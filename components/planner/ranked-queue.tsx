'use client';

/**
 * The ranked queue.
 *
 * Everything that is not on the clock yet, in the order the priority engine
 * says it matters. Two things make this more than a sorted list:
 *
 * - **Every row can explain itself.** The score is visible and the reasons are
 *   one disclosure away, so the ordering is arguable rather than oracular.
 *
 * - **Manual order is still respected.** Dragging sets `position`, which is a
 *   real tie-break in the ranking rather than a cosmetic reorder that the next
 *   re-score throws away. The user's judgement is an input, not an override
 *   that gets silently discarded.
 *
 * Reordering is only offered on the manual sort, because dragging a row while
 * the list is sorted by score would show the row snapping back the instant the
 * scores were recomputed.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ListChecks } from 'lucide-react';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { DragHandle, TaskRow } from '@/components/planner/task-row';
import { ScoreDisclosure } from '@/components/planner/score-breakdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import type { RankedTask } from '@/lib/domain/priority';
import { cn } from '@/lib/utils';

export type QueueSort = 'score' | 'manual' | 'deadline';

export function RankedQueue({
  entries,
  onOpenTask,
  onStartFocus,
}: {
  entries: readonly RankedTask[];
  onOpenTask: (id: string) => void;
  onStartFocus: (id: string) => void;
}) {
  const {
    goalsById,
    timezone,
    tasks,
    completeTask,
    uncompleteTask,
    deleteTask,
    archiveTask,
    duplicateTask,
    reorderTasks,
  } = usePlanner();

  const [sort, setSort] = React.useState<QueueSort>('score');

  const sorted = React.useMemo(() => {
    if (sort === 'score') return entries;
    const copy = [...entries];
    if (sort === 'manual') {
      copy.sort((a, b) => a.task.position - b.task.position || a.task.id.localeCompare(b.task.id));
    } else {
      // Undated work sorts last: a task with no deadline is not "due at the
      // beginning of time".
      copy.sort((a, b) => {
        const aDue = a.task.dueAt ?? '\uffff';
        const bDue = b.task.dueAt ?? '\uffff';
        return aDue.localeCompare(bDue) || b.score.score - a.score.score;
      });
    }
    return copy;
  }, [entries, sort]);

  const titleById = React.useMemo(
    () => new Map(tasks.map((task) => [task.id, task.title])),
    [tasks],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = sorted.map((entry) => entry.task.id);
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;

      void reorderTasks(arrayMove(ids, from, to));
    },
    [sorted, reorderTasks],
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Your queue is clear"
        description="Everything active is either scheduled or done. Capture something new above and it will land here, ranked."
        size="sm"
      />
    );
  }

  const rows = sorted.map((entry, index) => (
    <QueueRow
      key={entry.task.id}
      entry={entry}
      rank={sort === 'score' ? index + 1 : undefined}
      sortable={sort === 'manual'}
      goal={goalsById.get(entry.task.goalId ?? '') ?? null}
      timezone={timezone}
      blockedBy={entry.score.blockedBy.map((id) => titleById.get(id) ?? 'a deleted task')}
      onOpen={onOpenTask}
      onComplete={completeTask}
      onUncomplete={uncompleteTask}
      onDelete={deleteTask}
      onArchive={archiveTask}
      onDuplicate={duplicateTask}
      onStartFocus={onStartFocus}
    />
  ));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink-subtle text-xs">
          {sort === 'score'
            ? 'Ranked by deadline, goal alignment, importance and effort fit.'
            : sort === 'manual'
              ? 'Your order. Drag to rearrange — it feeds back into the ranking.'
              : 'Soonest deadline first.'}
        </p>

        <Tabs value={sort} onValueChange={(value) => setSort(value as QueueSort)}>
          <TabsList aria-label="Sort the queue">
            <TabsTrigger value="score">Ranked</TabsTrigger>
            <TabsTrigger value="deadline">Due</TabsTrigger>
            <TabsTrigger value="manual">Mine</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {sort === 'manual' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sorted.map((entry) => entry.task.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">{rows}</ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="space-y-0.5">{rows}</ul>
      )}
    </div>
  );
}

type QueueRowProps = Omit<React.ComponentProps<typeof TaskRow>, 'task' | 'score' | 'dragHandle'> & {
  entry: RankedTask;
  sortable: boolean;
};

function QueueRow({ entry, sortable, ...rest }: QueueRowProps) {
  if (!sortable) {
    return (
      <li>
        <TaskRow task={entry.task} score={entry.score} {...rest} />
        <div className="mt-0.5 pl-11">
          <ScoreDisclosure score={entry.score} />
        </div>
      </li>
    );
  }
  return <SortableQueueRow entry={entry} {...rest} />;
}

function SortableQueueRow({ entry, ...rest }: Omit<QueueRowProps, 'sortable'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.task.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('touch-none', isDragging && 'relative z-10 opacity-90')}
    >
      <TaskRow
        task={entry.task}
        score={entry.score}
        dragHandle={
          <DragHandle
            attributes={attributes as React.HTMLAttributes<HTMLButtonElement>}
            listeners={listeners}
            isDragging={isDragging}
          />
        }
        {...rest}
      />
    </li>
  );
}
