'use client';

/**
 * A task in a list.
 *
 * The interaction model is deliberate: the checkbox completes, the title opens
 * the editor, the drag handle reorders, and the overflow menu holds everything
 * else. Making the whole row a single click target would mean a mis-tap while
 * reaching for the checkbox silently opens a sheet, which on a phone happens
 * constantly.
 *
 * The completion animation matters more than it looks. Ticking a task strikes
 * the title through and holds the row in place for a moment before the list
 * re-sorts, so the user sees *which* row they completed. Without the hold, the
 * row vanishes and re-ranking shuffles everything, and there is no confirmation
 * that the right thing happened.
 */
import { GripVertical, MoreHorizontal, PenLine, Play, Trash2, Archive, Copy } from 'lucide-react';
import * as React from 'react';

import { TaskMeta } from '@/components/planner/task-meta';
import { TopReasons } from '@/components/planner/score-breakdown';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TaskScore } from '@/lib/domain/priority';
import type { Goal, Task } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export interface TaskRowProps {
  task: Task;
  goal?: Goal | null;
  score?: TaskScore | null;
  timezone: string;
  blockedBy?: readonly string[];
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onDuplicate: (id: string) => void;
  onStartFocus?: (id: string) => void;
  /** Drag handle props from the sortable wrapper, when reordering is enabled. */
  dragHandle?: React.ReactNode;
  /** Shows the rank number, which is what makes the ordering legible. */
  rank?: number;
  className?: string;
}

export function TaskRow({
  task,
  goal,
  score,
  timezone,
  blockedBy,
  onOpen,
  onComplete,
  onUncomplete,
  onDelete,
  onArchive,
  onDuplicate,
  onStartFocus,
  dragHandle,
  rank,
  className,
}: TaskRowProps) {
  const completed = task.status === 'completed';

  /**
   * Holds the strike-through visible for one beat after the tick.
   *
   * The completion write refreshes the snapshot and the list re-ranks, so
   * without this the row would disappear in the same frame it was clicked.
   */
  const [justCompleted, setJustCompleted] = React.useState(false);

  const handleToggle = React.useCallback(
    (checked: boolean) => {
      if (checked) {
        setJustCompleted(true);
        onComplete(task.id);
        window.setTimeout(() => setJustCompleted(false), 400);
      } else {
        onUncomplete(task.id);
      }
    },
    [onComplete, onUncomplete, task.id],
  );

  return (
    <div
      data-task-id={task.id}
      className={cn(
        'group relative flex items-start gap-3 rounded-md border border-transparent px-2 py-2.5',
        'hover:border-line hover:bg-surface-hover transition-colors',
        completed && 'opacity-60',
        className,
      )}
    >
      {dragHandle ?? null}

      {rank !== undefined ? (
        <span
          className="text-ink-subtle mt-1 w-4 shrink-0 text-center text-xs font-semibold tabular-nums"
          aria-hidden
        >
          {rank}
        </span>
      ) : null}

      <Checkbox
        checked={completed}
        onCheckedChange={(checked) => handleToggle(checked === true)}
        className="mt-0.5 shrink-0"
        // The task title is the accessible name, so a screen-reader user hears
        // what they are about to complete rather than just "checkbox".
        aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />

      <div className="min-w-0 flex-1 space-y-1.5">
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className={cn(
            'text-ink block w-full rounded-sm text-left text-[0.9375rem] leading-snug font-medium',
            'hover:text-primary',
            (completed || justCompleted) && 'decoration-ink-subtle line-through',
          )}
        >
          {task.title}
        </button>

        <TaskMeta task={task} goal={goal} timezone={timezone} blockedBy={blockedBy} />

        {score && !completed ? <TopReasons score={score} /> : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {score && !completed ? (
          <span
            className={cn(
              'text-ink-subtle hidden w-9 text-right text-xs font-semibold tabular-nums sm:block',
            )}
            aria-label={`Priority score ${score.score.toFixed(0)} out of 100`}
          >
            {score.score.toFixed(0)}
          </span>
        ) : null}

        {onStartFocus && !completed ? (
          <Button
            variant="ghost"
            size="iconSm"
            // Hidden until hover on pointer devices to keep rows calm, but
            // always present for keyboard and touch, where hover does not exist.
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
            aria-label={`Start a focus session on ${task.title}`}
            onClick={() => onStartFocus(task.id)}
          >
            <Play className="size-3.5" aria-hidden />
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={`More actions for ${task.title}`}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpen(task.id)}>
              <PenLine aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(task.id)}>
              <Copy aria-hidden />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArchive(task.id)}>
              <Archive aria-hidden />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => onDelete(task.id)}>
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** The visual drag affordance. Wired up by the sortable wrapper. */
export function DragHandle({
  attributes,
  listeners,
  isDragging,
}: {
  attributes?: React.HTMLAttributes<HTMLButtonElement>;
  listeners?: Record<string, unknown>;
  isDragging?: boolean;
}) {
  return (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className={cn(
        'text-ink-subtle mt-1 shrink-0 cursor-grab rounded-sm p-0.5',
        'hover:bg-surface-hover hover:text-ink-muted',
        isDragging && 'cursor-grabbing',
      )}
      aria-label="Reorder task"
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}
