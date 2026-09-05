'use client';

/**
 * Today.
 *
 * The one screen the product is really about, arranged as an argument:
 *
 *   1. **Capture** — say it in a sentence, review what the app understood.
 *   2. **Decide** — the Daily Three, the three things that actually matter.
 *   3. **Place** — a capacity-checked timeline you can argue with by dragging.
 *   4. **Everything else** — ranked, explainable, and honest about what did
 *      not fit.
 *
 * The order is deliberate. A planner that opens on a flat backlog makes you do
 * the triage yourself; this one leads with its opinion and keeps the raw list
 * one scroll down for when you disagree.
 */
import { CalendarDays, Plus } from 'lucide-react';
import * as React from 'react';

import { Composer } from '@/components/planner/composer';
import { DailyThree } from '@/components/planner/daily-three';
import { DayPlanPanel, useCommitPlan } from '@/components/planner/day-plan-panel';
import { DayTimeline } from '@/components/planner/day-timeline';
import { FocusTimerCard, useFocusTimer } from '@/components/planner/focus-timer';
import { NewTaskDialog } from '@/components/planner/new-task-dialog';
import { usePlanner } from '@/components/planner/planner-store';
import { ProgressDial } from '@/components/planner/progress-dial';
import { RankedQueue } from '@/components/planner/ranked-queue';
import { TaskDetailSheet } from '@/components/planner/task-detail-sheet';
import { useAssistant } from '@/components/planner/use-assistant';
import { useDaySchedule } from '@/components/planner/use-day-schedule';
import { PageContainer, PageHeader, Section } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import {
  dayKeyDifference,
  dayKeyOf,
  formatDuration,
  formatLongDate,
  parseIso,
  startOfDayInZone,
} from '@/lib/dates';
import { pluralize } from '@/lib/utils';

export default function TodayPage() {
  const planner = usePlanner();
  const assistant = useAssistant();
  const focus = useFocusTimer();
  const { schedule } = useDaySchedule();
  const commitController = useCommitPlan(schedule);

  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const openTask = React.useCallback((id: string) => setOpenTaskId(id), []);
  const startFocus = React.useCallback(
    (id: string) => {
      void focus.start(id);
    },
    [focus],
  );

  /**
   * `optimize_day` is the one assistant action that is not a data mutation, so
   * it is completed here rather than in the apply pipeline. Committing only
   * the day currently on screen keeps the effect visible — silently rewriting
   * a day the user cannot see is exactly the kind of thing this app avoids.
   */
  const { pendingOptimizeDates, consumeOptimizeDates } = assistant;
  const { dayKey } = planner;
  const { commit } = commitController;

  React.useEffect(() => {
    if (pendingOptimizeDates.length === 0) return;
    const wantsToday = pendingOptimizeDates.includes(dayKey);
    consumeOptimizeDates();
    if (wantsToday) void commit();
  }, [pendingOptimizeDates, dayKey, consumeOptimizeDates, commit]);

  const progress = useDayProgress();

  if (planner.status === 'loading') return <TodaySkeleton />;

  if (planner.status === 'error') {
    return (
      <PageContainer>
        <Card className="p-6">
          <h1 className="text-ink text-lg font-semibold">Could not load your planner</h1>
          <p className="text-ink-muted mt-1 text-sm">{planner.error}</p>
          <Button className="mt-4" onClick={() => void planner.refresh()}>
            Try again
          </Button>
        </Card>
      </PageContainer>
    );
  }

  const isToday = planner.dayKey === planner.today;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={dayEyebrow(planner.dayKey, planner.today)}
        title={formatLongDate(startOfDayInZone(planner.dayKey, planner.timezone), planner.timezone)}
        description={
          progress.total === 0
            ? 'Nothing on the books yet. Describe your day below and it will take shape.'
            : `${pluralize(progress.completed, 'task')} done of ${progress.total}. ${
                progress.remainingMinutes > 0
                  ? `${formatDuration(progress.remainingMinutes)} of estimated work left.`
                  : 'The board is clear.'
              }`
        }
        actions={
          <>
            {!isToday ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => planner.setDayKey(planner.today)}
              >
                <CalendarDays className="size-3.5" aria-hidden />
                Back to today
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setIsCreating(true)}>
              <Plus className="size-3.5" aria-hidden />
              New task
            </Button>
          </>
        }
      />

      <FocusTimerCard controller={focus} />

      {/* The composer renders its own preview inline, so the review step reads
          as a continuation of what you typed rather than a separate panel. */}
      <Composer assistant={assistant} />

      <Section
        title="Your Daily Three"
        description="The highest-leverage work on the board right now, and why."
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <DailyThree
              entries={planner.dailyThree}
              onOpenTask={openTask}
              onStartFocus={startFocus}
            />
          </div>

          {progress.total > 0 ? (
            <Card className="flex shrink-0 items-center gap-4 p-4 xl:w-56 xl:flex-col xl:text-center">
              <ProgressDial
                completedCount={progress.completed}
                totalCount={progress.total}
                completedMinutes={progress.completedMinutes}
                plannedMinutes={progress.plannedMinutes}
              />
              <div className="min-w-0">
                <p className="text-ink text-sm font-medium">Day progress</p>
                <p className="text-ink-subtle text-xs">
                  {progress.completedMinutes > 0
                    ? `${formatDuration(progress.completedMinutes)} logged`
                    : 'Nothing logged yet'}
                </p>
              </div>
            </Card>
          ) : null}
        </div>
      </Section>

      {schedule ? (
        <Section
          title="The plan"
          description="Fixed commitments are immovable. Everything else is placed around them."
        >
          <div className="space-y-3">
            <DayPlanPanel
              schedule={schedule}
              commitController={commitController}
              onOpenTask={openTask}
            />
            <DayTimeline schedule={schedule} onOpenTask={openTask} />
          </div>
        </Section>
      ) : null}

      <Section title="Queue" description="Everything else, in the order it earns.">
        <RankedQueue entries={planner.ranked} onOpenTask={openTask} onStartFocus={startFocus} />
      </Section>

      <TaskDetailSheet
        taskId={openTaskId}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
      />

      <NewTaskDialog
        open={isCreating}
        onOpenChange={setIsCreating}
        defaultDayKey={planner.dayKey}
      />
    </PageContainer>
  );
}

/** "Today", "Tomorrow", or how far out the day on screen is. */
function dayEyebrow(dayKey: string, today: string): string {
  const offset = dayKeyDifference(today, dayKey);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return offset > 0 ? `In ${pluralize(offset, 'day')}` : `${pluralize(-offset, 'day')} ago`;
}

interface DayProgress {
  completed: number;
  total: number;
  completedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
}

/**
 * Progress for the day on screen.
 *
 * A task counts toward today if it is scheduled today, due today, or was
 * completed today — which is what makes finishing something unplanned still
 * register as progress. A dial that only credits work you predicted is a dial
 * that punishes you for a useful day.
 */
function useDayProgress(): DayProgress {
  const { tasks, dayKey, timezone } = usePlanner();

  return React.useMemo(() => {
    const fallsToday = (iso: string | null): boolean => {
      const instant = parseIso(iso);
      return instant !== null && dayKeyOf(instant, timezone) === dayKey;
    };

    const relevant = tasks.filter(
      (task) =>
        task.status !== 'archived' &&
        task.archivedAt === null &&
        (fallsToday(task.scheduledStart) || fallsToday(task.dueAt) || fallsToday(task.completedAt)),
    );

    const completedTasks = relevant.filter((task) => task.status === 'completed');
    const completedMinutes = completedTasks.reduce(
      (sum, task) => sum + (task.actualMinutes ?? task.durationMinutes),
      0,
    );
    const plannedMinutes = relevant.reduce((sum, task) => sum + task.durationMinutes, 0);

    return {
      completed: completedTasks.length,
      total: relevant.length,
      completedMinutes,
      plannedMinutes,
      remainingMinutes: relevant
        .filter((task) => task.status !== 'completed')
        .reduce((sum, task) => sum + task.durationMinutes, 0),
    };
  }, [tasks, dayKey, timezone]);
}

function TodaySkeleton() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </PageContainer>
  );
}
