/**
 * Database row shapes.
 *
 * Hand-written rather than generated, for one reason: a generated file is a
 * build artifact that only reflects whatever database the generator was pointed
 * at. Written by hand next to the migrations, these types are reviewed in the
 * same pull request as the DDL they describe, and a mismatch shows up as a
 * failing typecheck instead of at runtime against production.
 *
 * Everything here is snake_case and mirrors the columns exactly. Translation to
 * the camelCase domain model happens in exactly one place, `mappers.ts`.
 *
 * The row shapes are `type` aliases rather than `interface`s, which is not a
 * style choice. `postgrest-js` constrains each table's `Row` to
 * `Record<string, unknown>`, and TypeScript only infers an implicit index
 * signature for object *type literals* — an `interface` is not assignable to
 * `Record<string, unknown>`. Declared as interfaces, the whole schema silently
 * resolves to `never` and every query loses its typing.
 */
import type {
  ActivityEventType,
  BlockType,
  EnergyLevel,
  GoalCategory,
  GoalColorToken,
  GoalStatus,
  ManualPriority,
  TaskSource,
  TaskStatus,
  ThemePreference,
} from '@/lib/domain/types';

/** `timestamptz(3)` as serialized by PostgREST, e.g. `2026-03-10T14:00:00.000+00:00`. */
export type TimestampString = string;
/** `date` as serialized by PostgREST, e.g. `2026-03-10`. */
export type DateString = string;
/** `time` as serialized by PostgREST, e.g. `09:00:00`. */
export type TimeString = string;

export type ProfileRow = {
  id: string;
  display_name: string;
  timezone: string;
  workday_start: TimeString;
  workday_end: TimeString;
  default_task_duration_minutes: number;
  break_minutes: number;
  high_energy_start: TimeString;
  high_energy_end: TimeString;
  theme: ThemePreference;
  ai_assist_enabled: boolean;
  confirm_all_actions: boolean;
  split_long_tasks: boolean;
  created_at: TimestampString;
  updated_at: TimestampString;
};

export type GoalRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  priority_weight: number;
  target_date: DateString | null;
  weekly_target_minutes: number | null;
  status: GoalStatus;
  color: GoalColorToken;
  created_at: TimestampString;
  updated_at: TimestampString;
};

export type TaskRow = {
  id: string;
  user_id: string;
  goal_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  manual_priority: ManualPriority;
  importance: number;
  energy: EnergyLevel;
  due_at: TimestampString | null;
  scheduled_start: TimestampString | null;
  scheduled_end: TimestampString | null;
  duration_minutes: number;
  actual_minutes: number | null;
  is_fixed_time: boolean;
  splittable: boolean;
  recurrence_rule: string | null;
  recurrence_series_id: string | null;
  recurrence_occurrence_at: TimestampString | null;
  source: TaskSource;
  source_text: string | null;
  position: number;
  created_at: TimestampString;
  updated_at: TimestampString;
  completed_at: TimestampString | null;
  archived_at: TimestampString | null;
};

export type TaskDependencyRow = {
  task_id: string;
  depends_on_task_id: string;
  user_id: string;
  created_at?: TimestampString;
};

export type DailyPlanRow = {
  id: string;
  user_id: string;
  plan_date: DateString;
  timezone: string;
  available_minutes: number;
  scheduled_minutes: number;
  score_version: string;
  generated_at: TimestampString;
  updated_at: TimestampString;
};

export type PlanBlockRow = {
  id: string;
  user_id: string;
  daily_plan_id: string;
  task_id: string | null;
  title: string | null;
  start_at: TimestampString;
  end_at: TimestampString;
  block_type: BlockType;
  is_locked: boolean;
  position: number;
  created_at?: TimestampString;
};

export type ActivityEventRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  event_type: ActivityEventType;
  occurred_at: TimestampString;
  duration_minutes: number | null;
  metadata: Record<string, unknown>;
};

export type FocusSessionRow = {
  user_id: string;
  task_id: string;
  started_at: TimestampString;
  accumulated_minutes: number;
  is_paused: boolean;
  updated_at?: TimestampString;
};

/** Shape returned by the `momentum_snapshot` RPC. */
export type SnapshotPayload = {
  profile: ProfileRow | null;
  goals: GoalRow[];
  tasks: TaskRow[];
  dependencies: TaskDependencyRow[];
  plan: DailyPlanRow | null;
  blocks: PlanBlockRow[];
  events: ActivityEventRow[];
  focus_session: FocusSessionRow | null;
};

/** Shape returned by the `momentum_apply_mutations` RPC. */
export type ApplyMutationsPayload = {
  applied_count: number;
  created_task_ids: string[];
  created_goal_ids: string[];
  rejected: Array<{ index: number; kind: string; reason: string }>;
};

/** Shape returned by the `momentum_save_plan` RPC. */
export type SavePlanPayload = {
  plan: DailyPlanRow;
  blocks: PlanBlockRow[];
};

/**
 * A table entry in the shape `postgrest-js` expects.
 *
 * `Relationships: []` is deliberate. Declaring foreign keys here is what
 * enables PostgREST's embedded-select typing (`select('*, goals(*)')`), and
 * this app never uses embeds — `momentum_snapshot` returns the whole working
 * set in one call instead. Leaving the list empty keeps these types honest
 * about what is actually supported rather than describing joins no query makes.
 */
type TableTypes<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/**
 * Minimal typing for the tables and functions this app touches.
 *
 * Not the full shape `supabase gen types` emits — only what is used, which
 * keeps the surface reviewable and means an unused table cannot silently become
 * a dependency.
 */
export interface Database {
  public: {
    Tables: {
      profiles: TableTypes<ProfileRow, Partial<ProfileRow> & { id: string }>;
      goals: TableTypes<GoalRow>;
      tasks: TableTypes<TaskRow>;
      task_dependencies: TableTypes<TaskDependencyRow, TaskDependencyRow>;
      daily_plans: TableTypes<DailyPlanRow>;
      plan_blocks: TableTypes<PlanBlockRow>;
      activity_events: TableTypes<ActivityEventRow>;
      focus_sessions: TableTypes<FocusSessionRow, FocusSessionRow>;
    };
    Views: Record<string, never>;
    Functions: {
      momentum_snapshot: {
        Args: { p_day: string; p_event_days?: number };
        Returns: SnapshotPayload;
      };
      momentum_apply_mutations: {
        Args: { p_mutations: unknown };
        Returns: ApplyMutationsPayload;
      };
      momentum_save_plan: {
        Args: { p_plan: unknown; p_blocks: unknown };
        Returns: SavePlanPayload;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
