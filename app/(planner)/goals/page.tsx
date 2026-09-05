'use client';

/**
 * Goals.
 *
 * A goal here is not a folder — it is a weight in the ranking function. So the
 * page is built to answer one question per goal: *is this actually getting
 * time, or does it just exist?*
 *
 * That is why each card leads with hours invested this week against the weekly
 * target rather than a task count. Counting tasks rewards writing tasks down;
 * counting hours rewards doing them.
 */
import { Archive, MoreHorizontal, Pencil, Plus, Target } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { GoalDialog } from '@/components/goals/goal-dialog';
import { usePlanner } from '@/components/planner/planner-store';
import { PageContainer, PageHeader, Section } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress, Skeleton } from '@/components/ui/misc';
import {
  dayKeyDifference,
  dayKeyOf,
  formatDuration,
  parseIso,
  startOfWeekKey,
  todayKey,
} from '@/lib/dates';
import { effectiveMinutes } from '@/lib/domain/analytics';
import type { Goal, Task } from '@/lib/domain/types';
import { CATEGORY_LABELS, resolveGoalColor } from '@/lib/goal-colors';
import { cn, pluralize } from '@/lib/utils';

export default function GoalsPage() {
  const { status, goals, tasks, timezone, archiveGoal } = usePlanner();

  const [editing, setEditing] = React.useState<Goal | null>(null);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);

  const stats = useGoalStats(goals, tasks, timezone);

  const openNew = React.useCallback(() => {
    setEditing(null);
    setIsDialogOpen(true);
  }, []);

  const openEdit = React.useCallback((goal: Goal) => {
    setEditing(goal);
    setIsDialogOpen(true);
  }, []);

  if (status === 'loading') return <GoalsSkeleton />;

  const active = goals.filter((goal) => goal.status === 'active');
  const resting = goals.filter((goal) => goal.status === 'paused' || goal.status === 'achieved');

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Goals"
        title="What this is all for"
        description="Every task you rank is ranked against these. Weight them honestly — if everything is a five, nothing is."
        actions={
          <Button variant="primary" size="sm" onClick={openNew}>
            <Plus className="size-3.5" aria-hidden />
            New goal
          </Button>
        }
      />

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Add the two or three things you actually want to move this quarter. Tasks linked to them will rise up the queue on their own."
          action={
            <Button variant="primary" onClick={openNew}>
              <Plus className="size-4" aria-hidden />
              Add your first goal
            </Button>
          }
        />
      ) : (
        <>
          <Section
            title="Active"
            description={`${pluralize(active.length, 'goal')} currently influencing the ranking.`}
          >
            {active.length === 0 ? (
              <p className="text-ink-muted text-sm">
                Nothing active. Tasks will be ranked on deadline and importance alone.
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {active.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    stats={stats.get(goal.id)}
                    timezone={timezone}
                    onEdit={() => openEdit(goal)}
                    onArchive={async () => {
                      const ok = await archiveGoal(goal.id);
                      if (ok) toast.success('Goal archived. Its tasks kept their history.');
                    }}
                  />
                ))}
              </ul>
            )}
          </Section>

          {resting.length > 0 ? (
            <Section
              title="Paused and completed"
              description="Kept for history. These no longer affect how tasks are ranked."
            >
              <ul className="grid gap-3 md:grid-cols-2">
                {resting.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    stats={stats.get(goal.id)}
                    timezone={timezone}
                    muted
                    onEdit={() => openEdit(goal)}
                    onArchive={async () => {
                      const ok = await archiveGoal(goal.id);
                      if (ok) toast.success('Goal archived.');
                    }}
                  />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}

      <GoalDialog goal={editing} open={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </PageContainer>
  );
}

interface GoalStats {
  openTasks: number;
  completedTasks: number;
  minutesThisWeek: number;
  /** Progress toward the weekly target, 0–1, or `null` when there is no target. */
  weekProgress: number | null;
}

function GoalCard({
  goal,
  stats,
  timezone,
  muted,
  onEdit,
  onArchive,
}: {
  goal: Goal;
  stats: GoalStats | undefined;
  timezone: string;
  muted?: boolean;
  onEdit: () => void;
  onArchive: () => void | Promise<void>;
}) {
  const color = resolveGoalColor(goal);
  const daysLeft =
    goal.targetDate === null ? null : dayKeyDifference(todayKey(timezone), goal.targetDate);

  return (
    <li>
      <Card className={cn('h-full overflow-hidden', muted && 'opacity-75')}>
        <span className="block h-[3px]" style={{ backgroundColor: color }} aria-hidden />

        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-ink text-sm font-semibold">{goal.title}</h3>
                <Badge tone="outline">{CATEGORY_LABELS[goal.category]}</Badge>
                {goal.status !== 'active' ? (
                  <Badge tone="neutral">{goal.status === 'paused' ? 'Paused' : 'Achieved'}</Badge>
                ) : null}
              </div>
              {goal.description ? (
                <p className="text-ink-muted text-xs leading-relaxed">{goal.description}</p>
              ) : null}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="iconSm" aria-label={`Actions for ${goal.title}`}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-3.5" aria-hidden />
                  Edit goal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void onArchive()} destructive>
                  <Archive className="size-3.5" aria-hidden />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* The honest metric: time invested this week, not tasks filed. */}
          {goal.weeklyTargetMinutes !== null ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-muted">This week</span>
                <span className="text-ink font-medium tabular-nums">
                  {formatDuration(stats?.minutesThisWeek ?? 0)} of{' '}
                  {formatDuration(goal.weeklyTargetMinutes)}
                </span>
              </div>
              <Progress
                value={(stats?.weekProgress ?? 0) * 100}
                tone={(stats?.weekProgress ?? 0) >= 1 ? 'success' : 'primary'}
                aria-label={`${goal.title} weekly progress`}
              />
            </div>
          ) : (
            <p className="text-ink-muted text-xs">
              {formatDuration(stats?.minutesThisWeek ?? 0)} invested this week
              <span className="text-ink-subtle"> · no weekly target set</span>
            </p>
          )}

          <dl className="text-ink-subtle flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <div className="flex items-baseline gap-1">
              <dt>Weight</dt>
              <dd className="text-ink-muted font-medium tabular-nums">{goal.priorityWeight}/5</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt>Open</dt>
              <dd className="text-ink-muted font-medium tabular-nums">{stats?.openTasks ?? 0}</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt>Done</dt>
              <dd className="text-ink-muted font-medium tabular-nums">
                {stats?.completedTasks ?? 0}
              </dd>
            </div>
            {daysLeft !== null ? (
              <div className="flex items-baseline gap-1">
                <dt>Target</dt>
                <dd
                  className={cn(
                    'font-medium tabular-nums',
                    daysLeft < 0 ? 'text-danger' : 'text-ink-muted',
                  )}
                >
                  {daysLeft < 0
                    ? `${pluralize(-daysLeft, 'day')} overdue`
                    : daysLeft === 0
                      ? 'today'
                      : `in ${pluralize(daysLeft, 'day')}`}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </Card>
    </li>
  );
}

/**
 * Per-goal counts and this week's invested minutes.
 *
 * "This week" is the calendar week in the profile's timezone, so the number
 * resets when the user's Monday arrives rather than the server's.
 */
function useGoalStats(
  goals: readonly Goal[],
  tasks: readonly Task[],
  timezone: string,
): Map<string, GoalStats> {
  return React.useMemo(() => {
    const weekStart = startOfWeekKey(todayKey(timezone));

    const stats = new Map<string, GoalStats>();
    for (const goal of goals) {
      stats.set(goal.id, {
        openTasks: 0,
        completedTasks: 0,
        minutesThisWeek: 0,
        weekProgress: goal.weeklyTargetMinutes === null ? null : 0,
      });
    }

    for (const task of tasks) {
      if (task.goalId === null) continue;
      const entry = stats.get(task.goalId);
      if (!entry || task.archivedAt !== null) continue;

      if (task.status === 'completed') {
        entry.completedTasks += 1;

        const completedAt = parseIso(task.completedAt);
        if (completedAt && dayKeyOf(completedAt, timezone) >= weekStart) {
          entry.minutesThisWeek += effectiveMinutes(task);
        }
      } else if (task.status !== 'archived') {
        entry.openTasks += 1;
      }
    }

    for (const goal of goals) {
      const entry = stats.get(goal.id);
      if (!entry || goal.weeklyTargetMinutes === null || goal.weeklyTargetMinutes === 0) continue;
      entry.weekProgress = Math.min(1, entry.minutesThisWeek / goal.weeklyTargetMinutes);
    }

    return stats;
  }, [goals, tasks, timezone]);
}

function GoalsSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </PageContainer>
  );
}
