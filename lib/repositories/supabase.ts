/**
 * `SupabasePlannerRepository` — the authenticated adapter.
 *
 * Implements the same `PlannerRepository` contract as the guest adapter, so
 * every page, hook and domain engine above it is unchanged between demo mode
 * and production. That symmetry is the point of the interface: the Playwright
 * suite exercises the real UI through the local adapter, and swapping in this
 * one changes only where bytes live.
 *
 * Three things are worth knowing before reading:
 *
 * 1. **Reads go through one RPC.** `momentum_snapshot` returns the profile,
 *    goals, tasks, dependencies, plan, blocks, events and focus session in a
 *    single transaction. Eight parallel PostgREST calls would return eight
 *    views read at eight different instants, which shows up as a UI that
 *    briefly contradicts itself.
 *
 * 2. **Batched writes go through one RPC.** `momentum_apply_mutations` runs the
 *    whole batch in one transaction, because PostgREST gives each HTTP request
 *    its own. Everything else is a single statement and therefore atomic on its
 *    own.
 *
 * 3. **`user_id` is always supplied and never trusted.** Every insert sets it
 *    from the verified session, and RLS independently rejects anything else. A
 *    client that lies about it fails twice.
 */
import { addMinutesTo, parseIso, toIso } from '@/lib/dates';
import { newId } from '@/lib/domain/ids';
import { buildNextOccurrence } from '@/lib/domain/recurrence';
import type { DaySchedule } from '@/lib/domain/scheduler';
import type {
  ActivityEvent,
  DayKey,
  FocusSession,
  Goal,
  IsoDateTime,
  PlannerSnapshot,
  Profile,
  Task,
} from '@/lib/domain/types';
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
import {
  blockFromRow,
  dependencyFromRow,
  eventFromRow,
  focusSessionFromRow,
  goalFromRow,
  goalPatchToRow,
  goalToRow,
  planFromRow,
  profileFromRow,
  profileToRow,
  taskFromRow,
  taskPatchToRow,
  taskToRow,
} from '@/lib/supabase/mappers';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type {
  ApplyMutationsPayload,
  GoalRow,
  SavePlanPayload,
  SnapshotPayload,
  TaskRow,
} from '@/lib/supabase/types';

export interface SupabaseRepositoryOptions {
  client: TypedSupabaseClient;
  userId: string;
  timezone: string;
  now?: () => Date;
  generateId?: () => string;
}

/** How much activity history the analytics window needs. */
const EVENT_WINDOW_DAYS = 60;

export class SupabasePlannerRepository implements PlannerRepository {
  readonly mode: RepositoryMode = 'supabase';

  private readonly client: TypedSupabaseClient;
  private readonly userId: string;
  private readonly timezone: string;
  private readonly clock: () => Date;
  private readonly generateId: () => string;

  constructor(options: SupabaseRepositoryOptions) {
    this.client = options.client;
    this.userId = options.userId;
    this.timezone = options.timezone;
    this.clock = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? newId;
  }

  private now(): Date {
    return this.clock();
  }

  private nowIso(): IsoDateTime {
    return toIso(this.now());
  }

  /**
   * Converts a Postgres error into a sentence a person can act on.
   *
   * The raw message is never surfaced: it can contain constraint names, column
   * lists and SQL fragments, which are noise to a user and a small
   * information-disclosure leak to anyone else. Known error codes are mapped to
   * specific guidance; everything else gets one honest generic sentence.
   */
  private fail(error: { code?: string; message: string }, fallback: string): never {
    switch (error.code) {
      // check_violation and invalid_parameter_value are raised by this schema's
      // own triggers ("That dependency would create a loop.", "Unknown
      // timezone: …"). Those messages are written for users, so passing them
      // through is both safe and more useful than a generic sentence.
      case '23514':
      case '22023':
        throw new Error(error.message);
      // unique_violation: the constraint name would leak schema detail.
      case '23505':
        throw new Error('That already exists.');
      case '23503':
        throw new Error('That change referred to something that no longer exists.');
      case '23502':
        throw new Error('That change was missing a required value.');
      case '42501':
        // RLS refused the row. From the user's side these are the same
        // situation: it is not theirs to change.
        throw new Error('You are not signed in, or that record is not yours.');
      case 'PGRST116':
        throw new Error('That record no longer exists.');
      default:
        throw new Error(fallback);
    }
  }

  // --- Reads -----------------------------------------------------------------

  async getSnapshot(dayKey: DayKey): Promise<PlannerSnapshot> {
    const { data, error } = await this.client.rpc('momentum_snapshot', {
      p_day: dayKey,
      p_event_days: EVENT_WINDOW_DAYS,
    });

    if (error) this.fail(error, 'Your planner could not be loaded. Try again in a moment.');

    const payload = data as SnapshotPayload | null;
    if (!payload?.profile) {
      // The signup trigger creates the profile, so its absence means the
      // account is genuinely incomplete rather than merely empty.
      throw new Error('Your profile has not finished setting up yet. Reload in a moment.');
    }

    return {
      profile: profileFromRow(payload.profile),
      goals: (payload.goals ?? []).map(goalFromRow),
      tasks: (payload.tasks ?? []).map(taskFromRow),
      dependencies: (payload.dependencies ?? []).map(dependencyFromRow),
      plan: payload.plan ? planFromRow(payload.plan) : null,
      blocks: (payload.blocks ?? []).map(blockFromRow),
      events: (payload.events ?? []).map(eventFromRow),
      focusSession: payload.focus_session ? focusSessionFromRow(payload.focus_session) : null,
    };
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const { data, error } = await this.client
      .from('profiles')
      .update(profileToRow(patch))
      .eq('id', this.userId)
      .select()
      .single();

    if (error) this.fail(error, 'Your settings could not be saved.');
    return profileFromRow(data);
  }

  // --- Tasks -----------------------------------------------------------------

  async createTask(input: CreateTaskInput): Promise<Task> {
    const duration = input.durationMinutes ?? (await this.defaultDuration());
    const scheduledStart = parseIso(input.scheduledStart ?? null);
    const id = this.generateId();

    // Recurring tasks are the first occurrence of their own series. Setting the
    // series identity here keeps `(series_id, occurrence_at)` a usable
    // idempotency key regardless of which code path created the task.
    const isRecurring = Boolean(input.recurrenceRule);
    const recurrenceSeriesId = input.recurrenceSeriesId ?? (isRecurring ? id : null);
    const recurrenceOccurrenceAt =
      input.recurrenceOccurrenceAt ??
      (isRecurring ? (input.dueAt ?? input.scheduledStart ?? this.nowIso()) : null);

    const row: Partial<TaskRow> = {
      id,
      user_id: this.userId,
      goal_id: input.goalId ?? null,
      parent_task_id: input.parentTaskId ?? null,
      title: input.title.trim(),
      notes: input.notes ?? null,
      status: input.status ?? (scheduledStart ? 'planned' : 'inbox'),
      manual_priority: input.manualPriority ?? 'normal',
      importance: input.importance ?? 3,
      energy: input.energy ?? 'medium',
      due_at: input.dueAt ?? null,
      scheduled_start: input.scheduledStart ?? null,
      scheduled_end:
        input.scheduledEnd ??
        (scheduledStart ? toIso(addMinutesTo(scheduledStart, duration)) : null),
      duration_minutes: duration,
      is_fixed_time: input.isFixedTime ?? false,
      splittable: input.splittable ?? false,
      recurrence_rule: input.recurrenceRule ?? null,
      recurrence_series_id: recurrenceSeriesId,
      recurrence_occurrence_at: recurrenceOccurrenceAt,
      source: input.source ?? 'manual',
      source_text: input.sourceText ?? null,
      position: input.position ?? (await this.nextPosition()),
    };

    const { data, error } = await this.client.from('tasks').insert(row).select().single();
    if (error) this.fail(error, 'That task could not be created.');

    const task = taskFromRow(data);
    await this.logEvent({ eventType: 'task_created', taskId: task.id });
    return task;
  }

  private async defaultDuration(): Promise<number> {
    const { data } = await this.client
      .from('profiles')
      .select('default_task_duration_minutes')
      .eq('id', this.userId)
      .single();
    return data?.default_task_duration_minutes ?? 30;
  }

  /**
   * Next queue position.
   *
   * Read-then-write, so two truly simultaneous creates can land on the same
   * position. That is acceptable here: `position` only determines manual
   * ordering, ranking has a total-order tie-break on id, and the user can drag
   * to fix it. A sequence would remove the race at the cost of making
   * reordering a rewrite of every row.
   */
  private async nextPosition(): Promise<number> {
    const { data } = await this.client
      .from('tasks')
      .select('position')
      .eq('user_id', this.userId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.position ?? 0) + 1;
  }

  async updateTask(
    id: string,
    patch: UpdateTaskInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Task> {
    let query = this.client.from('tasks').update(taskPatchToRow(patch)).eq('id', id);

    // The concurrency guard rides along as a predicate rather than a prior
    // read: one statement means there is no window between checking and
    // writing for another client to slip through.
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

    const { data, error } = await query.select().maybeSingle();
    if (error) this.fail(error, 'That task could not be updated.');

    if (!data) {
      // No row matched. Either it is gone, or the `updated_at` predicate
      // excluded it — distinguish the two so the message is accurate.
      if (expectedUpdatedAt) {
        const { data: current } = await this.client
          .from('tasks')
          .select('id')
          .eq('id', id)
          .maybeSingle();
        if (current) throw new StaleWriteError('task', id);
      }
      throw new Error('That task no longer exists.');
    }

    await this.logEvent({ eventType: 'task_updated', taskId: id });
    return taskFromRow(data);
  }

  async deleteTask(id: string): Promise<void> {
    const { error, count } = await this.client
      .from('tasks')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) this.fail(error, 'That task could not be deleted.');
    if (count === 0) throw new Error('That task no longer exists.');

    // `task_id` is nulled by the foreign key, so the event records the deletion
    // without dangling.
    await this.logEvent({ eventType: 'task_deleted', taskId: null });
  }

  async archiveTask(id: string): Promise<Task> {
    return this.updateTask(id, { status: 'archived', archivedAt: this.nowIso() });
  }

  async duplicateTask(id: string): Promise<Task> {
    const original = await this.requireTask(id);
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

  private async requireTask(id: string): Promise<Task> {
    const { data, error } = await this.client.from('tasks').select().eq('id', id).maybeSingle();

    if (error) this.fail(error, 'That task could not be loaded.');
    if (!data) throw new Error('That task no longer exists.');
    return taskFromRow(data);
  }

  private async requireGoal(id: string): Promise<Goal> {
    const { data, error } = await this.client.from('goals').select().eq('id', id).maybeSingle();

    if (error) this.fail(error, 'That goal could not be loaded.');
    if (!data) throw new Error('That goal no longer exists.');
    return goalFromRow(data);
  }

  /**
   * Completes a task and materializes the next occurrence of a recurring one.
   *
   * The completion and the successor are one `momentum_apply_mutations` call so
   * they cannot half-happen. Duplicate suppression rests on the unique index
   * over `(recurrence_series_id, recurrence_occurrence_at)`: a double-tap hits
   * the constraint rather than racing a `select`-then-`insert` check.
   */
  async completeTask(id: string, actualMinutes?: number | null): Promise<CompleteTaskResult> {
    const existing = await this.requireTask(id);
    const nowIso = this.nowIso();

    const successor = existing.recurrenceRule
      ? buildNextOccurrence(existing, this.timezone, this.now(), this.generateId())
      : null;

    const mutations: Mutation[] = [
      {
        kind: 'update_task',
        id,
        patch: {
          status: 'completed',
          completedAt: nowIso,
          actualMinutes: actualMinutes ?? existing.actualMinutes,
        },
        expectedUpdatedAt: null,
      },
    ];

    if (successor) mutations.push({ kind: 'create_task', task: successor });

    mutations.push({
      kind: 'log_event',
      event: {
        id: this.generateId(),
        userId: this.userId,
        taskId: id,
        eventType: 'task_completed',
        occurredAt: nowIso,
        durationMinutes: actualMinutes ?? existing.durationMinutes,
        metadata: {},
      },
    });

    try {
      const outcome = await this.applyMutations(mutations);
      const rejection = outcome.rejected[0];
      if (rejection) throw new Error(rejection.reason);
    } catch (error) {
      // The occurrence already exists: another click, or a retry after a
      // dropped response. Completing is idempotent from the user's point of
      // view, so this is a success with no successor to report.
      if (isUniqueViolation(error)) {
        const refreshed = await this.requireTask(id);
        return { task: refreshed, nextOccurrence: null };
      }
      throw error;
    }

    return {
      task: await this.requireTask(id),
      nextOccurrence: successor,
    };
  }

  async uncompleteTask(id: string): Promise<Task> {
    const existing = await this.requireTask(id);
    const status = existing.scheduledStart ? 'planned' : 'inbox';

    const updated = await this.updateTask(id, { status, completedAt: null });
    await this.logEvent({ eventType: 'task_uncompleted', taskId: id });

    // Withdraw the successor this completion created, but only while it is
    // still untouched — a user who already edited or scheduled the next
    // occurrence should not have it deleted underneath them.
    if (existing.recurrenceSeriesId) {
      const candidate = buildNextOccurrence(existing, this.timezone, this.now(), 'probe');
      if (candidate?.recurrenceOccurrenceAt) {
        await this.client
          .from('tasks')
          .delete()
          .eq('recurrence_series_id', existing.recurrenceSeriesId)
          .eq('recurrence_occurrence_at', candidate.recurrenceOccurrenceAt)
          .eq('status', 'inbox')
          .is('actual_minutes', null);
      }
    }

    return updated;
  }

  /**
   * Persists a new manual ordering.
   *
   * An `upsert` of `(id, position)` pairs is one statement, so the reordered
   * queue never renders half-sorted. The rows are guarded by RLS, and the
   * `id`s came from a snapshot the user could already read.
   */
  async reorderTasks(orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;

    const rows = orderedIds.map((id, index) => ({
      id,
      user_id: this.userId,
      position: index + 1,
    }));

    const { error } = await this.client
      .from('tasks')
      .upsert(rows, { onConflict: 'id', defaultToNull: false });

    if (error) this.fail(error, 'That new order could not be saved.');
  }

  // --- Goals -----------------------------------------------------------------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const row: Partial<GoalRow> = {
      id: this.generateId(),
      user_id: this.userId,
      title: input.title.trim(),
      description: input.description ?? null,
      category: input.category ?? 'personal',
      priority_weight: input.priorityWeight ?? 3,
      target_date: input.targetDate ?? null,
      weekly_target_minutes: input.weeklyTargetMinutes ?? null,
      status: input.status ?? 'active',
      color: input.color ?? 'cobalt',
    };

    const { data, error } = await this.client.from('goals').insert(row).select().single();
    if (error) this.fail(error, 'That goal could not be created.');

    await this.logEvent({ eventType: 'goal_created', taskId: null });
    return goalFromRow(data);
  }

  async updateGoal(
    id: string,
    patch: UpdateGoalInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Goal> {
    let query = this.client.from('goals').update(goalPatchToRow(patch)).eq('id', id);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

    const { data, error } = await query.select().maybeSingle();
    if (error) this.fail(error, 'That goal could not be updated.');

    if (!data) {
      if (expectedUpdatedAt) {
        const { data: current } = await this.client
          .from('goals')
          .select('id')
          .eq('id', id)
          .maybeSingle();
        if (current) throw new StaleWriteError('goal', id);
      }
      throw new Error('That goal no longer exists.');
    }

    await this.logEvent({ eventType: 'goal_updated', taskId: null });
    return goalFromRow(data);
  }

  async archiveGoal(id: string): Promise<Goal> {
    await this.requireGoal(id);
    return this.updateGoal(id, { status: 'archived' });
  }

  // --- Dependencies ----------------------------------------------------------

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw new Error('A task cannot depend on itself.');
    }

    // Cycles are rejected by the `prevent_dependency_cycle` trigger rather than
    // by a check here. The database sees a consistent graph under concurrency;
    // an application-side walk could be raced by a second client adding the
    // complementary edge at the same moment.
    const { error } = await this.client.from('task_dependencies').insert({
      task_id: taskId,
      depends_on_task_id: dependsOnTaskId,
      user_id: this.userId,
    });

    // Already present is the desired end state, so it is not an error.
    if (error && !isUniqueViolation(error)) {
      this.fail(error, 'That dependency could not be added.');
    }
  }

  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    const { error } = await this.client
      .from('task_dependencies')
      .delete()
      .eq('task_id', taskId)
      .eq('depends_on_task_id', dependsOnTaskId);

    if (error) this.fail(error, 'That dependency could not be removed.');
  }

  // --- Plans -----------------------------------------------------------------

  async savePlan(input: SavePlanInput): Promise<SavedPlan> {
    const { schedule } = input;
    const locked = new Set(input.lockedBlockIds ?? []);

    const { data, error } = await this.client.rpc('momentum_save_plan', {
      p_plan: {
        plan_date: schedule.date,
        timezone: schedule.timezone,
        available_minutes: schedule.diagnostics.availableMinutes,
        scheduled_minutes: schedule.diagnostics.scheduledMinutes,
        score_version: schedule.scoreVersion,
      },
      p_blocks: schedule.blocks.map((block, index) => ({
        task_id: block.taskId,
        title: block.taskId ? null : block.title,
        start_at: block.startAt,
        end_at: block.endAt,
        block_type: block.blockType,
        is_locked: block.isLocked || locked.has(block.id),
        position: index,
      })),
    });

    if (error) this.fail(error, 'That plan could not be saved.');

    const payload = data as SavePlanPayload;

    // Mirror the plan onto the tasks so the queue, the ranked list and the
    // timeline all agree on when work is scheduled. Done after the plan write
    // rather than inside it, because a stale mirror is a cosmetic
    // inconsistency while a lost plan is not.
    await this.mirrorScheduleOntoTasks(schedule);

    await this.logEvent({
      eventType: 'plan_generated',
      taskId: null,
      metadata: {
        date: schedule.date,
        scheduledMinutes: schedule.diagnostics.scheduledMinutes,
        overflowCount: schedule.overflow.length,
        scoreVersion: schedule.scoreVersion,
      },
    });

    return {
      plan: planFromRow(payload.plan),
      blocks: (payload.blocks ?? []).map(blockFromRow),
    };
  }

  private async mirrorScheduleOntoTasks(schedule: DaySchedule): Promise<void> {
    const spans = new Map<string, { start: IsoDateTime; end: IsoDateTime }>();
    for (const block of schedule.blocks) {
      if (block.blockType !== 'task' || !block.taskId) continue;
      const current = spans.get(block.taskId);
      if (!current) {
        spans.set(block.taskId, { start: block.startAt, end: block.endAt });
      } else {
        // A split task spans from its first chunk to its last.
        spans.set(block.taskId, {
          start: block.startAt < current.start ? block.startAt : current.start,
          end: block.endAt > current.end ? block.endAt : current.end,
        });
      }
    }

    const mutations: Mutation[] = [];

    for (const [taskId, span] of spans) {
      mutations.push({
        kind: 'update_task',
        id: taskId,
        patch: { scheduledStart: span.start, scheduledEnd: span.end, status: 'planned' },
        expectedUpdatedAt: null,
      });
    }

    // Anything that overflowed returns to the queue instead of keeping a time
    // the plan no longer contains.
    for (const item of schedule.overflow) {
      mutations.push({
        kind: 'update_task',
        id: item.taskId,
        patch: { scheduledStart: null, scheduledEnd: null, status: 'inbox' },
        expectedUpdatedAt: null,
      });
    }

    if (mutations.length > 0) await this.applyMutations(mutations);
  }

  // --- Events and focus ------------------------------------------------------

  async logEvent(input: LogEventInput): Promise<ActivityEvent> {
    const row = {
      id: this.generateId(),
      user_id: this.userId,
      task_id: input.taskId ?? null,
      event_type: input.eventType,
      occurred_at: input.occurredAt ?? this.nowIso(),
      duration_minutes: input.durationMinutes ?? null,
      metadata: input.metadata ?? {},
    };

    const { data, error } = await this.client.from('activity_events').insert(row).select().single();

    if (error) this.fail(error, 'That activity could not be recorded.');
    return eventFromRow(data);
  }

  async getFocusSession(): Promise<FocusSession | null> {
    const { data, error } = await this.client
      .from('focus_sessions')
      .select()
      .eq('user_id', this.userId)
      .maybeSingle();

    if (error) this.fail(error, 'Your focus timer could not be loaded.');
    return data ? focusSessionFromRow(data) : null;
  }

  async setFocusSession(session: FocusSession | null): Promise<void> {
    if (!session) {
      const { error } = await this.client
        .from('focus_sessions')
        .delete()
        .eq('user_id', this.userId);
      if (error) this.fail(error, 'Your focus timer could not be cleared.');
      return;
    }

    // `user_id` is the primary key, so an upsert enforces one session per user
    // at the storage layer rather than relying on the caller to check first.
    const { error } = await this.client.from('focus_sessions').upsert(
      {
        user_id: this.userId,
        task_id: session.taskId,
        started_at: session.startedAt,
        accumulated_minutes: session.accumulatedMinutes,
        is_paused: session.isPaused,
      },
      { onConflict: 'user_id' },
    );

    if (error) this.fail(error, 'Your focus timer could not be saved.');
  }

  // --- Batch apply -----------------------------------------------------------

  /**
   * Applies a confirmed batch in one transaction.
   *
   * The inverse operations for Undo are computed *here*, on the client side of
   * the call, from the pre-write state. The database function cannot return
   * them without also returning every row it touched, which would make the
   * response size grow with the batch for the sake of a feature the user might
   * never use.
   */
  async applyMutations(mutations: readonly Mutation[]): Promise<MutationOutcome> {
    if (mutations.length === 0) {
      return {
        appliedCount: 0,
        createdTaskIds: [],
        createdGoalIds: [],
        rejected: [],
        inverse: [],
      };
    }

    const inverse = await this.buildInverse(mutations);

    const { data, error } = await this.client.rpc('momentum_apply_mutations', {
      p_mutations: mutations.map((mutation) => toWireMutation(mutation)),
    });

    if (error) this.fail(error, 'Those changes could not be applied.');

    const payload = data as ApplyMutationsPayload;
    const appliedTaskIds = new Set(payload.created_task_ids ?? []);
    const appliedGoalIds = new Set(payload.created_goal_ids ?? []);
    const rejectedIndexes = new Set((payload.rejected ?? []).map((entry) => entry.index));

    return {
      appliedCount: payload.applied_count ?? 0,
      createdTaskIds: payload.created_task_ids ?? [],
      createdGoalIds: payload.created_goal_ids ?? [],
      rejected: (payload.rejected ?? []).map((entry) => ({
        index: entry.index,
        kind: entry.kind as Mutation['kind'],
        reason: entry.reason,
      })),
      // Undo must not offer to reverse something that was never applied.
      inverse: inverse.filter(
        (entry, index) =>
          !rejectedIndexes.has(index) &&
          (entry.kind !== 'delete_task' || appliedTaskIds.has(entry.id)) &&
          (entry.kind !== 'delete_goal' || appliedGoalIds.has(entry.id)),
      ),
    };
  }

  /**
   * Captures the pre-write state each mutation would overwrite.
   *
   * One query per referenced id would be N round trips, so the ids are
   * collected first and fetched in two `in` queries.
   */
  private async buildInverse(mutations: readonly Mutation[]): Promise<InverseOperation[]> {
    const taskIds = new Set<string>();
    const goalIds = new Set<string>();

    for (const mutation of mutations) {
      if (mutation.kind === 'update_task' || mutation.kind === 'delete_task') {
        taskIds.add(mutation.id);
      }
      if (mutation.kind === 'update_goal') goalIds.add(mutation.id);
    }

    const tasksById = new Map<string, Task>();
    if (taskIds.size > 0) {
      const { data } = await this.client
        .from('tasks')
        .select()
        .in('id', [...taskIds]);
      for (const row of data ?? []) tasksById.set(row.id, taskFromRow(row));
    }

    const goalsById = new Map<string, Goal>();
    if (goalIds.size > 0) {
      const { data } = await this.client
        .from('goals')
        .select()
        .in('id', [...goalIds]);
      for (const row of data ?? []) goalsById.set(row.id, goalFromRow(row));
    }

    const inverse: InverseOperation[] = [];
    for (const mutation of mutations) {
      switch (mutation.kind) {
        case 'create_task':
          inverse.push({ kind: 'delete_task', id: mutation.task.id });
          break;
        case 'create_goal':
          inverse.push({ kind: 'delete_goal', id: mutation.goal.id });
          break;
        case 'update_task':
        case 'delete_task': {
          const task = tasksById.get(mutation.id);
          if (task) inverse.push({ kind: 'restore_task', task });
          break;
        }
        case 'update_goal': {
          const goal = goalsById.get(mutation.id);
          if (goal) inverse.push({ kind: 'restore_goal', goal });
          break;
        }
        case 'log_event':
          break;
      }
    }

    return inverse;
  }

  async applyInverse(operations: readonly InverseOperation[]): Promise<void> {
    if (operations.length === 0) return;

    // Reversed so a create-then-update pair unwinds in the order it was applied.
    const ordered = [...operations].reverse();
    const mutations: Mutation[] = [];

    for (const operation of ordered) {
      switch (operation.kind) {
        case 'delete_task':
          mutations.push({ kind: 'delete_task', id: operation.id });
          break;
        case 'restore_task':
          // `create_task` with the original id, because the row may have been
          // deleted outright. The RPC's insert would collide if it still
          // exists, so the previous row is removed first.
          mutations.push({ kind: 'delete_task', id: operation.task.id });
          mutations.push({ kind: 'create_task', task: operation.task });
          break;
        case 'delete_goal':
          mutations.push({
            kind: 'update_goal',
            id: operation.id,
            patch: { status: 'archived' },
            expectedUpdatedAt: null,
          });
          break;
        case 'restore_goal':
          mutations.push({
            kind: 'update_goal',
            id: operation.goal.id,
            patch: operation.goal,
            expectedUpdatedAt: null,
          });
          break;
      }
    }

    await this.applyMutations(mutations);
  }

  /**
   * Not available on this adapter.
   *
   * Regenerating demo data means destroying real records, so the operation is
   * refused rather than reinterpreted. Signed-in users clear data from
   * Settings, where the consequences are spelled out.
   */
  async resetDemoData(): Promise<void> {
    throw new Error('Demo data can only be reset in Guest Demo mode.');
  }
}

/** Domain mutation → snake_case wire shape the RPC expects. */
function toWireMutation(mutation: Mutation): Record<string, unknown> {
  switch (mutation.kind) {
    case 'create_task':
      return { kind: mutation.kind, task: taskToRow(mutation.task) };
    case 'update_task':
      return {
        kind: mutation.kind,
        id: mutation.id,
        patch: taskPatchToRow(mutation.patch),
        expected_updated_at: mutation.expectedUpdatedAt,
      };
    case 'delete_task':
      return { kind: mutation.kind, id: mutation.id };
    case 'create_goal':
      return { kind: mutation.kind, goal: goalToRow(mutation.goal) };
    case 'update_goal':
      return {
        kind: mutation.kind,
        id: mutation.id,
        patch: goalPatchToRow(mutation.patch),
        expected_updated_at: mutation.expectedUpdatedAt,
      };
    case 'log_event':
      return {
        kind: mutation.kind,
        event: {
          id: mutation.event.id,
          task_id: mutation.event.taskId,
          event_type: mutation.event.eventType,
          occurred_at: mutation.event.occurredAt,
          duration_minutes: mutation.event.durationMinutes,
          metadata: mutation.event.metadata,
        },
      };
  }
}

/** Postgres unique-violation detection, from either an error object or a throw. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: string }).code === '23505';
  }
  if (error instanceof Error) {
    return error.message.includes('duplicate key value');
  }
  return false;
}
