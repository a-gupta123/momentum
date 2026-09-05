/**
 * Form schemas.
 *
 * Forms are validated against the *same* limits the database enforces, imported
 * from `DOMAIN_LIMITS` rather than retyped. A form that accepts 300 characters
 * where the column allows 200 is a guaranteed server-side rejection after the
 * user has finished typing, and that is a worse experience than an inline
 * message at character 201.
 *
 * Dates and times are handled as the *strings the native inputs produce*
 * (`yyyy-MM-dd` and `HH:mm`), not as `Date` objects. The conversion to an
 * instant happens once, in the submit handler, using the profile's timezone —
 * which is the only place that knows what "5pm" means. Parsing to a `Date` in
 * the form would silently apply the browser's timezone instead.
 */
import { z } from 'zod';

import {
  ENERGY_LEVELS,
  GOAL_CATEGORIES,
  GOAL_COLOR_TOKENS,
  GOAL_STATUSES,
  MANUAL_PRIORITIES,
} from '@/lib/domain/types';
import { DOMAIN_LIMITS } from '@/lib/domain/tuning';

const optionalDayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a real date')
  .or(z.literal(''));

const optionalClockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 17:30')
  .or(z.literal(''));

const requiredClockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 17:30');

/** The task fields themselves, before the cross-field rules are layered on. */
const taskFormFields = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give the task a name')
    .max(
      DOMAIN_LIMITS.taskTitleMaxLength,
      `Keep it under ${DOMAIN_LIMITS.taskTitleMaxLength} characters`,
    ),
  notes: z
    .string()
    .max(DOMAIN_LIMITS.taskNotesMaxLength, 'That is longer than the notes field allows')
    .default(''),
  goalId: z.string().default(''),
  /** Deadline date and time, as the native inputs provide them. */
  dueDate: optionalDayKey.default(''),
  dueTime: optionalClockTime.default(''),
  /** Planned working start. */
  scheduledDate: optionalDayKey.default(''),
  scheduledTime: optionalClockTime.default(''),
  durationMinutes: z.coerce
    .number()
    .int('Use whole minutes')
    .min(
      DOMAIN_LIMITS.minTaskDurationMinutes,
      `At least ${DOMAIN_LIMITS.minTaskDurationMinutes} minutes`,
    )
    .max(
      DOMAIN_LIMITS.maxTaskDurationMinutes,
      `At most ${DOMAIN_LIMITS.maxTaskDurationMinutes} minutes`,
    ),
  manualPriority: z.enum(MANUAL_PRIORITIES),
  importance: z.coerce.number().int().min(1).max(5),
  energy: z.enum(ENERGY_LEVELS),
  isFixedTime: z.boolean(),
  splittable: z.boolean(),
  recurrenceRule: z.string().max(200).default(''),
});

export const taskFormSchema = taskFormFields
  // A time with no date is meaningless, and silently discarding it would lose
  // what the user typed. Attaching the message to the date field points at the
  // input they need to fill in.
  .refine((value) => value.dueTime === '' || value.dueDate !== '', {
    message: 'Add a deadline date to go with that time',
    path: ['dueDate'],
  })
  .refine((value) => value.scheduledTime === '' || value.scheduledDate !== '', {
    message: 'Add a date to go with that start time',
    path: ['scheduledDate'],
  })
  // A fixed commitment without a start time cannot be placed on the timeline,
  // which is the entire point of marking it fixed.
  .refine((value) => !value.isFixedTime || value.scheduledTime !== '', {
    message: 'A fixed commitment needs a start time',
    path: ['scheduledTime'],
  });

export type TaskFormValues = z.input<typeof taskFormSchema>;
export type TaskFormOutput = z.output<typeof taskFormSchema>;

/**
 * Quick add. A strict subset of `taskFormSchema` reusing the same field rules,
 * so the two entry points cannot disagree about what a valid title or estimate
 * is. Everything omitted here falls back to the repository's defaults.
 */
export const quickTaskFormSchema = taskFormFields
  .pick({ title: true, goalId: true, durationMinutes: true, dueDate: true, dueTime: true })
  .refine((value) => value.dueTime === '' || value.dueDate !== '', {
    message: 'Add a deadline date to go with that time',
    path: ['dueDate'],
  });

export type QuickTaskFormValues = z.input<typeof quickTaskFormSchema>;

export const goalFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give the goal a name')
    .max(
      DOMAIN_LIMITS.goalTitleMaxLength,
      `Keep it under ${DOMAIN_LIMITS.goalTitleMaxLength} characters`,
    ),
  description: z
    .string()
    .max(DOMAIN_LIMITS.goalDescriptionMaxLength, 'That is longer than the description allows')
    .default(''),
  category: z.enum(GOAL_CATEGORIES),
  priorityWeight: z.coerce.number().int().min(1).max(5),
  targetDate: optionalDayKey.default(''),
  /** Blank means "no weekly target", which is different from a target of zero. */
  weeklyTargetHours: z
    .string()
    .refine(
      (value) =>
        value === '' ||
        (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 168),
      'Use a number of hours between 0 and 168',
    )
    .default(''),
  status: z.enum(GOAL_STATUSES),
  color: z.enum(GOAL_COLOR_TOKENS),
});

export type GoalFormValues = z.input<typeof goalFormSchema>;
export type GoalFormOutput = z.output<typeof goalFormSchema>;

export const settingsFormSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Tell us what to call you').max(80),
    timezone: z.string().min(1, 'Pick a timezone'),
    workdayStart: requiredClockTime,
    workdayEnd: requiredClockTime,
    highEnergyStart: requiredClockTime,
    highEnergyEnd: requiredClockTime,
    defaultTaskDurationMinutes: z.coerce
      .number()
      .int()
      .min(DOMAIN_LIMITS.minTaskDurationMinutes)
      .max(DOMAIN_LIMITS.maxTaskDurationMinutes),
    breakMinutes: z.coerce
      .number()
      .int()
      .min(0, 'Cannot be negative')
      .max(60, 'At most 60 minutes'),
    aiAssistEnabled: z.boolean(),
    confirmAllActions: z.boolean(),
    splitLongTasks: z.boolean(),
  })
  // An end before a start would produce a zero-length day and an empty
  // schedule with no explanation, so it is caught here where it can be
  // explained. A workday *ending* at midnight or later is legitimate and is
  // handled by the scheduler, so only the equal/reversed case is rejected.
  .refine((value) => value.workdayEnd !== value.workdayStart, {
    message: 'Your day needs to be longer than zero hours',
    path: ['workdayEnd'],
  })
  .refine((value) => timeToMinutes(value.highEnergyEnd) > timeToMinutes(value.highEnergyStart), {
    message: 'The high-energy window must end after it starts',
    path: ['highEnergyEnd'],
  });

export type SettingsFormValues = z.input<typeof settingsFormSchema>;
export type SettingsFormOutput = z.output<typeof settingsFormSchema>;

function timeToMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}
