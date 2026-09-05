'use client';

/**
 * The small facts that sit under a task title.
 *
 * Split into its own module because the same set of chips appears in four
 * places — the ranked queue, the Daily Three, the timeline and the detail sheet
 * — and they must read identically in all of them. A deadline styled as urgent
 * in one list and neutral in another teaches the user that the color means
 * nothing.
 *
 * Coral appears only when work is genuinely overdue or due today. Everything
 * else is neutral, which is what keeps coral meaningful.
 */
import { AlertTriangle, Clock, Link2, Lock, Repeat, Zap } from 'lucide-react';
import * as React from 'react';

import { useMinuteNow } from '@/components/hooks/use-clock';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';
import { describeDueDate, formatDuration, formatTimeLabel, parseIso } from '@/lib/dates';
import { describeRecurrence } from '@/lib/domain/recurrence';
import type { Goal, Task } from '@/lib/domain/types';
import { resolveGoalColor } from '@/lib/goal-colors';
import { cn, pluralize } from '@/lib/utils';

/** A goal's color and title as a single compact chip. */
export function GoalChip({ goal, className }: { goal: Goal; className?: string }) {
  return (
    <span
      className={cn(
        'text-ink-muted inline-flex max-w-40 items-center gap-1.5 text-[0.6875rem] font-medium',
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: resolveGoalColor(goal) }}
        aria-hidden
      />
      <span className="truncate">{goal.title}</span>
    </span>
  );
}

export interface TaskMetaProps {
  task: Task;
  goal?: Goal | null;
  timezone: string;
  /** Prerequisite titles, when the task cannot start yet. */
  blockedBy?: readonly string[];
  /** Hides the duration chip where the row already shows a time range. */
  hideDuration?: boolean;
  className?: string;
}

export function TaskMeta({
  task,
  goal,
  timezone,
  blockedBy,
  hideDuration = false,
  className,
}: TaskMetaProps) {
  const due = parseIso(task.dueAt);
  const now = useMinuteNow();
  const overdue =
    due !== null && now !== null && due.getTime() < now && task.status !== 'completed';
  const dueToday =
    due !== null && !overdue && describeDueDate(task.dueAt, timezone).includes('Today');

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
      {goal ? <GoalChip goal={goal} /> : null}

      {task.dueAt ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[0.6875rem] font-medium',
            overdue ? 'text-urgent-ink' : dueToday ? 'text-urgent' : 'text-ink-subtle',
          )}
        >
          {overdue ? (
            <AlertTriangle className="size-3" aria-hidden />
          ) : (
            <Clock className="size-3" aria-hidden />
          )}
          {describeDueDate(task.dueAt, timezone)}
        </span>
      ) : null}

      {task.scheduledStart && task.isFixedTime ? (
        <Hint label="A fixed commitment. The scheduler will not move it." side="top">
          <span className="text-ink-subtle inline-flex items-center gap-1 text-[0.6875rem] font-medium">
            <Lock className="size-3" aria-hidden />
            <time dateTime={task.scheduledStart}>
              {formatTimeLabel(task.scheduledStart, timezone)}
            </time>
          </span>
        </Hint>
      ) : null}

      {!hideDuration ? (
        <span
          className="text-ink-subtle inline-flex items-center gap-1 text-[0.6875rem]"
          data-numeric
        >
          {formatDuration(task.durationMinutes)}
        </span>
      ) : null}

      {task.energy === 'high' ? (
        <Hint
          label="Needs focus. Scheduled inside your high-energy window when possible."
          side="top"
        >
          <span className="text-ink-subtle inline-flex items-center gap-1 text-[0.6875rem] font-medium">
            <Zap className="size-3" aria-hidden />
            Deep work
          </span>
        </Hint>
      ) : null}

      {task.recurrenceRule ? (
        <Hint label={describeRecurrence(task.recurrenceRule)} side="top">
          <span className="text-ink-subtle inline-flex items-center gap-1 text-[0.6875rem]">
            <Repeat className="size-3" aria-hidden />
            Repeats
          </span>
        </Hint>
      ) : null}

      {task.manualPriority === 'urgent' ? (
        <Badge tone="urgent">Urgent</Badge>
      ) : task.manualPriority === 'high' ? (
        <Badge tone="primary">High</Badge>
      ) : task.manualPriority === 'low' ? (
        <Badge tone="outline">Low</Badge>
      ) : null}

      {blockedBy && blockedBy.length > 0 ? (
        <Hint label={`Waiting on: ${blockedBy.join(', ')}`} side="top">
          <span className="text-warning-ink inline-flex items-center gap-1 text-[0.6875rem] font-medium">
            <Link2 className="size-3" aria-hidden />
            Blocked by {pluralize(blockedBy.length, 'task')}
          </span>
        </Hint>
      ) : null}
    </div>
  );
}
