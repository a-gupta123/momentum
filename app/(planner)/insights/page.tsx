'use client';

/**
 * Insights.
 *
 * The rule this page is written to: **report, never scold**. A drop is stated
 * as a number and a direction, with no adjective attached. Productivity tools
 * that editorialise get closed on the first bad week, which is exactly the week
 * the data would have been most useful.
 *
 * The second rule is that a number is only shown once it means something. The
 * estimate-accuracy panel stays hidden until there are enough recorded samples,
 * because "you are 340% over on a sample of one" is not an insight, it is a
 * rounding artifact wearing a percentage sign.
 */
import { Flame, Info, LineChart as LineChartIcon, TrendingDown, TrendingUp } from 'lucide-react';
import * as React from 'react';

import {
  CompletionChart,
  EstimateAccuracyChart,
  GoalInvestmentChart,
  PlannedVsActualChart,
} from '@/components/insights/charts';
import { usePlanner } from '@/components/planner/planner-store';
import { PageContainer, PageHeader, Section } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { InfoHint } from '@/components/ui/tooltip';
import { formatDuration } from '@/lib/dates';
import { computeInsights, type WeekChangeMetric } from '@/lib/domain/analytics';
import { goalColorVar } from '@/lib/goal-colors';
import { cn, pluralize } from '@/lib/utils';

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const;

export default function InsightsPage() {
  const { status, snapshot, tasks, goals, timezone } = usePlanner();
  const [windowDays, setWindowDays] = React.useState('7');

  const insights = React.useMemo(() => {
    if (!snapshot) return null;
    return computeInsights({
      tasks,
      goals,
      events: snapshot.events,
      timezone,
      now: new Date(),
      windowDays: Number(windowDays),
    });
  }, [snapshot, tasks, goals, timezone, windowDays]);

  if (status === 'loading' || !insights) return <InsightsSkeleton />;

  if (!insights.totals.hasAnyData) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Insights" title="Nothing to measure yet" />
        <EmptyState
          icon={LineChartIcon}
          title="Come back after a day of work"
          description="Insights are computed from what you actually complete — not from what you write down. Finish a few tasks and this page fills in on its own."
        />
      </PageContainer>
    );
  }

  const { streak, totals, estimateAccuracy, goalAttention } = insights;
  const attention = goalAttention.filter((goal) => goal.needsAttention);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Insights"
        title="What actually happened"
        description="Computed from completed work and recorded focus time. No projections, no scores out of ten."
        actions={
          <Tabs value={windowDays} onValueChange={setWindowDays}>
            <TabsList aria-label="Time window">
              {WINDOWS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current streak"
          value={streak.current === 0 ? 'None' : pluralize(streak.current, 'day')}
          detail={
            streak.todayCounted
              ? 'Today already counts.'
              : streak.current > 0
                ? 'Complete something today to keep it.'
                : 'Complete a task to start one.'
          }
          hint={streak.rule}
          icon={Flame}
          accent={streak.current > 0}
        />
        <StatCard
          label="Tasks completed"
          value={String(totals.completedTasks)}
          detail={`Longest streak: ${pluralize(streak.longest, 'day')}.`}
        />
        <StatCard
          label="Focus time recorded"
          value={formatDuration(totals.focusMinutes)}
          detail={
            totals.focusMinutes === 0
              ? 'Use the focus timer to record real time.'
              : 'From timed focus sessions only.'
          }
        />
        <StatCard
          label="Moved forward"
          value={String(totals.tasksMovedForward)}
          detail="Scheduled for a past day and still open."
          hint="Not a failure metric — it is how you find work that keeps getting deferred and either do it or drop it."
        />
      </div>

      <Section title="What changed" description="The last 7 days against the 7 before them.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {insights.weekChanges.map((metric) => (
            <ChangeCard key={metric.key} metric={metric} />
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Completed work</CardTitle>
          </CardHeader>
          <CardContent>
            <CompletionChart data={insights.daily} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the time went</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <GoalInvestmentChart data={insights.goalInvestment} />

            {insights.goalInvestment.length > 0 ? (
              <ul className="space-y-1.5">
                {insights.goalInvestment.slice(0, 6).map((slice) => (
                  <li
                    key={slice.goalId ?? 'unassigned'}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: goalColorVar(slice.color) }}
                      aria-hidden
                    />
                    <span className="text-ink-muted truncate">{slice.label}</span>
                    <span className="text-ink ml-auto shrink-0 font-medium tabular-nums">
                      {formatDuration(slice.minutes)}
                    </span>
                    <span className="text-ink-subtle w-10 shrink-0 text-right tabular-nums">
                      {Math.round(slice.share * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estimated against actual</CardTitle>
          </CardHeader>
          <CardContent>
            <PlannedVsActualChart data={insights.plannedVsActual} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Estimate accuracy
              <InfoHint text="Only counts tasks where you recorded focus time. Estimates compared against themselves would tell you nothing." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {estimateAccuracy.hasEnoughData && estimateAccuracy.averageRatio !== null ? (
              <div className="space-y-3">
                <p className="text-ink-muted text-sm">
                  Your tasks take{' '}
                  <span className="text-ink font-semibold tabular-nums">
                    {estimateAccuracy.averageRatio.toFixed(2)}×
                  </span>{' '}
                  as long as you estimate, on average — typically off by{' '}
                  <span className="text-ink font-semibold tabular-nums">
                    {formatDuration(estimateAccuracy.medianAbsoluteErrorMinutes ?? 0)}
                  </span>
                  . Based on {pluralize(estimateAccuracy.sampleSize, 'timed task')}.
                </p>
                <EstimateAccuracyChart accuracy={estimateAccuracy} />
              </div>
            ) : (
              <p className="text-ink-subtle py-8 text-center text-sm">
                Needs at least three tasks with recorded focus time.
                {estimateAccuracy.sampleSize > 0
                  ? ` You have ${estimateAccuracy.sampleSize} so far.`
                  : ''}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {attention.length > 0 ? (
        <Section
          title="Goals with no time booked"
          description="Weighted 4 or 5, but nothing planned or completed against them this week."
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {attention.map((goal) => (
              <li
                key={goal.goalId}
                className="border-line bg-surface flex items-center gap-2.5 rounded-md border px-3 py-2.5"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: goalColorVar(goal.color) }}
                  aria-hidden
                />
                <span className="text-ink truncate text-sm">{goal.title}</span>
                <Badge tone="warning" className="ml-auto shrink-0">
                  weight {goal.priorityWeight}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </PageContainer>
  );
}

function StatCard({
  label,
  value,
  detail,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-ink-subtle flex items-center gap-1.5 text-xs font-medium">
        {label}
        {hint ? <InfoHint text={hint} /> : null}
      </p>
      <p className="mt-1.5 flex items-center gap-2">
        {Icon ? (
          <Icon className={cn('size-5', accent ? 'text-warning' : 'text-ink-subtle')} aria-hidden />
        ) : null}
        <span className="text-ink text-2xl leading-none font-semibold tabular-nums">{value}</span>
      </p>
      <p className="text-ink-subtle mt-1.5 text-xs leading-relaxed">{detail}</p>
    </Card>
  );
}

function ChangeCard({ metric }: { metric: WeekChangeMetric }) {
  const format = (value: number): string =>
    metric.unit === 'minutes'
      ? formatDuration(value)
      : metric.unit === 'percent'
        ? `${value}%`
        : String(value);

  // Direction is shown, judgement is not: the arrow is grey unless the metric
  // moved, and even then the wording stays neutral.
  const Arrow = metric.delta > 0 ? TrendingUp : metric.delta < 0 ? TrendingDown : Info;

  return (
    <Card className="p-4">
      <p className="text-ink-subtle text-xs font-medium">{metric.label}</p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="text-ink text-xl leading-none font-semibold tabular-nums">
          {format(metric.current)}
        </span>
        <span className="text-ink-subtle text-xs tabular-nums">was {format(metric.previous)}</span>
      </p>
      <p className="text-ink-muted mt-1.5 flex items-center gap-1.5 text-xs">
        <Arrow
          className={cn(
            'size-3.5 shrink-0',
            metric.delta > 0
              ? 'text-success'
              : metric.delta < 0
                ? 'text-ink-subtle'
                : 'text-ink-subtle',
          )}
          aria-hidden
        />
        {metric.sentence}
      </p>
    </Card>
  );
}

function InsightsSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </PageContainer>
  );
}
