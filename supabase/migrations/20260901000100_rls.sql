-- ============================================================================
-- Momentum — Row Level Security
-- ============================================================================
--
-- The rule for the whole database: a row is visible to exactly one user, and
-- that user is identified by `auth.uid()`. There is no sharing model, no team
-- scope and no admin read path, so any policy more complex than an equality
-- check on `user_id` would be a policy that needs justifying.
--
-- Notes on the choices below:
--
-- * Policies are written per-operation rather than as one `for all`. A single
--   combined policy makes `insert` and `update` share a predicate, which is
--   how a table ends up letting a user *write* a row they could never read
--   (`with check` and `using` are not the same test).
--
-- * `insert` policies re-assert `user_id = auth.uid()` in `with check`. This is
--   the control that stops a client from writing a row *into another user's
--   account* — RLS on read alone would happily accept it and then hide it.
--
-- * `(select auth.uid())` rather than a bare `auth.uid()`: wrapping it in a
--   scalar subquery lets Postgres evaluate it once per statement instead of
--   once per row, which turns a per-row function call into a constant. On a
--   task list this is the difference between an index scan and a filter.
--
-- * Child tables check their own `user_id` column instead of joining to the
--   parent. Denormalizing the column (see the schema migration) is what makes
--   that possible, and it keeps every policy a single indexed comparison.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.daily_plans enable row level security;
alter table public.plan_blocks enable row level security;
alter table public.activity_events enable row level security;
alter table public.focus_sessions enable row level security;

-- Belt and braces: revoke the blanket grants PostgREST's roles receive so that
-- a future table created without RLS is not reachable by accident.
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.goals,
  public.tasks,
  public.task_dependencies,
  public.daily_plans,
  public.plan_blocks,
  public.activity_events,
  public.focus_sessions
to authenticated;

-- ------------------------------------------------------------------ profiles

-- No insert policy on purpose. Profile rows are created only by the
-- `handle_new_user` trigger, so a client cannot fabricate one, and cannot
-- create a profile for an id that has no corresponding auth user.
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Deletion happens by removing the auth user, which cascades. Exposing a
-- direct delete would let a client orphan their own session.

-- --------------------------------------------------------------------- goals

create policy "goals: read own"
  on public.goals for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "goals: insert own"
  on public.goals for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "goals: update own"
  on public.goals for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "goals: delete own"
  on public.goals for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------- tasks

create policy "tasks: read own"
  on public.tasks for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The `goal_id` check closes a cross-account reference: without it a user could
-- attach their task to someone else's goal id, which would leak the existence
-- of that goal through foreign-key errors and pollute the other account's
-- analytics.
create policy "tasks: insert own"
  on public.tasks for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      goal_id is null
      or exists (
        select 1 from public.goals g
        where g.id = goal_id and g.user_id = (select auth.uid())
      )
    )
    and (
      parent_task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = parent_task_id and t.user_id = (select auth.uid())
      )
    )
  );

create policy "tasks: update own"
  on public.tasks for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      goal_id is null
      or exists (
        select 1 from public.goals g
        where g.id = goal_id and g.user_id = (select auth.uid())
      )
    )
  );

create policy "tasks: delete own"
  on public.tasks for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------- task_dependencies

create policy "task_dependencies: read own"
  on public.task_dependencies for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Both endpoints are verified to belong to the caller. A dependency is a
-- readable relationship between two tasks, so accepting an edge that points at
-- a foreign task would disclose that the task exists.
create policy "task_dependencies: insert own"
  on public.task_dependencies for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tasks t
      where t.id = depends_on_task_id and t.user_id = (select auth.uid())
    )
  );

create policy "task_dependencies: delete own"
  on public.task_dependencies for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------- daily_plans

create policy "daily_plans: read own"
  on public.daily_plans for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "daily_plans: insert own"
  on public.daily_plans for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "daily_plans: update own"
  on public.daily_plans for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "daily_plans: delete own"
  on public.daily_plans for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------- plan_blocks

create policy "plan_blocks: read own"
  on public.plan_blocks for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "plan_blocks: insert own"
  on public.plan_blocks for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.daily_plans p
      where p.id = daily_plan_id and p.user_id = (select auth.uid())
    )
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id and t.user_id = (select auth.uid())
      )
    )
  );

create policy "plan_blocks: update own"
  on public.plan_blocks for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "plan_blocks: delete own"
  on public.plan_blocks for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------- activity_events

create policy "activity_events: read own"
  on public.activity_events for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "activity_events: insert own"
  on public.activity_events for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- No update policy: the activity log is append-only. Analytics and streaks are
-- derived from it, so allowing edits would let history be rewritten to
-- manufacture a streak, and would make any audit meaningless.

create policy "activity_events: delete own"
  on public.activity_events for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------ focus_sessions

create policy "focus_sessions: read own"
  on public.focus_sessions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "focus_sessions: insert own"
  on public.focus_sessions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

create policy "focus_sessions: update own"
  on public.focus_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "focus_sessions: delete own"
  on public.focus_sessions for delete
  to authenticated
  using (user_id = (select auth.uid()));
