import { describe, expect, it } from 'vitest';

import { toIso } from '@/lib/dates';
import {
  compareRankedTasks,
  computeBlockedTasks,
  rankTasks,
  scoreTask,
  selectRankableTasks,
  type ScoreContext,
} from '@/lib/domain/priority';
import { DEFAULT_PRIORITY_CONFIG, PRIORITY_FACTOR_KEYS, SCORE_VERSION } from '@/lib/domain/tuning';
import type { Goal, Task } from '@/lib/domain/types';

import { makeGoal, makeTask } from './factories';

const NOW = new Date('2026-03-10T15:00:00.000Z'); // 11:00 in America/New_York
const TIMEZONE = 'America/New_York';

function contextFor(goals: Goal[] = [], blocked = new Map<string, string[]>()): ScoreContext {
  return {
    goalsById: new Map(goals.map((goal) => [goal.id, goal])),
    blockedTaskIds: blocked,
    now: NOW,
    timezone: TIMEZONE,
  };
}

describe('scoreTask factor normalization', () => {
  it('keeps the default weights summing to exactly 1', () => {
    const total = PRIORITY_FACTOR_KEYS.reduce(
      (sum, key) => sum + DEFAULT_PRIORITY_CONFIG.weights[key],
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it('normalizes every factor into the 0–1 range', () => {
    const task = makeTask({
      importance: 5,
      manualPriority: 'urgent',
      durationMinutes: 15,
      dueAt: toIso(NOW),
      createdAt: toIso(new Date('2025-01-01T00:00:00.000Z')),
    });

    const score = scoreTask(task, contextFor());

    for (const factor of score.factors) {
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
    }
    expect(score.factors).toHaveLength(PRIORITY_FACTOR_KEYS.length);
  });

  it('computes the exact weighted score for a fully specified task', () => {
    // A task created exactly 7 days ago, due in exactly 7 days, importance 3,
    // normal priority, 180 minutes long, linked to no goal.
    const task = makeTask({
      importance: 3,
      manualPriority: 'normal',
      durationMinutes: 180,
      dueAt: toIso(new Date(NOW.getTime() + 7 * 86_400_000)),
      createdAt: toIso(new Date(NOW.getTime() - 7 * 86_400_000)),
    });

    const { weights, noGoalAlignment, manualPriorityValue } = DEFAULT_PRIORITY_CONFIG;
    const expected =
      100 *
      (weights.deadlineUrgency * 0.5 + // 7 of 14 days remaining
        weights.goalAlignment * noGoalAlignment +
        weights.userImportance * 0.5 + // (3-1)/4
        weights.manualPriority * manualPriorityValue.normal +
        weights.age * 0.5 + // 7 of 14 days waited
        weights.effortFit * 0); // 180 min is the ceiling

    const score = scoreTask(task, contextFor());
    expect(score.score).toBeCloseTo(Math.round(expected * 100) / 100, 2);
    expect(score.boosts).toHaveLength(0);
    expect(score.scoreVersion).toBe(SCORE_VERSION);
  });

  it('stamps the score version so old plans stay explainable', () => {
    expect(scoreTask(makeTask(), contextFor()).scoreVersion).toBe(SCORE_VERSION);
  });
});

describe('deadline boundaries', () => {
  it('caps the overdue boost no matter how long a task has been late', () => {
    const barelyOverdue = makeTask({ dueAt: toIso(new Date(NOW.getTime() - 60_000)) });
    const ancient = makeTask({ dueAt: toIso(new Date(NOW.getTime() - 400 * 86_400_000)) });

    const barelyBoost = scoreTask(barelyOverdue, contextFor()).boosts[0];
    const ancientBoost = scoreTask(ancient, contextFor()).boosts[0];

    expect(barelyBoost?.key).toBe('overdue');
    expect(ancientBoost?.points).toBe(DEFAULT_PRIORITY_CONFIG.boosts.overdueMax);
    expect(ancientBoost?.points).toBeLessThanOrEqual(DEFAULT_PRIORITY_CONFIG.boosts.overdueMax);
  });

  it('boosts a task due later today without marking it overdue', () => {
    // 22:00 UTC is 18:00 in New York, still the same local day as NOW.
    const task = makeTask({ dueAt: '2026-03-10T22:00:00.000Z' });
    const score = scoreTask(task, contextFor());

    expect(score.boosts.map((boost) => boost.key)).toEqual(['dueToday']);
    expect(score.topReasons).toContain('Due today');
  });

  it('treats a deadline late tonight as today, not tomorrow, in the user timezone', () => {
    // 03:00 UTC on the 11th is 23:00 on the 10th in New York.
    const task = makeTask({ dueAt: '2026-03-11T03:00:00.000Z' });
    expect(scoreTask(task, contextFor()).boosts.map((b) => b.key)).toEqual(['dueToday']);
  });

  it('keeps an undated task rankable rather than invisible', () => {
    const undated = makeTask({ dueAt: null });
    const score = scoreTask(undated, contextFor());

    const urgency = score.factors.find((factor) => factor.key === 'deadlineUrgency');
    expect(urgency?.value).toBe(DEFAULT_PRIORITY_CONFIG.noDeadlineUrgency);
    expect(score.score).toBeGreaterThan(0);
    expect(urgency?.detail).toBe('No deadline set');
  });

  it('scores a far-future deadline at zero urgency without going negative', () => {
    const task = makeTask({ dueAt: toIso(new Date(NOW.getTime() + 90 * 86_400_000)) });
    const urgency = scoreTask(task, contextFor()).factors.find(
      (factor) => factor.key === 'deadlineUrgency',
    );
    expect(urgency?.value).toBe(0);
  });
});

describe('goal alignment', () => {
  it('ranks work on a top-priority goal above identical unlinked work', () => {
    const goal = makeGoal({ priorityWeight: 5 });
    const linked = makeTask({ goalId: goal.id });
    const unlinked = makeTask({ goalId: null });

    const context = contextFor([goal]);
    expect(scoreTask(linked, context).score).toBeGreaterThan(
      scoreTask(unlinked, context).score,
    );
    expect(scoreTask(linked, context).topReasons).toContain(
      'Supports your highest-priority goal',
    );
  });

  it('discounts a paused goal without erasing its contribution', () => {
    const active = makeGoal({ priorityWeight: 5, status: 'active' });
    const paused = makeGoal({ priorityWeight: 5, status: 'paused' });

    const activeScore = scoreTask(makeTask({ goalId: active.id }), contextFor([active]));
    const pausedScore = scoreTask(makeTask({ goalId: paused.id }), contextFor([paused]));

    expect(activeScore.score).toBeGreaterThan(pausedScore.score);
    const factor = pausedScore.factors.find((entry) => entry.key === 'goalAlignment');
    expect(factor?.value).toBeGreaterThan(0);
  });
});

describe('blocked tasks', () => {
  it('marks a task blocked while its prerequisite is open', () => {
    const prerequisite = makeTask({ title: 'Write tests' });
    const dependent = makeTask({ title: 'Deploy' });
    const blocked = computeBlockedTasks(
      [prerequisite, dependent],
      [{ taskId: dependent.id, dependsOnTaskId: prerequisite.id, userId: 'u' }],
    );

    const score = scoreTask(dependent, contextFor([], blocked));
    expect(score.blocked).toBe(true);
    expect(score.blockedReason).toBe('dependency');
    expect(score.blockedBy).toEqual([prerequisite.id]);
  });

  it('unblocks once the prerequisite is completed', () => {
    const prerequisite = makeTask({ status: 'completed' });
    const dependent = makeTask();
    const blocked = computeBlockedTasks(
      [prerequisite, dependent],
      [{ taskId: dependent.id, dependsOnTaskId: prerequisite.id, userId: 'u' }],
    );
    expect(blocked.has(dependent.id)).toBe(false);
  });

  it('ignores a self-dependency instead of blocking the task forever', () => {
    const task = makeTask();
    const blocked = computeBlockedTasks(
      [task],
      [{ taskId: task.id, dependsOnTaskId: task.id, userId: 'u' }],
    );
    expect(blocked.size).toBe(0);
  });

  it('ignores an edge pointing at a task that no longer exists', () => {
    const task = makeTask();
    const blocked = computeBlockedTasks(
      [task],
      [{ taskId: task.id, dependsOnTaskId: 'missing-task', userId: 'u' }],
    );
    expect(blocked.size).toBe(0);
  });
});

describe('deterministic ordering', () => {
  it('breaks an exact score tie by deadline, then position, then id', () => {
    const shared = {
      importance: 3 as const,
      manualPriority: 'normal' as const,
      durationMinutes: 60,
      createdAt: toIso(NOW),
    };
    const earlier = makeTask({ ...shared, dueAt: toIso(new Date(NOW.getTime() + 3_600_000)) });
    const later = makeTask({ ...shared, dueAt: toIso(new Date(NOW.getTime() + 7_200_000)) });

    const ranked = rankTasks([later, earlier], contextFor());
    expect(ranked[0]?.task.id).toBe(earlier.id);
  });

  it('sorts dated work ahead of undated work at an identical score', () => {
    const a = { task: makeTask({ dueAt: null }), score: { score: 50 } };
    const b = { task: makeTask({ dueAt: toIso(NOW) }), score: { score: 50 } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- comparator only reads score/task
    expect(compareRankedTasks(a as any, b as any)).toBeGreaterThan(0);
  });

  it('produces byte-identical ordering across repeated runs', () => {
    const goal = makeGoal({ priorityWeight: 4 });
    const tasks: Task[] = Array.from({ length: 12 }, (_, index) =>
      makeTask({
        title: `Task ${index}`,
        importance: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        durationMinutes: 30 + index * 10,
        goalId: index % 2 === 0 ? goal.id : null,
        dueAt: index % 3 === 0 ? toIso(new Date(NOW.getTime() + index * 86_400_000)) : null,
        position: index,
      }),
    );

    const first = rankTasks(tasks, contextFor([goal])).map((entry) => entry.task.id);
    const shuffled = [...tasks].reverse();
    const second = rankTasks(shuffled, contextFor([goal])).map((entry) => entry.task.id);

    expect(second).toEqual(first);
  });
});

describe('selectRankableTasks', () => {
  it('excludes completed, archived and fixed-time work from flexible ranking', () => {
    const flexible = makeTask({ title: 'flexible' });
    const candidates = [
      flexible,
      makeTask({ status: 'completed' }),
      makeTask({ status: 'archived' }),
      makeTask({ archivedAt: toIso(NOW) }),
      makeTask({ isFixedTime: true }),
    ];

    expect(selectRankableTasks(candidates).map((task) => task.id)).toEqual([flexible.id]);
  });
});

describe('explanations', () => {
  it('translates the strongest contributors into human phrases', () => {
    const goal = makeGoal({ priorityWeight: 5, title: 'Land an internship' });
    const task = makeTask({
      goalId: goal.id,
      importance: 5,
      dueAt: toIso(new Date(NOW.getTime() + 26 * 3_600_000)),
      createdAt: toIso(new Date(NOW.getTime() - 8 * 86_400_000)),
    });

    const reasons = scoreTask(task, contextFor([goal])).topReasons;
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(reasons.some((reason) => /Waiting 8 days|highest-priority|Due/.test(reason))).toBe(true);
  });

  it('reports each factor contribution as weight times value times 100', () => {
    const score = scoreTask(makeTask({ importance: 5 }), contextFor());
    for (const factor of score.factors) {
      expect(factor.contribution).toBeCloseTo(factor.weight * factor.value * 100, 6);
    }
  });
});
