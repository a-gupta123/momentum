/**
 * Recurring-task rules, normalized to RFC-5545 RRULE strings.
 *
 * Two things make this less trivial than calling into `rrule` directly:
 *
 * 1. **DST safety.** `rrule` does its arithmetic on UTC fields. Feeding it real
 *    instants would make "every weekday at 9 AM" drift by an hour twice a year.
 *    Instead we project the anchor into a *floating* date whose UTC fields equal
 *    the user's wall clock, iterate there, then project back. Wall-clock intent
 *    survives DST transitions.
 * 2. **History preservation.** Completing an occurrence must leave that
 *    occurrence completed and create the *next* one. `nextOccurrenceKey` gives
 *    the idempotency key that both the local adapter and the Postgres unique
 *    constraint use, so a double-click cannot fork a series.
 */
import { RRule } from 'rrule';
import { fromZonedTime } from 'date-fns-tz';

import { formatInZone, parseIso, safeTimezone, toIso } from '@/lib/dates';
import type { IsoDateTime, Task } from '@/lib/domain/types';

/** Rules the UI offers directly; free-form RRULEs are still accepted. */
export const RECURRENCE_PRESETS = [
  { label: 'Does not repeat', rule: null },
  { label: 'Every day', rule: 'FREQ=DAILY' },
  { label: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every week', rule: 'FREQ=WEEKLY' },
  { label: 'Every two weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rule: 'FREQ=MONTHLY' },
] as const;

const WEEKDAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

/**
 * Validates and canonicalizes an RRULE string, returning `null` when the rule
 * cannot be understood. `DTSTART` is stripped: the anchor always comes from the
 * task's own occurrence timestamp, never from the stored rule.
 */
export function normalizeRecurrenceRule(input: string | null | undefined): string | null {
  if (!input) return null;

  const cleaned = input
    .trim()
    .replace(/^RRULE:/i, '')
    .replace(/DTSTART=[^;]*;?/i, '')
    .toUpperCase();

  if (!cleaned) return null;

  try {
    const options = RRule.parseString(cleaned);
    if (options.freq === undefined || options.freq === null) return null;
    // Round-trip through RRule so the output is canonically ordered.
    const rule = new RRule({ ...options, dtstart: new Date(Date.UTC(2024, 0, 1)) });
    return rule.toString().replace(/^DTSTART:[^\n]*\n?/i, '').replace(/^RRULE:/i, '');
  } catch {
    return null;
  }
}

/**
 * Maps common English recurrence phrasing onto RRULEs. Used by the deterministic
 * fallback parser, which only claims a recurrence when the phrasing is
 * unambiguous — a wrong recurring task is far more annoying than a missed one.
 */
export function recurrenceFromPhrase(phrase: string): string | null {
  const text = phrase.toLowerCase();

  if (/\bevery (week ?day|business day)\b/.test(text)) {
    return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  }
  if (/\b(every ?day|daily|each day)\b/.test(text)) return 'FREQ=DAILY';
  if (/\bevery other (week|2 weeks)\b/.test(text)) return 'FREQ=WEEKLY;INTERVAL=2';
  if (/\bevery (week|7 days)\b|\bweekly\b/.test(text)) return 'FREQ=WEEKLY';
  if (/\bevery month\b|\bmonthly\b/.test(text)) return 'FREQ=MONTHLY';

  const dayMatch =
    /\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/.exec(text);
  if (dayMatch?.[1]) {
    const code = Object.entries(WEEKDAY_NAMES).find(
      ([, name]) => name.toLowerCase() === dayMatch[1],
    )?.[0];
    if (code) return `FREQ=WEEKLY;BYDAY=${code}`;
  }

  const weekendMatch = /\bevery weekend\b/.exec(text);
  if (weekendMatch) return 'FREQ=WEEKLY;BYDAY=SA,SU';

  return null;
}

/** Plain-English summary of a rule, e.g. `Every weekday`, `Every Monday`. */
export function describeRecurrence(rule: string | null | undefined): string {
  const normalized = normalizeRecurrenceRule(rule);
  if (!normalized) return 'Does not repeat';

  const preset = RECURRENCE_PRESETS.find((entry) => entry.rule === normalized);
  if (preset) return preset.label;

  try {
    const options = RRule.parseString(normalized);
    const interval = options.interval ?? 1;
    const days = normalized.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(',') ?? [];

    if (days.length > 0 && options.freq === RRule.WEEKLY && interval === 1) {
      if (days.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => days.includes(d))) {
        return 'Every weekday';
      }
      const names = days.map((day) => WEEKDAY_NAMES[day] ?? day);
      return `Every ${names.join(', ')}`;
    }

    const unit =
      options.freq === RRule.DAILY
        ? 'day'
        : options.freq === RRule.WEEKLY
          ? 'week'
          : options.freq === RRule.MONTHLY
            ? 'month'
            : options.freq === RRule.YEARLY
              ? 'year'
              : 'occurrence';

    return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  } catch {
    return 'Custom schedule';
  }
}

/**
 * Projects a real instant into a floating date whose UTC fields match the user's
 * wall clock, which is the space `rrule` can safely iterate in.
 */
function toFloating(instant: Date, timezone: string): Date {
  const wall = formatInZone(instant, timezone, "yyyy-MM-dd'T'HH:mm:ss");
  return new Date(`${wall}Z`);
}

/** Inverse of `toFloating`: re-anchors wall-clock fields to a real instant. */
function fromFloating(floating: Date, timezone: string): Date {
  const wall = floating.toISOString().slice(0, 19);
  return fromZonedTime(wall, safeTimezone(timezone));
}

/**
 * The next instant a rule fires strictly after `anchor`, preserving the
 * anchor's wall-clock time of day across DST boundaries.
 */
export function nextOccurrence(
  rule: string,
  anchor: Date,
  timezone: string,
): Date | null {
  const normalized = normalizeRecurrenceRule(rule);
  if (!normalized) return null;

  const zone = safeTimezone(timezone);

  try {
    const floatingAnchor = toFloating(anchor, zone);
    const options = RRule.parseString(normalized);
    const rrule = new RRule({ ...options, dtstart: floatingAnchor });
    const next = rrule.after(floatingAnchor, false);
    return next ? fromFloating(next, zone) : null;
  } catch {
    return null;
  }
}

/**
 * Idempotency key for the next occurrence of a recurring task.
 *
 * Callers persist `(userId, recurrenceSeriesId, recurrenceOccurrenceAt)`; a
 * retry recomputes the identical key and is rejected by the unique index rather
 * than creating a duplicate.
 */
export function nextOccurrenceKey(task: Task, timezone: string): IsoDateTime | null {
  if (!task.recurrenceRule) return null;

  const anchor =
    parseIso(task.recurrenceOccurrenceAt) ??
    parseIso(task.dueAt) ??
    parseIso(task.scheduledStart) ??
    parseIso(task.createdAt);

  if (!anchor) return null;

  const next = nextOccurrence(task.recurrenceRule, anchor, timezone);
  return next ? toIso(next) : null;
}

/**
 * Builds the successor occurrence for a completed recurring task.
 *
 * The completed row is left untouched — that is the historical record. The
 * successor shifts `dueAt` and any scheduled window by the same delta so a
 * "9 AM every weekday" task stays at 9 AM.
 */
export function buildNextOccurrence(
  task: Task,
  timezone: string,
  now: Date,
  newTaskId: string,
): Task | null {
  if (!task.recurrenceRule) return null;

  const nextAnchorIso = nextOccurrenceKey(task, timezone);
  const nextAnchor = parseIso(nextAnchorIso);
  if (!nextAnchor || !nextAnchorIso) return null;

  const previousAnchor =
    parseIso(task.recurrenceOccurrenceAt) ??
    parseIso(task.dueAt) ??
    parseIso(task.scheduledStart) ??
    parseIso(task.createdAt);
  if (!previousAnchor) return null;

  const shiftMs = nextAnchor.getTime() - previousAnchor.getTime();
  const shift = (value: IsoDateTime | null): IsoDateTime | null => {
    const parsed = parseIso(value);
    return parsed ? toIso(new Date(parsed.getTime() + shiftMs)) : null;
  };

  const nowIso = toIso(now);

  return {
    ...task,
    id: newTaskId,
    status: task.isFixedTime ? 'planned' : 'inbox',
    dueAt: shift(task.dueAt),
    scheduledStart: shift(task.scheduledStart),
    scheduledEnd: shift(task.scheduledEnd),
    actualMinutes: null,
    recurrenceSeriesId: task.recurrenceSeriesId ?? task.id,
    recurrenceOccurrenceAt: nextAnchorIso,
    source: 'recurrence',
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    archivedAt: null,
  };
}
