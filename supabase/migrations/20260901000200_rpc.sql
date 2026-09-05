-- ============================================================================
-- Momentum — atomic write RPCs
-- ============================================================================
--
-- Why these exist at all: two operations in this product are batches that must
-- not be observable half-done.
--
-- 1. Confirming an assistant plan applies several writes at once. A brain dump
--    that creates four tasks and completes a fifth has to land completely or
--    not at all, or the user is left reconciling a partial result against a
--    preview they already approved.
-- 2. Regenerating a day replaces a plan and all of its blocks. Done as
--    separate HTTP calls, a failure between the delete and the insert leaves
--    the user with an empty day.
--
-- PostgREST gives each HTTP request its own transaction, so a loop of
-- `.insert()` calls from the client is a loop of independent transactions. The
-- only way to get one transaction is one call — hence a function.
--
-- Both functions are `security invoker` (the default, stated explicitly for the
-- reader). They therefore execute with the caller's privileges and every
-- statement inside them is still filtered by the RLS policies from the previous
-- migration. Using `security definer` here would have quietly turned these into
-- a way to bypass every policy in the schema, which is the single most common
-- serious mistake in a Supabase codebase.
--
-- The wire format is snake_case and matches the column names exactly. The
-- TypeScript adapter owns that mapping, which keeps the SQL free of any
-- camelCase translation and makes a field rename a compile error rather than a
-- runtime surprise.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- momentum_apply_mutations
--
-- Applies an ordered batch. Returns a report rather than raising on a rejected
-- item: an optimistic-concurrency miss on one task should not discard the four
-- valid tasks alongside it. Genuine faults (a constraint violation, a bad
-- enum) still raise and roll the whole batch back.
-- ----------------------------------------------------------------------------

create or replace function public.momentum_apply_mutations(p_mutations jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mutation jsonb;
  v_index integer := 0;
  v_kind text;
  v_payload jsonb;
  v_patch jsonb;
  v_id uuid;
  v_expected timestamptz(3);
  v_actual timestamptz(3);
  v_applied integer := 0;
  v_created_tasks uuid[] := '{}';
  v_created_goals uuid[] := '{}';
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_mutations) <> 'array' then
    raise exception 'Expected an array of mutations.' using errcode = '22023';
  end if;

  -- A ceiling here matches the batch cap the application enforces, and stops a
  -- single call from holding row locks for an unbounded amount of time.
  if jsonb_array_length(p_mutations) > 60 then
    raise exception 'Too many changes in one batch.' using errcode = '22023';
  end if;

  for v_mutation in select value from jsonb_array_elements(p_mutations)
  loop
    v_kind := v_mutation ->> 'kind';

    case v_kind

      -- ------------------------------------------------------ create_task
      when 'create_task' then
        v_payload := v_mutation -> 'task';
        insert into public.tasks (
          id, user_id, goal_id, parent_task_id, title, notes, status,
          manual_priority, importance, energy, due_at, scheduled_start,
          scheduled_end, duration_minutes, actual_minutes, is_fixed_time,
          splittable, recurrence_rule, recurrence_series_id,
          recurrence_occurrence_at, source, source_text, position,
          created_at, updated_at, completed_at, archived_at
        )
        values (
          coalesce((v_payload ->> 'id')::uuid, gen_random_uuid()),
          -- The caller's own id is forced in, never read from the payload. A
          -- client that tries to write into another account is corrected here
          -- and would be rejected by RLS regardless.
          v_uid,
          (v_payload ->> 'goal_id')::uuid,
          (v_payload ->> 'parent_task_id')::uuid,
          v_payload ->> 'title',
          v_payload ->> 'notes',
          coalesce((v_payload ->> 'status')::public.task_status, 'inbox'),
          coalesce((v_payload ->> 'manual_priority')::public.manual_priority, 'normal'),
          coalesce((v_payload ->> 'importance')::smallint, 3),
          coalesce((v_payload ->> 'energy')::public.energy_level, 'medium'),
          (v_payload ->> 'due_at')::timestamptz(3),
          (v_payload ->> 'scheduled_start')::timestamptz(3),
          (v_payload ->> 'scheduled_end')::timestamptz(3),
          coalesce((v_payload ->> 'duration_minutes')::integer, 30),
          (v_payload ->> 'actual_minutes')::integer,
          coalesce((v_payload ->> 'is_fixed_time')::boolean, false),
          coalesce((v_payload ->> 'splittable')::boolean, true),
          v_payload ->> 'recurrence_rule',
          (v_payload ->> 'recurrence_series_id')::uuid,
          (v_payload ->> 'recurrence_occurrence_at')::timestamptz(3),
          coalesce((v_payload ->> 'source')::public.task_source, 'manual'),
          v_payload ->> 'source_text',
          coalesce((v_payload ->> 'position')::integer, 0),
          coalesce((v_payload ->> 'created_at')::timestamptz(3), clock_timestamp()),
          coalesce((v_payload ->> 'updated_at')::timestamptz(3), clock_timestamp()),
          (v_payload ->> 'completed_at')::timestamptz(3),
          (v_payload ->> 'archived_at')::timestamptz(3)
        )
        returning id into v_id;

        v_created_tasks := v_created_tasks || v_id;
        v_applied := v_applied + 1;

      -- ------------------------------------------------------ update_task
      when 'update_task' then
        v_id := (v_mutation ->> 'id')::uuid;
        v_patch := v_mutation -> 'patch';
        v_expected := (v_mutation ->> 'expected_updated_at')::timestamptz(3);

        -- `for update` takes the row lock before the comparison, so a
        -- concurrent writer cannot slip between the check and the write.
        select updated_at into v_actual
        from public.tasks
        where id = v_id and user_id = v_uid
        for update;

        if v_actual is null then
          v_rejected := v_rejected || jsonb_build_object(
            'index', v_index, 'kind', v_kind, 'reason', 'That task no longer exists.'
          );
        elsif v_expected is not null and v_actual <> v_expected then
          v_rejected := v_rejected || jsonb_build_object(
            'index', v_index, 'kind', v_kind,
            'reason', 'That task changed somewhere else. Reload to see the latest version.'
          );
        else
          -- `p_patch ? 'column'` distinguishes "not mentioned" from "set to
          -- null". Clearing a deadline and leaving it alone are different
          -- intents, and a `coalesce` would collapse them into one.
          update public.tasks t set
            goal_id = case when v_patch ? 'goal_id' then (v_patch ->> 'goal_id')::uuid else t.goal_id end,
            title = case when v_patch ? 'title' then v_patch ->> 'title' else t.title end,
            notes = case when v_patch ? 'notes' then v_patch ->> 'notes' else t.notes end,
            status = case when v_patch ? 'status' then (v_patch ->> 'status')::public.task_status else t.status end,
            manual_priority = case when v_patch ? 'manual_priority' then (v_patch ->> 'manual_priority')::public.manual_priority else t.manual_priority end,
            importance = case when v_patch ? 'importance' then (v_patch ->> 'importance')::smallint else t.importance end,
            energy = case when v_patch ? 'energy' then (v_patch ->> 'energy')::public.energy_level else t.energy end,
            due_at = case when v_patch ? 'due_at' then (v_patch ->> 'due_at')::timestamptz(3) else t.due_at end,
            scheduled_start = case when v_patch ? 'scheduled_start' then (v_patch ->> 'scheduled_start')::timestamptz(3) else t.scheduled_start end,
            scheduled_end = case when v_patch ? 'scheduled_end' then (v_patch ->> 'scheduled_end')::timestamptz(3) else t.scheduled_end end,
            duration_minutes = case when v_patch ? 'duration_minutes' then (v_patch ->> 'duration_minutes')::integer else t.duration_minutes end,
            actual_minutes = case when v_patch ? 'actual_minutes' then (v_patch ->> 'actual_minutes')::integer else t.actual_minutes end,
            is_fixed_time = case when v_patch ? 'is_fixed_time' then (v_patch ->> 'is_fixed_time')::boolean else t.is_fixed_time end,
            splittable = case when v_patch ? 'splittable' then (v_patch ->> 'splittable')::boolean else t.splittable end,
            recurrence_rule = case when v_patch ? 'recurrence_rule' then v_patch ->> 'recurrence_rule' else t.recurrence_rule end,
            recurrence_series_id = case when v_patch ? 'recurrence_series_id' then (v_patch ->> 'recurrence_series_id')::uuid else t.recurrence_series_id end,
            recurrence_occurrence_at = case when v_patch ? 'recurrence_occurrence_at' then (v_patch ->> 'recurrence_occurrence_at')::timestamptz(3) else t.recurrence_occurrence_at end,
            position = case when v_patch ? 'position' then (v_patch ->> 'position')::integer else t.position end,
            source_text = case when v_patch ? 'source_text' then v_patch ->> 'source_text' else t.source_text end,
            completed_at = case when v_patch ? 'completed_at' then (v_patch ->> 'completed_at')::timestamptz(3) else t.completed_at end,
            archived_at = case when v_patch ? 'archived_at' then (v_patch ->> 'archived_at')::timestamptz(3) else t.archived_at end
          where t.id = v_id and t.user_id = v_uid;

          v_applied := v_applied + 1;
        end if;

      -- ------------------------------------------------------ delete_task
      when 'delete_task' then
        v_id := (v_mutation ->> 'id')::uuid;
        delete from public.tasks where id = v_id and user_id = v_uid;
        if found then
          v_applied := v_applied + 1;
        else
          v_rejected := v_rejected || jsonb_build_object(
            'index', v_index, 'kind', v_kind, 'reason', 'That task no longer exists.'
          );
        end if;

      -- ------------------------------------------------------ create_goal
      when 'create_goal' then
        v_payload := v_mutation -> 'goal';
        insert into public.goals (
          id, user_id, title, description, category, priority_weight,
          target_date, weekly_target_minutes, status, color, created_at, updated_at
        )
        values (
          coalesce((v_payload ->> 'id')::uuid, gen_random_uuid()),
          v_uid,
          v_payload ->> 'title',
          v_payload ->> 'description',
          coalesce((v_payload ->> 'category')::public.goal_category, 'custom'),
          coalesce((v_payload ->> 'priority_weight')::smallint, 3),
          (v_payload ->> 'target_date')::date,
          (v_payload ->> 'weekly_target_minutes')::integer,
          coalesce((v_payload ->> 'status')::public.goal_status, 'active'),
          coalesce((v_payload ->> 'color')::public.goal_color, 'cobalt'),
          coalesce((v_payload ->> 'created_at')::timestamptz(3), clock_timestamp()),
          coalesce((v_payload ->> 'updated_at')::timestamptz(3), clock_timestamp())
        )
        returning id into v_id;

        v_created_goals := v_created_goals || v_id;
        v_applied := v_applied + 1;

      -- ------------------------------------------------------ update_goal
      when 'update_goal' then
        v_id := (v_mutation ->> 'id')::uuid;
        v_patch := v_mutation -> 'patch';
        v_expected := (v_mutation ->> 'expected_updated_at')::timestamptz(3);

        select updated_at into v_actual
        from public.goals
        where id = v_id and user_id = v_uid
        for update;

        if v_actual is null then
          v_rejected := v_rejected || jsonb_build_object(
            'index', v_index, 'kind', v_kind, 'reason', 'That goal no longer exists.'
          );
        elsif v_expected is not null and v_actual <> v_expected then
          v_rejected := v_rejected || jsonb_build_object(
            'index', v_index, 'kind', v_kind,
            'reason', 'That goal changed somewhere else. Reload to see the latest version.'
          );
        else
          update public.goals g set
            title = case when v_patch ? 'title' then v_patch ->> 'title' else g.title end,
            description = case when v_patch ? 'description' then v_patch ->> 'description' else g.description end,
            category = case when v_patch ? 'category' then (v_patch ->> 'category')::public.goal_category else g.category end,
            priority_weight = case when v_patch ? 'priority_weight' then (v_patch ->> 'priority_weight')::smallint else g.priority_weight end,
            target_date = case when v_patch ? 'target_date' then (v_patch ->> 'target_date')::date else g.target_date end,
            weekly_target_minutes = case when v_patch ? 'weekly_target_minutes' then (v_patch ->> 'weekly_target_minutes')::integer else g.weekly_target_minutes end,
            status = case when v_patch ? 'status' then (v_patch ->> 'status')::public.goal_status else g.status end,
            color = case when v_patch ? 'color' then (v_patch ->> 'color')::public.goal_color else g.color end
          where g.id = v_id and g.user_id = v_uid;

          v_applied := v_applied + 1;
        end if;

      -- -------------------------------------------------------- log_event
      when 'log_event' then
        v_payload := v_mutation -> 'event';
        insert into public.activity_events (
          id, user_id, task_id, event_type, occurred_at, duration_minutes, metadata
        )
        values (
          coalesce((v_payload ->> 'id')::uuid, gen_random_uuid()),
          v_uid,
          (v_payload ->> 'task_id')::uuid,
          (v_payload ->> 'event_type')::public.activity_event_type,
          coalesce((v_payload ->> 'occurred_at')::timestamptz(3), clock_timestamp()),
          (v_payload ->> 'duration_minutes')::integer,
          coalesce(v_payload -> 'metadata', '{}'::jsonb)
        );
        v_applied := v_applied + 1;

      else
        raise exception 'Unknown mutation kind: %', coalesce(v_kind, 'null')
          using errcode = '22023';
    end case;

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object(
    'applied_count', v_applied,
    'created_task_ids', to_jsonb(v_created_tasks),
    'created_goal_ids', to_jsonb(v_created_goals),
    'rejected', v_rejected
  );
end;
$$;

comment on function public.momentum_apply_mutations(jsonb) is
  'Applies an ordered batch of planner writes in one transaction. Returns a report of applied and rejected items.';

-- ----------------------------------------------------------------------------
-- momentum_save_plan
--
-- Replaces the plan for one day. The delete-then-insert is safe here precisely
-- because it is one transaction: no reader ever observes the intermediate
-- state where the day has been emptied but not refilled.
--
-- Locked blocks need no special handling. The scheduler receives them as fixed
-- commitments and re-emits them in the new schedule, so a full replace
-- preserves them by construction rather than by a carve-out that could drift
-- out of sync with the scheduler's own behaviour.
-- ----------------------------------------------------------------------------

create or replace function public.momentum_save_plan(p_plan jsonb, p_blocks jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan_id uuid;
  v_plan_date date;
  v_block jsonb;
  v_position integer := 0;
  v_plan_row jsonb;
  v_block_rows jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'Expected an array of blocks.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_blocks) > 200 then
    raise exception 'That day has too many blocks.' using errcode = '22023';
  end if;

  v_plan_date := (p_plan ->> 'plan_date')::date;

  -- One plan per (user, day), so regenerating updates in place and keeps the
  -- original `generated_at` only if the caller sent it.
  insert into public.daily_plans (
    user_id, plan_date, timezone, available_minutes, scheduled_minutes,
    score_version, generated_at
  )
  values (
    v_uid,
    v_plan_date,
    p_plan ->> 'timezone',
    coalesce((p_plan ->> 'available_minutes')::integer, 0),
    coalesce((p_plan ->> 'scheduled_minutes')::integer, 0),
    p_plan ->> 'score_version',
    coalesce((p_plan ->> 'generated_at')::timestamptz(3), clock_timestamp())
  )
  on conflict (user_id, plan_date) do update set
    timezone = excluded.timezone,
    available_minutes = excluded.available_minutes,
    scheduled_minutes = excluded.scheduled_minutes,
    score_version = excluded.score_version,
    generated_at = excluded.generated_at
  returning id into v_plan_id;

  -- Blocks are wholly derived from the schedule, so the previous set is
  -- discarded rather than diffed. Diffing would add a merge algorithm with no
  -- user-visible benefit.
  delete from public.plan_blocks where daily_plan_id = v_plan_id and user_id = v_uid;

  for v_block in select value from jsonb_array_elements(p_blocks)
  loop
    insert into public.plan_blocks (
      user_id, daily_plan_id, task_id, title, start_at, end_at,
      block_type, is_locked, position
    )
    values (
      v_uid,
      v_plan_id,
      (v_block ->> 'task_id')::uuid,
      v_block ->> 'title',
      (v_block ->> 'start_at')::timestamptz(3),
      (v_block ->> 'end_at')::timestamptz(3),
      coalesce((v_block ->> 'block_type')::public.block_type, 'task'),
      coalesce((v_block ->> 'is_locked')::boolean, false),
      coalesce((v_block ->> 'position')::integer, v_position)
    );
    v_position := v_position + 1;
  end loop;

  select to_jsonb(p) into v_plan_row
  from public.daily_plans p
  where p.id = v_plan_id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.start_at, b.position), '[]'::jsonb)
  into v_block_rows
  from public.plan_blocks b
  where b.daily_plan_id = v_plan_id;

  return jsonb_build_object('plan', v_plan_row, 'blocks', v_block_rows);
end;
$$;

comment on function public.momentum_save_plan(jsonb, jsonb) is
  'Atomically replaces the daily plan and its blocks for one calendar day.';

-- ----------------------------------------------------------------------------
-- momentum_snapshot
--
-- One round trip for a page load. The alternative — eight parallel PostgREST
-- requests — costs eight JWT verifications and eight connection checkouts, and
-- returns a set of rows read at eight slightly different instants. This reads
-- them all in one transaction, so the UI renders a consistent view.
-- ----------------------------------------------------------------------------

create or replace function public.momentum_snapshot(p_day date, p_event_days integer default 60)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan jsonb;
  v_plan_id uuid;
  v_since timestamptz(3);
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Analytics only ever look at a trailing window, so the event log is
  -- windowed at the source instead of shipping an ever-growing history to the
  -- browser on every page load.
  v_since := clock_timestamp() - make_interval(days => greatest(coalesce(p_event_days, 60), 1));

  select to_jsonb(p), p.id into v_plan, v_plan_id
  from public.daily_plans p
  where p.user_id = v_uid and p.plan_date = p_day;

  return jsonb_build_object(
    'profile', (select to_jsonb(pr) from public.profiles pr where pr.id = v_uid),
    'goals', (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.priority_weight desc, g.created_at), '[]'::jsonb)
      from public.goals g where g.user_id = v_uid
    ),
    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.position, t.created_at), '[]'::jsonb)
      from public.tasks t
      where t.user_id = v_uid
        -- Archived work is excluded from the working set but still reachable
        -- through its own view; carrying it here would grow every page load
        -- forever.
        and t.archived_at is null
    ),
    'dependencies', (
      select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
      from public.task_dependencies d where d.user_id = v_uid
    ),
    'plan', v_plan,
    'blocks', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.start_at, b.position), '[]'::jsonb)
      from public.plan_blocks b
      where b.user_id = v_uid and v_plan_id is not null and b.daily_plan_id = v_plan_id
    ),
    'events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc), '[]'::jsonb)
      from public.activity_events e
      where e.user_id = v_uid and e.occurred_at >= v_since
    ),
    'focus_session', (
      select to_jsonb(f) from public.focus_sessions f where f.user_id = v_uid
    )
  );
end;
$$;

comment on function public.momentum_snapshot(date, integer) is
  'Returns everything the planner UI needs for one day in a single consistent read.';

grant execute on function public.momentum_apply_mutations(jsonb) to authenticated;
grant execute on function public.momentum_save_plan(jsonb, jsonb) to authenticated;
grant execute on function public.momentum_snapshot(date, integer) to authenticated;
