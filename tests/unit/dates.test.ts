import { describe, expect, it } from 'vitest';

import {
  addDayKeys,
  clockTimeToMinutes,
  dayKeyDifference,
  dayKeyOf,
  dayKeyRange,
  describeDueDate,
  endOfDayInZone,
  formatDuration,
  greetingFor,
  isValidDayKey,
  isValidTimezone,
  minutesBetween,
  minutesToClockTime,
  normalizeClockTime,
  safeTimezone,
  startOfDayInZone,
  startOfWeekKey,
  todayKey,
  zonedTimeToInstant,
} from '@/lib/dates';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';
const UTC = 'UTC';

describe('calendar day resolution', () => {
  it('resolves the local calendar day rather than the UTC slice', () => {
    // 03:30 UTC on the 11th is still 22:30 on the 10th in New York.
    const instant = new Date('2026-03-11T03:30:00.000Z');
    expect(dayKeyOf(instant, NY)).toBe('2026-03-10');
    expect(dayKeyOf(instant, UTC)).toBe('2026-03-11');
    expect(dayKeyOf(instant, TOKYO)).toBe('2026-03-11');
  });

  it('disagrees across timezones for the same instant near midnight', () => {
    const instant = new Date('2026-06-15T02:00:00.000Z');
    expect(dayKeyOf(instant, NY)).toBe('2026-06-14');
    expect(dayKeyOf(instant, TOKYO)).toBe('2026-06-15');
  });

  it('treats the last minute before local midnight as the same day', () => {
    const instant = zonedTimeToInstant('2026-06-15', '23:59', NY);
    expect(dayKeyOf(instant, NY)).toBe('2026-06-15');
  });

  it('treats the first minute after local midnight as the next day', () => {
    const instant = zonedTimeToInstant('2026-06-16', '00:00', NY);
    expect(dayKeyOf(instant, NY)).toBe('2026-06-16');
  });

  it('spans exactly 24 hours on a normal day and 23 on spring-forward', () => {
    const normal = minutesBetween(
      startOfDayInZone('2026-06-15', NY),
      endOfDayInZone('2026-06-15', NY),
    );
    const springForward = minutesBetween(
      startOfDayInZone('2026-03-08', NY),
      endOfDayInZone('2026-03-08', NY),
    );

    expect(normal).toBe(1440);
    expect(springForward).toBe(1380);
  });

  it('spans 25 hours on the fall-back day', () => {
    const fallBack = minutesBetween(
      startOfDayInZone('2026-11-01', NY),
      endOfDayInZone('2026-11-01', NY),
    );
    expect(fallBack).toBe(1500);
  });
});

describe('wall-clock anchoring', () => {
  it('resolves the same clock time to different instants across DST', () => {
    const winter = zonedTimeToInstant('2026-01-15', '09:00', NY);
    const summer = zonedTimeToInstant('2026-07-15', '09:00', NY);

    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z'); // UTC-5
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z'); // UTC-4
  });

  it('anchors an evening time in a positive-offset zone to the prior UTC day', () => {
    const instant = zonedTimeToInstant('2026-06-15', '08:00', TOKYO);
    expect(instant.toISOString()).toBe('2026-06-14T23:00:00.000Z');
  });
});

describe('day key arithmetic', () => {
  it('adds and subtracts calendar days across a month boundary', () => {
    expect(addDayKeys('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDayKeys('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDayKeys('2028-03-01', -1)).toBe('2028-02-29'); // leap year
  });

  it('counts whole calendar days between keys', () => {
    expect(dayKeyDifference('2026-03-10', '2026-03-12')).toBe(2);
    expect(dayKeyDifference('2026-03-12', '2026-03-10')).toBe(-2);
    expect(dayKeyDifference('2026-03-10', '2026-03-10')).toBe(0);
  });

  it('does not skip a day when crossing a DST boundary', () => {
    expect(addDayKeys('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDayKeys('2026-03-08', 1)).toBe('2026-03-09');
    expect(dayKeyDifference('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('returns a trailing window oldest-first, inclusive of the end day', () => {
    expect(dayKeyRange('2026-03-10', 3)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('uses a Monday-based week start', () => {
    expect(startOfWeekKey('2026-03-11')).toBe('2026-03-09'); // Wednesday → Monday
    expect(startOfWeekKey('2026-03-09')).toBe('2026-03-09');
    expect(startOfWeekKey('2026-03-08')).toBe('2026-03-02'); // Sunday → prior Monday
  });

  it('validates day keys strictly', () => {
    expect(isValidDayKey('2026-03-10')).toBe(true);
    expect(isValidDayKey('2026-02-30')).toBe(false);
    expect(isValidDayKey('2026-3-10')).toBe(false);
    expect(isValidDayKey('not-a-date')).toBe(false);
  });
});

describe('clock times', () => {
  it('normalizes loose input and clamps out-of-range values', () => {
    expect(normalizeClockTime('9:5')).toBe('09:05');
    expect(normalizeClockTime('09:05:30')).toBe('09:05');
    expect(normalizeClockTime('99:99')).toBe('23:59');
    expect(normalizeClockTime('garbage')).toBe('09:00');
  });

  it('round-trips minutes and clock times', () => {
    expect(clockTimeToMinutes('09:30')).toBe(570);
    expect(minutesToClockTime(570)).toBe('09:30');
    expect(minutesToClockTime(0)).toBe('00:00');
    expect(minutesToClockTime(1440)).toBe('00:00');
  });
});

describe('timezone safety', () => {
  it('accepts real IANA zones and rejects invented ones', () => {
    expect(isValidTimezone(NY)).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('falls back to the default rather than throwing on bad stored data', () => {
    expect(safeTimezone('Mars/Olympus_Mons')).toBe('America/New_York');
    expect(safeTimezone(null)).toBe('America/New_York');
    expect(safeTimezone(TOKYO)).toBe(TOKYO);
  });

  it('still resolves a calendar day when the stored zone is invalid', () => {
    expect(() => dayKeyOf(new Date(), 'Nowhere/Fake')).not.toThrow();
  });
});

describe('human phrasing', () => {
  const now = new Date('2026-03-10T15:00:00.000Z'); // 11:00 New York

  it('describes deadlines relative to the user timezone', () => {
    expect(describeDueDate('2026-03-10T22:00:00.000Z', NY, now)).toMatch(/^Due today/);
    expect(describeDueDate('2026-03-11T22:00:00.000Z', NY, now)).toMatch(/^Due tomorrow/);
    expect(describeDueDate('2026-03-08T22:00:00.000Z', NY, now)).toBe('Overdue by 2 days');
    expect(describeDueDate(null, NY, now)).toBe('No deadline');
  });

  it('uses a weekday name inside the coming week', () => {
    expect(describeDueDate('2026-03-13T22:00:00.000Z', NY, now)).toBe('Due Friday');
  });

  it('reports an earlier time on the same day as overdue, not as due today', () => {
    expect(describeDueDate('2026-03-10T13:00:00.000Z', NY, now)).toMatch(/^Overdue · was/);
  });

  it('formats durations without redundant zero parts', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(260)).toBe('4h 20m');
    expect(formatDuration(-5)).toBe('0m');
  });

  it('greets according to the user local hour, not the server hour', () => {
    const morningInNy = new Date('2026-03-10T13:00:00.000Z'); // 09:00 NY, 22:00 Tokyo
    expect(greetingFor(NY, morningInNy)).toBe('Good morning');
    expect(greetingFor(TOKYO, morningInNy)).toBe('Winding down');
  });
});

describe('todayKey', () => {
  it('matches the user local date, not the UTC date', () => {
    const lateEvening = new Date('2026-03-11T02:00:00.000Z');
    expect(todayKey(NY, lateEvening)).toBe('2026-03-10');
    expect(todayKey(TOKYO, lateEvening)).toBe('2026-03-11');
  });
});
