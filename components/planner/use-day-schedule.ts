'use client';

/**
 * Turns the snapshot into a schedule proposal.
 *
 * This hook is the bridge between the ranked queue and the timeline. It exists
 * so that the *proposal* is always derivable from current data without writing
 * anything: the timeline can show what the day would look like, the header can
 * show capacity and utilization, and nothing is persisted until the user
 * presses Optimize.
 *
 * Two mapping decisions carry most of the weight:
 *
 * 1. **Fixed commitments and locked blocks become immovable input.** A class
 *    the user typed and a block they pinned are both facts the scheduler must
 *    route around, so both arrive as `fixedBlocks` rather than as tasks with a
 *    strong preference. Modelling them as preferences would let a busy day
 *    quietly move a lecture.
 *
 * 2. **Scores come from the priority engine, not from the scheduler.** The
 *    scheduler never re-derives priority; it places what it is given in the
 *    order it is given. Keeping those two concerns apart is what makes each of
 *    them testable in isolation, and it is why the timeline and the queue can
 *    never disagree about which task matters more.
 */
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { dayKeyOf, parseIso, toIso } from '@/lib/dates';
import {
  buildDaySchedule,
  type DaySchedule,
  type FixedBlockInput,
  type SchedulableTaskInput,
} from '@/lib/domain/scheduler';
import type { Task } from '@/lib/domain/types';

export interface DayScheduleResult {
  /** The proposal for the selected day. `null` while loading. */
  schedule: DaySchedule | null;
  /** Tasks that are already fixed in place on this day. */
  fixedTasks: readonly Task[];
  /** Ranked, schedulable tasks not pinned to a time. */
  flexibleTasks: readonly Task[];
}

export function useDaySchedule(): DayScheduleResult {
  const { snapshot, ranked, dayKey, timezone, blockedTaskIds } = usePlanner();

  return React.useMemo<DayScheduleResult>(() => {
    if (!snapshot) return { schedule: null, fixedTasks: [], flexibleTasks: [] };

    const { profile, tasks, blocks } = snapshot;

    // A commitment counts for this day if its *start* falls on this calendar
    // day in the user's zone — which is why the comparison goes through
    // `dayKeyOf` rather than a string prefix on the UTC timestamp.
    const onThisDay = (iso: string | null): boolean => {
      const instant = parseIso(iso);
      return instant !== null && dayKeyOf(instant, timezone) === dayKey;
    };

    const fixedTasks = tasks.filter(
      (task) =>
        task.isFixedTime &&
        task.status !== 'archived' &&
        task.archivedAt === null &&
        onThisDay(task.scheduledStart),
    );

    const fixedBlocks: FixedBlockInput[] = [];

    for (const task of fixedTasks) {
      const start = parseIso(task.scheduledStart);
      if (!start) continue;
      const end =
        parseIso(task.scheduledEnd) ?? new Date(start.getTime() + task.durationMinutes * 60_000);

      fixedBlocks.push({
        id: `task:${task.id}`,
        taskId: task.id,
        title: task.title,
        startAt: toIso(start),
        endAt: toIso(end),
      });
    }

    // Pinned blocks from a previously saved plan. Excluded when they are backed
    // by a fixed-time task, which is already in the list above — otherwise the
    // same commitment would be reserved twice and reported as a conflict with
    // itself.
    const fixedTaskIds = new Set(fixedTasks.map((task) => task.id));
    for (const block of blocks) {
      if (!block.isLocked) continue;
      if (block.taskId && fixedTaskIds.has(block.taskId)) continue;

      fixedBlocks.push({
        id: `block:${block.id}`,
        taskId: block.taskId,
        title: block.title ?? tasks.find((task) => task.id === block.taskId)?.title ?? 'Reserved',
        startAt: block.startAt,
        endAt: block.endAt,
      });
    }

    const lockedTaskIds = new Set(
      blocks.filter((block) => block.isLocked && block.taskId).map((block) => block.taskId),
    );

    const flexibleTasks: Task[] = [];
    const schedulable: SchedulableTaskInput[] = [];

    for (const entry of ranked) {
      const task = entry.task;
      if (task.status === 'completed' || task.isFixedTime) continue;
      if (lockedTaskIds.has(task.id)) continue;

      // A task with a deadline further out is still a candidate for today — the
      // scheduler decides whether it earns a slot. Only work already pinned to
      // a *different* day is excluded, so navigating to tomorrow does not
      // silently pull today's plan along.
      if (task.scheduledStart && !onThisDay(task.scheduledStart)) continue;

      flexibleTasks.push(task);
      schedulable.push({
        id: task.id,
        title: task.title,
        durationMinutes: task.durationMinutes,
        score: entry.score.score,
        dueAt: task.dueAt,
        energy: task.energy,
        importance: task.importance,
        splittable: task.splittable,
        blocked: entry.score.blocked,
        position: task.position,
      });
    }

    const schedule = buildDaySchedule({
      date: dayKey,
      timezone,
      workdayStart: profile.workdayStart,
      workdayEnd: profile.workdayEnd,
      breakMinutes: profile.breakMinutes,
      highEnergyStart: profile.highEnergyStart,
      highEnergyEnd: profile.highEnergyEnd,
      fixedBlocks,
      tasks: schedulable,
      allowSplitting: profile.splitLongTasks,
      now: new Date(),
    });

    return { schedule, fixedTasks, flexibleTasks };
    // `blockedTaskIds` is already folded into `ranked`, but it is listed so a
    // dependency change recomputes even if scores happen to be unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, ranked, dayKey, timezone, blockedTaskIds]);
}
