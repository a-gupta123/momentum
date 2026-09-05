'use client';

/**
 * The planner store.
 *
 * One provider owns the snapshot, every write, and the derived views the UI
 * renders from. A few decisions here shape the whole client:
 *
 * **Repository behind an interface.** The provider is handed a mode and builds
 * either the localStorage adapter or the Supabase one. Nothing below this file
 * knows which is in use, which is why Guest Demo is a real mode rather than a
 * mock — the same components, the same domain engines, the same code paths.
 *
 * **Read-after-write instead of a client cache.** Every mutation re-reads the
 * snapshot. For the local adapter that is synchronous work on an in-memory
 * object; for Supabase it is one RPC. The alternative — maintaining a
 * normalized client cache and patching it per mutation — means every write
 * needs a hand-written reducer that must agree with what the repository
 * actually did, and the two drift. Re-reading makes the repository the single
 * source of truth by construction.
 *
 * **Optimistic overlay for the one action that must feel instant.** Ticking a
 * checkbox has to respond within a frame or the product feels slow. So writes
 * can supply an optimistic transform applied immediately and rolled back if the
 * write fails. The overlay is a whole-snapshot function rather than a patch,
 * which keeps derived values (ranking, schedule, progress) consistent with it.
 *
 * **Repository construction happens after mount.** The local adapter reads
 * localStorage, which does not exist during server rendering. Building it in an
 * effect means the server and the first client render agree on a loading state,
 * so there is no hydration mismatch to paper over.
 */
import * as React from 'react';
import { toast } from 'sonner';

import { useMinuteNow } from '@/components/hooks/use-clock';
import { detectTimezone, safeTimezone, todayKey } from '@/lib/dates';
import {
  computeBlockedTasks,
  rankTasks,
  selectRankableTasks,
  type RankedTask,
} from '@/lib/domain/priority';
import { DAILY_THREE_COUNT } from '@/lib/domain/tuning';
import type {
  DayKey,
  FocusSession,
  Goal,
  PlannerSnapshot,
  Profile,
  Task,
} from '@/lib/domain/types';
import { LocalPlannerRepository } from '@/lib/repositories/local';
import { SupabasePlannerRepository } from '@/lib/repositories/supabase';
import {
  StaleWriteError,
  type CreateGoalInput,
  type CreateTaskInput,
  type InverseOperation,
  type PlannerRepository,
  type UpdateGoalInput,
  type UpdateTaskInput,
} from '@/lib/repositories/types';
import { getBrowserSupabase } from '@/lib/supabase/client';
import type { RuntimeCapabilities } from '@/lib/validation/env';

export type PlannerMode = 'guest' | 'supabase';
export type PlannerStatus = 'loading' | 'ready' | 'error';

/** A reversible batch, held only long enough for the Undo toast to matter. */
interface UndoEntry {
  label: string;
  operations: InverseOperation[];
}

export interface PlannerStore {
  mode: PlannerMode;
  status: PlannerStatus;
  /** Present once `status === 'ready'`. */
  snapshot: PlannerSnapshot | null;
  error: string | null;
  /** True while a write is in flight, for disabling double-submits. */
  isMutating: boolean;
  /** False when guest writes are session-only (private window, full quota). */
  isDurable: boolean;
  capabilities: RuntimeCapabilities;

  /** The day the planner is showing, in the profile's timezone. */
  dayKey: DayKey;
  setDayKey: (day: DayKey) => void;
  /** Today in the profile's timezone, recomputed as the clock crosses midnight. */
  today: DayKey;
  timezone: string;

  profile: Profile | null;
  tasks: readonly Task[];
  goals: readonly Goal[];
  goalsById: ReadonlyMap<string, Goal>;
  /** Task id → the prerequisite ids still blocking it. */
  blockedTaskIds: ReadonlyMap<string, string[]>;
  /** Every active, unblocked, non-fixed task in score order. */
  ranked: readonly RankedTask[];
  /** The three highest-value tasks, the ones the day is really about. */
  dailyThree: readonly RankedTask[];

  refresh: () => Promise<void>;

  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<Task | null>;
  deleteTask: (id: string) => Promise<boolean>;
  archiveTask: (id: string) => Promise<boolean>;
  duplicateTask: (id: string) => Promise<Task | null>;
  completeTask: (id: string, actualMinutes?: number | null) => Promise<boolean>;
  uncompleteTask: (id: string) => Promise<boolean>;
  reorderTasks: (orderedIds: readonly string[]) => Promise<boolean>;

  createGoal: (input: CreateGoalInput) => Promise<Goal | null>;
  updateGoal: (id: string, patch: UpdateGoalInput) => Promise<Goal | null>;
  archiveGoal: (id: string) => Promise<boolean>;

  addDependency: (taskId: string, dependsOnTaskId: string) => Promise<boolean>;
  removeDependency: (taskId: string, dependsOnTaskId: string) => Promise<boolean>;

  updateProfile: (patch: Partial<Profile>) => Promise<Profile | null>;
  setFocusSession: (session: FocusSession | null) => Promise<void>;
  resetDemoData: () => Promise<void>;

  /** Escape hatch for flows that need the adapter directly (assistant, planner). */
  repository: PlannerRepository | null;
  /** Registers a reversible batch so the caller can offer Undo. */
  pushUndo: (label: string, operations: InverseOperation[]) => void;
  undo: () => Promise<void>;
  canUndo: boolean;
}

const PlannerContext = React.createContext<PlannerStore | null>(null);

export interface PlannerProviderProps {
  mode: PlannerMode;
  /** Required for `mode === 'supabase'`. */
  userId?: string | null;
  capabilities: RuntimeCapabilities;
  children: React.ReactNode;
}

export function PlannerProvider({ mode, userId, capabilities, children }: PlannerProviderProps) {
  const [repository, setRepository] = React.useState<PlannerRepository | null>(null);
  const [snapshot, setSnapshot] = React.useState<PlannerSnapshot | null>(null);
  const [status, setStatus] = React.useState<PlannerStatus>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [isMutating, setIsMutating] = React.useState(false);
  const [isDurable, setIsDurable] = React.useState(true);

  /**
   * The pending undo lives in a ref, with state only mirroring whether one
   * exists.
   *
   * `undo` is handed to toast actions, which capture it at the moment the toast
   * is created — immediately after the batch was registered. Reading the entry
   * from state would give those closures the value from *before* registration,
   * so Undo would silently do nothing. The ref keeps `undo` stable and always
   * reading the current entry.
   */
  const undoRef = React.useRef<UndoEntry | null>(null);
  const [canUndo, setCanUndo] = React.useState(false);

  // Detected before the profile loads, then replaced by the stored preference.
  // The planner needs *a* timezone to know which day to request in the first
  // place, and the browser's guess is the best available answer at that point.
  const [fallbackTimezone] = React.useState(() => detectTimezone());
  const timezone = safeTimezone(snapshot?.profile.timezone ?? fallbackTimezone);

  /**
   * `today` is derived from the clock, not stored.
   *
   * It used to be state kept honest by two effects — one ticking to catch
   * midnight, one re-resolving when the timezone changed — which left a window
   * where the day heading disagreed with the clock, and a laptop waking in a
   * new timezone showed yesterday until the next tick. As a derived value it
   * cannot be stale by construction.
   */
  const nowMs = useMinuteNow();
  const today = React.useMemo(
    // Before hydration the clock reports nothing. The value is unused then —
    // the planner renders a skeleton until the repository resolves — but it
    // still has to be *a* day, and the browser's guess is the best available.
    () => (nowMs === null ? todayKey(fallbackTimezone) : todayKey(timezone, new Date(nowMs))),
    [nowMs, timezone, fallbackTimezone],
  );

  /**
   * The day the user pinned, or `null` while they are following today.
   *
   * Storing the *pin* rather than the selected day is what makes the midnight
   * rollover free: an unpinned planner reads `today` directly, so it advances
   * on its own with no code that has to remember to move it.
   */
  const [pinnedDay, setPinnedDay] = React.useState<DayKey | null>(null);
  const dayKey = pinnedDay ?? today;

  // --- Repository construction ----------------------------------------------

  React.useEffect(() => {
    let cancelled = false;

    async function build(): Promise<void> {
      try {
        if (mode === 'supabase') {
          const client = getBrowserSupabase();
          if (!client || !userId) {
            throw new Error('This deployment is not configured for accounts.');
          }
          const supabaseRepository = new SupabasePlannerRepository({
            client,
            userId,
            timezone: fallbackTimezone,
          });
          if (!cancelled) setRepository(supabaseRepository);
          return;
        }

        const localRepository = new LocalPlannerRepository({
          timezone: fallbackTimezone,
          // Surfaced as a warning toast rather than an error: a guest whose
          // browser refuses to persist should still get a working session.
          onWarning: (message) => toast.warning(message),
        });
        if (!cancelled) {
          setIsDurable(localRepository.isDurable);
          setRepository(localRepository);
        }
      } catch (buildError) {
        if (cancelled) return;
        setStatus('error');
        setError(
          buildError instanceof Error ? buildError.message : 'The planner could not be started.',
        );
      }
    }

    void build();
    return () => {
      cancelled = true;
    };
  }, [mode, userId, fallbackTimezone]);

  // --- Loading ---------------------------------------------------------------

  const load = React.useCallback(
    async (
      repo: PlannerRepository,
      day: DayKey,
      /** Reports whether this request has been superseded. */
      isStale: () => boolean = () => false,
    ): Promise<void> => {
      try {
        const next = await repo.getSnapshot(day);
        // A snapshot for a day the user has already left must not overwrite a
        // newer one. Without this check, stepping quickly across days settles
        // on whichever request happened to resolve last rather than the one
        // that was asked for last.
        if (isStale()) return;
        setSnapshot(next);
        setStatus('ready');
        setError(null);
      } catch (loadError) {
        if (isStale()) return;
        setStatus('error');
        setError(
          loadError instanceof Error ? loadError.message : 'Your planner could not be loaded.',
        );
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!repository) return;

    let cancelled = false;
    // Wrapped in an async thunk so nothing sets state during the synchronous
    // part of the effect: the first update cannot happen until the repository
    // has actually answered.
    void (async () => {
      await load(repository, dayKey, () => cancelled);
    })();

    return () => {
      cancelled = true;
    };
  }, [repository, dayKey, load]);

  const refresh = React.useCallback(async () => {
    if (!repository) return;
    await load(repository, dayKey);
  }, [repository, dayKey, load]);

  // Selecting today is recorded as "not pinned" rather than as a pin on that
  // date, so the planner resumes following the clock across midnight.
  const selectDay = React.useCallback(
    (day: DayKey) => setPinnedDay(day === today ? null : day),
    [today],
  );

  // --- The single write path -------------------------------------------------

  /**
   * Runs one write.
   *
   * Every mutation in the app goes through here so that optimistic rollback,
   * error reporting and post-write refresh are implemented once. Returning
   * `null`/`false` on failure rather than throwing keeps call sites in
   * components free of try/catch around what are, from the user's point of
   * view, recoverable and already-reported problems.
   */
  const mutate = React.useCallback(
    async <T,>(options: {
      run: (repo: PlannerRepository) => Promise<T>;
      /** Applied immediately; reverted automatically if the write fails. */
      optimistic?: (current: PlannerSnapshot) => PlannerSnapshot;
      fallbackMessage: string;
    }): Promise<{ ok: true; value: T } | { ok: false }> => {
      if (!repository) return { ok: false };

      const previous = snapshot;
      if (options.optimistic && previous) {
        setSnapshot(options.optimistic(previous));
      }

      setIsMutating(true);
      try {
        const value = await options.run(repository);
        await load(repository, dayKey);
        return { ok: true, value };
      } catch (writeError) {
        if (options.optimistic && previous) setSnapshot(previous);

        if (writeError instanceof StaleWriteError) {
          // A conflict is recoverable and the recovery is a reload, so offer it
          // directly instead of asking the user to work out what to do.
          toast.error(writeError.message, {
            action: { label: 'Reload', onClick: () => void refresh() },
          });
        } else {
          toast.error(writeError instanceof Error ? writeError.message : options.fallbackMessage);
        }
        return { ok: false };
      } finally {
        setIsMutating(false);
        if (repository instanceof LocalPlannerRepository) {
          setIsDurable(repository.isDurable);
        }
      }
    },
    [repository, snapshot, dayKey, load, refresh],
  );

  // --- Derived views ---------------------------------------------------------

  const tasks = snapshot?.tasks ?? EMPTY_TASKS;
  const goals = snapshot?.goals ?? EMPTY_GOALS;

  const goalsById = React.useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const blockedTaskIds = React.useMemo(
    () => computeBlockedTasks(tasks, snapshot?.dependencies ?? []),
    [tasks, snapshot?.dependencies],
  );

  /**
   * Ranking is recomputed from `dayKey` rather than from a live clock.
   *
   * Scores depend on "now", and re-scoring on every render or every second
   * would make the queue reorder under the user's cursor while they read it.
   * Anchoring to the day being viewed makes the order stable for as long as the
   * user is looking at it, and any write refreshes it anyway.
   */
  const ranked = React.useMemo(() => {
    if (!snapshot) return EMPTY_RANKED;
    return rankTasks(selectRankableTasks(snapshot.tasks), {
      goalsById,
      blockedTaskIds,
      now: new Date(),
      timezone,
    });
    // `dayKey` is listed deliberately even though the body does not read it:
    // it is what re-anchors `new Date()` when the user moves to another day.
    // The clock is excluded for the reason in the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, goalsById, blockedTaskIds, timezone, dayKey]);

  /**
   * The Daily Three.
   *
   * Blocked work is excluded because a task the user cannot start today is not
   * a candidate for "the three things that matter today", however well it
   * scores. Completed work is excluded so the list does not congratulate itself.
   */
  const dailyThree = React.useMemo(
    () =>
      ranked
        .filter((entry) => !entry.score.blocked && entry.task.status !== 'completed')
        .slice(0, DAILY_THREE_COUNT),
    [ranked],
  );

  // --- Undo ------------------------------------------------------------------

  const pushUndo = React.useCallback((label: string, operations: InverseOperation[]) => {
    if (operations.length === 0) return;
    // Only the most recent batch is kept. A deeper stack would imply an undo
    // history the UI does not show, and offering to reverse a change from ten
    // actions ago is more likely to surprise than to help.
    undoRef.current = { label, operations };
    setCanUndo(true);
  }, []);

  const undo = React.useCallback(async () => {
    const entry = undoRef.current;
    if (!entry) return;

    // Cleared up front so a double-tapped Undo cannot apply the same inverse
    // batch twice.
    undoRef.current = null;
    setCanUndo(false);

    const result = await mutate({
      run: (repo) => repo.applyInverse(entry.operations),
      fallbackMessage: 'That could not be undone.',
    });

    if (result.ok) {
      toast.success(`Undid ${entry.label}.`);
    } else {
      // The write failed, so the batch is still in place and still reversible.
      undoRef.current = entry;
      setCanUndo(true);
    }
  }, [mutate]);

  // --- Public actions --------------------------------------------------------

  const store = React.useMemo<PlannerStore>(() => {
    const nowIso = new Date().toISOString();

    return {
      mode,
      status,
      snapshot,
      error,
      isMutating,
      isDurable,
      capabilities,
      dayKey,
      setDayKey: selectDay,
      today,
      timezone,
      profile: snapshot?.profile ?? null,
      tasks,
      goals,
      goalsById,
      blockedTaskIds,
      ranked,
      dailyThree,
      repository,
      refresh,
      pushUndo,
      undo,
      canUndo,

      createTask: async (input) => {
        const result = await mutate({
          run: (repo) => repo.createTask(input),
          fallbackMessage: 'That task could not be added.',
        });
        return result.ok ? result.value : null;
      },

      updateTask: async (id, patch) => {
        const result = await mutate({
          run: (repo) => repo.updateTask(id, patch, currentUpdatedAt(snapshot, id)),
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
          }),
          fallbackMessage: 'That change could not be saved.',
        });
        return result.ok ? result.value : null;
      },

      deleteTask: async (id) => {
        const result = await mutate({
          run: (repo) => repo.deleteTask(id),
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== id),
          }),
          fallbackMessage: 'That task could not be deleted.',
        });
        return result.ok;
      },

      archiveTask: async (id) => {
        const result = await mutate({
          run: (repo) => repo.archiveTask(id),
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== id),
          }),
          fallbackMessage: 'That task could not be archived.',
        });
        return result.ok;
      },

      duplicateTask: async (id) => {
        const result = await mutate({
          run: (repo) => repo.duplicateTask(id),
          fallbackMessage: 'That task could not be duplicated.',
        });
        return result.ok ? result.value : null;
      },

      completeTask: async (id, actualMinutes) => {
        const result = await mutate({
          run: (repo) => repo.completeTask(id, actualMinutes),
          // The one write where latency is unacceptable: the checkbox must
          // strike through in the same frame it was clicked.
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id ? { ...task, status: 'completed', completedAt: nowIso } : task,
            ),
          }),
          fallbackMessage: 'That task could not be completed.',
        });
        return result.ok;
      },

      uncompleteTask: async (id) => {
        const result = await mutate({
          run: (repo) => repo.uncompleteTask(id),
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === id
                ? {
                    ...task,
                    status: task.scheduledStart ? 'planned' : 'inbox',
                    completedAt: null,
                  }
                : task,
            ),
          }),
          fallbackMessage: 'That task could not be reopened.',
        });
        return result.ok;
      },

      reorderTasks: async (orderedIds) => {
        const positionById = new Map(orderedIds.map((id, index) => [id, index + 1]));
        const result = await mutate({
          run: (repo) => repo.reorderTasks(orderedIds),
          // Drag-and-drop already moved the row visually; the overlay keeps it
          // there instead of letting it snap back for one frame.
          optimistic: (current) => ({
            ...current,
            tasks: current.tasks.map((task) => {
              const position = positionById.get(task.id);
              return position === undefined ? task : { ...task, position };
            }),
          }),
          fallbackMessage: 'That new order could not be saved.',
        });
        return result.ok;
      },

      createGoal: async (input) => {
        const result = await mutate({
          run: (repo) => repo.createGoal(input),
          fallbackMessage: 'That goal could not be created.',
        });
        return result.ok ? result.value : null;
      },

      updateGoal: async (id, patch) => {
        const result = await mutate({
          run: (repo) => repo.updateGoal(id, patch, currentGoalUpdatedAt(snapshot, id)),
          optimistic: (current) => ({
            ...current,
            goals: current.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)),
          }),
          fallbackMessage: 'That goal could not be updated.',
        });
        return result.ok ? result.value : null;
      },

      archiveGoal: async (id) => {
        const result = await mutate({
          run: (repo) => repo.archiveGoal(id),
          fallbackMessage: 'That goal could not be archived.',
        });
        return result.ok;
      },

      addDependency: async (taskId, dependsOnTaskId) => {
        const result = await mutate({
          run: (repo) => repo.addDependency(taskId, dependsOnTaskId),
          fallbackMessage: 'That dependency could not be added.',
        });
        return result.ok;
      },

      removeDependency: async (taskId, dependsOnTaskId) => {
        const result = await mutate({
          run: (repo) => repo.removeDependency(taskId, dependsOnTaskId),
          fallbackMessage: 'That dependency could not be removed.',
        });
        return result.ok;
      },

      updateProfile: async (patch) => {
        const result = await mutate({
          run: (repo) => repo.updateProfile(patch),
          optimistic: (current) => ({
            ...current,
            profile: { ...current.profile, ...patch },
          }),
          fallbackMessage: 'Those settings could not be saved.',
        });
        return result.ok ? result.value : null;
      },

      setFocusSession: async (session) => {
        await mutate({
          run: (repo) => repo.setFocusSession(session),
          optimistic: (current) => ({ ...current, focusSession: session }),
          fallbackMessage: 'The focus timer could not be updated.',
        });
      },

      resetDemoData: async () => {
        const result = await mutate({
          run: (repo) => repo.resetDemoData(),
          fallbackMessage: 'The demo could not be reset.',
        });
        if (result.ok) {
          undoRef.current = null;
          setCanUndo(false);
          toast.success('Fresh demo data loaded.');
        }
      },
    };
  }, [
    mode,
    status,
    snapshot,
    error,
    isMutating,
    isDurable,
    capabilities,
    dayKey,
    selectDay,
    today,
    timezone,
    tasks,
    goals,
    goalsById,
    blockedTaskIds,
    ranked,
    dailyThree,
    repository,
    refresh,
    pushUndo,
    undo,
    canUndo,
    mutate,
  ]);

  return <PlannerContext.Provider value={store}>{children}</PlannerContext.Provider>;
}

/** Throws when used outside the provider, which is always a wiring bug. */
export function usePlanner(): PlannerStore {
  const store = React.useContext(PlannerContext);
  if (!store) {
    throw new Error('usePlanner must be used inside a PlannerProvider.');
  }
  return store;
}

/**
 * The concurrency token for a task, read from the snapshot the user is looking
 * at. Passing it with every update is what turns "last write wins" into a
 * detected conflict.
 */
function currentUpdatedAt(snapshot: PlannerSnapshot | null, id: string): string | null {
  return snapshot?.tasks.find((task) => task.id === id)?.updatedAt ?? null;
}

function currentGoalUpdatedAt(snapshot: PlannerSnapshot | null, id: string): string | null {
  return snapshot?.goals.find((goal) => goal.id === id)?.updatedAt ?? null;
}

// Stable empty references, so `useMemo` consumers do not re-run while loading.
const EMPTY_TASKS: readonly Task[] = [];
const EMPTY_GOALS: readonly Goal[] = [];
const EMPTY_RANKED: readonly RankedTask[] = [];
