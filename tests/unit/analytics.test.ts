import { describe, expect, it } from 'vitest';

import { toIso, zonedTimeToInstant } from '@/lib/dates';
import {
  computeInsights,
  computeStreak,
  effectiveMinutes,
  STREAK_RULE,
} from '@/lib/domain/analytics';
import type { Task } from '@/lib/domain/types';

import { makeEvent, makeGoal, makeTask } from './factories';

const NY = 'America/New_York';
/** Tuesday 2026-03-10, 11:00 in New York. */
const NOW = new Date('2026-03-10T15:00:00.000Z');

function at(dayKey: string, time: string): string {
  return toIso(zonedTimeToInstant(dayKey, time, NY));
}

function completedTask(dayKey: string, overrides: Partial<Task> = {}): Task {
  return makeTask({
    status: 'completed',
    scheduledStart: at(dayKey, '10:00'),
    scheduledEnd: at(dayKey, '11:00'),
    completedAt: at(dayKey, '11:00'),
    durationMinutes: 60,
    ...overrides,
  });
}

describe('effectiveMinutes', () => {
  it('prefers recorded focus time over the estimate', () => {
    expect(effectiveMinutes(makeTask({ durationMinutes: 60, actualMinutes: 75 }))).toBe(75);
  });

  it('falls back to the estimate when nothing was recorded', () => {
    expect(effectiveMinutes(makeTask({ durationMinutes: 60, actualMinutes: null }))).toBe(60);
    expect(effectiveMinutes(makeTask({ durationMinutes: 60, actualMinutes: 0 }))).toBe(60);
  });
});

describe('daily series', () => {
  it('attributes a completion to the local calendar day, not the UTC day', () => {
    // 02:30 UTC on the 11th is 21:30 on the 10th in New York.
    const task = makeTask({
      status: 'completed',
      completedAt: '2026-03-11T02:30:00.000Z',
      durationMinutes: 45,
    });

    const insights = computeInsights({
      tasks: [task],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const today = insights.daily.find((point) => point.dayKey === '2026-03-10');
    expect(today?.completedCount).toBe(1);
    expect(today?.completedMinutes).toBe(45);
  });

  it('returns exactly the requested trailing window, oldest first', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
      windowDays: 7,
    });

    expect(insights.daily).toHaveLength(7);
    expect(insights.daily[0]?.dayKey).toBe('2026-03-04');
    expect(insights.daily[6]?.dayKey).toBe('2026-03-10');
  });

  it('reports a null completion rate for a day with nothing scheduled', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    // Honest absence: an empty day is not a 0% day.
    expect(insights.daily.every((point) => point.completionRate === null)).toBe(true);
  });

  it('computes a real completion rate from scheduled versus completed work', () => {
    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10'),
        makeTask({ status: 'planned', scheduledStart: at('2026-03-10', '13:00') }),
        makeTask({ status: 'planned', scheduledStart: at('2026-03-10', '15:00') }),
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const today = insights.daily.find((point) => point.dayKey === '2026-03-10');
    expect(today?.scheduledCount).toBe(3);
    expect(today?.completionRate).toBeCloseTo(1 / 3, 3);
  });

  it('excludes archived work from the scheduled denominator', () => {
    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10'),
        makeTask({
          status: 'archived',
          archivedAt: toIso(NOW),
          scheduledStart: at('2026-03-10', '13:00'),
        }),
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const today = insights.daily.find((point) => point.dayKey === '2026-03-10');
    expect(today?.scheduledCount).toBe(1);
    expect(today?.completionRate).toBe(1);
  });
});

describe('planned versus actual', () => {
  it('separates the estimate from the recorded time', () => {
    const insights = computeInsights({
      tasks: [completedTask('2026-03-10', { durationMinutes: 60, actualMinutes: 90 })],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const today = insights.plannedVsActual.find((point) => point.dayKey === '2026-03-10');
    expect(today?.plannedMinutes).toBe(60);
    expect(today?.actualMinutes).toBe(90);
    expect(today?.hasRecordedTime).toBe(true);
  });

  it('flags a day whose actuals were never recorded', () => {
    const insights = computeInsights({
      tasks: [completedTask('2026-03-10', { actualMinutes: null })],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const today = insights.plannedVsActual.find((point) => point.dayKey === '2026-03-10');
    expect(today?.hasRecordedTime).toBe(false);
  });
});

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    const streak = computeStreak(
      [completedTask('2026-03-10'), completedTask('2026-03-09'), completedTask('2026-03-08')],
      NY,
      NOW,
    );

    expect(streak.current).toBe(3);
    expect(streak.todayCounted).toBe(true);
    expect(streak.lastActiveDay).toBe('2026-03-10');
    expect(streak.rule).toBe(STREAK_RULE);
  });

  it('holds the streak through today when the last completion was yesterday', () => {
    // The day is still in progress, so a run ending yesterday is not yet broken.
    const streak = computeStreak(
      [completedTask('2026-03-09'), completedTask('2026-03-08')],
      NY,
      NOW,
    );

    expect(streak.current).toBe(2);
    expect(streak.todayCounted).toBe(false);
  });

  it('resets to zero once a full day has passed with nothing completed', () => {
    const streak = computeStreak(
      [completedTask('2026-03-08'), completedTask('2026-03-07')],
      NY,
      NOW,
    );
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(2);
  });

  it('does not bridge a gap in the middle of a run', () => {
    const streak = computeStreak(
      [
        completedTask('2026-03-10'),
        completedTask('2026-03-09'),
        // 2026-03-08 missing
        completedTask('2026-03-07'),
        completedTask('2026-03-06'),
        completedTask('2026-03-05'),
      ],
      NY,
      NOW,
    );

    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(3);
  });

  it('counts several completions on one day as a single streak day', () => {
    const streak = computeStreak(
      [completedTask('2026-03-10'), completedTask('2026-03-10'), completedTask('2026-03-10')],
      NY,
      NOW,
    );
    expect(streak.current).toBe(1);
  });

  it('reports zero for a user who has completed nothing', () => {
    const streak = computeStreak([], NY, NOW);
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(0);
    expect(streak.lastActiveDay).toBeNull();
  });

  it('ignores tasks that are not actually completed', () => {
    const streak = computeStreak(
      [makeTask({ status: 'planned', completedAt: at('2026-03-10', '11:00') })],
      NY,
      NOW,
    );
    expect(streak.current).toBe(0);
  });

  it('respects the timezone when deciding which day a completion belongs to', () => {
    // 03:00 UTC on the 11th: still the 10th in New York, already the 11th in Tokyo.
    const task = makeTask({ status: 'completed', completedAt: '2026-03-11T03:00:00.000Z' });
    expect(computeStreak([task], NY, NOW).lastActiveDay).toBe('2026-03-10');
    expect(computeStreak([task], 'Asia/Tokyo', NOW).lastActiveDay).toBe('2026-03-11');
  });
});

describe('estimate accuracy', () => {
  it('withholds a verdict until there is enough recorded data', () => {
    const insights = computeInsights({
      tasks: [completedTask('2026-03-10', { actualMinutes: 70 })],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.estimateAccuracy.hasEnoughData).toBe(false);
    expect(insights.estimateAccuracy.sampleSize).toBe(1);
  });

  it('computes the average ratio once enough samples exist', () => {
    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10', { durationMinutes: 60, actualMinutes: 90 }),
        completedTask('2026-03-09', { durationMinutes: 60, actualMinutes: 60 }),
        completedTask('2026-03-08', { durationMinutes: 60, actualMinutes: 30 }),
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.estimateAccuracy.hasEnoughData).toBe(true);
    expect(insights.estimateAccuracy.sampleSize).toBe(3);
    expect(insights.estimateAccuracy.averageRatio).toBeCloseTo(1, 3);
    expect(insights.estimateAccuracy.medianAbsoluteErrorMinutes).toBe(30);
  });

  it('excludes tasks with no recorded time rather than assuming accuracy', () => {
    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10', { actualMinutes: null }),
        completedTask('2026-03-09', { actualMinutes: null }),
        completedTask('2026-03-08', { actualMinutes: null }),
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.estimateAccuracy.sampleSize).toBe(0);
    expect(insights.estimateAccuracy.averageRatio).toBeNull();
  });
});

describe('goal investment', () => {
  it('attributes completed minutes to each goal and computes shares', () => {
    const coursework = makeGoal({ title: 'Coursework', priorityWeight: 5 });
    const fitness = makeGoal({ title: 'Fitness', priorityWeight: 3, color: 'moss' });

    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10', { goalId: coursework.id, actualMinutes: 90 }),
        completedTask('2026-03-09', { goalId: fitness.id, actualMinutes: 30 }),
      ],
      goals: [coursework, fitness],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const [first, second] = insights.goalInvestment;
    expect(first?.label).toBe('Coursework');
    expect(first?.minutes).toBe(90);
    expect(first?.share).toBeCloseTo(0.75, 3);
    expect(second?.minutes).toBe(30);
  });

  it('groups unlinked work under an explicit label', () => {
    const insights = computeInsights({
      tasks: [completedTask('2026-03-10', { goalId: null })],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.goalInvestment[0]?.label).toBe('Not linked to a goal');
    expect(insights.goalInvestment[0]?.category).toBe('unassigned');
  });

  it('flags an active high-priority goal that got no planned time this week', () => {
    const neglected = makeGoal({ title: 'Neglected', priorityWeight: 5 });
    const served = makeGoal({ title: 'Served', priorityWeight: 5 });

    const insights = computeInsights({
      tasks: [completedTask('2026-03-10', { goalId: served.id })],
      goals: [neglected, served],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const flagged = insights.goalAttention.filter((entry) => entry.needsAttention);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.title).toBe('Neglected');
  });

  it('does not flag a low-priority goal for having no time', () => {
    const minor = makeGoal({ title: 'Minor', priorityWeight: 2 });
    const insights = computeInsights({
      tasks: [],
      goals: [minor],
      events: [],
      timezone: NY,
      now: NOW,
    });
    expect(insights.goalAttention[0]?.needsAttention).toBe(false);
  });

  it('ignores paused and archived goals in the attention list', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [
        makeGoal({ status: 'paused', priorityWeight: 5 }),
        makeGoal({ status: 'archived', priorityWeight: 5 }),
      ],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.goalAttention).toHaveLength(0);
  });
});

describe('week comparison', () => {
  it('compares this week with the previous week in neutral language', () => {
    const insights = computeInsights({
      tasks: [
        completedTask('2026-03-10'),
        completedTask('2026-03-09'),
        completedTask('2026-03-02'), // previous week
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const tasksMetric = insights.weekChanges.find((metric) => metric.key === 'completed_tasks');
    expect(tasksMetric?.current).toBe(2);
    expect(tasksMetric?.previous).toBe(1);
    expect(tasksMetric?.delta).toBe(1);
    expect(tasksMetric?.sentence).toBe('Up 1 tasks from last week.');
  });

  it('states a decline as a plain number, with no blame', () => {
    // Both completions land in the previous window (2026-02-25 … 2026-03-03),
    // so this week is empty and the metric must report a decline.
    const insights = computeInsights({
      tasks: [completedTask('2026-03-02'), completedTask('2026-03-01')],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    const metric = insights.weekChanges.find((entry) => entry.key === 'completed_tasks');
    expect(metric?.sentence).toMatch(/^Down \d+ tasks from last week\.$/);
    expect(metric?.sentence).not.toMatch(/fail|behind|should|worse/i);
  });

  it('says so honestly when both weeks are empty', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.weekChanges.every((metric) => metric.sentence.length > 0)).toBe(true);
    expect(insights.weekChanges.find((metric) => metric.key === 'completed_tasks')?.sentence).toBe(
      'No activity in either week.',
    );
  });

  it('sums recorded focus minutes from activity events', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [],
      events: [
        makeEvent('focus_session', at('2026-03-10', '10:00'), { durationMinutes: 50 }),
        makeEvent('focus_session', at('2026-03-09', '10:00'), { durationMinutes: 25 }),
        makeEvent('focus_session', at('2026-03-01', '10:00'), { durationMinutes: 40 }),
      ],
      timezone: NY,
      now: NOW,
    });

    const metric = insights.weekChanges.find((entry) => entry.key === 'focus_minutes');
    expect(metric?.current).toBe(75);
    expect(metric?.previous).toBe(40);
  });
});

describe('totals', () => {
  it('counts work that was scheduled in the past and never finished', () => {
    const insights = computeInsights({
      tasks: [
        makeTask({ status: 'planned', scheduledStart: at('2026-03-08', '10:00') }),
        makeTask({ status: 'planned', scheduledStart: at('2026-03-07', '10:00') }),
        completedTask('2026-03-09'),
        makeTask({ status: 'planned', scheduledStart: at('2026-03-10', '14:00') }), // today
      ],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.totals.tasksMovedForward).toBe(2);
    expect(insights.totals.completedTasks).toBe(1);
  });

  it('reports no data honestly for a brand-new user', () => {
    const insights = computeInsights({
      tasks: [],
      goals: [],
      events: [],
      timezone: NY,
      now: NOW,
    });

    expect(insights.totals.hasAnyData).toBe(false);
    expect(insights.totals.completedMinutes).toBe(0);
    expect(insights.goalInvestment).toHaveLength(0);
  });
});
