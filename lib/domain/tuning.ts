/**
 * Every weight, threshold and magic number used by the prioritizer and the
 * scheduler lives here so the behaviour can be tuned in one reviewable place.
 *
 * `SCORE_VERSION` is stamped onto each generated daily plan. When a weight
 * changes, bump it: historical plans then keep an honest record of the rules
 * that produced them instead of being re-explained under today's formula.
 */

export const SCORE_VERSION = 'priority-2026.09.1';

export const PRIORITY_FACTOR_KEYS = [
  'deadlineUrgency',
  'goalAlignment',
  'userImportance',
  'manualPriority',
  'age',
  'effortFit',
] as const;
export type PriorityFactorKey = (typeof PRIORITY_FACTOR_KEYS)[number];

export interface PriorityConfig {
  /** Factor weights. Must sum to 1 — asserted by a unit test. */
  weights: Record<PriorityFactorKey, number>;

  /** Deadline urgency reaches 0 this many days out and 1 at/past the deadline. */
  urgencyHorizonDays: number;
  /**
   * Urgency credited to a task with no deadline. Non-zero on purpose: undated
   * work must stay rankable and visible rather than sinking out of sight.
   */
  noDeadlineUrgency: number;

  /** Alignment credited when a task is linked to no goal at all. */
  noGoalAlignment: number;
  /** Multipliers applied to a linked goal's alignment by goal status. */
  goalStatusMultiplier: {
    active: number;
    paused: number;
    achieved: number;
    archived: number;
  };

  /** Age saturates (factor = 1) after this many days of waiting. */
  ageSaturationDays: number;

  /** Effort fit is 1 at or below this duration and 0 at or above `effortFitMaxMinutes`. */
  effortFitMinMinutes: number;
  effortFitMaxMinutes: number;

  /** Normalized value for each manual priority level. */
  manualPriorityValue: Record<'low' | 'normal' | 'high' | 'urgent', number>;

  /**
   * Additive point boosts applied after the weighted sum, then clamped.
   * These are separate from the factors so the breakdown UI can show them
   * as explicit, capped nudges rather than hiding them inside urgency.
   */
  boosts: {
    /** Points per full day overdue. */
    overduePerDay: number;
    /** Hard ceiling on the overdue boost, so a forgotten task cannot dominate forever. */
    overdueMax: number;
    /** Flat boost for anything due later today. */
    dueToday: number;
    /** Flat boost for a task already in progress, to discourage context switching. */
    inProgress: number;
  };
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  weights: {
    deadlineUrgency: 0.32,
    goalAlignment: 0.25,
    userImportance: 0.18,
    manualPriority: 0.1,
    age: 0.08,
    effortFit: 0.07,
  },
  urgencyHorizonDays: 14,
  noDeadlineUrgency: 0.22,
  noGoalAlignment: 0.2,
  goalStatusMultiplier: {
    active: 1,
    paused: 0.5,
    achieved: 0.25,
    archived: 0.15,
  },
  ageSaturationDays: 14,
  effortFitMinMinutes: 15,
  effortFitMaxMinutes: 180,
  manualPriorityValue: {
    low: 0,
    normal: 0.34,
    high: 0.67,
    urgent: 1,
  },
  boosts: {
    overduePerDay: 2.5,
    overdueMax: 10,
    dueToday: 6,
    inProgress: 4,
  },
};

export interface SchedulingConfig {
  /** Grid resolution. All placements snap to this many minutes. */
  slotMinutes: number;
  /** Tasks longer than this may be split when the task allows it. */
  splitThresholdMinutes: number;
  /** A split chunk is never shorter than this — avoids meaningless slivers. */
  minSplitChunkMinutes: number;
  /** A split chunk is never longer than this. */
  maxSplitChunkMinutes: number;
  /** Importance at or above this counts as "deep work" for energy-window placement. */
  deepWorkImportanceThreshold: number;
  /** Utilization above this ratio triggers an "approaching capacity" warning. */
  highUtilizationWarningRatio: number;
  /** Maximum swap attempts in the improvement pass, bounding worst-case cost. */
  maxImprovementSwaps: number;
}

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  slotMinutes: 15,
  splitThresholdMinutes: 90,
  minSplitChunkMinutes: 30,
  maxSplitChunkMinutes: 90,
  deepWorkImportanceThreshold: 4,
  highUtilizationWarningRatio: 0.9,
  maxImprovementSwaps: 64,
};

/** Guardrails shared by forms, Zod schemas and database check constraints. */
export const DOMAIN_LIMITS = {
  taskTitleMaxLength: 200,
  taskNotesMaxLength: 4000,
  goalTitleMaxLength: 120,
  goalDescriptionMaxLength: 1000,
  minTaskDurationMinutes: 5,
  maxTaskDurationMinutes: 600,
  maxBreakMinutes: 60,
  /** Request-size limit for natural-language capture, enforced server-side. */
  captureMaxLength: 2000,
  maxActionsPerBatch: 25,
} as const;

/** Daily Three is a product decision, not an incidental slice length. */
export const DAILY_THREE_COUNT = 3;
