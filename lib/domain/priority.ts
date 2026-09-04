/**
 * The explainable prioritization engine.
 *
 * `scoreTask` is pure: the same stored inputs always produce the same score and
 * the same breakdown. The AI layer may *propose* field values (a due date, an
 * importance, a goal link), but it never participates in ranking — that keeps
 * the ordering auditable and lets the UI justify every position.
 *
 * Score composition:
 *
 *   score = clamp(100 * Σ(weightᵢ × valueᵢ) + Σ boosts, 0, 100)
 *
 * where every `valueᵢ` is normalized to 0–1 and the weights sum to 1. Boosts
 * are deliberately additive and individually capped so that urgency signals
 * (overdue, due today, in progress) read as explicit nudges in the breakdown
 * instead of being smuggled inside a factor.
 */
import { clamp, clamp01, dayKeyDifference, dayKeyOf, parseIso } from '@/lib/dates';
import {
  DEFAULT_PRIORITY_CONFIG,
  SCORE_VERSION,
  type PriorityConfig,
  type PriorityFactorKey,
} from '@/lib/domain/tuning';
import type { Goal, Task, TaskDependency } from '@/lib/domain/types';

/** One normalized contributor to a task's score. */
export interface ScoreFactor {
  key: PriorityFactorKey;
  /** Short label for the breakdown UI. */
  label: string;
  weight: number;
  /** Normalized 0–1. */
  value: number;
  /** Points this factor added to the 0–100 score. */
  contribution: number;
  /** Human-language explanation, e.g. `Due tomorrow`. */
  detail: string;
}

/** An additive, capped adjustment applied after the weighted sum. */
export interface ScoreBoost {
  key: 'overdue' | 'dueToday' | 'inProgress';
  label: string;
  points: number;
}

export type BlockedReason = 'dependency';

export interface TaskScore {
  taskId: string;
  score: number;
  factors: ScoreFactor[];
  boosts: ScoreBoost[];
  /** Blocked tasks are excluded from automatic scheduling, not merely deranked. */
  blocked: boolean;
  blockedBy: string[];
  blockedReason: BlockedReason | null;
  scoreVersion: string;
  /** The two or three strongest contributors, phrased for the UI. */
  topReasons: string[];
}

export interface ScoreContext {
  goalsById: ReadonlyMap<string, Goal>;
  /** Task ids that are still waiting on an incomplete dependency. */
  blockedTaskIds: ReadonlyMap<string, string[]>;
  now: Date;
  timezone: string;
  config?: PriorityConfig;
}

const FACTOR_LABELS: Record<PriorityFactorKey, string> = {
  deadlineUrgency: 'Deadline',
  goalAlignment: 'Goal alignment',
  userImportance: 'Importance',
  manualPriority: 'Priority flag',
  age: 'Waiting time',
  effortFit: 'Effort fit',
};

/**
 * Builds the map of tasks that cannot start yet.
 *
 * A dependency edge only blocks while the prerequisite is neither completed nor
 * archived — archiving a prerequisite is treated as "no longer relevant" rather
 * than as a permanent block, which would otherwise strand its dependents.
 */
export function computeBlockedTasks(
  tasks: readonly Task[],
  dependencies: readonly TaskDependency[],
): Map<string, string[]> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blocked = new Map<string, string[]>();

  for (const edge of dependencies) {
    if (edge.taskId === edge.dependsOnTaskId) continue;
    const prerequisite = byId.get(edge.dependsOnTaskId);
    if (!prerequisite) continue;
    if (prerequisite.status === 'completed' || prerequisite.status === 'archived') continue;

    const existing = blocked.get(edge.taskId);
    if (existing) existing.push(prerequisite.id);
    else blocked.set(edge.taskId, [prerequisite.id]);
  }

  // Sorted so the blocked list — and therefore any UI derived from it — is stable.
  for (const ids of blocked.values()) ids.sort();
  return blocked;
}

/**
 * Deadline urgency.
 *
 * Linear ramp from `urgencyHorizonDays` out (0) to the deadline itself (1),
 * saturating at 1 once overdue. Tasks without a deadline receive a fixed
 * mid-low value so that they remain rankable and visible.
 */
function deadlineUrgencyFactor(
  task: Task,
  now: Date,
  timezone: string,
  config: PriorityConfig,
): { value: number; detail: string } {
  const due = parseIso(task.dueAt);
  if (!due) {
    return { value: config.noDeadlineUrgency, detail: 'No deadline set' };
  }

  const msUntil = due.getTime() - now.getTime();
  const daysUntil = msUntil / 86_400_000;

  if (msUntil <= 0) {
    const overdueDays = Math.floor(-daysUntil);
    return {
      value: 1,
      detail: overdueDays >= 1 ? `Overdue by ${overdueDays}d` : 'Past its deadline',
    };
  }

  const value = clamp01(1 - daysUntil / config.urgencyHorizonDays);
  const dayDelta = dayKeyDifference(dayKeyOf(now, timezone), dayKeyOf(due, timezone));
  const detail =
    dayDelta === 0
      ? 'Due later today'
      : dayDelta === 1
        ? 'Due tomorrow'
        : `Due in ${dayDelta} days`;

  return { value, detail };
}

/**
 * Goal alignment.
 *
 * A linked goal's 1–5 priority weight normalizes to 0–1, then scales by goal
 * status so work attached to a paused or achieved goal quietly recedes without
 * disappearing. Unlinked tasks get a small fixed value.
 */
function goalAlignmentFactor(
  task: Task,
  goalsById: ReadonlyMap<string, Goal>,
  config: PriorityConfig,
): { value: number; detail: string } {
  const goal = task.goalId ? goalsById.get(task.goalId) : undefined;
  if (!goal) {
    return { value: config.noGoalAlignment, detail: 'Not linked to a goal' };
  }

  const base = (goal.priorityWeight - 1) / 4;
  const multiplier = config.goalStatusMultiplier[goal.status];
  const value = clamp01(base * multiplier);

  const detail =
    goal.status !== 'active'
      ? `Supports ${goal.title} (${goal.status})`
      : goal.priorityWeight >= 5
        ? `Supports your highest-priority goal`
        : `Supports ${goal.title}`;

  return { value, detail };
}

/** How long the task has been waiting since creation, saturating at the configured age. */
function ageFactor(task: Task, now: Date, config: PriorityConfig): { value: number; detail: string } {
  const created = parseIso(task.createdAt);
  if (!created) return { value: 0, detail: 'Just added' };

  const days = Math.max(0, (now.getTime() - created.getTime()) / 86_400_000);
  const value = clamp01(days / config.ageSaturationDays);
  const wholeDays = Math.floor(days);

  const detail =
    wholeDays <= 0 ? 'Added today' : `Waiting ${wholeDays} ${wholeDays === 1 ? 'day' : 'days'}`;

  return { value, detail };
}

/**
 * Effort fit rewards work that realistically slots into a normal opening.
 * A 20-minute task is a dependable win; a four-hour block rarely is. This is
 * the smallest weight in the formula — a tiebreaker, not a driver.
 */
function effortFitFactor(task: Task, config: PriorityConfig): { value: number; detail: string } {
  const { effortFitMinMinutes: min, effortFitMaxMinutes: max } = config;
  const duration = clamp(task.durationMinutes, 0, Number.MAX_SAFE_INTEGER);
  const value = clamp01((max - duration) / (max - min));

  const detail =
    duration <= 30
      ? 'Quick win'
      : duration <= config.effortFitMaxMinutes / 2
        ? 'Fits a normal block'
        : 'Needs a long stretch';

  return { value, detail };
}

/**
 * Scores a single task and returns the full breakdown behind the number.
 * Fixed-time events are scored for display but the scheduler places them by
 * clock time and excludes them from flexible ranking.
 */
export function scoreTask(task: Task, context: ScoreContext): TaskScore {
  const config = context.config ?? DEFAULT_PRIORITY_CONFIG;
  const { now, timezone, goalsById } = context;

  const urgency = deadlineUrgencyFactor(task, now, timezone, config);
  const alignment = goalAlignmentFactor(task, goalsById, config);
  const importanceValue = clamp01((task.importance - 1) / 4);
  const manualValue = config.manualPriorityValue[task.manualPriority];
  const age = ageFactor(task, now, config);
  const effort = effortFitFactor(task, config);

  const rawFactors: Array<{ key: PriorityFactorKey; value: number; detail: string }> = [
    { key: 'deadlineUrgency', value: urgency.value, detail: urgency.detail },
    { key: 'goalAlignment', value: alignment.value, detail: alignment.detail },
    {
      key: 'userImportance',
      value: importanceValue,
      detail: `Importance ${task.importance} of 5`,
    },
    {
      key: 'manualPriority',
      value: manualValue,
      detail: `Marked ${task.manualPriority}`,
    },
    { key: 'age', value: age.value, detail: age.detail },
    { key: 'effortFit', value: effort.value, detail: effort.detail },
  ];

  const factors: ScoreFactor[] = rawFactors.map(({ key, value, detail }) => {
    const weight = config.weights[key];
    const normalized = clamp01(value);
    return {
      key,
      label: FACTOR_LABELS[key],
      weight,
      value: normalized,
      contribution: weight * normalized * 100,
      detail,
    };
  });

  const weighted = factors.reduce((total, factor) => total + factor.contribution, 0);
  const boosts = computeBoosts(task, now, timezone, config);
  const boostPoints = boosts.reduce((total, boost) => total + boost.points, 0);

  const blockedBy = context.blockedTaskIds.get(task.id) ?? [];
  const blocked = blockedBy.length > 0;

  return {
    taskId: task.id,
    // Rounded to two decimals: enough precision for stable ordering, without
    // pretending the model is accurate to a millionth of a point.
    score: round2(clamp(weighted + boostPoints, 0, 100)),
    factors,
    boosts,
    blocked,
    blockedBy,
    blockedReason: blocked ? 'dependency' : null,
    scoreVersion: SCORE_VERSION,
    topReasons: buildTopReasons(factors, boosts),
  };
}

function computeBoosts(
  task: Task,
  now: Date,
  timezone: string,
  config: PriorityConfig,
): ScoreBoost[] {
  const boosts: ScoreBoost[] = [];
  const due = parseIso(task.dueAt);

  if (due) {
    const msUntil = due.getTime() - now.getTime();
    if (msUntil <= 0) {
      const overdueDays = Math.max(1, Math.floor(-msUntil / 86_400_000) + 1);
      const points = Math.min(overdueDays * config.boosts.overduePerDay, config.boosts.overdueMax);
      boosts.push({ key: 'overdue', label: 'Overdue', points: round2(points) });
    } else if (dayKeyDifference(dayKeyOf(now, timezone), dayKeyOf(due, timezone)) === 0) {
      boosts.push({ key: 'dueToday', label: 'Due today', points: config.boosts.dueToday });
    }
  }

  if (task.status === 'in_progress') {
    boosts.push({
      key: 'inProgress',
      label: 'Already started',
      points: config.boosts.inProgress,
    });
  }

  return boosts;
}

/**
 * Picks the phrases the UI shows by default. Boosts lead because "overdue"
 * explains a position more directly than "importance 4 of 5" does, then the
 * strongest weighted factors fill in behind them.
 */
function buildTopReasons(factors: readonly ScoreFactor[], boosts: readonly ScoreBoost[]): string[] {
  const reasons: string[] = [];

  for (const boost of boosts) {
    if (boost.key === 'overdue') reasons.push('Overdue');
    if (boost.key === 'dueToday') reasons.push('Due today');
    if (boost.key === 'inProgress') reasons.push('Already in progress');
  }

  const ranked = [...factors]
    .filter((factor) => factor.contribution > 0.5)
    .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key));

  for (const factor of ranked) {
    if (reasons.length >= 3) break;
    // Deadline detail is already covered by the overdue/due-today boost phrasing.
    if (factor.key === 'deadlineUrgency' && reasons.length > 0) continue;
    if (!reasons.includes(factor.detail)) reasons.push(factor.detail);
  }

  return reasons.slice(0, 3);
}

export interface RankedTask {
  task: Task;
  score: TaskScore;
}

/**
 * Ranks tasks by score with a fully deterministic tie-break chain:
 * score desc → earlier deadline → dated before undated → lower position → id.
 * The final `id` comparison guarantees a total order, so repeated runs over the
 * same data can never shuffle equal-scoring tasks.
 */
export function rankTasks(tasks: readonly Task[], context: ScoreContext): RankedTask[] {
  const scored = tasks.map((task) => ({ task, score: scoreTask(task, context) }));
  return scored.sort(compareRankedTasks);
}

export function compareRankedTasks(a: RankedTask, b: RankedTask): number {
  if (b.score.score !== a.score.score) return b.score.score - a.score.score;

  const aDue = parseIso(a.task.dueAt)?.getTime() ?? null;
  const bDue = parseIso(b.task.dueAt)?.getTime() ?? null;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  }

  if (a.task.position !== b.task.position) return a.task.position - b.task.position;
  return a.task.id.localeCompare(b.task.id);
}

/**
 * The flexible, schedulable candidates: active, unblocked, not fixed-time.
 * Fixed-time events are excluded here because they are placed by their clock
 * time and must not compete for slots against ranked work.
 */
export function selectRankableTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'archived' &&
      task.archivedAt === null &&
      !task.isFixedTime,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
