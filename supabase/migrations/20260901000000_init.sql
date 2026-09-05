-- ============================================================================
-- Momentum — schema
-- ============================================================================
--
-- Design notes that are not obvious from the DDL:
--
-- * Every timestamp column is `timestamptz(3)`, not `timestamptz`. Postgres
--   defaults to microsecond precision while JavaScript `Date` carries
--   milliseconds, so a value written from the app and read back would differ in
--   its final digits. The app uses `updated_at` as an optimistic-concurrency
--   token compared as a string, and that comparison has to be exact — matching
--   the precision to the client's is what makes it reliable rather than
--   intermittently wrong.
--
-- * `due_at` and `scheduled_start` are separate columns because they answer
--   different questions: when is this *due*, versus when will I *do* it. The
--   whole planner rests on that distinction, so it is modelled in the schema
--   rather than inferred.
--
-- * Clock-time preferences (`workday_start`, quiet windows) are `time`, not
--   `timestamptz`. "I start at 9am" is a wall-clock intention that must survive
--   a timezone change and a DST transition; storing an instant would silently
--   shift the user's working day.
--
-- * `user_id` is denormalized onto every child table, including ones reachable
--   through a parent. It costs a column and buys RLS policies that are a single
--   indexed equality check with no join, which is both faster and much harder
--   to get subtly wrong.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enum types
-- Enums rather than text+check: they are self-documenting in the catalog, and
-- adding a value later is an explicit migration rather than an accident.

create type goal_category as enum ('coursework', 'career', 'project', 'health', 'personal', 'custom');
create type goal_status as enum ('active', 'paused', 'achieved', 'archived');
create type task_status as enum ('inbox', 'planned', 'in_progress', 'completed', 'snoozed', 'archived');
create type energy_level as enum ('low', 'medium', 'high');
create type manual_priority as enum ('low', 'normal', 'high', 'urgent');
create type task_source as enum ('manual', 'natural_language', 'recurrence', 'demo');
create type block_type as enum ('task', 'fixed', 'break');
create type theme_preference as enum ('light', 'dark', 'system');
create type activity_event_type as enum (
  'task_created',
  'task_completed',
  'task_uncompleted',
  'task_updated',
  'task_deleted',
  'task_archived',
  'task_scheduled',
  'focus_session',
  'plan_generated',
  'goal_created',
  'goal_updated'
);
create type goal_color as enum ('cobalt', 'teal', 'violet', 'amber', 'coral', 'moss', 'slate', 'rose');

-- ------------------------------------------------------------------ profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'You'
    constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  -- Validated against the IANA database on write by the trigger below; a bad
  -- timezone would make every date in the app wrong in a way that is hard to
  -- trace back to its source.
  timezone text not null default 'America/New_York',
  workday_start time not null default '09:00',
  workday_end time not null default '18:00',
  default_task_duration_minutes integer not null default 30
    constraint profiles_default_duration_range check (default_task_duration_minutes between 5 and 480),
  break_minutes integer not null default 10
    constraint profiles_break_range check (break_minutes between 0 and 60),
  high_energy_start time not null default '09:00',
  high_energy_end time not null default '12:00',
  theme theme_preference not null default 'system',
  ai_assist_enabled boolean not null default true,
  confirm_all_actions boolean not null default false,
  split_long_tasks boolean not null default true,
  created_at timestamptz(3) not null default clock_timestamp(),
  updated_at timestamptz(3) not null default clock_timestamp()
);

comment on table public.profiles is
  'One row per authenticated user: display preferences and the scheduling constraints the planner needs.';

-- --------------------------------------------------------------------- goals

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null
    constraint goals_title_length check (char_length(btrim(title)) between 1 and 120),
  description text
    constraint goals_description_length check (description is null or char_length(description) <= 1000),
  category goal_category not null default 'custom',
  priority_weight smallint not null default 3
    constraint goals_priority_weight_range check (priority_weight between 1 and 5),
  -- A calendar date, not an instant: "by 15 December" does not move because the
  -- user flew to another continent.
  target_date date,
  weekly_target_minutes integer
    constraint goals_weekly_target_range check (weekly_target_minutes is null or weekly_target_minutes between 0 and 10080),
  status goal_status not null default 'active',
  color goal_color not null default 'cobalt',
  created_at timestamptz(3) not null default clock_timestamp(),
  updated_at timestamptz(3) not null default clock_timestamp()
);

create index goals_user_status_idx on public.goals (user_id, status);
create index goals_user_priority_idx on public.goals (user_id, priority_weight desc);

-- --------------------------------------------------------------------- tasks

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  -- Self-reference for subtasks. `on delete cascade` because a subtask has no
  -- meaning without its parent.
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null
    constraint tasks_title_length check (char_length(btrim(title)) between 1 and 200),
  notes text
    constraint tasks_notes_length check (notes is null or char_length(notes) <= 2000),
  status task_status not null default 'inbox',
  manual_priority manual_priority not null default 'normal',
  importance smallint not null default 3
    constraint tasks_importance_range check (importance between 1 and 5),
  energy energy_level not null default 'medium',

  due_at timestamptz(3),
  scheduled_start timestamptz(3),
  scheduled_end timestamptz(3),
  duration_minutes integer not null default 30
    constraint tasks_duration_range check (duration_minutes between 5 and 480),
  actual_minutes integer
    constraint tasks_actual_minutes_range check (actual_minutes is null or actual_minutes between 0 and 1440),

  is_fixed_time boolean not null default false,
  splittable boolean not null default true,

  recurrence_rule text
    constraint tasks_recurrence_rule_length check (recurrence_rule is null or char_length(recurrence_rule) <= 200),
  -- All occurrences of a repeating task share a series id. Together with
  -- `recurrence_occurrence_at` it forms the natural key that makes
  -- materializing the next occurrence idempotent.
  recurrence_series_id uuid,
  recurrence_occurrence_at timestamptz(3),

  source task_source not null default 'manual',
  source_text text
    constraint tasks_source_text_length check (source_text is null or char_length(source_text) <= 2000),
  position integer not null default 0,

  created_at timestamptz(3) not null default clock_timestamp(),
  updated_at timestamptz(3) not null default clock_timestamp(),
  completed_at timestamptz(3),
  archived_at timestamptz(3),

  -- A scheduled window must be a real interval. Without this, a bad write
  -- produces blocks that render with negative height.
  constraint tasks_schedule_order check (
    scheduled_start is null or scheduled_end is null or scheduled_end > scheduled_start
  ),
  -- Completion state and its timestamp must agree, or every analytic built on
  -- `completed_at` quietly disagrees with the task list.
  constraint tasks_completed_at_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint tasks_no_self_parent check (parent_task_id is null or parent_task_id <> id)
);

-- The planner's hot path: "all active tasks for this user".
create index tasks_user_status_idx on public.tasks (user_id, status);
-- Deadline ranking, skipping the large tail of undated tasks.
create index tasks_user_due_idx on public.tasks (user_id, due_at) where due_at is not null;
-- Loading one day's plan.
create index tasks_user_scheduled_idx on public.tasks (user_id, scheduled_start) where scheduled_start is not null;
create index tasks_user_goal_idx on public.tasks (user_id, goal_id) where goal_id is not null;
create index tasks_user_position_idx on public.tasks (user_id, position);
create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;
-- Completion analytics scan by day.
create index tasks_user_completed_idx on public.tasks (user_id, completed_at desc) where completed_at is not null;

-- Guarantees that retrying "complete this recurring task" cannot create a
-- second copy of the same occurrence — the constraint enforces at the database
-- level what the application logic intends.
create unique index tasks_recurrence_occurrence_idx
  on public.tasks (recurrence_series_id, recurrence_occurrence_at)
  where recurrence_series_id is not null and recurrence_occurrence_at is not null;

-- --------------------------------------------------------- task_dependencies

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz(3) not null default clock_timestamp(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id)
);

-- Reverse lookup: "what is waiting on this task?"
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on_task_id);
create index task_dependencies_user_idx on public.task_dependencies (user_id);

-- --------------------------------------------------------------- daily_plans

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_date date not null,
  -- The timezone the plan was generated in, kept so that a plan stays
  -- interpretable after the user moves.
  timezone text not null,
  available_minutes integer not null default 0
    constraint daily_plans_available_range check (available_minutes between 0 and 1440),
  scheduled_minutes integer not null default 0
    constraint daily_plans_scheduled_range check (scheduled_minutes between 0 and 1440),
  -- Which scoring rules produced this plan, so an old plan remains explainable
  -- after the weights change.
  score_version text not null,
  generated_at timestamptz(3) not null default clock_timestamp(),
  updated_at timestamptz(3) not null default clock_timestamp(),
  -- One plan per day per user; regenerating replaces rather than accumulates.
  constraint daily_plans_unique_day unique (user_id, plan_date)
);

create index daily_plans_user_date_idx on public.daily_plans (user_id, plan_date desc);

-- --------------------------------------------------------------- plan_blocks

create table public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans (id) on delete cascade,
  -- Null for blocks with no backing task: breaks and ad-hoc fixed commitments.
  task_id uuid references public.tasks (id) on delete cascade,
  title text
    constraint plan_blocks_title_length check (title is null or char_length(title) <= 200),
  start_at timestamptz(3) not null,
  end_at timestamptz(3) not null,
  block_type block_type not null default 'task',
  is_locked boolean not null default false,
  position integer not null default 0,
  created_at timestamptz(3) not null default clock_timestamp(),
  constraint plan_blocks_interval check (end_at > start_at),
  -- Every block is identifiable in the UI: it has a task to name it, or a title.
  constraint plan_blocks_has_label check (task_id is not null or title is not null)
);

create index plan_blocks_plan_idx on public.plan_blocks (daily_plan_id, start_at);
create index plan_blocks_user_start_idx on public.plan_blocks (user_id, start_at);
create index plan_blocks_task_idx on public.plan_blocks (task_id) where task_id is not null;

-- ----------------------------------------------------------- activity_events

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  event_type activity_event_type not null,
  occurred_at timestamptz(3) not null default clock_timestamp(),
  duration_minutes integer
    constraint activity_events_duration_range check (duration_minutes is null or duration_minutes between 0 and 1440),
  -- Bounded metadata bag. Capped because it is written from user-influenced
  -- paths and an unbounded JSON column is a storage-exhaustion vector.
  metadata jsonb not null default '{}'::jsonb
    constraint activity_events_metadata_size check (pg_column_size(metadata) <= 2048),
  constraint activity_events_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

-- Analytics read a trailing window, newest first.
create index activity_events_user_occurred_idx on public.activity_events (user_id, occurred_at desc);
create index activity_events_user_type_idx on public.activity_events (user_id, event_type, occurred_at desc);
create index activity_events_task_idx on public.activity_events (task_id) where task_id is not null;

-- ------------------------------------------------------------ focus_sessions

-- At most one running session per user, enforced by making the user the
-- primary key. A second concurrent timer is not a state the product has a
-- meaning for, so it is made unrepresentable.
create table public.focus_sessions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  started_at timestamptz(3) not null,
  accumulated_minutes integer not null default 0
    constraint focus_sessions_accumulated_range check (accumulated_minutes between 0 and 1440),
  is_paused boolean not null default false,
  updated_at timestamptz(3) not null default clock_timestamp()
);

-- ============================================================================
-- Triggers
-- ============================================================================

-- `set_config('search_path', ...)` on every function below: a `security
-- definer` function with a mutable search_path can be hijacked by a caller who
-- creates a shadowing object in a schema earlier on the path.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- `clock_timestamp()`, not `now()`: `now()` is the transaction start time, so
  -- two rows updated in one transaction would share an `updated_at` and the
  -- concurrency token would not advance between them.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function public.touch_updated_at();

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

create trigger daily_plans_touch_updated_at
  before update on public.daily_plans
  for each row execute function public.touch_updated_at();

create trigger focus_sessions_touch_updated_at
  before update on public.focus_sessions
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- timezone validation

create or replace function public.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Casting to `timestamptz AT TIME ZONE` is the cheapest way to ask Postgres
  -- whether it recognizes the name; an unknown zone raises here rather than
  -- producing wrong dates for the rest of the user's account lifetime.
  begin
    perform clock_timestamp() at time zone new.timezone;
  exception when others then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end;
  return new;
end;
$$;

create trigger profiles_validate_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.validate_timezone();

create trigger daily_plans_validate_timezone
  before insert or update of timezone on public.daily_plans
  for each row execute function public.validate_timezone();

-- ------------------------------------------- dependency cycle prevention

create or replace function public.prevent_dependency_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  has_cycle boolean;
begin
  -- Walk the existing edges forward from the proposed prerequisite. If that
  -- walk can reach the task being made dependent, the new edge closes a loop
  -- and would produce a set of tasks that permanently block each other.
  with recursive reachable as (
    select new.depends_on_task_id as node
    union
    select d.depends_on_task_id
    from public.task_dependencies d
    join reachable r on d.task_id = r.node
  )
  select exists (select 1 from reachable where node = new.task_id) into has_cycle;

  if has_cycle then
    raise exception 'That dependency would create a loop.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger task_dependencies_prevent_cycle
  before insert or update on public.task_dependencies
  for each row execute function public.prevent_dependency_cycle();

-- ------------------------------------------------ profile on user signup

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Runs as definer because the new user has no session yet and so cannot pass
  -- their own RLS policy. Without this, a fresh sign-up would land on an app
  -- with no profile row and nothing would load.
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Prefer a name from the OAuth provider, then the local part of the email,
    -- and only then a neutral placeholder.
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'You'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------- keep task times and blocks aligned

create or replace function public.clear_schedule_on_uncomplete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Reopening a task must not leave a stale completion timestamp behind, which
  -- would keep counting toward streaks and completion rates.
  if new.status <> 'completed' and old.status = 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_clear_completion
  before update of status on public.tasks
  for each row execute function public.clear_schedule_on_uncomplete();
