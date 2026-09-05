/**
 * Guest Demo persistence contract.
 *
 * localStorage is untrusted input: it can be hand-edited, truncated by a quota
 * error, or written by an older build still open in another tab. Everything read
 * back is therefore validated, and older payloads are migrated forward rather
 * than discarded — losing a user's demo work to a schema bump would be the
 * cheapest possible way to look unreliable.
 */
import { z } from 'zod';

import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/dates';
import {
  ACTIVITY_EVENT_TYPES,
  BLOCK_TYPES,
  ENERGY_LEVELS,
  GOAL_CATEGORIES,
  GOAL_COLOR_TOKENS,
  GOAL_STATUSES,
  MANUAL_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  THEME_PREFERENCES,
} from '@/lib/domain/types';

/** Bump when the persisted shape changes, and add a migration step below. */
export const GUEST_STATE_VERSION = 2;

export const GUEST_STORAGE_KEY = 'momentum.guest.v1';

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO-8601 date-time',
});
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTime = z.string().regex(/^\d{2}:\d{2}$/);
const timezone = z.string().refine(isValidTimezone, { message: 'Unknown IANA timezone' });

const profileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(80),
  timezone,
  workdayStart: clockTime,
  workdayEnd: clockTime,
  defaultTaskDurationMinutes: z.number().int().min(5).max(600),
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

const goalSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable(),
  category: z.enum(GOAL_CATEGORIES),
  priorityWeight: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  targetDate: dayKey.nullable(),
  weeklyTargetMinutes: z.number().int().min(0).max(10_080).nullable(),
  status: z.enum(GOAL_STATUSES),
  color: z.enum(GOAL_COLOR_TOKENS),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const taskSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  goalId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).nullable(),
  status: z.enum(TASK_STATUSES),
  manualPriority: z.enum(MANUAL_PRIORITIES),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  energy: z.enum(ENERGY_LEVELS),
  dueAt: isoDateTime.nullable(),
  scheduledStart: isoDateTime.nullable(),
  scheduledEnd: isoDateTime.nullable(),
  durationMinutes: z.number().int().min(5).max(600),
  actualMinutes: z.number().int().min(0).max(10_080).nullable(),
  isFixedTime: z.boolean(),
  splittable: z.boolean(),
  recurrenceRule: z.string().max(200).nullable(),
  recurrenceSeriesId: z.string().nullable(),
  recurrenceOccurrenceAt: isoDateTime.nullable(),
  source: z.enum(TASK_SOURCES),
  sourceText: z.string().max(2000).nullable(),
  position: z.number(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
  archivedAt: isoDateTime.nullable(),
});

const dependencySchema = z.object({
  taskId: z.string().min(1),
  dependsOnTaskId: z.string().min(1),
  userId: z.string().min(1),
});

const dailyPlanSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  planDate: dayKey,
  timezone,
  availableMinutes: z.number().int().min(0),
  scheduledMinutes: z.number().int().min(0),
  scoreVersion: z.string().min(1),
  generatedAt: isoDateTime,
  updatedAt: isoDateTime,
});

const planBlockSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  dailyPlanId: z.string().min(1),
  taskId: z.string().nullable(),
  title: z.string().max(200).nullable(),
  startAt: isoDateTime,
  endAt: isoDateTime,
  blockType: z.enum(BLOCK_TYPES),
  isLocked: z.boolean(),
  position: z.number(),
});

const activityEventSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  taskId: z.string().nullable(),
  eventType: z.enum(ACTIVITY_EVENT_TYPES),
  occurredAt: isoDateTime,
  durationMinutes: z.number().int().min(0).max(10_080).nullable(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const focusSessionSchema = z.object({
  taskId: z.string().min(1),
  startedAt: isoDateTime,
  accumulatedMinutes: z.number().min(0).max(10_080),
  isPaused: z.boolean(),
});

export const guestStateSchema = z.object({
  version: z.literal(GUEST_STATE_VERSION),
  profile: profileSchema,
  goals: z.array(goalSchema),
  tasks: z.array(taskSchema),
  dependencies: z.array(dependencySchema),
  plans: z.array(dailyPlanSchema),
  blocks: z.array(planBlockSchema),
  events: z.array(activityEventSchema),
  focusSession: focusSessionSchema.nullable(),
  /** Day the demo dataset was generated, used to keep a stale demo fresh. */
  seedDayKey: dayKey,
  /** Set once the user changes anything, which freezes automatic re-seeding. */
  userModified: z.boolean(),
});

export type GuestState = z.infer<typeof guestStateSchema>;

export type GuestStateLoadOutcome =
  | { status: 'ok'; state: GuestState; migratedFrom: number | null }
  | { status: 'empty' }
  | { status: 'invalid'; reason: string };

/**
 * Parses and migrates a raw localStorage payload.
 *
 * Returns a discriminated outcome instead of throwing so the caller can decide
 * between "seed a fresh demo" and "tell the user their local data was
 * unreadable", which are genuinely different situations.
 */
export function loadGuestState(raw: string | null): GuestStateLoadOutcome {
  if (!raw) return { status: 'empty' };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'Stored demo data was not valid JSON.' };
  }

  // A stored literal `null` means "nothing here", not corruption. Treating it as
  // empty seeds a fresh demo silently instead of warning about damaged data.
  if (parsedJson === null) return { status: 'empty' };

  const migrated = migrateGuestState(parsedJson);
  if (!migrated.ok) return { status: 'invalid', reason: migrated.reason };

  const result = guestStateSchema.safeParse(migrated.value);
  if (!result.success) {
    return {
      status: 'invalid',
      reason: `Stored demo data did not match the expected shape (${result.error.issues[0]?.path.join('.') || 'unknown field'}).`,
    };
  }

  return { status: 'ok', state: result.data, migratedFrom: migrated.migratedFrom };
}

type MigrationResult =
  { ok: true; value: unknown; migratedFrom: number | null } | { ok: false; reason: string };

/**
 * Steps an older payload up to the current version.
 *
 * Migrations are additive and forgiving: a v1 record simply lacked the
 * assistant preferences and the activity log, so v2 supplies defaults. An
 * unknown *newer* version is refused rather than mangled, which matters when a
 * second tab is running a newer deployment.
 */
export function migrateGuestState(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'Stored demo data was not an object.' };
  }

  const record = input as Record<string, unknown>;
  const version = typeof record.version === 'number' ? record.version : 1;

  if (version > GUEST_STATE_VERSION) {
    return {
      ok: false,
      reason: 'Stored demo data comes from a newer version of Momentum.',
    };
  }

  if (version === GUEST_STATE_VERSION) {
    return { ok: true, value: record, migratedFrom: null };
  }

  let working = record;

  // --- v1 → v2 -------------------------------------------------------------
  // v1 predates the assistant preferences, the activity log and the
  // seed-freshness bookkeeping.
  if (version === 1) {
    const profile = (working.profile ?? {}) as Record<string, unknown>;
    working = {
      ...working,
      version: 2,
      profile: {
        ...profile,
        timezone: isValidTimezone(String(profile.timezone ?? ''))
          ? profile.timezone
          : DEFAULT_TIMEZONE,
        aiAssistEnabled: profile.aiAssistEnabled ?? true,
        confirmAllActions: profile.confirmAllActions ?? false,
        splitLongTasks: profile.splitLongTasks ?? true,
      },
      events: Array.isArray(working.events) ? working.events : [],
      dependencies: Array.isArray(working.dependencies) ? working.dependencies : [],
      plans: Array.isArray(working.plans) ? working.plans : [],
      blocks: Array.isArray(working.blocks) ? working.blocks : [],
      focusSession: working.focusSession ?? null,
      seedDayKey:
        typeof working.seedDayKey === 'string'
          ? working.seedDayKey
          : new Date().toISOString().slice(0, 10),
      // A v1 payload always represents real prior use, so never auto-reseed it.
      userModified: true,
    };
  }

  return { ok: true, value: working, migratedFrom: version };
}

export function serializeGuestState(state: GuestState): string {
  return JSON.stringify(state);
}
