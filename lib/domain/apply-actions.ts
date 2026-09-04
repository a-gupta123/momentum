/**
 * Turns confirmed assistant actions into primitive repository mutations.
 *
 * This module is pure and adapter-agnostic, which is the whole point: the
 * *semantics* of "apply this batch" are defined once and unit-tested once, while
 * each repository only has to know how to run a list of mutations atomically.
 *
 * The AI never reaches this code with authority — it reaches it with a proposal
 * that has already passed the Zod schema and the id-existence check, and whose
 * destructive members the user has explicitly confirmed.
 */
import { addMinutesTo, parseIso, toIso } from '@/lib/dates';
import { newId } from '@/lib/domain/ids';
import { normalizeRecurrenceRule } from '@/lib/domain/recurrence';
import type {
  ActivityEvent,
  Goal,
  GoalColorToken,
  Importance,
  IsoDateTime,
  PriorityWeight,
  Profile,
  Task,
} from '@/lib/domain/types';
import { GOAL_COLOR_TOKENS } from '@/lib/domain/types';
import type { Mutation, UpdateGoalInput, UpdateTaskInput } from '@/lib/repositories/types';
import type { AssistantAction, OptimizeDayAction } from '@/lib/validation/ai-actions';

export interface ApplyContext {
  profile: Profile;
  tasks: readonly Task[];
  goals: readonly Goal[];
  now: Date;
  /** Verbatim user input, stored on created tasks for audit and explanation. */
  sourceText: string;
  /** Injectable for deterministic tests. */
  generateId?: () => string;
}

export interface PlannedMutations {
  mutations: Mutation[];
  /**
   * `optimize_day` cannot be a blind write: it needs the scheduler and a
   * before/after preview. It is handed back to the caller to run through the
   * normal Optimize Day flow instead of being applied silently.
   */
  deferred: OptimizeDayAction[];
  /** Actions that produce no write, e.g. `clarify`. */
  skipped: Array<{ index: number; type: AssistantAction['type']; reason: string }>;
}

/**
 * Plans the writes for a batch of actions.
 *
 * Created tasks are appended after the current maximum position so a brain dump
 * lands at the end of the queue in the order the user typed it.
 */
export function planMutations(
  actions: readonly AssistantAction[],
  context: ApplyContext,
): PlannedMutations {
  const generateId = context.generateId ?? newId;
  const nowIso = toIso(context.now);
  const userId = context.profile.id;
  const taskById = new Map(context.tasks.map((task) => [task.id, task]));
  const goalById = new Map(context.goals.map((goal) => [goal.id, goal]));

  const mutations: Mutation[] = [];
  const deferred: OptimizeDayAction[] = [];
  const skipped: PlannedMutations['skipped'] = [];

  let nextPosition =
    context.tasks.reduce((max, task) => Math.max(max, task.position), 0) + 1;

  const logEvent = (
    eventType: ActivityEvent['eventType'],
    taskId: string | null,
    metadata: ActivityEvent['metadata'] = {},
  ): void => {
    mutations.push({
      kind: 'log_event',
      event: {
        id: generateId(),
        userId,
        taskId,
        eventType,
        occurredAt: nowIso,
        durationMinutes: null,
        metadata,
      },
    });
  };

  actions.forEach((action, index) => {
    switch (action.type) {
      case 'create_task': {
        const duration =
          action.durationMinutes ?? context.profile.defaultTaskDurationMinutes;
        const scheduledStart = parseIso(action.scheduledStart);
        const task: Task = {
          id: generateId(),
          userId,
          goalId: action.goalId,
          parentTaskId: null,
          title: action.title.trim(),
          notes: action.notes,
          status: scheduledStart ? 'planned' : 'inbox',
          manualPriority: action.manualPriority ?? 'normal',
          importance: (action.importance ?? 3) as Importance,
          energy: action.energy ?? 'medium',
          dueAt: action.dueAt,
          scheduledStart: action.scheduledStart,
          scheduledEnd: scheduledStart
            ? toIso(addMinutesTo(scheduledStart, duration))
            : null,
          durationMinutes: duration,
          actualMinutes: null,
          isFixedTime: action.isFixedTime,
          // A fixed commitment is never split; otherwise respect the proposal.
          splittable: action.isFixedTime ? false : (action.splittable ?? duration > 90),
          recurrenceRule: normalizeRecurrenceRule(action.recurrenceRule),
          recurrenceSeriesId: null,
          recurrenceOccurrenceAt: null,
          source: 'natural_language',
          sourceText: context.sourceText.slice(0, 2000),
          position: nextPosition,
          createdAt: nowIso,
          updatedAt: nowIso,
          completedAt: null,
          archivedAt: null,
        };
        nextPosition += 1;

        // A recurring task is the first occurrence of its own series.
        if (task.recurrenceRule) {
          task.recurrenceSeriesId = task.id;
          task.recurrenceOccurrenceAt = task.dueAt ?? task.scheduledStart ?? nowIso;
        }

        mutations.push({ kind: 'create_task', task });
        logEvent('task_created', task.id, { source: 'natural_language' });
        break;
      }

      case 'update_task': {
        const existing = taskById.get(action.taskId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That task no longer exists.' });
          break;
        }

        const patch: UpdateTaskInput = {};
        if (action.title !== null) patch.title = action.title.trim();
        if (action.notes !== null) patch.notes = action.notes;
        if (action.manualPriority !== null) patch.manualPriority = action.manualPriority;
        if (action.importance !== null) patch.importance = action.importance as Importance;
        if (action.energy !== null) patch.energy = action.energy;
        if (action.goalId !== null) patch.goalId = action.goalId;
        if (action.status !== null) patch.status = action.status;
        if (action.durationMinutes !== null) patch.durationMinutes = action.durationMinutes;

        // `null` means "unchanged", so removing a value needs an explicit flag.
        if (action.clearDueAt) patch.dueAt = null;
        else if (action.dueAt !== null) patch.dueAt = action.dueAt;

        if (action.clearSchedule) {
          patch.scheduledStart = null;
          patch.scheduledEnd = null;
          if (existing.status === 'planned') patch.status = 'inbox';
        }

        mutations.push({
          kind: 'update_task',
          id: existing.id,
          patch,
          expectedUpdatedAt: existing.updatedAt,
        });
        logEvent('task_updated', existing.id, { via: 'natural_language' });
        break;
      }

      case 'complete_task': {
        const existing = taskById.get(action.taskId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That task no longer exists.' });
          break;
        }
        if (existing.status === 'completed') {
          skipped.push({ index, type: action.type, reason: 'Already completed.' });
          break;
        }
        mutations.push({
          kind: 'update_task',
          id: existing.id,
          patch: { status: 'completed', completedAt: nowIso },
          expectedUpdatedAt: existing.updatedAt,
        });
        logEvent('task_completed', existing.id, { via: 'natural_language' });
        break;
      }

      case 'delete_task': {
        const existing = taskById.get(action.taskId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That task no longer exists.' });
          break;
        }
        mutations.push({ kind: 'delete_task', id: existing.id });
        logEvent('task_deleted', null, { title: existing.title.slice(0, 60) });
        break;
      }

      case 'schedule_task': {
        const existing = taskById.get(action.taskId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That task no longer exists.' });
          break;
        }
        const start = parseIso(action.scheduledStart);
        if (!start) {
          skipped.push({ index, type: action.type, reason: 'The start time was unreadable.' });
          break;
        }
        const duration = action.durationMinutes ?? existing.durationMinutes;
        mutations.push({
          kind: 'update_task',
          id: existing.id,
          patch: {
            scheduledStart: toIso(start),
            scheduledEnd: toIso(addMinutesTo(start, duration)),
            durationMinutes: duration,
            status: existing.status === 'inbox' ? 'planned' : existing.status,
          },
          expectedUpdatedAt: existing.updatedAt,
        });
        logEvent('task_scheduled', existing.id, { via: 'natural_language' });
        break;
      }

      case 'reschedule_task': {
        const existing = taskById.get(action.taskId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That task no longer exists.' });
          break;
        }
        const patch: UpdateTaskInput = {};
        const start = parseIso(action.scheduledStart);
        if (start) {
          patch.scheduledStart = toIso(start);
          patch.scheduledEnd = toIso(addMinutesTo(start, existing.durationMinutes));
          if (existing.status === 'inbox') patch.status = 'planned';
        }
        if (action.dueAt !== null) patch.dueAt = action.dueAt;

        if (!start && action.dueAt === null) {
          skipped.push({ index, type: action.type, reason: 'Nothing to move.' });
          break;
        }

        mutations.push({
          kind: 'update_task',
          id: existing.id,
          patch,
          expectedUpdatedAt: existing.updatedAt,
        });
        logEvent('task_scheduled', existing.id, { via: 'natural_language' });
        break;
      }

      case 'create_goal': {
        const goal: Goal = {
          id: generateId(),
          userId,
          title: action.title.trim(),
          description: action.description,
          category: action.category,
          priorityWeight: action.priorityWeight as PriorityWeight,
          targetDate: action.targetDate,
          weeklyTargetMinutes: action.weeklyTargetMinutes,
          status: 'active',
          color: pickGoalColor(context.goals.length + mutations.length),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        mutations.push({ kind: 'create_goal', goal });
        logEvent('goal_created', null, { title: goal.title.slice(0, 60) });
        break;
      }

      case 'update_goal': {
        const existing = goalById.get(action.goalId);
        if (!existing) {
          skipped.push({ index, type: action.type, reason: 'That goal no longer exists.' });
          break;
        }
        const patch: UpdateGoalInput = {};
        if (action.title !== null) patch.title = action.title.trim();
        if (action.description !== null) patch.description = action.description;
        if (action.category !== null) patch.category = action.category;
        if (action.priorityWeight !== null) {
          patch.priorityWeight = action.priorityWeight as PriorityWeight;
        }
        if (action.targetDate !== null) patch.targetDate = action.targetDate;
        if (action.weeklyTargetMinutes !== null) {
          patch.weeklyTargetMinutes = action.weeklyTargetMinutes;
        }
        if (action.status !== null) patch.status = action.status;

        mutations.push({
          kind: 'update_goal',
          id: existing.id,
          patch,
          expectedUpdatedAt: existing.updatedAt,
        });
        logEvent('goal_updated', null, { goalId: existing.id });
        break;
      }

      case 'optimize_day': {
        deferred.push(action);
        break;
      }

      case 'clarify': {
        skipped.push({
          index,
          type: action.type,
          reason: 'Needs a detail before anything can be saved.',
        });
        break;
      }
    }
  });

  return { mutations, deferred, skipped };
}

/** Cycles through the accessible palette so new goals stay visually distinct. */
function pickGoalColor(seed: number): GoalColorToken {
  const index = Math.abs(seed) % GOAL_COLOR_TOKENS.length;
  return GOAL_COLOR_TOKENS[index] ?? 'cobalt';
}

/**
 * Human-readable one-liner for a planned mutation, used by the Undo toast and
 * the apply-result summary.
 */
export function describeMutation(mutation: Mutation): string {
  switch (mutation.kind) {
    case 'create_task':
      return `Added “${mutation.task.title}”`;
    case 'update_task':
      return 'Updated a task';
    case 'delete_task':
      return 'Deleted a task';
    case 'create_goal':
      return `Added the goal “${mutation.goal.title}”`;
    case 'update_goal':
      return 'Updated a goal';
    case 'log_event':
      return 'Recorded activity';
  }
}

/** Counts only the mutations a user would recognize as a change. */
export function countUserVisibleMutations(mutations: readonly Mutation[]): number {
  return mutations.filter((mutation) => mutation.kind !== 'log_event').length;
}

export type { IsoDateTime };
