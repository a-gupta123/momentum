/**
 * Row ↔ domain translation.
 *
 * The one place snake_case meets camelCase. Centralizing it means a column
 * rename touches this file and nothing else, and it keeps two conversions that
 * must be exact inverses of each other side by side where they can be read
 * together.
 *
 * Two conversions are load-bearing:
 *
 * 1. **Timestamps are normalized to `Z` form.** PostgREST emits
 *    `2026-03-10T14:00:00.000+00:00`; the domain model's `IsoDateTime` is
 *    `2026-03-10T14:00:00.000Z`. Those are the same instant but not the same
 *    string, and `updated_at` is compared *as a string* for optimistic
 *    concurrency. Normalizing on the way in is what stops every second edit
 *    from being falsely reported as a conflict.
 *
 * 2. **`time` columns are trimmed to `HH:mm`.** Postgres returns `09:00:00`;
 *    the domain's `ClockTime` and every `<input type="time">` in the app expect
 *    `09:00`.
 */
import { toIso } from '@/lib/dates';
import type {
  ActivityEvent,
  ActivityMetadata,
  ClockTime,
  DailyPlan,
  FocusSession,
  Goal,
  Importance,
  IsoDateTime,
  PlanBlock,
  PriorityWeight,
  Profile,
  Task,
  TaskDependency,
} from '@/lib/domain/types';
import type {
  ActivityEventRow,
  DailyPlanRow,
  FocusSessionRow,
  GoalRow,
  PlanBlockRow,
  ProfileRow,
  TaskDependencyRow,
  TaskRow,
} from '@/lib/supabase/types';

/** Normalizes any Postgres timestamp rendering to canonical UTC ISO. */
export function isoFromRow(value: string): IsoDateTime {
  return toIso(new Date(value));
}

export function isoFromRowNullable(value: string | null): IsoDateTime | null {
  return value === null ? null : isoFromRow(value);
}

/** `09:00:00` → `09:00`. Also tolerates an already-trimmed value. */
export function clockFromRow(value: string): ClockTime {
  const [hours = '00', minutes = '00'] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

/** Clamps a smallint into the 1–5 literal union the domain requires. */
function toScale5(value: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as 2 | 3 | 4;
}

/**
 * Coerces the metadata column into the domain's restricted value type.
 *
 * `jsonb` can hold arbitrary nesting; `ActivityMetadata` allows only scalars.
 * Nested values are dropped rather than stringified, because a silently
 * flattened object in an audit log is worse than an absent field.
 */
export function metadataFromRow(value: Record<string, unknown>): ActivityMetadata {
  const output: ActivityMetadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null) output[key] = null;
    else if (typeof entry === 'string') output[key] = entry;
    else if (typeof entry === 'number' && Number.isFinite(entry)) output[key] = entry;
    else if (typeof entry === 'boolean') output[key] = entry;
  }
  return output;
}

export function profileFromRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    workdayStart: clockFromRow(row.workday_start),
    workdayEnd: clockFromRow(row.workday_end),
    defaultTaskDurationMinutes: row.default_task_duration_minutes,
    breakMinutes: row.break_minutes,
    highEnergyStart: clockFromRow(row.high_energy_start),
    highEnergyEnd: clockFromRow(row.high_energy_end),
    theme: row.theme,
    aiAssistEnabled: row.ai_assist_enabled,
    confirmAllActions: row.confirm_all_actions,
    splitLongTasks: row.split_long_tasks,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

export function profileToRow(patch: Partial<Profile>): Partial<ProfileRow> {
  const row: Partial<ProfileRow> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.workdayStart !== undefined) row.workday_start = patch.workdayStart;
  if (patch.workdayEnd !== undefined) row.workday_end = patch.workdayEnd;
  if (patch.defaultTaskDurationMinutes !== undefined) {
    row.default_task_duration_minutes = patch.defaultTaskDurationMinutes;
  }
  if (patch.breakMinutes !== undefined) row.break_minutes = patch.breakMinutes;
  if (patch.highEnergyStart !== undefined) row.high_energy_start = patch.highEnergyStart;
  if (patch.highEnergyEnd !== undefined) row.high_energy_end = patch.highEnergyEnd;
  if (patch.theme !== undefined) row.theme = patch.theme;
  if (patch.aiAssistEnabled !== undefined) row.ai_assist_enabled = patch.aiAssistEnabled;
  if (patch.confirmAllActions !== undefined) row.confirm_all_actions = patch.confirmAllActions;
  if (patch.splitLongTasks !== undefined) row.split_long_tasks = patch.splitLongTasks;
  return row;
}

export function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    category: row.category,
    priorityWeight: toScale5(row.priority_weight) as PriorityWeight,
    targetDate: row.target_date,
    weeklyTargetMinutes: row.weekly_target_minutes,
    status: row.status,
    color: row.color,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

export function goalToRow(goal: Goal): GoalRow {
  return {
    id: goal.id,
    user_id: goal.userId,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    priority_weight: goal.priorityWeight,
    target_date: goal.targetDate,
    weekly_target_minutes: goal.weeklyTargetMinutes,
    status: goal.status,
    color: goal.color,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

/** Partial goal patch → column patch. Absent keys stay absent. */
export function goalPatchToRow(patch: Partial<Goal>): Partial<GoalRow> {
  const row: Partial<GoalRow> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.priorityWeight !== undefined) row.priority_weight = patch.priorityWeight;
  if (patch.targetDate !== undefined) row.target_date = patch.targetDate;
  if (patch.weeklyTargetMinutes !== undefined) {
    row.weekly_target_minutes = patch.weeklyTargetMinutes;
  }
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.color !== undefined) row.color = patch.color;
  return row;
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    goalId: row.goal_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    manualPriority: row.manual_priority,
    importance: toScale5(row.importance) as Importance,
    energy: row.energy,
    dueAt: isoFromRowNullable(row.due_at),
    scheduledStart: isoFromRowNullable(row.scheduled_start),
    scheduledEnd: isoFromRowNullable(row.scheduled_end),
    durationMinutes: row.duration_minutes,
    actualMinutes: row.actual_minutes,
    isFixedTime: row.is_fixed_time,
    splittable: row.splittable,
    recurrenceRule: row.recurrence_rule,
    recurrenceSeriesId: row.recurrence_series_id,
    recurrenceOccurrenceAt: isoFromRowNullable(row.recurrence_occurrence_at),
    source: row.source,
    sourceText: row.source_text,
    position: row.position,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
    completedAt: isoFromRowNullable(row.completed_at),
    archivedAt: isoFromRowNullable(row.archived_at),
  };
}

export function taskToRow(task: Task): TaskRow {
  return {
    id: task.id,
    user_id: task.userId,
    goal_id: task.goalId,
    parent_task_id: task.parentTaskId,
    title: task.title,
    notes: task.notes,
    status: task.status,
    manual_priority: task.manualPriority,
    importance: task.importance,
    energy: task.energy,
    due_at: task.dueAt,
    scheduled_start: task.scheduledStart,
    scheduled_end: task.scheduledEnd,
    duration_minutes: task.durationMinutes,
    actual_minutes: task.actualMinutes,
    is_fixed_time: task.isFixedTime,
    splittable: task.splittable,
    recurrence_rule: task.recurrenceRule,
    recurrence_series_id: task.recurrenceSeriesId,
    recurrence_occurrence_at: task.recurrenceOccurrenceAt,
    source: task.source,
    source_text: task.sourceText,
    position: task.position,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    completed_at: task.completedAt,
    archived_at: task.archivedAt,
  };
}

/**
 * Partial task patch → column patch.
 *
 * `undefined` means "not mentioned" and is omitted; an explicit `null` is
 * preserved and clears the column. The RPC's `patch ? 'column'` test relies on
 * exactly this distinction, so collapsing the two here would make deadlines
 * impossible to clear.
 */
export function taskPatchToRow(patch: Partial<Task>): Partial<TaskRow> {
  const row: Partial<TaskRow> = {};
  if (patch.goalId !== undefined) row.goal_id = patch.goalId;
  if (patch.parentTaskId !== undefined) row.parent_task_id = patch.parentTaskId;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.manualPriority !== undefined) row.manual_priority = patch.manualPriority;
  if (patch.importance !== undefined) row.importance = patch.importance;
  if (patch.energy !== undefined) row.energy = patch.energy;
  if (patch.dueAt !== undefined) row.due_at = patch.dueAt;
  if (patch.scheduledStart !== undefined) row.scheduled_start = patch.scheduledStart;
  if (patch.scheduledEnd !== undefined) row.scheduled_end = patch.scheduledEnd;
  if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
  if (patch.actualMinutes !== undefined) row.actual_minutes = patch.actualMinutes;
  if (patch.isFixedTime !== undefined) row.is_fixed_time = patch.isFixedTime;
  if (patch.splittable !== undefined) row.splittable = patch.splittable;
  if (patch.recurrenceRule !== undefined) row.recurrence_rule = patch.recurrenceRule;
  if (patch.recurrenceSeriesId !== undefined) row.recurrence_series_id = patch.recurrenceSeriesId;
  if (patch.recurrenceOccurrenceAt !== undefined) {
    row.recurrence_occurrence_at = patch.recurrenceOccurrenceAt;
  }
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.sourceText !== undefined) row.source_text = patch.sourceText;
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
  return row;
}

export function dependencyFromRow(row: TaskDependencyRow): TaskDependency {
  return {
    taskId: row.task_id,
    dependsOnTaskId: row.depends_on_task_id,
    userId: row.user_id,
  };
}

export function planFromRow(row: DailyPlanRow): DailyPlan {
  return {
    id: row.id,
    userId: row.user_id,
    planDate: row.plan_date,
    timezone: row.timezone,
    availableMinutes: row.available_minutes,
    scheduledMinutes: row.scheduled_minutes,
    scoreVersion: row.score_version,
    generatedAt: isoFromRow(row.generated_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

export function blockFromRow(row: PlanBlockRow): PlanBlock {
  return {
    id: row.id,
    userId: row.user_id,
    dailyPlanId: row.daily_plan_id,
    taskId: row.task_id,
    title: row.title,
    startAt: isoFromRow(row.start_at),
    endAt: isoFromRow(row.end_at),
    blockType: row.block_type,
    isLocked: row.is_locked,
    position: row.position,
  };
}

export function eventFromRow(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    eventType: row.event_type,
    occurredAt: isoFromRow(row.occurred_at),
    durationMinutes: row.duration_minutes,
    metadata: metadataFromRow(row.metadata ?? {}),
  };
}

export function focusSessionFromRow(row: FocusSessionRow): FocusSession {
  return {
    taskId: row.task_id,
    startedAt: isoFromRow(row.started_at),
    accumulatedMinutes: row.accumulated_minutes,
    isPaused: row.is_paused,
  };
}
