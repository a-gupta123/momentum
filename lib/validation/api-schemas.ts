/**
 * Request schemas for the HTTP boundary.
 *
 * These live outside the route handlers so the client can import them to build
 * a payload the server is guaranteed to accept — one schema, both sides, no
 * chance of a field name diverging between the fetch call and the validator.
 *
 * The interesting shape here is `guestContextSchema`. In Guest Demo mode the
 * user's planner lives in *their* localStorage, so the server has no copy and
 * the client must send the context the interpreter needs. That is safe for one
 * specific reason: guest context is only ever used to build a prompt and is
 * never persisted or trusted as identity. It also means guest mode leaks
 * nothing about other users, because there are none — a guest deployment has no
 * shared state at all.
 *
 * For a signed-in user the opposite rule applies: any context in the body is
 * ignored and the server reads from Postgres under RLS. Accepting
 * client-supplied task lists for an authenticated request would let a caller
 * describe a world that is not theirs.
 */
import { z } from 'zod';

import {
  ENERGY_LEVELS,
  GOAL_CATEGORIES,
  GOAL_COLOR_TOKENS,
  GOAL_STATUSES,
  MANUAL_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  THEME_PREFERENCES,
} from '@/lib/domain/types';
import { DOMAIN_LIMITS } from '@/lib/domain/tuning';
import { assistantActionSchema, assistantActionTypeSchema } from '@/lib/validation/ai-actions';

const isoDateTime = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO-8601 timestamp');

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');
const identifier = z.string().min(1).max(64);
const scale5 = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

/** The profile fields the interpreter and scheduler actually read. */
export const guestProfileSchema = z.strictObject({
  id: identifier,
  displayName: z.string().max(80),
  timezone: z.string().min(1).max(64),
  workdayStart: clockTime,
  workdayEnd: clockTime,
  defaultTaskDurationMinutes: z
    .number()
    .int()
    .min(DOMAIN_LIMITS.minTaskDurationMinutes)
    .max(DOMAIN_LIMITS.maxTaskDurationMinutes),
  breakMinutes: z.number().int().min(0).max(60),
  highEnergyStart: clockTime,
  highEnergyEnd: clockTime,
  theme: z.enum(THEME_PREFERENCES),
  aiAssistEnabled: z.boolean(),
  confirmAllActions: z.boolean(),
  splitLongTasks: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const guestTaskSchema = z.strictObject({
  id: identifier,
  userId: identifier,
  goalId: identifier.nullable(),
  parentTaskId: identifier.nullable(),
  title: z.string().min(1).max(DOMAIN_LIMITS.taskTitleMaxLength),
  notes: z.string().max(DOMAIN_LIMITS.taskNotesMaxLength).nullable(),
  status: z.enum(TASK_STATUSES),
  manualPriority: z.enum(MANUAL_PRIORITIES),
  importance: scale5,
  energy: z.enum(ENERGY_LEVELS),
  dueAt: isoDateTime.nullable(),
  scheduledStart: isoDateTime.nullable(),
  scheduledEnd: isoDateTime.nullable(),
  durationMinutes: z.number().int().min(1).max(1440),
  actualMinutes: z.number().int().min(0).max(1440).nullable(),
  isFixedTime: z.boolean(),
  splittable: z.boolean(),
  recurrenceRule: z.string().max(200).nullable(),
  recurrenceSeriesId: identifier.nullable(),
  recurrenceOccurrenceAt: isoDateTime.nullable(),
  source: z.enum(TASK_SOURCES),
  sourceText: z.string().max(2000).nullable(),
  position: z.number().int().min(0).max(1_000_000),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
  archivedAt: isoDateTime.nullable(),
});

export const guestGoalSchema = z.strictObject({
  id: identifier,
  userId: identifier,
  title: z.string().min(1).max(DOMAIN_LIMITS.goalTitleMaxLength),
  description: z.string().max(DOMAIN_LIMITS.goalDescriptionMaxLength).nullable(),
  category: z.enum(GOAL_CATEGORIES),
  priorityWeight: scale5,
  targetDate: dayKey.nullable(),
  weeklyTargetMinutes: z.number().int().min(0).max(10_080).nullable(),
  status: z.enum(GOAL_STATUSES),
  color: z.enum(GOAL_COLOR_TOKENS),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * Guest planner context.
 *
 * The collection caps match the prompt builder's own candidate limits, so a
 * payload larger than this could not influence the result anyway — rejecting it
 * early keeps the request bounded.
 */
export const guestContextSchema = z.strictObject({
  profile: guestProfileSchema,
  tasks: z.array(guestTaskSchema).max(500),
  goals: z.array(guestGoalSchema).max(100),
});

export const interpretRequestSchema = z.strictObject({
  text: z.string().min(1).max(DOMAIN_LIMITS.captureMaxLength),
  /**
   * Required for guests, ignored for signed-in users. Optional in the schema
   * because which rule applies is decided by the session, not the payload.
   */
  context: guestContextSchema.optional(),
});

export type InterpretRequest = z.infer<typeof interpretRequestSchema>;

export const applyRequestSchema = z.strictObject({
  /** Actions the user explicitly confirmed in the preview. */
  actions: z.array(assistantActionSchema).min(1).max(DOMAIN_LIMITS.maxActionsPerBatch),
  /** Verbatim capture, stored on created tasks for audit and explanation. */
  sourceText: z.string().max(DOMAIN_LIMITS.captureMaxLength),
  /**
   * Client-generated key, resent unchanged on retry. This is what makes a
   * double-tapped Confirm land once instead of twice.
   */
  idempotencyKey: z.string().min(8).max(100),
});

export type ApplyRequest = z.infer<typeof applyRequestSchema>;

export const interpretResponseSchema = z.strictObject({
  summary: z.string(),
  actions: z.array(assistantActionSchema),
  source: z.enum(['ai', 'deterministic']),
  fallbackReason: z.string().nullable(),
  issues: z.array(
    z.object({
      index: z.number(),
      actionType: assistantActionTypeSchema,
      message: z.string(),
    }),
  ),
});

export type InterpretResponse = z.infer<typeof interpretResponseSchema>;
