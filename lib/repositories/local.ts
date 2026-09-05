/**
 * `LocalPlannerRepository` — the Guest Demo adapter.
 *
 * Backed by a versioned, schema-validated blob in localStorage. It implements
 * the same `PlannerRepository` interface as the Supabase adapter, which is what
 * lets the entire product (and the whole Playwright suite) run with no
 * credentials at all.
 *
 * Storage is injected rather than reached for globally, so the adapter is
 * testable in plain Node and degrades to an in-memory session when the browser
 * refuses to persist — private windows and full quotas should make Momentum
 * *lossy*, never broken.
 */
import { addMinutesTo, parseIso, toIso, todayKey } from '@/lib/dates';
import { buildDemoState } from '@/lib/domain/demo-data';
import { newId } from '@/lib/domain/ids';
import { buildNextOccurrence } from '@/lib/domain/recurrence';
import type {
  ActivityEvent,
  DailyPlan,
  DayKey,
  FocusSession,
  Goal,
  IsoDateTime,
  PlanBlock,
  PlannerSnapshot,
  Profile,
  Task,
} from '@/lib/domain/types';
import {
  GUEST_STORAGE_KEY,
  loadGuestState,
  serializeGuestState,
  type GuestState,
} from '@/lib/validation/guest-state';
import {
  StaleWriteError,
  type CompleteTaskResult,
  type CreateGoalInput,
  type CreateTaskInput,
  type InverseOperation,
  type LogEventInput,
  type Mutation,
  type MutationOutcome,
  type PlannerRepository,
  type RepositoryMode,
  type SavePlanInput,
  type SavedPlan,
  type UpdateGoalInput,
  type UpdateTaskInput,
} from '@/lib/repositories/types';

/** The slice of the `Storage` API this adapter needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Fallback used when the platform has no usable storage. */
export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * Returns `window.localStorage` when it is genuinely writable.
 *
 * Feature-detecting by *writing* matters: Safari private browsing exposes the
 * API and then throws on `setItem`, so a presence check is not enough.
 */
export function resolveBrowserStorage(): { storage: KeyValueStorage; durable: boolean } {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { storage: createMemoryStorage(), durable: false };
    }
    const probe = '__momentum_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { storage: window.localStorage, durable: true };
  } catch {
    return { storage: createMemoryStorage(), durable: false };
  }
}

export interface LocalRepositoryOptions {
  storage?: KeyValueStorage;
  timezone: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  generateId?: () => string;
  storageKey?: string;
  /** Surfaces load problems to the UI without turning them into crashes. */
  onWarning?: (message: string) => void;
}

export class LocalPlannerRepository implements PlannerRepository {
  readonly mode: RepositoryMode = 'guest';

  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private readonly clock: () => Date;
  private readonly generateId: () => string;
  private readonly onWarning: (message: string) => void;
  private readonly timezone: string;

  private state: GuestState;
  /** False once a write has failed, so the UI can say data is session-only. */
  private durable = true;

  constructor(options: LocalRepositoryOptions) {
    this.storageKey = options.storageKey ?? GUEST_STORAGE_KEY;
    this.clock = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? newId;
    this.onWarning = options.onWarning ?? (() => {});
    this.timezone = options.timezone;

    if (options.storage) {
      this.storage = options.storage;
    } else {
      const resolved = resolveBrowserStorage();
      this.storage = resolved.storage;
      this.durable = resolved.durable;
    }

    this.state = this.loadOrSeed();
  }

  /** True when writes are actually reaching disk. */
  get isDurable(): boolean {
    return this.durable;
  }

  // --- Loading ---------------------------------------------------------------

  private loadOrSeed(): GuestState {
    const outcome = loadGuestState(this.readRaw());

    if (outcome.status === 'ok') {
      if (outcome.migratedFrom !== null) {
        this.onWarning(
          `Your demo data was upgraded from an earlier version of Momentum (v${outcome.migratedFrom}).`,
        );
      }
      const refreshed = this.refreshStaleDemo(outcome.state);
      if (refreshed !== outcome.state) this.persist(refreshed);
      return refreshed;
    }

    if (outcome.status === 'invalid') {
      this.onWarning(`${outcome.reason} A fresh demo was loaded.`);
    }

    const seeded = this.seedState();
    this.persist(seeded);
    return seeded;
  }

  /**
   * Regenerates an untouched demo that was seeded on an earlier day.
   *
   * A recruiter opening a bookmarked demo two weeks later should see a live
   * day, not a wall of overdue tasks. The moment the visitor changes anything,
   * `userModified` latches and this never fires again — their work is theirs.
   */
  private refreshStaleDemo(state: GuestState): GuestState {
    if (state.userModified) return state;
    const today = todayKey(this.timezone, this.clock());
    if (state.seedDayKey === today) return state;
    return this.seedState();
  }

  private seedState(): GuestState {
    return buildDemoState({
      timezone: this.timezone,
      now: this.clock(),
      generateId: this.generateId,
    });
  }

  private readRaw(): string | null {
    try {
      return this.storage.getItem(this.storageKey);
    } catch {
      this.durable = false;
      return null;
    }
  }

  private persist(state: GuestState = this.state): void {
    try {
      this.storage.setItem(this.storageKey, serializeGuestState(state));
    } catch {
      if (this.durable) {
        this.durable = false;
        this.onWarning(
          'This browser will not let Momentum save locally, so your demo changes will last only for this session.',
        );
      }
    }
  }

  /** Every write funnels through here so `userModified` cannot be forgotten. */
  private commit(mutate: (state: GuestState) => void): void {
    mutate(this.state);
    this.state.userModified = true;
    this.persist();
  }

  private now(): Date {
    return this.clock();
  }

  private nowIso(): IsoDateTime {
    return toIso(this.now());
  }

  private get userId(): string {
    return this.state.profile.id;
  }

  private requireTask(id: string): Task {
    const task = this.state.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('That task no longer exists.');
    return task;
  }

  private requireGoal(id: string): Goal {
    const goal = this.state.goals.find((candidate) => candidate.id === id);
    if (!goal) throw new Error('That goal no longer exists.');
    return goal;
  }

  // --- Reads -----------------------------------------------------------------

  async getSnapshot(dayKey: DayKey): Promise<PlannerSnapshot> {
    const plan = this.state.plans.find((candidate) => candidate.planDate === dayKey) ?? null;
    const blocks = plan
      ? this.state.blocks
          .filter((block) => block.dailyPlanId === plan.id)
          .sort((a, b) => a.startAt.localeCompare(b.startAt))
      : [];

    return {
      profile: { ...this.state.profile },
      goals: this.state.goals.map((goal) => ({ ...goal })),
      tasks: this.state.tasks.map((task) => ({ ...task })),
      dependencies: this.state.dependencies.map((edge) => ({ ...edge })),
      plan: plan ? { ...plan } : null,
      blocks,
      events: this.state.events.map((event) => ({ ...event })),
      focusSession: this.state.focusSession ? { ...this.state.focusSession } : null,
    };
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    this.commit((state) => {
      state.profile = {
        ...state.profile,
        ...patch,
        id: state.profile.id,
        createdAt: state.profile.createdAt,
        updatedAt: this.nowIso(),
      };
    });
    return { ...this.state.profile };
  }

  // --- Tasks -----------------------------------------------------------------

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = this.buildTask(input);
    this.commit((state) => {
      state.tasks.push(task);
      state.events.push(this.buildEvent({ eventType: 'task_created', taskId: task.id }));
    });
    return { ...task };
  }

  private buildTask(input: CreateTaskInput): Task {
    const nowIso = this.nowIso();
    const duration = input.durationMinutes ?? this.state.profile.defaultTaskDurationMinutes;
    const scheduledStart = parseIso(input.scheduledStart ?? null);
    const maxPosition = this.state.tasks.reduce((max, task) => Math.max(max, task.position), 0);

    const task: Task = {
      id: this.generateId(),
      userId: this.userId,
      goalId: input.goalId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title.trim(),
      notes: input.notes ?? null,
      status: input.status ?? (scheduledStart ? 'planned' : 'inbox'),
      manualPriority: input.manualPriority ?? 'normal',
      importance: input.importance ?? 3,
      energy: input.energy ?? 'medium',
      dueAt: input.dueAt ?? null,
      scheduledStart: input.scheduledStart ?? null,
      scheduledEnd:
        input.scheduledEnd ??
        (scheduledStart ? toIso(addMinutesTo(scheduledStart, duration)) : null),
      durationMinutes: duration,
      actualMinutes: null,
      isFixedTime: input.isFixedTime ?? false,
      splittable: input.splittable ?? false,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceSeriesId: input.recurrenceSeriesId ?? null,
      recurrenceOccurrenceAt: input.recurrenceOccurrenceAt ?? null,
      source: input.source ?? 'manual',
      sourceText: input.sourceText ?? null,
      position: input.position ?? maxPosition + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
      archivedAt: null,
    };

    // A recurring task is the first occurrence of its own series. Establishing
    // the identity here — not only in the assistant's apply path — is what makes
    // `(seriesId, occurrenceAt)` a usable idempotency key no matter how the task
    // was created, and therefore what stops a retry from forking the series.
    if (task.recurrenceRule && !task.recurrenceSeriesId) {
      task.recurrenceSeriesId = task.id;
      task.recurrenceOccurrenceAt =
        task.recurrenceOccurrenceAt ?? task.dueAt ?? task.scheduledStart ?? task.createdAt;
    }

    return task;
  }

  async updateTask(
    id: string,
    patch: UpdateTaskInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Task> {
    const existing = this.requireTask(id);
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      throw new StaleWriteError('task', id);
    }

    const updated: Task = {
      ...existing,
      ...patch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: this.nowIso(),
    };

    this.commit((state) => {
      state.tasks = state.tasks.map((task) => (task.id === id ? updated : task));
      state.events.push(this.buildEvent({ eventType: 'task_updated', taskId: id }));
    });

    return { ...updated };
  }

  async deleteTask(id: string): Promise<void> {
    this.requireTask(id);
    this.commit((state) => {
      state.tasks = state.tasks.filter((task) => task.id !== id);
      state.dependencies = state.dependencies.filter(
        (edge) => edge.taskId !== id && edge.dependsOnTaskId !== id,
      );
      state.blocks = state.blocks.filter((block) => block.taskId !== id);
      if (state.focusSession?.taskId === id) state.focusSession = null;
      state.events.push(this.buildEvent({ eventType: 'task_deleted', taskId: null }));
    });
  }

  async archiveTask(id: string): Promise<Task> {
    const nowIso = this.nowIso();
    return this.updateTask(id, { status: 'archived', archivedAt: nowIso });
  }

  async duplicateTask(id: string): Promise<Task> {
    const original = this.requireTask(id);
    return this.createTask({
      title: `${original.title} (copy)`,
      notes: original.notes,
      goalId: original.goalId,
      manualPriority: original.manualPriority,
      importance: original.importance,
      energy: original.energy,
      dueAt: original.dueAt,
      durationMinutes: original.durationMinutes,
      isFixedTime: original.isFixedTime,
      splittable: original.splittable,
      recurrenceRule: original.recurrenceRule,
      source: 'manual',
    });
  }

  /**
   * Completes a task, and for a recurring one creates the next occurrence.
   *
   * The completed row is never rewritten into the future — that is the history.
   * The successor is keyed by `(seriesId, occurrenceAt)`, so a double-click
   * finds the occurrence already present and does nothing.
   */
  async completeTask(id: string, actualMinutes?: number | null): Promise<CompleteTaskResult> {
    const existing = this.requireTask(id);
    const nowIso = this.nowIso();

    const completed: Task = {
      ...existing,
      status: 'completed',
      completedAt: nowIso,
      actualMinutes: actualMinutes ?? existing.actualMinutes,
      updatedAt: nowIso,
    };

    let nextOccurrence: Task | null = null;
    if (existing.recurrenceRule) {
      const candidate = buildNextOccurrence(existing, this.timezone, this.now(), this.generateId());
      if (candidate) {
        const seriesId = candidate.recurrenceSeriesId;
        const alreadyExists = this.state.tasks.some(
          (task) =>
            task.recurrenceSeriesId === seriesId &&
            task.recurrenceOccurrenceAt === candidate.recurrenceOccurrenceAt,
        );
        if (!alreadyExists) nextOccurrence = candidate;
      }
    }

    this.commit((state) => {
      state.tasks = state.tasks.map((task) => (task.id === id ? completed : task));
      if (nextOccurrence) state.tasks.push(nextOccurrence);
      state.events.push(
        this.buildEvent({
          eventType: 'task_completed',
          taskId: id,
          durationMinutes: actualMinutes ?? existing.durationMinutes,
        }),
      );
    });

    return {
      task: { ...completed },
      nextOccurrence: nextOccurrence ? { ...nextOccurrence } : null,
    };
  }

  async uncompleteTask(id: string): Promise<Task> {
    const existing = this.requireTask(id);
    const status = existing.scheduledStart ? 'planned' : 'inbox';

    const updated = await this.updateTask(id, { status, completedAt: null });

    this.commit((state) => {
      state.events.push(this.buildEvent({ eventType: 'task_uncompleted', taskId: id }));
      // Withdraw the successor this completion created, if it is still untouched.
      if (existing.recurrenceSeriesId) {
        const candidate = buildNextOccurrence(existing, this.timezone, this.now(), 'probe');
        if (candidate) {
          state.tasks = state.tasks.filter(
            (task) =>
              !(
                task.recurrenceSeriesId === existing.recurrenceSeriesId &&
                task.recurrenceOccurrenceAt === candidate.recurrenceOccurrenceAt &&
                task.status === 'inbox' &&
                task.actualMinutes === null
              ),
          );
        }
      }
    });

    return updated;
  }

  async reorderTasks(orderedIds: readonly string[]): Promise<void> {
    const positionById = new Map(orderedIds.map((id, index) => [id, index + 1]));
    this.commit((state) => {
      state.tasks = state.tasks.map((task) => {
        const position = positionById.get(task.id);
        return position === undefined ? task : { ...task, position, updatedAt: this.nowIso() };
      });
    });
  }

  // --- Goals -----------------------------------------------------------------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const nowIso = this.nowIso();
    const goal: Goal = {
      id: this.generateId(),
      userId: this.userId,
      title: input.title.trim(),
      description: input.description ?? null,
      category: input.category ?? 'personal',
      priorityWeight: input.priorityWeight ?? 3,
      targetDate: input.targetDate ?? null,
      weeklyTargetMinutes: input.weeklyTargetMinutes ?? null,
      status: input.status ?? 'active',
      color: input.color ?? 'cobalt',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.commit((state) => {
      state.goals.push(goal);
      state.events.push(this.buildEvent({ eventType: 'goal_created', taskId: null }));
    });

    return { ...goal };
  }

  async updateGoal(
    id: string,
    patch: UpdateGoalInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Goal> {
    const existing = this.requireGoal(id);
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      throw new StaleWriteError('goal', id);
    }

    const updated: Goal = {
      ...existing,
      ...patch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: this.nowIso(),
    };

    this.commit((state) => {
      state.goals = state.goals.map((goal) => (goal.id === id ? updated : goal));
      state.events.push(this.buildEvent({ eventType: 'goal_updated', taskId: null }));
    });

    return { ...updated };
  }

  async archiveGoal(id: string): Promise<Goal> {
    return this.updateGoal(id, { status: 'archived' });
  }

  // --- Dependencies ----------------------------------------------------------

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw new Error('A task cannot depend on itself.');
    }
    this.requireTask(taskId);
    this.requireTask(dependsOnTaskId);

    if (this.wouldCreateCycle(taskId, dependsOnTaskId)) {
      throw new Error('That would create a circular dependency.');
    }

    const exists = this.state.dependencies.some(
      (edge) => edge.taskId === taskId && edge.dependsOnTaskId === dependsOnTaskId,
    );
    if (exists) return;

    this.commit((state) => {
      state.dependencies.push({ taskId, dependsOnTaskId, userId: this.userId });
    });
  }

  /** Walks the existing edges to keep the dependency graph acyclic. */
  private wouldCreateCycle(taskId: string, dependsOnTaskId: string): boolean {
    const adjacency = new Map<string, string[]>();
    for (const edge of this.state.dependencies) {
      const list = adjacency.get(edge.taskId) ?? [];
      list.push(edge.dependsOnTaskId);
      adjacency.set(edge.taskId, list);
    }

    const seen = new Set<string>();
    const stack = [dependsOnTaskId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      if (current === taskId) return true;
      seen.add(current);
      stack.push(...(adjacency.get(current) ?? []));
    }
    return false;
  }

  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    this.commit((state) => {
      state.dependencies = state.dependencies.filter(
        (edge) => !(edge.taskId === taskId && edge.dependsOnTaskId === dependsOnTaskId),
      );
    });
  }

  // --- Plans -----------------------------------------------------------------

  /**
   * Replaces the plan for a day. Atomic by construction: the in-memory state is
   * rewritten and then serialized in a single `setItem`, so there is no window
   * in which half a day is stored.
   */
  async savePlan(input: SavePlanInput): Promise<SavedPlan> {
    const { schedule } = input;
    const nowIso = this.nowIso();
    const locked = new Set(input.lockedBlockIds ?? []);

    const existing = this.state.plans.find((plan) => plan.planDate === schedule.date);
    const planId = existing?.id ?? this.generateId();

    const plan: DailyPlan = {
      id: planId,
      userId: this.userId,
      planDate: schedule.date,
      timezone: schedule.timezone,
      availableMinutes: schedule.diagnostics.availableMinutes,
      scheduledMinutes: schedule.diagnostics.scheduledMinutes,
      scoreVersion: schedule.scoreVersion,
      generatedAt: existing?.generatedAt ?? nowIso,
      updatedAt: nowIso,
    };

    const blocks: PlanBlock[] = schedule.blocks.map((block, index) => ({
      id: this.generateId(),
      userId: this.userId,
      dailyPlanId: planId,
      taskId: block.taskId,
      title: block.taskId ? null : block.title,
      startAt: block.startAt,
      endAt: block.endAt,
      blockType: block.blockType,
      isLocked: block.isLocked || locked.has(block.id),
      position: index,
    }));

    this.commit((state) => {
      state.plans = [...state.plans.filter((entry) => entry.planDate !== schedule.date), plan];
      state.blocks = [...state.blocks.filter((block) => block.dailyPlanId !== planId), ...blocks];

      // Mirror task blocks onto the tasks themselves so the queue, the ranked
      // list and the timeline all agree on when work is scheduled.
      const scheduledByTask = new Map<string, { start: string; end: string }>();
      for (const block of schedule.blocks) {
        if (block.blockType !== 'task' || !block.taskId) continue;
        const current = scheduledByTask.get(block.taskId);
        if (!current || block.startAt < current.start) {
          scheduledByTask.set(block.taskId, { start: block.startAt, end: block.endAt });
        } else if (block.endAt > current.end) {
          scheduledByTask.set(block.taskId, { start: current.start, end: block.endAt });
        }
      }

      const overflowIds = new Set(schedule.overflow.map((item) => item.taskId));

      state.tasks = state.tasks.map((task) => {
        const scheduled = scheduledByTask.get(task.id);
        if (scheduled) {
          return {
            ...task,
            scheduledStart: scheduled.start,
            scheduledEnd: scheduled.end,
            status: task.status === 'inbox' ? 'planned' : task.status,
            updatedAt: nowIso,
          };
        }
        // Anything that overflowed goes back to the queue rather than keeping a
        // stale time that the plan no longer contains.
        if (overflowIds.has(task.id) && !task.isFixedTime) {
          return {
            ...task,
            scheduledStart: null,
            scheduledEnd: null,
            status: task.status === 'planned' ? 'inbox' : task.status,
            updatedAt: nowIso,
          };
        }
        return task;
      });

      state.events.push(
        this.buildEvent({
          eventType: 'plan_generated',
          taskId: null,
          metadata: {
            date: schedule.date,
            scheduledMinutes: schedule.diagnostics.scheduledMinutes,
            overflowCount: schedule.overflow.length,
            scoreVersion: schedule.scoreVersion,
          },
        }),
      );
    });

    return { plan, blocks };
  }

  // --- Events and focus ------------------------------------------------------

  private buildEvent(input: LogEventInput): ActivityEvent {
    return {
      id: this.generateId(),
      userId: this.userId,
      taskId: input.taskId ?? null,
      eventType: input.eventType,
      occurredAt: input.occurredAt ?? this.nowIso(),
      durationMinutes: input.durationMinutes ?? null,
      metadata: input.metadata ?? {},
    };
  }

  async logEvent(input: LogEventInput): Promise<ActivityEvent> {
    const event = this.buildEvent(input);
    this.commit((state) => {
      state.events.push(event);
    });
    return { ...event };
  }

  async getFocusSession(): Promise<FocusSession | null> {
    return this.state.focusSession ? { ...this.state.focusSession } : null;
  }

  async setFocusSession(session: FocusSession | null): Promise<void> {
    this.commit((state) => {
      state.focusSession = session ? { ...session } : null;
    });
  }

  // --- Batch apply -----------------------------------------------------------

  /**
   * Runs a confirmed batch. All mutations are staged against a working copy and
   * only committed once every one of them has been evaluated, so a rejected
   * mutation in the middle cannot leave the demo half-applied.
   */
  async applyMutations(mutations: readonly Mutation[]): Promise<MutationOutcome> {
    const working: GuestState = structuredCloneState(this.state);
    const outcome: MutationOutcome = {
      appliedCount: 0,
      createdTaskIds: [],
      createdGoalIds: [],
      rejected: [],
      inverse: [],
    };

    mutations.forEach((mutation, index) => {
      switch (mutation.kind) {
        case 'create_task': {
          working.tasks.push({ ...mutation.task });
          outcome.createdTaskIds.push(mutation.task.id);
          outcome.inverse.push({ kind: 'delete_task', id: mutation.task.id });
          outcome.appliedCount += 1;
          break;
        }
        case 'update_task': {
          const existing = working.tasks.find((task) => task.id === mutation.id);
          if (!existing) {
            outcome.rejected.push({
              index,
              kind: mutation.kind,
              reason: 'That task no longer exists.',
            });
            break;
          }
          if (mutation.expectedUpdatedAt && existing.updatedAt !== mutation.expectedUpdatedAt) {
            outcome.rejected.push({
              index,
              kind: mutation.kind,
              reason: 'That task changed since the preview was generated.',
            });
            break;
          }
          outcome.inverse.push({ kind: 'restore_task', task: { ...existing } });
          working.tasks = working.tasks.map((task) =>
            task.id === mutation.id
              ? { ...task, ...mutation.patch, updatedAt: this.nowIso() }
              : task,
          );
          outcome.appliedCount += 1;
          break;
        }
        case 'delete_task': {
          const existing = working.tasks.find((task) => task.id === mutation.id);
          if (!existing) {
            outcome.rejected.push({
              index,
              kind: mutation.kind,
              reason: 'That task no longer exists.',
            });
            break;
          }
          outcome.inverse.push({ kind: 'restore_task', task: { ...existing } });
          working.tasks = working.tasks.filter((task) => task.id !== mutation.id);
          working.dependencies = working.dependencies.filter(
            (edge) => edge.taskId !== mutation.id && edge.dependsOnTaskId !== mutation.id,
          );
          outcome.appliedCount += 1;
          break;
        }
        case 'create_goal': {
          working.goals.push({ ...mutation.goal });
          outcome.createdGoalIds.push(mutation.goal.id);
          outcome.inverse.push({ kind: 'delete_goal', id: mutation.goal.id });
          outcome.appliedCount += 1;
          break;
        }
        case 'update_goal': {
          const existing = working.goals.find((goal) => goal.id === mutation.id);
          if (!existing) {
            outcome.rejected.push({
              index,
              kind: mutation.kind,
              reason: 'That goal no longer exists.',
            });
            break;
          }
          if (mutation.expectedUpdatedAt && existing.updatedAt !== mutation.expectedUpdatedAt) {
            outcome.rejected.push({
              index,
              kind: mutation.kind,
              reason: 'That goal changed since the preview was generated.',
            });
            break;
          }
          outcome.inverse.push({ kind: 'restore_goal', goal: { ...existing } });
          working.goals = working.goals.map((goal) =>
            goal.id === mutation.id
              ? { ...goal, ...mutation.patch, updatedAt: this.nowIso() }
              : goal,
          );
          outcome.appliedCount += 1;
          break;
        }
        case 'log_event': {
          working.events.push({ ...mutation.event });
          break;
        }
      }
    });

    this.state = working;
    this.state.userModified = true;
    this.persist();

    return outcome;
  }

  async applyInverse(operations: readonly InverseOperation[]): Promise<void> {
    // Reversed so a create-then-update pair unwinds in the right order.
    const ordered = [...operations].reverse();

    this.commit((state) => {
      for (const operation of ordered) {
        switch (operation.kind) {
          case 'delete_task':
            state.tasks = state.tasks.filter((task) => task.id !== operation.id);
            break;
          case 'restore_task': {
            const exists = state.tasks.some((task) => task.id === operation.task.id);
            state.tasks = exists
              ? state.tasks.map((task) =>
                  task.id === operation.task.id ? { ...operation.task } : task,
                )
              : [...state.tasks, { ...operation.task }];
            break;
          }
          case 'delete_goal':
            state.goals = state.goals.filter((goal) => goal.id !== operation.id);
            break;
          case 'restore_goal': {
            const exists = state.goals.some((goal) => goal.id === operation.goal.id);
            state.goals = exists
              ? state.goals.map((goal) =>
                  goal.id === operation.goal.id ? { ...operation.goal } : goal,
                )
              : [...state.goals, { ...operation.goal }];
            break;
          }
        }
      }
    });
  }

  async resetDemoData(): Promise<void> {
    this.state = this.seedState();
    this.persist();
  }
}

/**
 * Deep-copies guest state.
 *
 * `structuredClone` is used where available; the manual fallback keeps the
 * adapter working in older runtimes without dragging in a clone library.
 */
function structuredCloneState(state: GuestState): GuestState {
  if (typeof structuredClone === 'function') return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as GuestState;
}
