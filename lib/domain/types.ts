/**
 * Core domain model for Momentum.
 *
 * These types are the single shared vocabulary for the UI, the repositories and
 * the pure domain engines. Two conventions matter:
 *
 * 1. Every absolute point in time is an ISO-8601 UTC string (`2026-03-14T18:30:00.000Z`).
 *    Conversion to a user's wall clock happens only at the display/parsing boundary
 *    via `lib/dates`.
 * 2. A `DayKey` (`yyyy-MM-dd`) is a *calendar* date interpreted in a specific
 *    timezone, never a UTC slice of an instant.
 */

/** ISO-8601 timestamp in UTC. */
export type IsoDateTime = string;

/** Calendar date as `yyyy-MM-dd`, interpreted in an explicit timezone. */
export type DayKey = string;

/** Wall-clock time of day as `HH:mm` in the user's timezone. */
export type ClockTime = string;

export const GOAL_CATEGORIES = [
  'coursework',
  'career',
  'project',
  'health',
  'personal',
  'custom',
] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TASK_STATUSES = [
  'inbox',
  'planned',
  'in_progress',
  'completed',
  'snoozed',
  'archived',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ENERGY_LEVELS = ['low', 'medium', 'high'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export const MANUAL_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ManualPriority = (typeof MANUAL_PRIORITIES)[number];

export const TASK_SOURCES = ['manual', 'natural_language', 'recurrence', 'demo'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const BLOCK_TYPES = ['task', 'fixed', 'break'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Importance is a 1–5 user-set scale; 3 is the neutral default. */
export type Importance = 1 | 2 | 3 | 4 | 5;

/** Goal priority weight is a 1–5 scale used by the prioritizer. */
export type PriorityWeight = 1 | 2 | 3 | 4 | 5;

/**
 * User preferences and scheduling constraints. In production this row is keyed
 * by `auth.users(id)`; in Guest Demo mode a stable local UUID stands in.
 */
export interface Profile {
  id: string;
  displayName: string;
  timezone: string;
  workdayStart: ClockTime;
  workdayEnd: ClockTime;
  defaultTaskDurationMinutes: number;
  breakMinutes: number;
  highEnergyStart: ClockTime;
  highEnergyEnd: ClockTime;
  theme: ThemePreference;
  /** When false the assistant uses the deterministic parser even if a key exists. */
  aiAssistEnabled: boolean;
  /** When true every proposed action requires explicit confirmation, not just destructive ones. */
  confirmAllActions: boolean;
  /** Allows the scheduler to break long, `splittable` tasks into multiple blocks. */
  splitLongTasks: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  priorityWeight: PriorityWeight;
  /** Calendar date in the profile timezone. */
  targetDate: DayKey | null;
  weeklyTargetMinutes: number | null;
  status: GoalStatus;
  /** Token from `GOAL_COLOR_TOKENS`, resolved to a CSS variable at render time. */
  color: GoalColorToken;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Task {
  id: string;
  userId: string;
  goalId: string | null;
  parentTaskId: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  manualPriority: ManualPriority;
  importance: Importance;
  energy: EnergyLevel;
  /** Deadline: when the work is *due*. Distinct from `scheduledStart`. */
  dueAt: IsoDateTime | null;
  /** Planned working window: when the user intends to *do* the work. */
  scheduledStart: IsoDateTime | null;
  scheduledEnd: IsoDateTime | null;
  durationMinutes: number;
  actualMinutes: number | null;
  /** Fixed-time events are placed by their clock time and never re-ranked. */
  isFixedTime: boolean;
  splittable: boolean;
  /** RFC-5545 RRULE string, normalized by `lib/domain/recurrence`. */
  recurrenceRule: string | null;
  recurrenceSeriesId: string | null;
  recurrenceOccurrenceAt: IsoDateTime | null;
  source: TaskSource;
  /** Verbatim user phrasing that produced this task, kept for audit and explanations. */
  sourceText: string | null;
  position: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  userId: string;
}

export interface DailyPlan {
  id: string;
  userId: string;
  planDate: DayKey;
  timezone: string;
  availableMinutes: number;
  scheduledMinutes: number;
  /** Identifies the scoring rules used, so old plans stay explainable. */
  scoreVersion: string;
  generatedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PlanBlock {
  id: string;
  userId: string;
  dailyPlanId: string;
  taskId: string | null;
  /** Label for blocks that are not backed by a task (fixed commitments, breaks). */
  title: string | null;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  blockType: BlockType;
  isLocked: boolean;
  position: number;
}

export const ACTIVITY_EVENT_TYPES = [
  'task_created',
  'task_completed',
  'task_uncompleted',
  'task_updated',
  'task_deleted',
  'task_archived',
  'task_scheduled',
  'focus_session',
  'plan_generated',
  'goal_created',
  'goal_updated',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/** Small, secret-free metadata bag attached to activity events. */
export type ActivityMetadata = Record<string, string | number | boolean | null>;

export interface ActivityEvent {
  id: string;
  userId: string;
  taskId: string | null;
  eventType: ActivityEventType;
  occurredAt: IsoDateTime;
  durationMinutes: number | null;
  metadata: ActivityMetadata;
}

/** A running focus session, persisted so a refresh cannot lose elapsed time. */
export interface FocusSession {
  taskId: string;
  startedAt: IsoDateTime;
  /** Accumulated minutes from earlier paused stretches of the same sitting. */
  accumulatedMinutes: number;
  isPaused: boolean;
}

/** Everything the planner UI needs for one render, loaded as a single snapshot. */
export interface PlannerSnapshot {
  profile: Profile;
  goals: Goal[];
  tasks: Task[];
  dependencies: TaskDependency[];
  plan: DailyPlan | null;
  blocks: PlanBlock[];
  events: ActivityEvent[];
  focusSession: FocusSession | null;
}

/** Accessible goal colors, exposed as CSS variables in `app/globals.css`. */
export const GOAL_COLOR_TOKENS = [
  'cobalt',
  'teal',
  'violet',
  'amber',
  'coral',
  'moss',
  'slate',
  'rose',
] as const;
export type GoalColorToken = (typeof GOAL_COLOR_TOKENS)[number];

export function isGoalColorToken(value: string): value is GoalColorToken {
  return (GOAL_COLOR_TOKENS as readonly string[]).includes(value);
}

/** Statuses that take a task out of ranking and scheduling entirely. */
export const INACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'archived'];

export function isActiveTask(task: Task): boolean {
  return !INACTIVE_TASK_STATUSES.includes(task.status) && task.archivedAt === null;
}

export function isCompleted(task: Task): boolean {
  return task.status === 'completed';
}
