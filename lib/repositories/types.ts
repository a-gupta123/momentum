/**
 * The data-access seam.
 *
 * Two adapters implement this interface:
 *
 *  - `LocalPlannerRepository`  — Guest Demo, backed by validated localStorage.
 *  - `SupabasePlannerRepository` — authenticated production, backed by Postgres
 *    with Row Level Security.
 *
 * The UI and the domain engines only ever see this interface, which is what lets
 * the entire product work with no credentials while still having a real
 * production data path.
 */
import type {
  ActivityEvent,
  ActivityEventType,
  ActivityMetadata,
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
import type { DaySchedule } from '@/lib/domain/scheduler';

export type RepositoryMode = 'guest' | 'supabase';

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  goalId?: string | null;
  parentTaskId?: string | null;
  status?: Task['status'];
  manualPriority?: Task['manualPriority'];
  importance?: Task['importance'];
  energy?: Task['energy'];
  dueAt?: IsoDateTime | null;
  scheduledStart?: IsoDateTime | null;
  scheduledEnd?: IsoDateTime | null;
  durationMinutes?: number;
  isFixedTime?: boolean;
  splittable?: boolean;
  recurrenceRule?: string | null;
  recurrenceSeriesId?: string | null;
  recurrenceOccurrenceAt?: IsoDateTime | null;
  source?: Task['source'];
  sourceText?: string | null;
  position?: number;
}

/** Fields a caller may change. Identity and audit columns are excluded. */
export type UpdateTaskInput = Partial<
  Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
>;

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  category?: Goal['category'];
  priorityWeight?: Goal['priorityWeight'];
  targetDate?: DayKey | null;
  weeklyTargetMinutes?: number | null;
  status?: Goal['status'];
  color?: Goal['color'];
}

export type UpdateGoalInput = Partial<Omit<Goal, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export interface LogEventInput {
  eventType: ActivityEventType;
  taskId?: string | null;
  durationMinutes?: number | null;
  metadata?: ActivityMetadata;
  occurredAt?: IsoDateTime;
}

/**
 * A single primitive write. Batches of these are what `applyMutations`
 * executes atomically, and they are produced by the pure planner in
 * `lib/domain/apply-actions.ts`.
 */
export type Mutation =
  | { kind: 'create_task'; task: Task }
  | {
      kind: 'update_task';
      id: string;
      patch: UpdateTaskInput;
      /** Optimistic-concurrency guard; a mismatch rejects the write. */
      expectedUpdatedAt: IsoDateTime | null;
    }
  | { kind: 'delete_task'; id: string }
  | { kind: 'create_goal'; goal: Goal }
  | { kind: 'update_goal'; id: string; patch: UpdateGoalInput; expectedUpdatedAt: IsoDateTime | null }
  | { kind: 'log_event'; event: ActivityEvent };

/** An operation that reverses part of an applied batch, powering the Undo toast. */
export type InverseOperation =
  | { kind: 'delete_task'; id: string }
  | { kind: 'restore_task'; task: Task }
  | { kind: 'delete_goal'; id: string }
  | { kind: 'restore_goal'; goal: Goal };

export interface MutationOutcome {
  appliedCount: number;
  createdTaskIds: string[];
  createdGoalIds: string[];
  /** Mutations that were refused, with a reason fit for a toast. */
  rejected: Array<{ index: number; kind: Mutation['kind']; reason: string }>;
  inverse: InverseOperation[];
}

export interface SavePlanInput {
  schedule: DaySchedule;
  /** Blocks the user pinned; preserved across a replace. */
  lockedBlockIds?: readonly string[];
}

export interface SavedPlan {
  plan: DailyPlan;
  blocks: PlanBlock[];
}

export interface CompleteTaskResult {
  task: Task;
  /** Present when completing an occurrence spawned the next one in the series. */
  nextOccurrence: Task | null;
}

/** Thrown when an `expectedUpdatedAt` guard fails, so the UI can offer a reload. */
export class StaleWriteError extends Error {
  constructor(
    readonly entity: 'task' | 'goal',
    readonly id: string,
  ) {
    super(
      `This ${entity} changed somewhere else since you loaded it. Reload to see the latest version.`,
    );
    this.name = 'StaleWriteError';
  }
}

/** Thrown when guest storage is unusable (quota, private mode, corrupt data). */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export interface PlannerRepository {
  readonly mode: RepositoryMode;

  /** Everything the planner needs for one day, in a single round trip. */
  getSnapshot(dayKey: DayKey): Promise<PlannerSnapshot>;

  updateProfile(patch: Partial<Profile>): Promise<Profile>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(
    id: string,
    patch: UpdateTaskInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  archiveTask(id: string): Promise<Task>;
  duplicateTask(id: string): Promise<Task>;

  /** Completes a task and, for a recurring one, materializes the next occurrence. */
  completeTask(id: string, actualMinutes?: number | null): Promise<CompleteTaskResult>;
  uncompleteTask(id: string): Promise<Task>;

  /** Persists a new manual ordering for the unscheduled queue. */
  reorderTasks(orderedIds: readonly string[]): Promise<void>;

  createGoal(input: CreateGoalInput): Promise<Goal>;
  updateGoal(
    id: string,
    patch: UpdateGoalInput,
    expectedUpdatedAt?: IsoDateTime | null,
  ): Promise<Goal>;
  archiveGoal(id: string): Promise<Goal>;

  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>;

  /** Replaces the plan for a day. Atomic: callers never see a half-written day. */
  savePlan(input: SavePlanInput): Promise<SavedPlan>;

  logEvent(input: LogEventInput): Promise<ActivityEvent>;

  getFocusSession(): Promise<FocusSession | null>;
  setFocusSession(session: FocusSession | null): Promise<void>;

  /** Executes a confirmed batch atomically. */
  applyMutations(mutations: readonly Mutation[]): Promise<MutationOutcome>;
  /** Reverses a previously applied batch. */
  applyInverse(operations: readonly InverseOperation[]): Promise<void>;

  /** Guest-only: regenerate the demo dataset. Rejects on the Supabase adapter. */
  resetDemoData(): Promise<void>;
}

export type { PlannerSnapshot, Profile, Task, Goal, DailyPlan, PlanBlock, ActivityEvent };
