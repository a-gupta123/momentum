/**
 * The capacity-aware daily scheduler.
 *
 * Pure TypeScript with no React and no persistence: given a day, a set of
 * constraints and a ranked list of flexible tasks, it returns a concrete plan
 * plus honest diagnostics about what did not fit and why.
 *
 * Shape of the algorithm:
 *
 *  1. Build a 15-minute slot grid across the availability window.
 *  2. Burn slots for fixed commitments and locked blocks.
 *  3. Drop tasks that must not be auto-scheduled (blocked, done, archived).
 *  4. Walk the ranked order placing each task in the earliest opening that
 *     still finishes before its deadline, preferring the high-energy window
 *     for deep work, and splitting long tasks only when allowed.
 *  5. Reserve the configured buffer after each focus block.
 *  6. Run a bounded, deterministic improvement pass that reorders candidates to
 *     reduce deadline violations without lowering total scheduled priority.
 *
 * Everything about it is deterministic: the same inputs always yield the same
 * plan, which is what makes the "before/after" preview trustworthy.
 */
import {
  addDayKeys,
  addMinutesTo,
  clamp,
  dayKeyOf,
  minutesBetween,
  parseIso,
  toIso,
  zonedTimeToInstant,
  MS_PER_MINUTE,
} from '@/lib/dates';
import {
  DEFAULT_SCHEDULING_CONFIG,
  SCORE_VERSION,
  type SchedulingConfig,
} from '@/lib/domain/tuning';
import type { BlockType, ClockTime, DayKey, EnergyLevel, IsoDateTime } from '@/lib/domain/types';

/** A commitment the scheduler may never move: a class, a meeting, a locked block. */
export interface FixedBlockInput {
  id: string;
  taskId: string | null;
  title: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
}

/** A flexible task competing for slots. */
export interface SchedulableTaskInput {
  id: string;
  title: string;
  durationMinutes: number;
  /** Score from the priority engine; the scheduler never recomputes it. */
  score: number;
  dueAt: IsoDateTime | null;
  energy: EnergyLevel;
  importance: number;
  splittable: boolean;
  blocked: boolean;
  position: number;
  /** Optional explicit window the user prefers for this task. */
  preferredWindow?: { start: ClockTime; end: ClockTime } | null;
}

export interface SchedulerInput {
  date: DayKey;
  timezone: string;
  workdayStart: ClockTime;
  workdayEnd: ClockTime;
  breakMinutes: number;
  highEnergyStart: ClockTime;
  highEnergyEnd: ClockTime;
  fixedBlocks: readonly FixedBlockInput[];
  tasks: readonly SchedulableTaskInput[];
  /** Profile-level switch; a task additionally needs `splittable`. */
  allowSplitting: boolean;
  now: Date;
  config?: SchedulingConfig;
}

export const OVERFLOW_REASONS = {
  capacity: 'Not enough capacity',
  blocked: 'Blocked by dependency',
  deadline: 'No slot before deadline',
} as const;
export type OverflowReason = (typeof OVERFLOW_REASONS)[keyof typeof OVERFLOW_REASONS];

export interface OverflowItem {
  taskId: string;
  title: string;
  durationMinutes: number;
  reason: OverflowReason;
  /** One sentence of user-facing context for the reason. */
  detail: string;
}

export interface ScheduledBlock {
  /** Deterministic id so re-running the scheduler produces stable React keys. */
  id: string;
  taskId: string | null;
  title: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  blockType: BlockType;
  durationMinutes: number;
  isLocked: boolean;
  position: number;
  /** 1-based chunk index for split tasks, otherwise `null`. */
  chunkIndex: number | null;
  chunkCount: number | null;
  score: number | null;
}

export interface ScheduleConflict {
  kind: 'fixed_overlap';
  message: string;
  blockIds: string[];
}

export interface ScheduleDiagnostics {
  /**
   * Minutes still ahead in the workday and not claimed by a fixed commitment.
   * For today this starts at the current time, not at the workday's start.
   */
  availableMinutes: number;
  /** Minutes of fixed commitments across the whole day, past ones included. */
  fixedMinutes: number;
  scheduledMinutes: number;
  bufferMinutes: number;
  freeMinutes: number;
  overflowMinutes: number;
  /** Scheduled ÷ available, 0–1. */
  utilization: number;
  deadlineViolations: number;
  conflicts: ScheduleConflict[];
  warnings: string[];
}

export interface DaySchedule {
  date: DayKey;
  timezone: string;
  scoreVersion: string;
  windowStart: IsoDateTime;
  windowEnd: IsoDateTime;
  blocks: ScheduledBlock[];
  overflow: OverflowItem[];
  diagnostics: ScheduleDiagnostics;
}

/** Slot occupancy codes. */
const FREE = 0;
const FIXED = 1;
const TASK = 2;
const BUFFER = 3;

interface Grid {
  slots: Uint8Array;
  slotCount: number;
  slotMinutes: number;
  windowStartMs: number;
}

interface PlacedChunk {
  startSlot: number;
  slotLength: number;
  minutes: number;
}

interface Placement {
  taskId: string;
  chunks: PlacedChunk[];
}

interface PlacementRun {
  placements: Placement[];
  overflow: OverflowItem[];
  grid: Grid;
}

/**
 * Builds a plan for one day.
 *
 * The returned plan is a proposal — callers preview it and persist only after
 * confirmation when existing blocks would move.
 */
export function buildDaySchedule(input: SchedulerInput): DaySchedule {
  const config = input.config ?? DEFAULT_SCHEDULING_CONFIG;
  const { timezone, date } = input;
  const slotMinutes = config.slotMinutes;

  const windowStart = zonedTimeToInstant(date, input.workdayStart, timezone);
  const rawWindowEnd = zonedTimeToInstant(date, input.workdayEnd, timezone);
  // An end at or before the start means the workday runs past midnight.
  const windowEnd =
    rawWindowEnd.getTime() > windowStart.getTime()
      ? rawWindowEnd
      : zonedTimeToInstant(addDayKeys(date, 1), input.workdayEnd, timezone);

  const totalMinutes = minutesBetween(windowStart, windowEnd);
  const slotCount = Math.floor(totalMinutes / slotMinutes);

  const conflicts: ScheduleConflict[] = [];
  const warnings: string[] = [];

  const baseGrid: Grid = {
    slots: new Uint8Array(slotCount),
    slotCount,
    slotMinutes,
    windowStartMs: windowStart.getTime(),
  };

  // --- Step 2: fixed commitments claim their slots first. ---------------------
  const fixedBlocks = [...input.fixedBlocks].sort(compareFixedBlocks);
  const fixedOwners = new Map<number, string>();
  let fixedMinutesInsideWindow = 0;

  for (const block of fixedBlocks) {
    const start = parseIso(block.startAt);
    const end = parseIso(block.endAt);
    if (!start || !end || end.getTime() <= start.getTime()) continue;

    const startSlot = clamp(
      Math.floor((start.getTime() - baseGrid.windowStartMs) / (slotMinutes * MS_PER_MINUTE)),
      0,
      slotCount,
    );
    const endSlot = clamp(
      Math.ceil((end.getTime() - baseGrid.windowStartMs) / (slotMinutes * MS_PER_MINUTE)),
      0,
      slotCount,
    );

    for (let slot = startSlot; slot < endSlot; slot += 1) {
      const existing = fixedOwners.get(slot);
      if (existing && existing !== block.id) {
        const already = conflicts.find(
          (conflict) =>
            conflict.blockIds.includes(existing) && conflict.blockIds.includes(block.id),
        );
        if (!already) {
          conflicts.push({
            kind: 'fixed_overlap',
            message: `${block.title} overlaps another fixed commitment.`,
            blockIds: [existing, block.id],
          });
        }
      } else {
        fixedOwners.set(slot, block.id);
      }
      baseGrid.slots[slot] = FIXED;
    }

    fixedMinutesInsideWindow += Math.max(0, endSlot - startSlot) * slotMinutes;
  }

  // Earliest slot we may use: never schedule into the past on the current day.
  const isToday = dayKeyOf(input.now, timezone) === date;
  const minSlot = isToday
    ? clamp(
        Math.ceil((input.now.getTime() - baseGrid.windowStartMs) / (slotMinutes * MS_PER_MINUTE)),
        0,
        slotCount,
      )
    : 0;

  /**
   * Capacity is measured from `minSlot`, not from the top of the workday.
   *
   * Opening the app at 3pm and being told eleven hours are available is worse
   * than useless — it is precisely the number that makes people overcommit.
   * What matters is the time still ahead of them that is not already spoken
   * for, and measuring `freeMinutes` and `utilization` against the same base
   * keeps the three numbers from contradicting each other on screen.
   */
  let availableSlots = 0;
  for (let slot = minSlot; slot < slotCount; slot += 1) {
    if (baseGrid.slots[slot] !== FIXED) availableSlots += 1;
  }
  const availableMinutes = availableSlots * slotMinutes;

  // --- Step 3: separate what may be auto-scheduled from what may not. --------
  const schedulable: SchedulableTaskInput[] = [];
  const preOverflow: OverflowItem[] = [];

  for (const task of input.tasks) {
    if (task.blocked) {
      preOverflow.push({
        taskId: task.id,
        title: task.title,
        durationMinutes: task.durationMinutes,
        reason: OVERFLOW_REASONS.blocked,
        detail: 'Waiting on another task to finish first.',
      });
      continue;
    }
    if (task.durationMinutes <= 0) continue;
    schedulable.push(task);
  }

  const energyWindow = resolveSlotWindow(
    baseGrid,
    date,
    timezone,
    input.highEnergyStart,
    input.highEnergyEnd,
  );

  const context: PlacementContext = {
    baseGrid,
    config,
    minSlot,
    energyWindow,
    bufferSlots: Math.ceil(Math.max(0, input.breakMinutes) / slotMinutes),
    allowSplitting: input.allowSplitting,
    now: input.now,
    timezone,
    date,
  };

  // --- Step 4/5: greedy placement over the ranked order. ---------------------
  const baseOrder = [...schedulable].sort(compareSchedulable);
  let best = runPlacement(baseOrder, context);

  // --- Step 6: bounded deterministic improvement pass. ----------------------
  best = improveSchedule(best, baseOrder, context);

  // --- Materialize blocks. ---------------------------------------------------
  const taskById = new Map(schedulable.map((task) => [task.id, task]));
  const blocks: ScheduledBlock[] = [];

  for (const block of fixedBlocks) {
    const start = parseIso(block.startAt);
    const end = parseIso(block.endAt);
    if (!start || !end || end.getTime() <= start.getTime()) continue;
    blocks.push({
      id: block.id,
      taskId: block.taskId,
      title: block.title,
      startAt: toIso(start),
      endAt: toIso(end),
      blockType: 'fixed',
      durationMinutes: minutesBetween(start, end),
      isLocked: true,
      position: 0,
      chunkIndex: null,
      chunkCount: null,
      score: null,
    });
  }

  let scheduledMinutes = 0;
  for (const placement of best.placements) {
    const task = taskById.get(placement.taskId);
    if (!task) continue;
    const chunkCount = placement.chunks.length;

    placement.chunks.forEach((chunk, index) => {
      const start = slotToInstant(context.baseGrid, chunk.startSlot);
      const end = addMinutesTo(start, chunk.minutes);
      scheduledMinutes += chunk.minutes;
      blocks.push({
        id: chunkCount > 1 ? `${task.id}::${index + 1}` : task.id,
        taskId: task.id,
        title: task.title,
        startAt: toIso(start),
        endAt: toIso(end),
        blockType: 'task',
        durationMinutes: chunk.minutes,
        isLocked: false,
        position: 0,
        chunkIndex: chunkCount > 1 ? index + 1 : null,
        chunkCount: chunkCount > 1 ? chunkCount : null,
        score: task.score,
      });
    });
  }

  blocks.push(...buildBreakBlocks(best, context));
  blocks.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  blocks.forEach((block, index) => {
    block.position = index;
  });

  const overflow = [...preOverflow, ...best.overflow].sort(
    (a, b) => a.reason.localeCompare(b.reason) || a.title.localeCompare(b.title),
  );
  const overflowMinutes = overflow.reduce((total, item) => total + item.durationMinutes, 0);

  let bufferMinutes = 0;
  let freeSlots = 0;
  for (let slot = 0; slot < best.grid.slotCount; slot += 1) {
    if (best.grid.slots[slot] === BUFFER) bufferMinutes += slotMinutes;
    if (best.grid.slots[slot] === FREE && slot >= minSlot) freeSlots += 1;
  }

  const deadlineViolations = countDeadlineViolations(best);
  const utilization = availableMinutes > 0 ? scheduledMinutes / availableMinutes : 0;

  if (overflow.some((item) => item.reason === OVERFLOW_REASONS.capacity)) {
    warnings.push(`${formatMinutes(overflowMinutes)} of work did not fit in today's window.`);
  }
  if (deadlineViolations > 0) {
    warnings.push(
      `${deadlineViolations} ${deadlineViolations === 1 ? 'task is' : 'tasks are'} planned after their deadline.`,
    );
  }
  if (utilization >= config.highUtilizationWarningRatio && overflowMinutes === 0) {
    warnings.push('Your day is nearly full. There is little room for anything unexpected.');
  }
  if (availableMinutes === 0) {
    warnings.push('No open time today. Check your workday hours and fixed commitments.');
  }

  return {
    date,
    timezone,
    scoreVersion: SCORE_VERSION,
    windowStart: toIso(windowStart),
    windowEnd: toIso(windowEnd),
    blocks,
    overflow,
    diagnostics: {
      availableMinutes,
      fixedMinutes: fixedMinutesInsideWindow,
      scheduledMinutes,
      bufferMinutes,
      freeMinutes: freeSlots * slotMinutes,
      overflowMinutes,
      utilization: Math.round(utilization * 1000) / 1000,
      deadlineViolations,
      conflicts,
      warnings,
    },
  };
}

interface PlacementContext {
  baseGrid: Grid;
  config: SchedulingConfig;
  minSlot: number;
  energyWindow: { startSlot: number; endSlot: number } | null;
  bufferSlots: number;
  allowSplitting: boolean;
  now: Date;
  timezone: string;
  date: DayKey;
}

/**
 * One greedy pass over `order`. Pure with respect to `context`: it clones the
 * base grid, so the improvement pass can replay alternative orders cheaply.
 */
function runPlacement(
  order: readonly SchedulableTaskInput[],
  context: PlacementContext,
): PlacementRun {
  const grid: Grid = { ...context.baseGrid, slots: new Uint8Array(context.baseGrid.slots) };
  const placements: Placement[] = [];
  const overflow: OverflowItem[] = [];

  for (const task of order) {
    const placement = placeTask(task, grid, context);
    if (placement) {
      commitPlacement(grid, placement, context.bufferSlots);
      placements.push(placement);
      continue;
    }
    overflow.push(describeFailure(task, grid, context));
  }

  return { placements, overflow, grid };
}

/**
 * Attempts to place one task.
 *
 * Contiguous placement is always tried first, across the preferred window, then
 * the high-energy window for deep work, then the whole day. Splitting is a last
 * resort: a task that fits in one sitting should get one.
 *
 * The deadline is a hard constraint. If nothing finishes in time the task is
 * *not* quietly planned late — it overflows with `No slot before deadline`, so
 * the user is told plainly instead of trusting a plan that cannot work. Tasks
 * whose deadline has already passed are unconstrained (see `deadlineSlotLimit`)
 * and therefore still get scheduled.
 */
function placeTask(
  task: SchedulableTaskInput,
  grid: Grid,
  context: PlacementContext,
): Placement | null {
  const { config } = context;
  const slotLength = Math.ceil(task.durationMinutes / grid.slotMinutes);
  const deadlineSlot = deadlineSlotLimit(task, grid, context);

  for (const window of candidateWindows(task, grid, context)) {
    const startSlot = findRun(grid, slotLength, window.startSlot, window.endSlot, deadlineSlot);
    if (startSlot !== null) {
      return {
        taskId: task.id,
        chunks: [{ startSlot, slotLength, minutes: task.durationMinutes }],
      };
    }
  }

  const splitAllowed =
    context.allowSplitting &&
    task.splittable &&
    task.durationMinutes > config.splitThresholdMinutes;

  if (!splitAllowed) return null;

  return placeSplitTask(task, grid, context, deadlineSlot);
}

/**
 * Places a long task as several chunks. Chunk minutes always sum to the task's
 * full duration, and chunks are placed in order so the day reads sensibly. If
 * any chunk cannot be placed in time the whole attempt is abandoned, because a
 * partially planned task is worse than an honest overflow.
 */
function placeSplitTask(
  task: SchedulableTaskInput,
  grid: Grid,
  context: PlacementContext,
  deadlineSlot: number,
): Placement | null {
  const chunkMinutes = planChunks(task.durationMinutes, context.config);
  const trial: Grid = { ...grid, slots: new Uint8Array(grid.slots) };
  const chunks: PlacedChunk[] = [];
  let cursor = context.minSlot;

  for (const minutes of chunkMinutes) {
    const slotLength = Math.ceil(minutes / grid.slotMinutes);
    const startSlot = findRun(trial, slotLength, cursor, trial.slotCount, deadlineSlot);
    if (startSlot === null) return null;

    const chunk: PlacedChunk = { startSlot, slotLength, minutes };
    chunks.push(chunk);
    commitPlacement(trial, { taskId: task.id, chunks: [chunk] }, context.bufferSlots);
    cursor = startSlot + slotLength;
  }

  return { taskId: task.id, chunks };
}

/**
 * Splits `duration` into 2+ chunks between the configured min and max chunk
 * sizes. The final chunk absorbs the remainder, which guarantees the chunk
 * minutes sum exactly to the original duration — an invariant under test.
 */
export function planChunks(duration: number, config: SchedulingConfig): number[] {
  const { minSplitChunkMinutes: min, maxSplitChunkMinutes: max, slotMinutes: step } = config;
  const count = Math.max(2, Math.ceil(duration / max));
  const chunks: number[] = [];
  let remaining = duration;

  for (let index = 0; index < count - 1; index += 1) {
    const ideal = remaining / (count - index);
    let chunk = Math.round(ideal / step) * step;
    chunk = clamp(chunk, min, max);
    // Never take so much that the remaining chunks fall below the minimum.
    chunk = Math.min(chunk, remaining - min * (count - index - 1));
    chunk = Math.max(step, chunk);
    chunks.push(chunk);
    remaining -= chunk;
  }

  chunks.push(remaining);
  return chunks;
}

/** Windows to search, most preferred first. */
function candidateWindows(
  task: SchedulableTaskInput,
  grid: Grid,
  context: PlacementContext,
): Array<{ startSlot: number; endSlot: number }> {
  const windows: Array<{ startSlot: number; endSlot: number }> = [];

  if (task.preferredWindow) {
    const preferred = resolveSlotWindow(
      grid,
      context.date,
      context.timezone,
      task.preferredWindow.start,
      task.preferredWindow.end,
    );
    if (preferred) windows.push(preferred);
  }

  const isDeepWork =
    task.energy === 'high' || task.importance >= context.config.deepWorkImportanceThreshold;

  if (isDeepWork && context.energyWindow) {
    windows.push(context.energyWindow);
  }

  windows.push({ startSlot: 0, endSlot: grid.slotCount });

  return windows.map((window) => ({
    startSlot: Math.max(window.startSlot, context.minSlot),
    endSlot: window.endSlot,
  }));
}

/**
 * Highest slot index a block may end at and still respect the deadline.
 *
 * A deadline already in the past imposes no constraint: the task is late no
 * matter what, so refusing to schedule it would be actively unhelpful.
 */
function deadlineSlotLimit(
  task: SchedulableTaskInput,
  grid: Grid,
  context: PlacementContext,
): number {
  const due = parseIso(task.dueAt);
  if (!due || due.getTime() <= context.now.getTime()) return grid.slotCount;

  const limit = Math.floor(
    (due.getTime() - grid.windowStartMs) / (grid.slotMinutes * MS_PER_MINUTE),
  );
  return clamp(limit, 0, grid.slotCount);
}

/** Earliest free run of `slotLength` slots inside `[from, to)` ending by `maxEndSlot`. */
function findRun(
  grid: Grid,
  slotLength: number,
  from: number,
  to: number,
  maxEndSlot: number,
): number | null {
  if (slotLength <= 0) return null;
  const start = Math.max(0, from);
  const end = Math.min(to, grid.slotCount, maxEndSlot);

  let run = 0;
  for (let slot = start; slot < end; slot += 1) {
    if (grid.slots[slot] === FREE) {
      run += 1;
      if (run === slotLength) return slot - slotLength + 1;
    } else {
      run = 0;
    }
  }
  return null;
}

function commitPlacement(grid: Grid, placement: Placement, bufferSlots: number): void {
  for (const chunk of placement.chunks) {
    for (let slot = chunk.startSlot; slot < chunk.startSlot + chunk.slotLength; slot += 1) {
      grid.slots[slot] = TASK;
    }
    // Reserve the break buffer immediately after the block so focus work never
    // lands back-to-back. Buffer slots are reported separately in diagnostics.
    const bufferEnd = Math.min(chunk.startSlot + chunk.slotLength + bufferSlots, grid.slotCount);
    for (let slot = chunk.startSlot + chunk.slotLength; slot < bufferEnd; slot += 1) {
      if (grid.slots[slot] === FREE) grid.slots[slot] = BUFFER;
    }
  }
}

/**
 * Distinguishes "there was room but not before your deadline" from "there was
 * no room at all", because the two call for completely different user actions.
 */
function describeFailure(
  task: SchedulableTaskInput,
  grid: Grid,
  context: PlacementContext,
): OverflowItem {
  const slotLength = Math.ceil(task.durationMinutes / grid.slotMinutes);
  const anywhere = findRun(grid, slotLength, context.minSlot, grid.slotCount, grid.slotCount);
  const due = parseIso(task.dueAt);

  if (anywhere !== null && due) {
    return {
      taskId: task.id,
      title: task.title,
      durationMinutes: task.durationMinutes,
      reason: OVERFLOW_REASONS.deadline,
      detail: 'There is open time today, but none of it finishes before this is due.',
    };
  }

  return {
    taskId: task.id,
    title: task.title,
    durationMinutes: task.durationMinutes,
    reason: OVERFLOW_REASONS.capacity,
    detail: `Needs ${formatMinutes(task.durationMinutes)} of contiguous time that today does not have.`,
  };
}

/**
 * Bounded improvement pass.
 *
 * Rather than mutating a finished plan, it replays the whole greedy placement
 * with one candidate hoisted ahead of a lower-scoring scheduled task. A trial
 * is adopted only if it reduces deadline violations *and* does not reduce the
 * total priority value actually scheduled — so the day never gets worse.
 */
function improveSchedule(
  initial: PlacementRun,
  baseOrder: readonly SchedulableTaskInput[],
  context: PlacementContext,
): PlacementRun {
  const byId = new Map(baseOrder.map((task) => [task.id, task]));
  let best = initial;
  let bestOrder = [...baseOrder];
  let attempts = 0;

  const violating = () =>
    best.overflow
      .filter((item) => item.reason === OVERFLOW_REASONS.deadline)
      .map((item) => byId.get(item.taskId))
      .filter((task): task is SchedulableTaskInput => Boolean(task))
      .sort(compareSchedulable);

  let candidates = violating();

  while (candidates.length > 0 && attempts < context.config.maxImprovementSwaps) {
    const candidate = candidates[0];
    if (!candidate) break;

    // Any scheduled task is a candidate hoist target. Deliberately *not*
    // pre-filtered by score: a long low-priority task can block two urgent
    // short ones whose combined value is higher, and hoisting above it often
    // costs nothing because it still fits afterwards. `isBetter` is the single
    // authority on whether a trial is acceptable, so a second, stricter filter
    // here would only make the pass unable to fire.
    const displaceable = best.placements
      .map((placement) => byId.get(placement.taskId))
      .filter((task): task is SchedulableTaskInput => Boolean(task))
      .sort(
        (a, b) =>
          a.score - b.score ||
          Number(hasLaterDeadline(b, candidate)) - Number(hasLaterDeadline(a, candidate)) ||
          a.id.localeCompare(b.id),
      );

    let improved = false;

    for (const target of displaceable) {
      if (attempts >= context.config.maxImprovementSwaps) break;
      attempts += 1;

      const trialOrder = hoistBefore(bestOrder, candidate.id, target.id);
      if (!trialOrder) continue;

      const trial = runPlacement(trialOrder, context);
      if (isBetter(trial, best, byId)) {
        best = trial;
        bestOrder = trialOrder;
        improved = true;
        break;
      }
    }

    if (!improved) break;
    candidates = violating();
  }

  return best;
}

function hasLaterDeadline(task: SchedulableTaskInput, candidate: SchedulableTaskInput): boolean {
  const taskDue = parseIso(task.dueAt)?.getTime() ?? null;
  const candidateDue = parseIso(candidate.dueAt)?.getTime() ?? null;
  if (taskDue === null) return true;
  if (candidateDue === null) return false;
  return taskDue > candidateDue;
}

function hoistBefore(
  order: readonly SchedulableTaskInput[],
  candidateId: string,
  targetId: string,
): SchedulableTaskInput[] | null {
  const candidateIndex = order.findIndex((task) => task.id === candidateId);
  const targetIndex = order.findIndex((task) => task.id === targetId);
  if (candidateIndex < 0 || targetIndex < 0 || candidateIndex === targetIndex) return null;
  if (candidateIndex < targetIndex) return null;

  const next = [...order];
  const [candidate] = next.splice(candidateIndex, 1);
  if (!candidate) return null;
  next.splice(targetIndex, 0, candidate);
  return next;
}

function isBetter(
  trial: PlacementRun,
  current: PlacementRun,
  byId: ReadonlyMap<string, SchedulableTaskInput>,
): boolean {
  const trialViolations = countDeadlineViolations(trial);
  const currentViolations = countDeadlineViolations(current);
  if (trialViolations >= currentViolations) return false;
  return scheduledValue(trial, byId) >= scheduledValue(current, byId);
}

/**
 * Deadline violations are exactly the tasks that could not be placed in time.
 * Because the placer treats a future deadline as a hard constraint, a scheduled
 * block can never itself be a violation.
 */
function countDeadlineViolations(run: PlacementRun): number {
  return run.overflow.filter((item) => item.reason === OVERFLOW_REASONS.deadline).length;
}

function scheduledValue(
  run: PlacementRun,
  byId: ReadonlyMap<string, SchedulableTaskInput>,
): number {
  return run.placements.reduce((total, placement) => {
    const task = byId.get(placement.taskId);
    return total + (task?.score ?? 0);
  }, 0);
}

/**
 * Emits `break` blocks only for buffer stretches that genuinely sit between two
 * pieces of work. A trailing buffer at the end of the day is not a break the
 * user needs to see.
 */
function buildBreakBlocks(run: PlacementRun, context: PlacementContext): ScheduledBlock[] {
  if (context.bufferSlots === 0) return [];

  const grid = run.grid;
  const breaks: ScheduledBlock[] = [];
  let slot = 0;

  while (slot < grid.slotCount) {
    if (grid.slots[slot] !== BUFFER) {
      slot += 1;
      continue;
    }
    const start = slot;
    while (slot < grid.slotCount && grid.slots[slot] === BUFFER) slot += 1;
    const end = slot;

    const precededByWork = start > 0 && grid.slots[start - 1] === TASK;
    const followedByWork =
      end < grid.slotCount && (grid.slots[end] === TASK || grid.slots[end] === FIXED);
    if (!precededByWork || !followedByWork) continue;

    const startAt = slotToInstant(grid, start);
    const endAt = slotToInstant(grid, end);
    breaks.push({
      id: `break::${start}`,
      taskId: null,
      title: 'Break',
      startAt: toIso(startAt),
      endAt: toIso(endAt),
      blockType: 'break',
      durationMinutes: (end - start) * grid.slotMinutes,
      isLocked: false,
      position: 0,
      chunkIndex: null,
      chunkCount: null,
      score: null,
    });
  }

  return breaks;
}

/** Translates a `HH:mm`–`HH:mm` window into slot indices, clipped to the grid. */
function resolveSlotWindow(
  grid: Grid,
  date: DayKey,
  timezone: string,
  start: ClockTime,
  end: ClockTime,
): { startSlot: number; endSlot: number } | null {
  const startInstant = zonedTimeToInstant(date, start, timezone);
  const rawEnd = zonedTimeToInstant(date, end, timezone);
  const endInstant =
    rawEnd.getTime() > startInstant.getTime()
      ? rawEnd
      : zonedTimeToInstant(addDayKeys(date, 1), end, timezone);

  const slotMs = grid.slotMinutes * MS_PER_MINUTE;
  const startSlot = clamp(
    Math.ceil((startInstant.getTime() - grid.windowStartMs) / slotMs),
    0,
    grid.slotCount,
  );
  const endSlot = clamp(
    Math.floor((endInstant.getTime() - grid.windowStartMs) / slotMs),
    0,
    grid.slotCount,
  );

  if (endSlot <= startSlot) return null;
  return { startSlot, endSlot };
}

function slotToInstant(grid: Grid, slot: number): Date {
  return new Date(grid.windowStartMs + slot * grid.slotMinutes * MS_PER_MINUTE);
}

function compareFixedBlocks(a: FixedBlockInput, b: FixedBlockInput): number {
  return a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id);
}

/** Ranked order for placement: score desc, then deadline, position, id. */
function compareSchedulable(a: SchedulableTaskInput, b: SchedulableTaskInput): number {
  if (b.score !== a.score) return b.score - a.score;

  const aDue = parseIso(a.dueAt)?.getTime() ?? null;
  const bDue = parseIso(b.dueAt)?.getTime() ?? null;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  }

  if (a.position !== b.position) return a.position - b.position;
  return a.id.localeCompare(b.id);
}

function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
