import { describe, expect, it } from 'vitest';

import { minutesBetween, parseIso, zonedTimeToInstant } from '@/lib/dates';
import {
  buildDaySchedule,
  planChunks,
  OVERFLOW_REASONS,
  type DaySchedule,
  type FixedBlockInput,
  type SchedulableTaskInput,
  type SchedulerInput,
} from '@/lib/domain/scheduler';
import { DEFAULT_SCHEDULING_CONFIG } from '@/lib/domain/tuning';

const TIMEZONE = 'America/New_York';
const DATE = '2026-03-10';
/** 05:00 local — before the workday, so "now" never truncates the grid. */
const NOW = new Date('2026-03-10T09:00:00.000Z');

function at(time: string, date = DATE): string {
  return zonedTimeToInstant(date, time, TIMEZONE).toISOString();
}

function makeSchedulable(
  overrides: Partial<SchedulableTaskInput> & Pick<SchedulableTaskInput, 'id'>,
): SchedulableTaskInput {
  return {
    title: `Task ${overrides.id}`,
    durationMinutes: 60,
    score: 50,
    dueAt: null,
    energy: 'medium',
    importance: 3,
    splittable: false,
    blocked: false,
    position: 0,
    preferredWindow: null,
    ...overrides,
  };
}

function schedule(input: Partial<SchedulerInput> = {}): DaySchedule {
  return buildDaySchedule({
    date: DATE,
    timezone: TIMEZONE,
    workdayStart: '09:00',
    workdayEnd: '17:00',
    breakMinutes: 0,
    highEnergyStart: '09:00',
    highEnergyEnd: '12:00',
    fixedBlocks: [],
    tasks: [],
    allowSplitting: true,
    now: NOW,
    ...input,
  });
}

/** Shared invariant assertions, applied to many different scenarios. */
function expectNoOverlaps(result: DaySchedule): void {
  const occupied = result.blocks
    .filter((block) => block.blockType !== 'break')
    .map((block) => ({
      start: parseIso(block.startAt)?.getTime() ?? 0,
      end: parseIso(block.endAt)?.getTime() ?? 0,
      id: block.id,
    }))
    .sort((a, b) => a.start - b.start);

  for (let index = 1; index < occupied.length; index += 1) {
    const previous = occupied[index - 1];
    const current = occupied[index];
    if (!previous || !current) continue;
    expect(
      current.start,
      `${current.id} starts before ${previous.id} ends`,
    ).toBeGreaterThanOrEqual(previous.end);
  }
}

function expectWithinWindow(result: DaySchedule): void {
  const windowStart = parseIso(result.windowStart)?.getTime() ?? 0;
  const windowEnd = parseIso(result.windowEnd)?.getTime() ?? 0;

  for (const block of result.blocks) {
    if (block.blockType === 'fixed') continue; // fixed commitments may sit outside
    const start = parseIso(block.startAt)?.getTime() ?? 0;
    const end = parseIso(block.endAt)?.getTime() ?? 0;
    expect(start).toBeGreaterThanOrEqual(windowStart);
    expect(end).toBeLessThanOrEqual(windowEnd);
  }
}

describe('core invariants', () => {
  it('never produces overlapping blocks', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({ id: 'a', durationMinutes: 90, score: 90 }),
        makeSchedulable({ id: 'b', durationMinutes: 60, score: 80 }),
        makeSchedulable({ id: 'c', durationMinutes: 45, score: 70 }),
        makeSchedulable({ id: 'd', durationMinutes: 120, score: 60 }),
      ],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('13:00'), endAt: at('14:30') },
      ],
    });

    expectNoOverlaps(result);
    expectWithinWindow(result);
  });

  it('never schedules anything outside the availability window', () => {
    const result = schedule({
      workdayStart: '10:00',
      workdayEnd: '12:00',
      tasks: [
        makeSchedulable({ id: 'a', durationMinutes: 60 }),
        makeSchedulable({ id: 'b', durationMinutes: 60 }),
        makeSchedulable({ id: 'c', durationMinutes: 60 }),
      ],
    });

    expectWithinWindow(result);
    expect(result.diagnostics.scheduledMinutes).toBeLessThanOrEqual(
      result.diagnostics.availableMinutes,
    );
  });

  it('leaves fixed blocks exactly where they were', () => {
    const fixed: FixedBlockInput = {
      id: 'gym',
      taskId: 'task-gym',
      title: 'Gym',
      startAt: at('11:00'),
      endAt: at('12:00'),
    };

    const result = schedule({
      fixedBlocks: [fixed],
      tasks: [makeSchedulable({ id: 'a', durationMinutes: 240, score: 99 })],
    });

    const placed = result.blocks.find((block) => block.id === 'gym');
    expect(placed?.startAt).toBe(fixed.startAt);
    expect(placed?.endAt).toBe(fixed.endAt);
    expect(placed?.isLocked).toBe(true);
    expectNoOverlaps(result);
  });

  it('excludes a blocked task from placement and explains why', () => {
    const result = schedule({
      tasks: [makeSchedulable({ id: 'blocked', blocked: true, score: 99 })],
    });

    expect(result.blocks.filter((block) => block.blockType === 'task')).toHaveLength(0);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0]?.reason).toBe(OVERFLOW_REASONS.blocked);
    expect(result.overflow[0]?.detail).toMatch(/another task/i);
  });

  it('is deterministic across repeated runs and input orderings', () => {
    const tasks = [
      makeSchedulable({ id: 'a', durationMinutes: 60, score: 70 }),
      makeSchedulable({ id: 'b', durationMinutes: 60, score: 70 }),
      makeSchedulable({ id: 'c', durationMinutes: 45, score: 55 }),
      makeSchedulable({ id: 'd', durationMinutes: 30, score: 70 }),
    ];

    const first = schedule({ tasks });
    const second = schedule({ tasks: [...tasks].reverse() });
    const third = schedule({ tasks });

    const fingerprint = (result: DaySchedule) =>
      result.blocks.map((block) => `${block.id}@${block.startAt}`).join('|');

    expect(fingerprint(second)).toBe(fingerprint(first));
    expect(fingerprint(third)).toBe(fingerprint(first));
  });

  it('never exceeds capacity, reporting the remainder as overflow', () => {
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '11:00', // 120 minutes of capacity
      tasks: [
        makeSchedulable({ id: 'a', durationMinutes: 60, score: 90 }),
        makeSchedulable({ id: 'b', durationMinutes: 60, score: 80 }),
        makeSchedulable({ id: 'c', durationMinutes: 60, score: 70 }),
      ],
    });

    expect(result.diagnostics.availableMinutes).toBe(120);
    expect(result.diagnostics.scheduledMinutes).toBe(120);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0]?.taskId).toBe('c');
    expect(result.overflow[0]?.reason).toBe(OVERFLOW_REASONS.capacity);
    expect(result.diagnostics.overflowMinutes).toBe(60);
  });
});

describe('ranking and energy windows', () => {
  it('places the highest-scoring task first', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({ id: 'low', score: 20 }),
        makeSchedulable({ id: 'high', score: 95 }),
        makeSchedulable({ id: 'mid', score: 55 }),
      ],
    });

    const order = result.blocks
      .filter((block) => block.blockType === 'task')
      .map((block) => block.taskId);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('uses the nearer deadline as a stable tie-breaker at equal scores', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({ id: 'later', score: 60, dueAt: at('16:00', '2026-03-20') }),
        makeSchedulable({ id: 'sooner', score: 60, dueAt: at('16:00', '2026-03-12') }),
      ],
    });

    const first = result.blocks.find((block) => block.blockType === 'task');
    expect(first?.taskId).toBe('sooner');
  });

  it('puts high-energy deep work inside the preferred energy window', () => {
    const result = schedule({
      highEnergyStart: '14:00',
      highEnergyEnd: '17:00',
      tasks: [
        makeSchedulable({ id: 'shallow', score: 90, energy: 'low', importance: 2 }),
        makeSchedulable({ id: 'deep', score: 40, energy: 'high', importance: 5 }),
      ],
    });

    const deep = result.blocks.find((block) => block.taskId === 'deep');
    const start = parseIso(deep?.startAt ?? '');
    expect(start).not.toBeNull();
    expect(start!.getTime()).toBeGreaterThanOrEqual(
      zonedTimeToInstant(DATE, '14:00', TIMEZONE).getTime(),
    );
  });

  it('honours an explicit preferred window ahead of the energy window', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({
          id: 'afternoon',
          energy: 'high',
          importance: 5,
          preferredWindow: { start: '15:00', end: '17:00' },
        }),
      ],
    });

    const block = result.blocks.find((block) => block.taskId === 'afternoon');
    expect(block?.startAt).toBe(at('15:00'));
  });
});

describe('deadlines', () => {
  it('still schedules an already-overdue task rather than refusing it', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({ id: 'late', durationMinutes: 60, dueAt: at('12:00', '2026-03-01') }),
      ],
    });

    const block = result.blocks.find((block) => block.taskId === 'late');
    expect(block).toBeDefined();
    expect(result.overflow).toHaveLength(0);
  });

  it('prefers a slot that finishes before the deadline over the earliest slot', () => {
    const result = schedule({
      tasks: [makeSchedulable({ id: 'a', durationMinutes: 60, dueAt: at('11:00') })],
    });

    const block = result.blocks.find((block) => block.taskId === 'a');
    const end = parseIso(block?.endAt ?? '')?.getTime() ?? 0;
    expect(end).toBeLessThanOrEqual(zonedTimeToInstant(DATE, '11:00', TIMEZONE).getTime());
  });

  it('hoists a deadline-critical task above a long blocker when nothing is lost', () => {
    // Greedy order places `bulky` (the highest score) across the whole morning,
    // which pushes both 11:30 deadlines into overflow. Hoisting `urgent-a`
    // above it costs nothing, because `bulky` still fits afterwards — so the
    // improvement pass should take that trade.
    const greedyOnly = schedule({
      workdayStart: '09:00',
      workdayEnd: '15:00',
      config: { ...DEFAULT_SCHEDULING_CONFIG, maxImprovementSwaps: 0 },
      tasks: [
        makeSchedulable({ id: 'bulky', durationMinutes: 240, score: 60 }),
        makeSchedulable({ id: 'urgent-a', durationMinutes: 120, score: 30, dueAt: at('11:30') }),
      ],
    });

    const improved = schedule({
      workdayStart: '09:00',
      workdayEnd: '15:00',
      tasks: [
        makeSchedulable({ id: 'bulky', durationMinutes: 240, score: 60 }),
        makeSchedulable({ id: 'urgent-a', durationMinutes: 120, score: 30, dueAt: at('11:30') }),
      ],
    });

    // Without the pass, the urgent task misses its deadline entirely.
    expect(greedyOnly.diagnostics.deadlineViolations).toBe(1);

    // With it, the urgent task lands in time and total scheduled value is intact.
    expect(improved.diagnostics.deadlineViolations).toBe(0);
    const urgent = improved.blocks.find((block) => block.taskId === 'urgent-a');
    expect(urgent).toBeDefined();
    expect(parseIso(urgent?.endAt ?? '')!.getTime()).toBeLessThanOrEqual(
      zonedTimeToInstant(DATE, '11:30', TIMEZONE).getTime(),
    );
    expect(improved.blocks.some((block) => block.taskId === 'bulky')).toBe(true);
    expect(improved.diagnostics.scheduledMinutes).toBeGreaterThanOrEqual(
      greedyOnly.diagnostics.scheduledMinutes,
    );
    expectNoOverlaps(improved);
  });

  it('overflows a task honestly when no arrangement finishes before its deadline', () => {
    const result = schedule({
      tasks: [
        makeSchedulable({ id: 'blocker', durationMinutes: 120, score: 99 }),
        // Needs 120 minutes but is due at 10:30, and the only opening is later.
        makeSchedulable({ id: 'tight', durationMinutes: 120, score: 10, dueAt: at('10:30') }),
      ],
    });

    const overflow = result.overflow.find((item) => item.taskId === 'tight');
    expect(overflow?.reason).toBe(OVERFLOW_REASONS.deadline);
    expect(overflow?.detail).toMatch(/finishes before/i);
    expect(result.blocks.some((block) => block.taskId === 'tight')).toBe(false);
  });
});

describe('splitting long tasks', () => {
  it('preserves the total duration when a task is split', () => {
    for (const duration of [95, 120, 150, 200, 240, 337]) {
      const chunks = planChunks(duration, DEFAULT_SCHEDULING_CONFIG);
      expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(duration);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of chunks) {
        expect(chunk).toBeGreaterThan(0);
      }
    }
  });

  it('prefers one contiguous block when the day has room for it', () => {
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '15:00',
      tasks: [makeSchedulable({ id: 'long', durationMinutes: 180, splittable: true, score: 90 })],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('10:00'), endAt: at('11:00') },
      ],
    });

    const blocks = result.blocks.filter((block) => block.taskId === 'long');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.durationMinutes).toBe(180);
    expect(blocks[0]?.chunkCount).toBeNull();
  });

  it('splits a long splittable task when no contiguous opening exists', () => {
    // 09:00–14:00 with a fixed hour at 11:00 leaves two 120-minute gaps, so a
    // 180-minute task cannot be placed in one sitting.
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '14:00',
      tasks: [makeSchedulable({ id: 'long', durationMinutes: 180, splittable: true, score: 90 })],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('11:00'), endAt: at('12:00') },
      ],
    });

    const chunks = result.blocks.filter((block) => block.taskId === 'long');
    const total = chunks.reduce((sum, block) => sum + block.durationMinutes, 0);

    expect(chunks.length).toBeGreaterThan(1);
    expect(total).toBe(180);
    expect(chunks.every((chunk) => chunk.chunkCount === chunks.length)).toBe(true);
    expectNoOverlaps(result);
  });

  it('keeps a non-splittable task contiguous or overflows it', () => {
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '13:00',
      tasks: [makeSchedulable({ id: 'solid', durationMinutes: 180, splittable: false, score: 90 })],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('10:00'), endAt: at('11:00') },
      ],
    });

    const chunks = result.blocks.filter((block) => block.taskId === 'solid');
    expect(chunks.length === 0 || chunks.length === 1).toBe(true);
    if (chunks.length === 0) {
      expect(result.overflow[0]?.taskId).toBe('solid');
    }
  });

  it('does not split when the profile disables splitting', () => {
    const result = schedule({
      allowSplitting: false,
      workdayStart: '09:00',
      workdayEnd: '13:00',
      tasks: [makeSchedulable({ id: 'long', durationMinutes: 180, splittable: true, score: 90 })],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('10:00'), endAt: at('11:00') },
      ],
    });

    expect(result.blocks.filter((block) => block.taskId === 'long').length).toBeLessThanOrEqual(1);
  });
});

describe('buffers and breaks', () => {
  it('inserts the configured buffer between consecutive focus blocks', () => {
    const result = schedule({
      breakMinutes: 15,
      tasks: [
        makeSchedulable({ id: 'a', durationMinutes: 60, score: 90 }),
        makeSchedulable({ id: 'b', durationMinutes: 60, score: 80 }),
      ],
    });

    const a = result.blocks.find((block) => block.taskId === 'a');
    const b = result.blocks.find((block) => block.taskId === 'b');
    const gap = minutesBetween(parseIso(a?.endAt ?? '')!, parseIso(b?.startAt ?? '')!);

    expect(gap).toBeGreaterThanOrEqual(15);
    expect(result.blocks.some((block) => block.blockType === 'break')).toBe(true);
    expect(result.diagnostics.bufferMinutes).toBeGreaterThan(0);
  });

  it('does not emit a trailing break after the final block of the day', () => {
    const result = schedule({
      breakMinutes: 15,
      tasks: [makeSchedulable({ id: 'only', durationMinutes: 60 })],
    });
    expect(result.blocks.filter((block) => block.blockType === 'break')).toHaveLength(0);
  });
});

describe('timezone and date boundaries', () => {
  it('computes availability across a spring-forward day using real elapsed time', () => {
    // 2026-03-08 is the US DST transition: 09:00–17:00 local is only 7 hours.
    const springForward = buildDaySchedule({
      date: '2026-03-08',
      timezone: TIMEZONE,
      workdayStart: '01:00',
      workdayEnd: '05:00',
      breakMinutes: 0,
      highEnergyStart: '01:00',
      highEnergyEnd: '03:00',
      fixedBlocks: [],
      tasks: [],
      allowSplitting: true,
      now: new Date('2026-03-01T00:00:00.000Z'),
    });

    // 01:00 → 05:00 spans only three real hours because 02:00 never happens.
    expect(springForward.diagnostics.availableMinutes).toBe(180);
  });

  it('supports a workday that runs past midnight', () => {
    const result = schedule({
      workdayStart: '22:00',
      workdayEnd: '02:00',
      tasks: [makeSchedulable({ id: 'night', durationMinutes: 60 })],
    });

    expect(result.diagnostics.availableMinutes).toBe(240);
    expect(result.blocks.find((block) => block.taskId === 'night')?.startAt).toBe(at('22:00'));
  });

  it('never schedules into the past when planning the current day', () => {
    const result = buildDaySchedule({
      date: DATE,
      timezone: TIMEZONE,
      workdayStart: '09:00',
      workdayEnd: '17:00',
      breakMinutes: 0,
      highEnergyStart: '09:00',
      highEnergyEnd: '12:00',
      fixedBlocks: [],
      tasks: [makeSchedulable({ id: 'a', durationMinutes: 60 })],
      allowSplitting: true,
      // 18:20 UTC == 14:20 local, mid-workday.
      now: new Date('2026-03-10T18:20:00.000Z'),
    });

    const block = result.blocks.find((block) => block.taskId === 'a');
    const start = parseIso(block?.startAt ?? '')?.getTime() ?? 0;
    expect(start).toBeGreaterThanOrEqual(new Date('2026-03-10T18:20:00.000Z').getTime());
    // Snapped up to the next 15-minute boundary: 14:30 local.
    expect(block?.startAt).toBe(at('14:30'));
  });
});

describe('diagnostics', () => {
  it('reports every capacity number needed by the header', () => {
    const result = schedule({
      breakMinutes: 10,
      tasks: [
        makeSchedulable({ id: 'a', durationMinutes: 60, score: 90 }),
        makeSchedulable({ id: 'b', durationMinutes: 45, score: 80 }),
      ],
      fixedBlocks: [
        { id: 'class', taskId: null, title: 'Lecture', startAt: at('13:00'), endAt: at('14:00') },
      ],
    });

    const { diagnostics } = result;
    expect(diagnostics.availableMinutes).toBe(8 * 60 - 60);
    expect(diagnostics.scheduledMinutes).toBe(105);
    expect(diagnostics.fixedMinutes).toBe(60);
    expect(diagnostics.utilization).toBeCloseTo(105 / 420, 3);
    expect(diagnostics.conflicts).toEqual([]);
  });

  it('flags overlapping fixed commitments as a conflict', () => {
    const result = schedule({
      fixedBlocks: [
        { id: 'one', taskId: null, title: 'Lecture', startAt: at('10:00'), endAt: at('11:30') },
        { id: 'two', taskId: null, title: 'Lab', startAt: at('11:00'), endAt: at('12:00') },
      ],
    });

    expect(result.diagnostics.conflicts).toHaveLength(1);
    expect(result.diagnostics.conflicts[0]?.kind).toBe('fixed_overlap');
    expect(result.diagnostics.conflicts[0]?.blockIds).toEqual(['one', 'two']);
  });

  it('warns when nothing fits and says so in plain language', () => {
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '10:00',
      tasks: [makeSchedulable({ id: 'a', durationMinutes: 120 })],
    });

    expect(result.diagnostics.warnings.some((warning) => /did not fit/i.test(warning))).toBe(true);
  });

  it('warns about a nearly full day only when nothing overflowed', () => {
    const result = schedule({
      workdayStart: '09:00',
      workdayEnd: '11:00',
      tasks: [makeSchedulable({ id: 'a', durationMinutes: 120 })],
    });

    expect(result.diagnostics.utilization).toBe(1);
    expect(result.diagnostics.warnings.some((warning) => /nearly full/i.test(warning))).toBe(true);
  });
});
