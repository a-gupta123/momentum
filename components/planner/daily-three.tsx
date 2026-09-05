'use client';

/**
 * The Daily Three.
 *
 * The product's opinion, stated once per day: of everything competing for your
 * attention, these three move you furthest. Three because a list of ten
 * priorities is a list of zero priorities, and because three is the number a
 * person can still hold in their head walking away from the screen.
 *
 * Each card says *why* it made the cut. A shortlist you cannot interrogate is
 * just another list in a different font.
 */
import { Check, Play, Sparkles } from 'lucide-react';
import * as React from 'react';

import { usePlanner } from '@/components/planner/planner-store';
import { TaskMeta } from '@/components/planner/task-meta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { RankedTask } from '@/lib/domain/priority';
import { resolveGoalColor } from '@/lib/goal-colors';
import { cn } from '@/lib/utils';

export function DailyThree({
  entries,
  onOpenTask,
  onStartFocus,
}: {
  entries: readonly RankedTask[];
  onOpenTask: (id: string) => void;
  onStartFocus: (id: string) => void;
}) {
  const { goalsById, timezone, completeTask } = usePlanner();

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing to rank yet"
        description="Once you have a few tasks, the three that move you furthest today will appear here."
        size="sm"
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry, index) => {
        const goal = goalsById.get(entry.task.goalId ?? '') ?? null;

        return (
          <li key={entry.task.id}>
            <Card className="relative flex h-full flex-col overflow-hidden">
              {/* The goal's color as a top edge: identifies the goal at a
                  glance without spending a whole row on a label. */}
              <span
                className="absolute inset-x-0 top-0 h-[3px]"
                style={{ backgroundColor: goal ? resolveGoalColor(goal) : 'var(--primary)' }}
                aria-hidden
              />

              <div className="flex flex-1 flex-col gap-2.5 p-4 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full',
                      'bg-surface-sunken text-ink-muted text-[0.6875rem] font-semibold',
                    )}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <span
                    className="text-ink-subtle text-xs font-semibold tabular-nums"
                    aria-label={`Priority score ${entry.score.score.toFixed(0)} out of 100`}
                  >
                    {entry.score.score.toFixed(0)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenTask(entry.task.id)}
                  className="text-ink hover:text-primary rounded-sm text-left text-[0.9375rem] leading-snug font-semibold"
                >
                  {entry.task.title}
                </button>

                <TaskMeta task={entry.task} goal={goal} timezone={timezone} />

                {entry.score.topReasons.length > 0 ? (
                  <p className="text-ink-subtle text-xs leading-relaxed">
                    {entry.score.topReasons.join(' · ')}
                  </p>
                ) : null}

                <div className="mt-auto flex gap-2 pt-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => onStartFocus(entry.task.id)}
                  >
                    <Play className="size-3.5" aria-hidden />
                    Focus
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void completeTask(entry.task.id)}
                    aria-label={`Complete ${entry.task.title}`}
                  >
                    <Check className="size-3.5" aria-hidden />
                    Done
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
