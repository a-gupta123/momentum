import { describe, expect, it } from 'vitest';

import { formatInZone, toIso } from '@/lib/dates';
import {
  buildNextOccurrence,
  describeRecurrence,
  nextOccurrence,
  nextOccurrenceKey,
  normalizeRecurrenceRule,
  recurrenceFromPhrase,
} from '@/lib/domain/recurrence';

import { makeTask } from './factories';

const NY = 'America/New_York';

describe('normalizeRecurrenceRule', () => {
  it('accepts a bare rule and strips any embedded DTSTART', () => {
    expect(normalizeRecurrenceRule('FREQ=DAILY')).toBe('FREQ=DAILY');
    expect(normalizeRecurrenceRule('RRULE:FREQ=DAILY')).toBe('FREQ=DAILY');
    expect(normalizeRecurrenceRule('DTSTART=20240101T090000Z;FREQ=DAILY')).toBe('FREQ=DAILY');
  });

  it('rejects unusable input instead of storing it', () => {
    expect(normalizeRecurrenceRule('')).toBeNull();
    expect(normalizeRecurrenceRule(null)).toBeNull();
    expect(normalizeRecurrenceRule('INTERVAL=2')).toBeNull();
    expect(normalizeRecurrenceRule('not a rule at all')).toBeNull();
  });

  it('preserves weekday restrictions', () => {
    expect(normalizeRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toContain('BYDAY=MO,WE,FR');
  });
});

describe('recurrenceFromPhrase', () => {
  it('maps common phrasing onto rules', () => {
    expect(recurrenceFromPhrase('every weekday at 9am')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(recurrenceFromPhrase('do this every day')).toBe('FREQ=DAILY');
    expect(recurrenceFromPhrase('gym every Monday')).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(recurrenceFromPhrase('review notes weekly')).toBe('FREQ=WEEKLY');
    expect(recurrenceFromPhrase('pay rent every month')).toBe('FREQ=MONTHLY');
    expect(recurrenceFromPhrase('call home every other week')).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(recurrenceFromPhrase('long run every weekend')).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
  });

  it('claims nothing when the phrasing is not clearly recurring', () => {
    expect(recurrenceFromPhrase('finish the problem set tomorrow')).toBeNull();
    expect(recurrenceFromPhrase('every so often I should read more')).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('produces the copy shown in the task sheet', () => {
    expect(describeRecurrence(null)).toBe('Does not repeat');
    expect(describeRecurrence('FREQ=DAILY')).toBe('Every day');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO')).toBe('Every Monday');
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2')).toBe('Every two weeks');
    expect(describeRecurrence('FREQ=MONTHLY')).toBe('Every month');
  });

  it('degrades gracefully for an exotic but valid rule', () => {
    expect(describeRecurrence('FREQ=YEARLY;INTERVAL=3')).toBe('Every 3 years');
  });
});

describe('nextOccurrence', () => {
  it('advances daily rules by one day', () => {
    const anchor = new Date('2026-03-10T14:00:00.000Z'); // 10:00 NY
    const next = nextOccurrence('FREQ=DAILY', anchor, NY);
    expect(next?.toISOString()).toBe('2026-03-11T14:00:00.000Z');
  });

  it('skips the weekend for a weekday rule', () => {
    // 2026-03-13 is a Friday in New York.
    const friday = new Date('2026-03-13T14:00:00.000Z');
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', friday, NY);
    expect(next).not.toBeNull();
    expect(formatInZone(next!, NY, 'EEEE')).toBe('Monday');
    expect(formatInZone(next!, NY, 'yyyy-MM-dd')).toBe('2026-03-16');
  });

  it('preserves the wall-clock time across a DST transition', () => {
    // 2026-03-08 is spring-forward in the US. A 09:00 task must stay at 09:00,
    // even though the UTC offset shifts from -05:00 to -04:00.
    const beforeDst = new Date('2026-03-07T14:00:00.000Z'); // 09:00 NY, UTC-5
    expect(formatInZone(beforeDst, NY, 'HH:mm')).toBe('09:00');

    const next = nextOccurrence('FREQ=DAILY', beforeDst, NY);
    expect(next).not.toBeNull();
    expect(formatInZone(next!, NY, 'HH:mm')).toBe('09:00');
    // The wall clock held, so the absolute instant shifted by 23 hours.
    expect(next!.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('preserves the wall-clock time across the fall-back transition', () => {
    const beforeFallBack = new Date('2026-10-31T13:00:00.000Z'); // 09:00 NY, UTC-4
    const next = nextOccurrence('FREQ=DAILY', beforeFallBack, NY);
    expect(formatInZone(next!, NY, 'HH:mm')).toBe('09:00');
    expect(next!.toISOString()).toBe('2026-11-01T14:00:00.000Z'); // now UTC-5
  });

  it('returns null for an unusable rule', () => {
    expect(nextOccurrence('nonsense', new Date(), NY)).toBeNull();
  });
});

describe('occurrence identity and history', () => {
  it('derives a stable idempotency key from the current occurrence', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
    });

    const first = nextOccurrenceKey(task, NY);
    const second = nextOccurrenceKey(task, NY);
    expect(first).toBe('2026-03-11T14:00:00.000Z');
    expect(second).toBe(first);
  });

  it('falls back to the due date when no occurrence anchor is stored', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: null,
      dueAt: '2026-03-10T14:00:00.000Z',
    });
    expect(nextOccurrenceKey(task, NY)).toBe('2026-03-11T14:00:00.000Z');
  });

  it('returns null for a non-recurring task', () => {
    expect(nextOccurrenceKey(makeTask(), NY)).toBeNull();
  });

  it('shifts the deadline and the scheduled window by the same delta', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      dueAt: '2026-03-10T14:00:00.000Z',
      scheduledStart: '2026-03-10T13:00:00.000Z',
      scheduledEnd: '2026-03-10T13:45:00.000Z',
      status: 'completed',
      completedAt: toIso(new Date('2026-03-10T13:40:00.000Z')),
      actualMinutes: 40,
    });

    const next = buildNextOccurrence(task, NY, new Date('2026-03-10T14:00:00.000Z'), 'new-id');

    expect(next).not.toBeNull();
    expect(next!.id).toBe('new-id');
    expect(next!.dueAt).toBe('2026-03-11T14:00:00.000Z');
    expect(next!.scheduledStart).toBe('2026-03-11T13:00:00.000Z');
    expect(next!.scheduledEnd).toBe('2026-03-11T13:45:00.000Z');
    expect(next!.recurrenceOccurrenceAt).toBe('2026-03-11T14:00:00.000Z');
  });

  it('starts the successor clean, leaving the completed record untouched', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      status: 'completed',
      completedAt: '2026-03-10T13:40:00.000Z',
      actualMinutes: 40,
      source: 'manual',
    });

    const next = buildNextOccurrence(task, NY, new Date(), 'new-id')!;

    expect(next.status).toBe('inbox');
    expect(next.completedAt).toBeNull();
    expect(next.actualMinutes).toBeNull();
    expect(next.archivedAt).toBeNull();
    expect(next.source).toBe('recurrence');
    // The original is unmodified: it is the historical record.
    expect(task.status).toBe('completed');
    expect(task.actualMinutes).toBe(40);
  });

  it('adopts the original task as the series root when none is set', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      recurrenceSeriesId: null,
    });
    const next = buildNextOccurrence(task, NY, new Date(), 'new-id')!;
    expect(next.recurrenceSeriesId).toBe(task.id);
  });

  it('keeps a fixed-time occurrence planned rather than dropping it to the inbox', () => {
    const task = makeTask({
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceOccurrenceAt: '2026-03-11T21:30:00.000Z',
      isFixedTime: true,
      scheduledStart: '2026-03-11T21:30:00.000Z',
      scheduledEnd: '2026-03-11T22:30:00.000Z',
    });
    const next = buildNextOccurrence(task, NY, new Date(), 'new-id')!;
    expect(next.status).toBe('planned');
    expect(next.scheduledStart).not.toBeNull();
  });

  it('returns null for a task with no recurrence rule', () => {
    expect(buildNextOccurrence(makeTask(), NY, new Date(), 'new-id')).toBeNull();
  });
});
