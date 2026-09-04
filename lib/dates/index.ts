/**
 * Timezone-safe date layer.
 *
 * The rule enforced here: absolute instants live in UTC, calendar dates and
 * clock times live in a named IANA timezone, and the two are only bridged by
 * the functions in this module. Nothing else in the codebase should slice an
 * ISO string to derive "today", because that silently uses UTC and breaks for
 * every user west of Greenwich in the evening.
 */
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  isValid,
  parse,
  startOfWeek,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

import type { ClockTime, DayKey, IsoDateTime } from '@/lib/domain/types';

export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60_000;

/** Fallback used when a stored timezone is missing or rejected by the platform. */
export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Validates an IANA timezone against the host's own database. Guest state and
 * profile rows are untrusted input, and an invalid zone would otherwise throw
 * from deep inside a render.
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(timezone: string | null | undefined): string {
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

/** The browser's timezone, or the default during server rendering. */
export function detectTimezone(): string {
  try {
    return safeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function toIso(date: Date): IsoDateTime {
  return date.toISOString();
}

/** Parses an ISO string, returning `null` rather than an `Invalid Date`. */
export function parseIso(value: IsoDateTime | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return isValid(parsed) ? parsed : null;
}

/** The calendar date that `instant` falls on, in `timezone`. */
export function dayKeyOf(instant: Date, timezone: string): DayKey {
  return formatInTimeZone(instant, safeTimezone(timezone), 'yyyy-MM-dd');
}

export function todayKey(timezone: string, now: Date = new Date()): DayKey {
  return dayKeyOf(now, timezone);
}

/** Midnight at the start of `dayKey` in `timezone`, as an absolute instant. */
export function startOfDayInZone(dayKey: DayKey, timezone: string): Date {
  return fromZonedTime(`${dayKey}T00:00:00`, safeTimezone(timezone));
}

/** Midnight beginning the *next* calendar day, i.e. the exclusive day end. */
export function endOfDayInZone(dayKey: DayKey, timezone: string): Date {
  return startOfDayInZone(addDayKeys(dayKey, 1), timezone);
}

/**
 * Combines a calendar date and a wall-clock time into an absolute instant.
 * Handles DST correctly because `fromZonedTime` resolves the offset that is
 * actually in force on that date.
 */
export function zonedTimeToInstant(dayKey: DayKey, time: ClockTime, timezone: string): Date {
  const normalized = normalizeClockTime(time);
  return fromZonedTime(`${dayKey}T${normalized}:00`, safeTimezone(timezone));
}

/** Shifts a `DayKey` by whole calendar days without touching clock time. */
export function addDayKeys(dayKey: DayKey, days: number): DayKey {
  const base = parse(dayKey, 'yyyy-MM-dd', new Date());
  return formatDayKey(addDays(base, days));
}

/** Formats a *floating* date (already in the target zone) as a day key. */
export function formatDayKey(date: Date): DayKey {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return isValid(parsed) && formatDayKey(parsed) === value;
}

/** Whole calendar days between two day keys (`b - a`). */
export function dayKeyDifference(a: DayKey, b: DayKey): number {
  return differenceInCalendarDays(
    parse(b, 'yyyy-MM-dd', new Date()),
    parse(a, 'yyyy-MM-dd', new Date()),
  );
}

/** `HH:mm` clamped to a real time of day; tolerates `9:5`, `09:05:00` and junk. */
export function normalizeClockTime(time: string): ClockTime {
  const match = /^(\d{1,2}):(\d{1,2})/.exec(time.trim());
  if (!match) return '09:00';
  const hours = clamp(Number(match[1]), 0, 23);
  const minutes = clamp(Number(match[2]), 0, 59);
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`;
}

/** Minutes since midnight for a `HH:mm` string. */
export function clockTimeToMinutes(time: ClockTime): number {
  const [hours, minutes] = normalizeClockTime(time).split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function minutesToClockTime(minutes: number): ClockTime {
  const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${`${hours}`.padStart(2, '0')}:${`${mins}`.padStart(2, '0')}`;
}

/** Formats an instant using the user's timezone. */
export function formatInZone(
  instant: Date | IsoDateTime,
  timezone: string,
  pattern: string,
): string {
  const date = typeof instant === 'string' ? parseIso(instant) : instant;
  if (!date) return '';
  return formatInTimeZone(date, safeTimezone(timezone), pattern);
}

/** `3:30 PM`, with no leading zero, for dense time labels. */
export function formatTimeLabel(instant: Date | IsoDateTime, timezone: string): string {
  return formatInZone(instant, timezone, 'h:mm a');
}

/** `Fri, Mar 14` — compact date context for due chips. */
export function formatDateLabel(instant: Date | IsoDateTime, timezone: string): string {
  return formatInZone(instant, timezone, 'EEE, MMM d');
}

/** `Friday, March 14` — the header's full date. */
export function formatLongDate(instant: Date | IsoDateTime, timezone: string): string {
  return formatInZone(instant, timezone, 'EEEE, MMMM d');
}

/**
 * Human due-date phrasing relative to now, in the user's timezone:
 * `Overdue by 2 days`, `Due today`, `Due tomorrow`, `Due Fri, Mar 14`.
 */
export function describeDueDate(
  dueAt: IsoDateTime | null,
  timezone: string,
  now: Date = new Date(),
): string {
  const due = parseIso(dueAt);
  if (!due) return 'No deadline';

  const zone = safeTimezone(timezone);
  const dueDay = dayKeyOf(due, zone);
  const nowDay = dayKeyOf(now, zone);
  const dayDelta = dayKeyDifference(nowDay, dueDay);

  if (due.getTime() < now.getTime()) {
    if (dayDelta === 0) return `Overdue · was ${formatTimeLabel(due, zone)}`;
    const days = Math.abs(dayDelta);
    return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (dayDelta === 0) return `Due today · ${formatTimeLabel(due, zone)}`;
  if (dayDelta === 1) return `Due tomorrow · ${formatTimeLabel(due, zone)}`;
  if (dayDelta <= 6) return `Due ${formatInZone(due, zone, 'EEEE')}`;
  return `Due ${formatDateLabel(due, zone)}`;
}

/** Minutes between two instants, floored, never negative. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, differenceInMinutes(end, start));
}

export function addMinutesTo(instant: Date, minutes: number): Date {
  return addMinutes(instant, minutes);
}

/** Rounds an instant up to the next `step`-minute boundary of the hour. */
export function ceilToMinuteStep(instant: Date, step: number): Date {
  const ms = instant.getTime();
  const stepMs = step * MS_PER_MINUTE;
  return new Date(Math.ceil(ms / stepMs) * stepMs);
}

export function floorToMinuteStep(instant: Date, step: number): Date {
  const ms = instant.getTime();
  const stepMs = step * MS_PER_MINUTE;
  return new Date(Math.floor(ms / stepMs) * stepMs);
}

/** Monday-based week start for the calendar week containing `dayKey`. */
export function startOfWeekKey(dayKey: DayKey): DayKey {
  const base = parse(dayKey, 'yyyy-MM-dd', new Date());
  return formatDayKey(startOfWeek(base, { weekStartsOn: 1 }));
}

/** The `count` day keys ending at `endKey`, oldest first. */
export function dayKeyRange(endKey: DayKey, count: number): DayKey[] {
  const keys: DayKey[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(addDayKeys(endKey, -offset));
  }
  return keys;
}

/** `4h 20m`, `45m`, `0m` — the app's single duration format. */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Time-of-day greeting in the user's timezone. */
export function greetingFor(timezone: string, now: Date = new Date()): string {
  const hour = Number(formatInZone(now, timezone, 'H'));
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Winding down';
}

/** Wall-clock minutes since midnight for an instant, in `timezone`. */
export function minutesIntoDay(instant: Date, timezone: string): number {
  return clockTimeToMinutes(formatInZone(instant, timezone, 'HH:mm'));
}

/** The instant re-expressed as a floating local `Date`, for calendar math only. */
export function asZonedDate(instant: Date, timezone: string): Date {
  return toZonedTime(instant, safeTimezone(timezone));
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
