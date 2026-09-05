'use client';

/**
 * The day, drawn to scale.
 *
 * Blocks are positioned by *proportion of the working window*, not by a fixed
 * pixels-per-minute constant. That is what lets a 6-hour day and a 14-hour day
 * both fill the same column legibly, and it means the visual weight of a block
 * always reflects how much of the day it consumes — which is the entire point
 * of looking at a timeline rather than a list.
 *
 * Drag-to-reschedule uses dnd-kit with a keyboard sensor, so a block can be
 * moved with arrow keys and not only with a pointer. Dropping snaps to the
 * scheduler's own slot size, because a plan at 09:07 is not a plan anyone
 * asked for.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CalendarRange, Coffee, Lock } from 'lucide-react';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { useMinuteNow } from '@/components/hooks/use-clock';
import { EmptyState } from '@/components/ui/empty-state';
import { Hint } from '@/components/ui/tooltip';
import { formatDuration, formatTimeLabel, minutesBetween, parseIso, toIso } from '@/lib/dates';
import { DEFAULT_SCHEDULING_CONFIG } from '@/lib/domain/tuning';
import type { DaySchedule, ScheduledBlock } from '@/lib/domain/scheduler';
import type { Goal, Task } from '@/lib/domain/types';
import { resolveGoalColor } from '@/lib/goal-colors';
import { cn } from '@/lib/utils';

const SNAP_MINUTES = DEFAULT_SCHEDULING_CONFIG.slotMinutes;

/**
 * How tall the column is.
 *
 * Height follows the hours in view rather than being fixed, so an hour is the
 * same distance whether six of them are on screen or twelve. Crucially the
 * scale is then stretched until the *shortest block in the plan* is still
 * legible: the alternative is clamping individual blocks to a minimum height,
 * which silently breaks the one promise a timeline makes — that position and
 * size mean time. A clamped 15-minute block overlaps the block after it and
 * clips its own label, so the scale bends instead of the blocks.
 */
const BASE_PX_PER_HOUR = 76;
/** A block must clear this to hold one line of text with its padding. */
const MIN_BLOCK_PX = 30;
const MIN_TIMELINE_PX = 360;
const MAX_TIMELINE_PX = 1200;

function timelineHeight(totalMinutes: number, blocks: readonly ScheduledBlock[]): number {
  const shortest = blocks.reduce(
    (min, block) => (block.durationMinutes > 0 ? Math.min(min, block.durationMinutes) : min),
    60,
  );
  const pxPerHour = Math.max(BASE_PX_PER_HOUR, (MIN_BLOCK_PX * 60) / shortest);
  const ideal = (totalMinutes / 60) * pxPerHour;
  return Math.round(Math.min(MAX_TIMELINE_PX, Math.max(MIN_TIMELINE_PX, ideal)));
}

export function DayTimeline({
  schedule,
  onOpenTask,
}: {
  schedule: DaySchedule;
  onOpenTask: (id: string) => void;
}) {
  const { tasks, goalsById, timezone, updateTask, dayKey, today } = usePlanner();

  const sensors = useSensors(
    // A small activation distance keeps a tap on a block from being read as a
    // drag, which otherwise makes the block un-openable on touch.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const taskById = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const clockMs = useMinuteNow();
  // A "now" line across a plan for next Tuesday would be actively misleading,
  // so the clock is withheld rather than clamped to an edge.
  const nowMs = dayKey === today ? clockMs : null;

  /**
   * Everything geometric, resolved once.
   *
   * Computed in one memo keyed on primitives — ISO strings and a millisecond
   * number — rather than as a chain of conditional expressions over freshly
   * parsed `Date` objects. Dates allocate a new identity every render, so the
   * chain both recomputed constantly and left the drag handler's dependencies
   * unanalysable.
   */
  const layout = React.useMemo(() => {
    const dayStart = parseIso(schedule.windowStart);
    const dayEnd = parseIso(schedule.windowEnd);
    if (!dayStart || !dayEnd) return null;

    const now = nowMs === null ? null : new Date(nowMs);
    const { start, end } = viewWindow(dayStart, dayEnd, schedule.blocks, now);
    const totalMinutes = minutesBetween(start, end);
    if (totalMinutes <= 0) return null;

    return {
      start,
      end,
      totalMinutes,
      height: timelineHeight(totalMinutes, schedule.blocks),
      nowOffset: offsetRatio(start, totalMinutes, now),
      trimmed: minutesBetween(dayStart, start) > 0,
    };
  }, [schedule.windowStart, schedule.windowEnd, schedule.blocks, nowMs]);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!layout) return;

      const blockId = String(event.active.id);
      const block = schedule.blocks.find((candidate) => candidate.id === blockId);
      if (!block?.taskId) return;

      const deltaMinutes =
        Math.round(((event.delta.y / layout.height) * layout.totalMinutes) / SNAP_MINUTES) *
        SNAP_MINUTES;

      if (deltaMinutes === 0) return;

      const start = parseIso(block.startAt);
      if (!start) return;

      const nextStart = new Date(start.getTime() + deltaMinutes * 60_000);
      const task = taskById.get(block.taskId);
      if (!task) return;

      // A manual move is a decision, so the task becomes fixed to that time.
      // Otherwise the next Optimize would helpfully undo what the user just did.
      void updateTask(task.id, {
        scheduledStart: toIso(nextStart),
        scheduledEnd: toIso(new Date(nextStart.getTime() + task.durationMinutes * 60_000)),
        isFixedTime: true,
        status: task.status === 'inbox' ? 'planned' : task.status,
      });
    },
    [schedule.blocks, layout, taskById, updateTask],
  );

  if (!layout) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Your working day has no length"
        description="Set a start and end time in Settings and the timeline will fill in."
      />
    );
  }

  if (schedule.blocks.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing scheduled yet"
        description="Add a few tasks, then press Optimize day to lay them out across the hours you have."
        size="sm"
      />
    );
  }

  const { start: windowStart, end: windowEnd, totalMinutes, height, nowOffset, trimmed } = layout;

  return (
    <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
      <div className="flex gap-2">
        <HourGutter
          start={windowStart}
          totalMinutes={totalMinutes}
          timezone={timezone}
          height={height}
        />

        <div
          className="relative min-w-0 flex-1"
          style={{ height }}
          role="list"
          aria-label={`Schedule from ${formatTimeLabel(windowStart, timezone)} to ${formatTimeLabel(windowEnd, timezone)}`}
        >
          <HourLines start={windowStart} totalMinutes={totalMinutes} />

          {nowOffset !== null ? <NowMarker offsetRatio={nowOffset} /> : null}

          {schedule.blocks.map((block) => (
            <TimelineBlock
              key={block.id}
              block={block}
              task={block.taskId ? (taskById.get(block.taskId) ?? null) : null}
              goal={
                block.taskId
                  ? (goalsById.get(taskById.get(block.taskId)?.goalId ?? '') ?? null)
                  : null
              }
              windowStart={windowStart}
              totalMinutes={totalMinutes}
              timezone={timezone}
              onOpen={onOpenTask}
            />
          ))}
        </div>
      </div>

      {trimmed ? (
        <p className="text-ink-subtle mt-2 pl-13 text-xs">
          Earlier hours are hidden because nothing is scheduled in them.
        </p>
      ) : null}
    </DndContext>
  );
}

function HourGutter({
  start,
  totalMinutes,
  timezone,
  height,
}: {
  start: Date;
  totalMinutes: number;
  timezone: string;
  height: number;
}) {
  const marks = hourMarks(start, totalMinutes);

  return (
    <div className="relative w-11 shrink-0" style={{ height }} aria-hidden>
      {marks.map((mark) => (
        <span
          key={mark.offsetMinutes}
          className="text-ink-subtle absolute right-0 -translate-y-1/2 text-[0.6875rem] tabular-nums"
          style={{ top: `${(mark.offsetMinutes / totalMinutes) * 100}%` }}
        >
          {formatTimeLabel(mark.instant, timezone)}
        </span>
      ))}
    </div>
  );
}

function HourLines({ start, totalMinutes }: { start: Date; totalMinutes: number }) {
  const marks = hourMarks(start, totalMinutes);
  return (
    <div className="absolute inset-0" aria-hidden>
      {marks.map((mark) => (
        <div
          key={mark.offsetMinutes}
          className="absolute inset-x-0 border-t border-dashed"
          style={{
            top: `${(mark.offsetMinutes / totalMinutes) * 100}%`,
            borderColor: 'var(--timeline-line)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * "You are here."
 *
 * Only rendered when the selected day *is* today — a red line across a plan for
 * next Tuesday would be actively misleading.
 */
function NowMarker({ offsetRatio }: { offsetRatio: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center gap-1"
      style={{ top: `${offsetRatio * 100}%` }}
      aria-hidden
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: 'var(--timeline-now)' }}
      />
      <span className="h-px flex-1" style={{ backgroundColor: 'var(--timeline-now)' }} />
    </div>
  );
}

function TimelineBlock({
  block,
  task,
  goal,
  windowStart,
  totalMinutes,
  timezone,
  onOpen,
}: {
  block: ScheduledBlock;
  task: Task | null;
  goal: Goal | null;
  windowStart: Date;
  totalMinutes: number;
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const start = parseIso(block.startAt);
  const end = parseIso(block.endAt);
  if (!start || !end) return null;

  const offsetMinutes = minutesBetween(windowStart, start);
  const topPct = (offsetMinutes / totalMinutes) * 100;
  const heightPct = (block.durationMinutes / totalMinutes) * 100;

  const draggable = block.blockType === 'task' && Boolean(block.taskId) && !block.isLocked;
  const accent =
    block.blockType === 'break'
      ? 'var(--ink-subtle)'
      : block.blockType === 'fixed'
        ? 'var(--ink-muted)'
        : goal
          ? resolveGoalColor(goal)
          : 'var(--primary)';

  // Below roughly 40 minutes there is not enough height for two lines, so the
  // time moves onto the title row instead of being clipped.
  const compact = block.durationMinutes < 40;

  return (
    <BlockShell
      id={block.id}
      draggable={draggable}
      // Exactly proportional. See `timelineHeight`: legibility is bought by
      // scaling the column, never by inflating a block past its real duration.
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      <div
        className={cn(
          'group flex h-full w-full overflow-hidden rounded-md border text-left transition-shadow',
          block.blockType === 'break'
            ? 'border-line bg-surface-sunken border-dashed'
            : 'border-line bg-surface shadow-xs hover:shadow-sm',
        )}
      >
        <span
          className="w-1 shrink-0 rounded-l-[5px]"
          style={{ backgroundColor: accent }}
          aria-hidden
        />

        <div className={cn('min-w-0 flex-1 px-2', compact ? 'py-1' : 'py-1.5')}>
          {block.blockType === 'break' ? (
            <p className="text-ink-subtle flex items-center gap-1.5 text-[0.6875rem] font-medium">
              <Coffee className="size-3" aria-hidden />
              Break · {formatDuration(block.durationMinutes)}
            </p>
          ) : (
            <div className={cn('flex min-w-0 gap-1.5', compact ? 'items-baseline' : 'flex-col')}>
              <button
                type="button"
                disabled={!task}
                onClick={() => task && onOpen(task.id)}
                className={cn(
                  'min-w-0 truncate rounded-sm text-left text-[0.8125rem] leading-tight font-medium',
                  task ? 'text-ink hover:text-primary' : 'text-ink cursor-default',
                )}
              >
                {block.title}
                {block.chunkCount && block.chunkCount > 1 ? (
                  <span className="text-ink-subtle ml-1 text-[0.6875rem] font-normal">
                    ({block.chunkIndex} of {block.chunkCount})
                  </span>
                ) : null}
              </button>

              <p className="text-ink-subtle flex shrink-0 items-center gap-1.5 text-[0.6875rem]">
                <time dateTime={block.startAt}>{formatTimeLabel(start, timezone)}</time>
                {!compact ? (
                  <>
                    <span aria-hidden>–</span>
                    <time dateTime={block.endAt}>{formatTimeLabel(end, timezone)}</time>
                  </>
                ) : null}
                {block.isLocked ? (
                  <Hint label="Pinned. The scheduler will not move this." side="top">
                    <Lock className="size-3" aria-hidden />
                  </Hint>
                ) : null}
              </p>
            </div>
          )}
        </div>
      </div>
    </BlockShell>
  );
}

/**
 * Wraps a block so only draggable ones pay for a dnd-kit hook.
 *
 * Calling `useDraggable` conditionally is not allowed, so the branch has to
 * happen at the component boundary rather than inside one component.
 *
 * This wrapper also carries `role="listitem"`, because it is the direct child
 * of the `role="list"` container. Putting it on the inner card instead leaves a
 * generic element between list and item, and a list whose items are not its
 * children is not a list to a screen reader.
 */
function BlockShell({
  id,
  draggable,
  style,
  children,
}: {
  id: string;
  draggable: boolean;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (!draggable) {
    return (
      <div className="absolute inset-x-0 z-10" style={style} role="listitem">
        {children}
      </div>
    );
  }
  return (
    <DraggableBlock id={id} style={style}>
      {children}
    </DraggableBlock>
  );
}

function DraggableBlock({
  id,
  style,
  children,
}: {
  id: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn('absolute inset-x-0 z-10 touch-none', isDragging && 'z-30 opacity-90')}
      style={{
        ...style,
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
      }}
      {...attributes}
      {...listeners}
      // After the spread on purpose. dnd-kit sets `role="button"`, which would
      // orphan this block from the surrounding list; its `tabIndex` and
      // `aria-roledescription="draggable"` survive, so the block is still a
      // focusable, announced drag target — just one that is also a list item.
      role="listitem"
    >
      {children}
    </div>
  );
}

/** Hour boundaries inside the window, for the gutter and the grid lines. */
function hourMarks(
  start: Date,
  totalMinutes: number,
): Array<{ offsetMinutes: number; instant: Date }> {
  const marks: Array<{ offsetMinutes: number; instant: Date }> = [];

  // Start at the first whole hour at or after the window start, so a day
  // beginning at 09:30 does not draw a line labelled 09:30.
  const minutesPastHour = start.getMinutes();
  const firstOffset = minutesPastHour === 0 ? 0 : 60 - minutesPastHour;

  for (let offset = firstOffset; offset <= totalMinutes; offset += 60) {
    marks.push({
      offsetMinutes: offset,
      instant: new Date(start.getTime() + offset * 60_000),
    });
  }

  return marks;
}

/** Where an instant sits in the window as a 0–1 ratio, or `null` if outside. */
function offsetRatio(start: Date, totalMinutes: number, instant: Date | null): number | null {
  if (!instant || totalMinutes <= 0) return null;
  const ratio = minutesBetween(start, instant) / totalMinutes;
  return ratio >= 0 && ratio <= 1 ? ratio : null;
}

/**
 * The slice of the day worth drawing.
 *
 * A working window runs twelve hours, but a plan built at 3pm occupies only the
 * last six. Drawing the whole window spends half the column on empty grid to
 * report that nothing happened this morning — which the user already knows, and
 * which pushes the actual plan below the fold. So the view is trimmed to the
 * hours that hold the plan, extended to include "now" when the day is today,
 * and snapped outward to whole hours so the gutter still reads cleanly.
 */
function viewWindow(
  dayStart: Date,
  dayEnd: Date,
  blocks: readonly ScheduledBlock[],
  now: Date | null,
): { start: Date; end: Date } {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const block of blocks) {
    const start = parseIso(block.startAt);
    const end = parseIso(block.endAt);
    if (start) earliest = Math.min(earliest, start.getTime());
    if (end) latest = Math.max(latest, end.getTime());
  }

  if (earliest > latest) return { start: dayStart, end: dayEnd };

  // "Now" only earns space on the timeline while it falls inside the working
  // day; at 11pm the marker is not showable and stretching to reach it would
  // add hours of blank grid to chase a line that cannot be drawn.
  if (now && now >= dayStart && now <= dayEnd) {
    earliest = Math.min(earliest, now.getTime());
    latest = Math.max(latest, now.getTime());
  }

  return { start: floorToHour(new Date(earliest)), end: ceilToHour(new Date(latest)) };
}

function floorToHour(instant: Date): Date {
  const floored = new Date(instant);
  floored.setMinutes(0, 0, 0);
  return floored;
}

function ceilToHour(instant: Date): Date {
  const ceiled = floorToHour(instant);
  if (ceiled.getTime() < instant.getTime()) ceiled.setHours(ceiled.getHours() + 1);
  return ceiled;
}
