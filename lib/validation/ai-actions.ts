/**
 * The AI/server contract: one Zod schema that is simultaneously
 *
 *  - the JSON Schema handed to OpenAI Structured Outputs,
 *  - the validator for whatever comes back,
 *  - the validator for the browser's `apply` request, and
 *  - the TypeScript source of truth for the preview UI.
 *
 * Because the inferred type is reused everywhere, the schema cannot drift away
 * from the components that render it.
 *
 * Two deliberate shape decisions:
 *
 * 1. **Discriminated union on `type`.** Each intent carries only its own
 *    payload. A single permissive object with forty optional fields would
 *    typecheck while allowing nonsense like a `delete_task` with a recurrence
 *    rule.
 * 2. **Required-and-nullable instead of optional.** Structured Outputs requires
 *    every property to be present, so "absent" is modelled as `null` and
 *    normalized at the boundary. For updates, `null` therefore means
 *    "leave unchanged" — clearing a value uses an explicit `clear*` flag.
 */
import { z } from 'zod';

import { DOMAIN_LIMITS } from '@/lib/domain/tuning';
import {
  ENERGY_LEVELS,
  GOAL_CATEGORIES,
  MANUAL_PRIORITIES,
  TASK_STATUSES,
} from '@/lib/domain/types';

/** ISO-8601 instant. Kept as a plain string in JSON Schema; validated here. */
const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO-8601 date-time string',
});

/** `yyyy-MM-dd` calendar date. */
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a yyyy-MM-dd date')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Expected a real calendar date',
  });

const confidence = z.number().min(0).max(1);
const interpretation = z.string().min(1).max(300);
const importance = z.number().int().min(1).max(5);
const priorityWeight = z.number().int().min(1).max(5);
const durationMinutes = z
  .number()
  .int()
  .min(DOMAIN_LIMITS.minTaskDurationMinutes)
  .max(DOMAIN_LIMITS.maxTaskDurationMinutes);

/**
 * A question the model could not resolve on its own. Surfaced in the preview so
 * the user decides, rather than the model guessing silently.
 */
export const ambiguitySchema = z.strictObject({
  field: z.string().max(60),
  question: z.string().max(240),
  options: z.array(z.string().max(160)).max(6),
});

const baseFields = {
  confidence,
  /** One short sentence of plain English shown in the preview row. */
  interpretation,
  /** The model's own signal; the server still enforces its own rules on top. */
  requiresConfirmation: z.boolean(),
  ambiguity: ambiguitySchema.nullable(),
};

/** Reference to an existing task, chosen from the candidates the server sent. */
const taskRef = {
  taskId: z.string().min(1).max(64),
  /** Echo of the candidate's title, used to make the preview readable. */
  taskTitle: z.string().max(DOMAIN_LIMITS.taskTitleMaxLength).nullable(),
};

export const createTaskActionSchema = z.strictObject({
  type: z.literal('create_task'),
  ...baseFields,
  title: z.string().min(1).max(DOMAIN_LIMITS.taskTitleMaxLength),
  notes: z.string().max(DOMAIN_LIMITS.taskNotesMaxLength).nullable(),
  /** Deadline — when it is *due*. */
  dueAt: isoDateTime.nullable(),
  /** Planned working start — when the user intends to *do* it. */
  scheduledStart: isoDateTime.nullable(),
  durationMinutes: durationMinutes.nullable(),
  /** True when the duration was guessed rather than stated by the user. */
  durationInferred: z.boolean(),
  manualPriority: z.enum(MANUAL_PRIORITIES).nullable(),
  importance: importance.nullable(),
  energy: z.enum(ENERGY_LEVELS).nullable(),
  /** Must be one of the candidate goal ids sent to the model. */
  goalId: z.string().max(64).nullable(),
  /** Human-readable goal match for the preview, even when `goalId` is null. */
  goalMatchTitle: z.string().max(DOMAIN_LIMITS.goalTitleMaxLength).nullable(),
  isFixedTime: z.boolean(),
  splittable: z.boolean().nullable(),
  recurrenceRule: z.string().max(200).nullable(),
});

export const updateTaskActionSchema = z.strictObject({
  type: z.literal('update_task'),
  ...baseFields,
  ...taskRef,
  title: z.string().min(1).max(DOMAIN_LIMITS.taskTitleMaxLength).nullable(),
  notes: z.string().max(DOMAIN_LIMITS.taskNotesMaxLength).nullable(),
  dueAt: isoDateTime.nullable(),
  durationMinutes: durationMinutes.nullable(),
  manualPriority: z.enum(MANUAL_PRIORITIES).nullable(),
  importance: importance.nullable(),
  energy: z.enum(ENERGY_LEVELS).nullable(),
  goalId: z.string().max(64).nullable(),
  status: z.enum(TASK_STATUSES).nullable(),
  /** Explicit intent to remove the deadline, since `null` means "unchanged". */
  clearDueAt: z.boolean(),
  /** Explicit intent to unschedule, freeing the task back to the queue. */
  clearSchedule: z.boolean(),
});

export const completeTaskActionSchema = z.strictObject({
  type: z.literal('complete_task'),
  ...baseFields,
  ...taskRef,
});

export const deleteTaskActionSchema = z.strictObject({
  type: z.literal('delete_task'),
  ...baseFields,
  ...taskRef,
});

export const scheduleTaskActionSchema = z.strictObject({
  type: z.literal('schedule_task'),
  ...baseFields,
  ...taskRef,
  scheduledStart: isoDateTime,
  durationMinutes: durationMinutes.nullable(),
});

export const rescheduleTaskActionSchema = z.strictObject({
  type: z.literal('reschedule_task'),
  ...baseFields,
  ...taskRef,
  scheduledStart: isoDateTime.nullable(),
  dueAt: isoDateTime.nullable(),
});

export const createGoalActionSchema = z.strictObject({
  type: z.literal('create_goal'),
  ...baseFields,
  title: z.string().min(1).max(DOMAIN_LIMITS.goalTitleMaxLength),
  description: z.string().max(DOMAIN_LIMITS.goalDescriptionMaxLength).nullable(),
  category: z.enum(GOAL_CATEGORIES),
  priorityWeight,
  targetDate: dayKey.nullable(),
  weeklyTargetMinutes: z.number().int().min(0).max(10_080).nullable(),
});

export const updateGoalActionSchema = z.strictObject({
  type: z.literal('update_goal'),
  ...baseFields,
  goalId: z.string().min(1).max(64),
  goalTitle: z.string().max(DOMAIN_LIMITS.goalTitleMaxLength).nullable(),
  title: z.string().min(1).max(DOMAIN_LIMITS.goalTitleMaxLength).nullable(),
  description: z.string().max(DOMAIN_LIMITS.goalDescriptionMaxLength).nullable(),
  category: z.enum(GOAL_CATEGORIES).nullable(),
  priorityWeight: priorityWeight.nullable(),
  targetDate: dayKey.nullable(),
  weeklyTargetMinutes: z.number().int().min(0).max(10_080).nullable(),
  status: z.enum(['active', 'paused', 'achieved', 'archived']).nullable(),
});

export const optimizeDayActionSchema = z.strictObject({
  type: z.literal('optimize_day'),
  ...baseFields,
  date: dayKey,
  /** True when the user asked to replace an existing plan, not just fill gaps. */
  replaceExisting: z.boolean(),
});

export const clarifyActionSchema = z.strictObject({
  type: z.literal('clarify'),
  ...baseFields,
  question: z.string().min(1).max(240),
  options: z.array(z.string().max(160)).max(6),
});

/** The full intent vocabulary. */
export const assistantActionSchema = z.discriminatedUnion('type', [
  createTaskActionSchema,
  updateTaskActionSchema,
  completeTaskActionSchema,
  deleteTaskActionSchema,
  scheduleTaskActionSchema,
  rescheduleTaskActionSchema,
  createGoalActionSchema,
  updateGoalActionSchema,
  optimizeDayActionSchema,
  clarifyActionSchema,
]);

/**
 * The model's whole response: a short summary plus a batch of proposed actions.
 * No conversational prose — the UI renders structure, not chat.
 */
export const assistantPlanSchema = z.strictObject({
  summary: z.string().min(1).max(400),
  actions: z.array(assistantActionSchema).max(DOMAIN_LIMITS.maxActionsPerBatch),
});

export type AmbiguityDetail = z.infer<typeof ambiguitySchema>;
export type AssistantAction = z.infer<typeof assistantActionSchema>;
export type AssistantActionType = AssistantAction['type'];

/**
 * The discriminator values, derived from the union rather than retyped, so a
 * new intent cannot be added without every consumer of this list seeing it.
 */
export const assistantActionTypeSchema = z.enum(
  assistantActionSchema.options.map((option) => option.shape.type.value) as [
    AssistantActionType,
    ...AssistantActionType[],
  ],
);
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;

export type CreateTaskAction = z.infer<typeof createTaskActionSchema>;
export type UpdateTaskAction = z.infer<typeof updateTaskActionSchema>;
export type CompleteTaskAction = z.infer<typeof completeTaskActionSchema>;
export type DeleteTaskAction = z.infer<typeof deleteTaskActionSchema>;
export type ScheduleTaskAction = z.infer<typeof scheduleTaskActionSchema>;
export type RescheduleTaskAction = z.infer<typeof rescheduleTaskActionSchema>;
export type CreateGoalAction = z.infer<typeof createGoalActionSchema>;
export type UpdateGoalAction = z.infer<typeof updateGoalActionSchema>;
export type OptimizeDayAction = z.infer<typeof optimizeDayActionSchema>;
export type ClarifyAction = z.infer<typeof clarifyActionSchema>;

/** Intents that mutate or destroy existing records and always need a prompt. */
const DESTRUCTIVE_TYPES: ReadonlySet<AssistantActionType> = new Set([
  'delete_task',
  'update_task',
  'update_goal',
  'reschedule_task',
]);

/**
 * Server-side confirmation policy. The model's `requiresConfirmation` is treated
 * as a hint that can only *raise* the requirement, never lower it: deletes, edits
 * to existing records, plan replacement and large batches are always confirmed
 * regardless of what the model claimed.
 */
export function requiresConfirmation(
  action: AssistantAction,
  options: { batchSize: number; confirmAll: boolean },
): boolean {
  if (options.confirmAll) return true;
  if (action.requiresConfirmation) return true;
  if (DESTRUCTIVE_TYPES.has(action.type)) return true;
  if (action.type === 'optimize_day' && action.replaceExisting) return true;
  // A brain dump that produced a large batch deserves one deliberate look.
  if (options.batchSize > 5) return true;
  return false;
}

/** Actions that reference an existing task or goal by id. */
export function referencedTaskId(action: AssistantAction): string | null {
  switch (action.type) {
    case 'update_task':
    case 'complete_task':
    case 'delete_task':
    case 'schedule_task':
    case 'reschedule_task':
      return action.taskId;
    default:
      return null;
  }
}

export function referencedGoalId(action: AssistantAction): string | null {
  switch (action.type) {
    case 'create_task':
    case 'update_task':
      return action.goalId;
    case 'update_goal':
      return action.goalId;
    default:
      return null;
  }
}

export interface ActionValidationIssue {
  index: number;
  actionType: AssistantActionType;
  message: string;
}

export interface ValidatedPlan {
  plan: AssistantPlan;
  /** Actions dropped because they referenced something that does not exist. */
  issues: ActionValidationIssue[];
}

/**
 * Rejects hallucinated identifiers.
 *
 * The model only ever sees a short candidate list of real task and goal ids;
 * anything outside it is dropped with a recorded issue rather than being
 * applied. This is the last line of defence before actions reach a repository.
 */
export function validatePlanAgainstContext(
  plan: AssistantPlan,
  known: { taskIds: ReadonlySet<string>; goalIds: ReadonlySet<string> },
): ValidatedPlan {
  const issues: ActionValidationIssue[] = [];
  const actions: AssistantAction[] = [];

  plan.actions.forEach((action, index) => {
    const taskId = referencedTaskId(action);
    if (taskId && !known.taskIds.has(taskId)) {
      issues.push({
        index,
        actionType: action.type,
        message: 'Referenced a task that does not exist.',
      });
      return;
    }

    const goalId = referencedGoalId(action);
    if (goalId && !known.goalIds.has(goalId)) {
      // A bad goal link is recoverable: keep the action, drop the link.
      issues.push({
        index,
        actionType: action.type,
        message: 'Referenced a goal that does not exist; the goal link was removed.',
      });
      actions.push(stripGoalLink(action));
      return;
    }

    actions.push(action);
  });

  return { plan: { summary: plan.summary, actions }, issues };
}

function stripGoalLink(action: AssistantAction): AssistantAction {
  if (action.type === 'create_task' || action.type === 'update_task') {
    return { ...action, goalId: null };
  }
  return action;
}

/** Short label used in the preview header and the undo toast. */
export function describeActionType(type: AssistantActionType): string {
  switch (type) {
    case 'create_task':
      return 'New task';
    case 'update_task':
      return 'Edit task';
    case 'complete_task':
      return 'Complete task';
    case 'delete_task':
      return 'Delete task';
    case 'schedule_task':
      return 'Schedule task';
    case 'reschedule_task':
      return 'Move task';
    case 'create_goal':
      return 'New goal';
    case 'update_goal':
      return 'Edit goal';
    case 'optimize_day':
      return 'Rebuild the day';
    case 'clarify':
      return 'Needs a detail';
  }
}
