/**
 * Insight calculations.
 *
 * Every number on `/insights` is derived here from stored tasks and activity
 * events — nothing is invented, cached or padded. Where the data is too sparse
 * to support a claim, the returned shape says so (`hasEnoughData: false`) so the
 * UI can be honest rather than drawing a confident line through two points.
 *
 * Definitions used throughout, stated explicitly because the UI quotes them:
 *
 * - A task "counts for" the calendar day its `completedAt` falls on, in the
 *   user's timezone.
 * - "Completed planned minutes" sums the *estimated* duration of completed
 *   tasks. It answers "how much of what I planned did I finish".
 * - "Actual minutes" prefers recorded focus time and falls back to the estimate.
 * - Completion rate for a day is completed ÷ scheduled for tasks scheduled that
 *   day. Days with nothing scheduled report `null`, not 0%.
 */
import {
  dayKeyDifference,
  dayKeyOf,
  dayKeyRange,
  formatInZone,
  parseIso,
  todayKey,
} from '@/lib/dates';
import type { ActivityEvent, DayKey, Goal, GoalCategory, Task } from '@/lib/domain/types';

export interface InsightsInput {
  tasks: readonly Task[];
  goals: readonly Goal[];
  events: readonly ActivityEvent[];
  timezone: string;
  now: Date;
  /** Size of the trailing window for the daily charts. */
  windowDays?: number;
}

export interface DailyPoint {
  dayKey: DayKey;
  /** Short axis label, e.g. `Mon`. */
  label: string;
  /** Full label for accessible descriptions and tooltips. */
  fullLabel: string;
  completedMinutes: number;
  completedCount: number;
  scheduledCount: number;
  /** `null` when nothing was scheduled that day — not the same as 0%. */
  completionRate: number | null;
}

export interface PlannedVsActualPoint {
  dayKey: DayKey;
  label: string;
  plannedMinutes: number;
  actualMinutes: number;
  /** True when at least one completed task that day had recorded focus time. */
  hasRecordedTime: boolean;
}

export interface GoalInvestmentSlice {
  goalId: string | null;
  label: string;
  category: GoalCategory | 'unassigned';
  color: string;
  minutes: number;
  taskCount: number;
  /** Share of total invested minutes, 0–1. */
  share: number;
  weeklyTargetMinutes: number | null;
}

export interface StreakSummary {
  current: number;
  longest: number;
  lastActiveDay: DayKey | null;
  /** The exact rule, surfaced verbatim in a tooltip. */
  rule: string;
  /** True when today has a completion, so the streak is already safe. */
  todayCounted: boolean;
}

export interface EstimateAccuracy {
  hasEnoughData: boolean;
  sampleSize: number;
  /** Mean of actual ÷ estimated across samples; 1.0 means spot on. */
  averageRatio: number | null;
  /** Median absolute error in minutes. */
  medianAbsoluteErrorMinutes: number | null;
  points: Array<{ dayKey: DayKey; label: string; ratio: number; sampleSize: number }>;
}

export interface WeekChangeMetric {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  /** Neutral wording; no praise, no shame. */
  sentence: string;
  unit: 'tasks' | 'minutes' | 'percent';
}

export interface GoalAttention {
  goalId: string;
  title: string;
  color: string;
  priorityWeight: number;
  plannedMinutesThisWeek: number;
  weeklyTargetMinutes: number | null;
  /** True for an active, high-priority goal that got no planned time this week. */
  needsAttention: boolean;
}

export interface InsightsSummary {
  timezone: string;
  windowDays: number;
  daily: DailyPoint[];
  plannedVsActual: PlannedVsActualPoint[];
  goalInvestment: GoalInvestmentSlice[];
  streak: StreakSummary;
  estimateAccuracy: EstimateAccuracy;
  weekChanges: WeekChangeMetric[];
  goalAttention: GoalAttention[];
  totals: {
    completedTasks: number;
    completedMinutes: number;
    focusMinutes: number;
    tasksMovedForward: number;
    hasAnyData: boolean;
  };
}

export const STREAK_RULE =
  'A day counts when you complete at least one task. The streak holds through today until a full day passes with nothing completed.';

const DEFAULT_WINDOW_DAYS = 7;

/** Actual effort for a task: recorded focus time, else the estimate. */
export function effectiveMinutes(task: Task): number {
  if (task.actualMinutes !== null && task.actualMinutes > 0) return task.actualMinutes;
  return task.durationMinutes;
}

export function computeInsights(input: InsightsInput): InsightsSummary {
  const { timezone, now, tasks, goals, events } = input;
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const today = todayKey(timezone, now);
  const window = dayKeyRange(today, windowDays);

  const completedByDay = new Map<DayKey, Task[]>();
  const scheduledByDay = new Map<DayKey, Task[]>();

  for (const task of tasks) {
    const completedAt = parseIso(task.completedAt);
    if (completedAt && task.status === 'completed') {
      const key = dayKeyOf(completedAt, timezone);
      pushInto(completedByDay, key, task);
    }
    const scheduledStart = parseIso(task.scheduledStart);
    if (scheduledStart && task.archivedAt === null) {
      pushInto(scheduledByDay, dayKeyOf(scheduledStart, timezone), task);
    }
  }

  const daily: DailyPoint[] = window.map((dayKey) => {
    const completed = completedByDay.get(dayKey) ?? [];
    const scheduled = scheduledByDay.get(dayKey) ?? [];
    const scheduledCompleted = scheduled.filter((task) => task.status === 'completed').length;

    return {
      dayKey,
      label: labelFor(dayKey, timezone, 'EEE'),
      fullLabel: labelFor(dayKey, timezone, 'EEEE, MMM d'),
      completedMinutes: sum(completed.map((task) => task.durationMinutes)),
      completedCount: completed.length,
      scheduledCount: scheduled.length,
      completionRate:
        scheduled.length > 0 ? round3(scheduledCompleted / scheduled.length) : null,
    };
  });

  const plannedVsActual: PlannedVsActualPoint[] = window.map((dayKey) => {
    const completed = completedByDay.get(dayKey) ?? [];
    return {
      dayKey,
      label: labelFor(dayKey, timezone, 'EEE'),
      plannedMinutes: sum(completed.map((task) => task.durationMinutes)),
      actualMinutes: sum(completed.map((task) => effectiveMinutes(task))),
      hasRecordedTime: completed.some(
        (task) => task.actualMinutes !== null && task.actualMinutes > 0,
      ),
    };
  });

  return {
    timezone,
    windowDays,
    daily,
    plannedVsActual,
    goalInvestment: computeGoalInvestment(tasks, goals, timezone, today, windowDays),
    streak: computeStreak(tasks, timezone, now),
    estimateAccuracy: computeEstimateAccuracy(completedByDay, window, timezone),
    weekChanges: computeWeekChanges(completedByDay, scheduledByDay, today, events, timezone),
    goalAttention: computeGoalAttention(tasks, goals, timezone, now),
    totals: computeTotals(tasks, events, timezone, now),
  };
}

/**
 * Current and longest streaks.
 *
 * The streak is allowed to "hold" through today: if the most recent completion
 * was yesterday and today is still in progress, the streak is not yet broken.
 * Anything older than yesterday means the streak has lapsed to zero.
 */
export function computeStreak(
  tasks: readonly Task[],
  timezone: string,
  now: Date,
): StreakSummary {
  const activeDays = new Set<DayKey>();
  for (const task of tasks) {
    const completedAt = parseIso(task.completedAt);
    if (completedAt && task.status === 'completed') {
      activeDays.add(dayKeyOf(completedAt, timezone));
    }
  }

  const sorted = [...activeDays].sort();
  const today = todayKey(timezone, now);

  if (sorted.length === 0) {
    return {
      current: 0,
      longest: 0,
      lastActiveDay: null,
      rule: STREAK_RULE,
      todayCounted: false,
    };
  }

  let longest = 1;
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const currentDay = sorted[index];
    if (!previous || !currentDay) continue;
    run = dayKeyDifference(previous, currentDay) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const lastActiveDay = sorted[sorted.length - 1] ?? null;
  const gapFromToday = lastActiveDay ? dayKeyDifference(lastActiveDay, today) : Number.MAX_SAFE_INTEGER;

  let current = 0;
  if (gapFromToday <= 1) {
    let cursor = lastActiveDay;
    while (cursor && activeDays.has(cursor)) {
      current += 1;
      const previousDay = shiftKey(cursor, -1);
      cursor = activeDays.has(previousDay) ? previousDay : null;
    }
  }

  return {
    current,
    longest,
    lastActiveDay,
    rule: STREAK_RULE,
    todayCounted: activeDays.has(today),
  };
}

function computeGoalInvestment(
  tasks: readonly Task[],
  goals: readonly Goal[],
  timezone: string,
  today: DayKey,
  windowDays: number,
): GoalInvestmentSlice[] {
  const window = new Set(dayKeyRange(today, windowDays));
  const byGoal = new Map<string | null, { minutes: number; count: number }>();

  for (const task of tasks) {
    const completedAt = parseIso(task.completedAt);
    if (!completedAt || task.status !== 'completed') continue;
    if (!window.has(dayKeyOf(completedAt, timezone))) continue;

    const key = task.goalId ?? null;
    const entry = byGoal.get(key) ?? { minutes: 0, count: 0 };
    entry.minutes += effectiveMinutes(task);
    entry.count += 1;
    byGoal.set(key, entry);
  }

  const total = sum([...byGoal.values()].map((entry) => entry.minutes));
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));

  const slices: GoalInvestmentSlice[] = [...byGoal.entries()].map(([goalId, entry]) => {
    const goal = goalId ? goalsById.get(goalId) : undefined;
    return {
      goalId: goalId ?? null,
      label: goal?.title ?? 'Not linked to a goal',
      category: goal?.category ?? 'unassigned',
      color: goal?.color ?? 'slate',
      minutes: entry.minutes,
      taskCount: entry.count,
      share: total > 0 ? round3(entry.minutes / total) : 0,
      weeklyTargetMinutes: goal?.weeklyTargetMinutes ?? null,
    };
  });

  return slices.sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
}

/**
 * Estimate accuracy needs recorded focus time to mean anything, so tasks whose
 * `actualMinutes` was never recorded are excluded rather than assumed accurate.
 */
function computeEstimateAccuracy(
  completedByDay: ReadonlyMap<DayKey, Task[]>,
  window: readonly DayKey[],
  timezone: string,
): EstimateAccuracy {
  const MIN_SAMPLES = 3;
  const ratios: number[] = [];
  const errors: number[] = [];
  const points: EstimateAccuracy['points'] = [];

  for (const dayKey of window) {
    const samples = (completedByDay.get(dayKey) ?? []).filter(
      (task) => task.actualMinutes !== null && task.actualMinutes > 0 && task.durationMinutes > 0,
    );
    if (samples.length === 0) continue;

    const dayRatios = samples.map((task) => (task.actualMinutes ?? 0) / task.durationMinutes);
    ratios.push(...dayRatios);
    errors.push(
      ...samples.map((task) => Math.abs((task.actualMinutes ?? 0) - task.durationMinutes)),
    );

    points.push({
      dayKey,
      label: labelFor(dayKey, timezone, 'EEE'),
      ratio: round3(mean(dayRatios)),
      sampleSize: samples.length,
    });
  }

  return {
    hasEnoughData: ratios.length >= MIN_SAMPLES,
    sampleSize: ratios.length,
    averageRatio: ratios.length > 0 ? round3(mean(ratios)) : null,
    medianAbsoluteErrorMinutes: errors.length > 0 ? Math.round(median(errors)) : null,
    points,
  };
}

/**
 * `What changed?` — the trailing 7 days against the 7 before them.
 *
 * Wording is deliberately flat. A drop is reported as a number, never as a
 * failure, because a planner that scolds gets abandoned.
 */
function computeWeekChanges(
  completedByDay: ReadonlyMap<DayKey, Task[]>,
  scheduledByDay: ReadonlyMap<DayKey, Task[]>,
  today: DayKey,
  events: readonly ActivityEvent[],
  timezone: string,
): WeekChangeMetric[] {
  const thisWeek = dayKeyRange(today, 7);
  const lastWeek = dayKeyRange(shiftKey(today, -7), 7);

  const completedIn = (days: readonly DayKey[]) =>
    days.flatMap((day) => completedByDay.get(day) ?? []);
  const scheduledIn = (days: readonly DayKey[]) =>
    days.flatMap((day) => scheduledByDay.get(day) ?? []);

  const focusMinutesIn = (days: readonly DayKey[]) => {
    const set = new Set(days);
    return sum(
      events
        .filter((event) => event.eventType === 'focus_session' && event.durationMinutes)
        .filter((event) => {
          const at = parseIso(event.occurredAt);
          return at ? set.has(dayKeyOf(at, timezone)) : false;
        })
        .map((event) => event.durationMinutes ?? 0),
    );
  };

  const currentCompleted = completedIn(thisWeek);
  const previousCompleted = completedIn(lastWeek);
  const currentScheduled = scheduledIn(thisWeek);
  const previousScheduled = scheduledIn(lastWeek);

  const rate = (scheduled: Task[]) =>
    scheduled.length === 0
      ? 0
      : Math.round(
          (scheduled.filter((task) => task.status === 'completed').length / scheduled.length) * 100,
        );

  const metrics: WeekChangeMetric[] = [
    buildMetric(
      'completed_tasks',
      'Tasks completed',
      currentCompleted.length,
      previousCompleted.length,
      'tasks',
    ),
    buildMetric(
      'completed_minutes',
      'Planned minutes finished',
      sum(currentCompleted.map((task) => task.durationMinutes)),
      sum(previousCompleted.map((task) => task.durationMinutes)),
      'minutes',
    ),
    buildMetric(
      'focus_minutes',
      'Focus time recorded',
      focusMinutesIn(thisWeek),
      focusMinutesIn(lastWeek),
      'minutes',
    ),
    buildMetric(
      'completion_rate',
      'Scheduled work finished',
      rate(currentScheduled),
      rate(previousScheduled),
      'percent',
    ),
  ];

  return metrics;
}

function buildMetric(
  key: string,
  label: string,
  current: number,
  previous: number,
  unit: WeekChangeMetric['unit'],
): WeekChangeMetric {
  const delta = current - previous;
  const noun = unit === 'tasks' ? 'tasks' : unit === 'percent' ? 'percentage points' : 'minutes';

  let sentence: string;
  if (previous === 0 && current === 0) {
    sentence = 'No activity in either week.';
  } else if (delta === 0) {
    sentence = 'Level with last week.';
  } else if (delta > 0) {
    sentence = `Up ${Math.abs(delta)} ${noun} from last week.`;
  } else {
    sentence = `Down ${Math.abs(delta)} ${noun} from last week.`;
  }

  return { key, label, current, previous, delta, sentence, unit };
}

/**
 * Flags active high-priority goals that received no planned time this week.
 * This is the honest version of a "goal health" indicator: it reports absence of
 * planned minutes, not a made-up completion percentage.
 */
function computeGoalAttention(
  tasks: readonly Task[],
  goals: readonly Goal[],
  timezone: string,
  now: Date,
): GoalAttention[] {
  const week = new Set(dayKeyRange(todayKey(timezone, now), 7));
  const plannedByGoal = new Map<string, number>();

  for (const task of tasks) {
    if (!task.goalId || task.archivedAt !== null) continue;
    const anchor = parseIso(task.scheduledStart) ?? parseIso(task.completedAt);
    if (!anchor || !week.has(dayKeyOf(anchor, timezone))) continue;
    plannedByGoal.set(task.goalId, (plannedByGoal.get(task.goalId) ?? 0) + task.durationMinutes);
  }

  return goals
    .filter((goal) => goal.status === 'active')
    .map((goal) => {
      const planned = plannedByGoal.get(goal.id) ?? 0;
      return {
        goalId: goal.id,
        title: goal.title,
        color: goal.color,
        priorityWeight: goal.priorityWeight,
        plannedMinutesThisWeek: planned,
        weeklyTargetMinutes: goal.weeklyTargetMinutes,
        needsAttention: goal.priorityWeight >= 4 && planned === 0,
      };
    })
    .sort((a, b) => b.priorityWeight - a.priorityWeight || a.title.localeCompare(b.title));
}

function computeTotals(
  tasks: readonly Task[],
  events: readonly ActivityEvent[],
  timezone: string,
  now: Date,
): InsightsSummary['totals'] {
  const completed = tasks.filter((task) => task.status === 'completed');
  const today = todayKey(timezone, now);

  // Work that was scheduled for a day already past and never completed.
  const movedForward = tasks.filter((task) => {
    if (task.status === 'completed' || task.archivedAt !== null) return false;
    const scheduled = parseIso(task.scheduledStart);
    if (!scheduled) return false;
    return dayKeyDifference(dayKeyOf(scheduled, timezone), today) > 0;
  }).length;

  const focusMinutes = sum(
    events
      .filter((event) => event.eventType === 'focus_session')
      .map((event) => event.durationMinutes ?? 0),
  );

  return {
    completedTasks: completed.length,
    completedMinutes: sum(completed.map((task) => task.durationMinutes)),
    focusMinutes,
    tasksMovedForward: movedForward,
    hasAnyData: tasks.length > 0,
  };
}

function labelFor(dayKey: DayKey, timezone: string, pattern: string): string {
  // Noon avoids any chance of a DST-shifted midnight landing on the prior day.
  return formatInZone(`${dayKey}T12:00:00.000Z`, timezone, pattern);
}

function shiftKey(dayKey: DayKey, days: number): DayKey {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
