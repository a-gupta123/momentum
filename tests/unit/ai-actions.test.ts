import { describe, expect, it } from 'vitest';

import {
  assistantActionSchema,
  assistantPlanSchema,
  describeActionType,
  referencedGoalId,
  referencedTaskId,
  requiresConfirmation,
  validatePlanAgainstContext,
  type AssistantAction,
  type AssistantPlan,
} from '@/lib/validation/ai-actions';
import { DOMAIN_LIMITS } from '@/lib/domain/tuning';

const base = {
  confidence: 0.9,
  interpretation: 'Add a task',
  requiresConfirmation: false,
  ambiguity: null,
};

function createTask(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'create_task',
    ...base,
    title: 'Finish the problem set',
    notes: null,
    dueAt: '2026-03-11T22:00:00.000Z',
    scheduledStart: null,
    durationMinutes: 90,
    durationInferred: false,
    manualPriority: 'high',
    importance: 5,
    energy: 'high',
    goalId: null,
    goalMatchTitle: null,
    isFixedTime: false,
    splittable: true,
    recurrenceRule: null,
    ...overrides,
  };
}

describe('schema acceptance', () => {
  it('accepts a well-formed create_task action', () => {
    expect(assistantActionSchema.safeParse(createTask()).success).toBe(true);
  });

  it('accepts a well-formed plan envelope', () => {
    const plan = { summary: 'One task', actions: [createTask()] };
    expect(assistantPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('accepts an empty action list, which is how "nothing to do" is expressed', () => {
    expect(assistantPlanSchema.safeParse({ summary: 'Nothing found', actions: [] }).success).toBe(
      true,
    );
  });
});

describe('schema rejection of malformed AI output', () => {
  it('rejects an unknown intent type', () => {
    expect(
      assistantActionSchema.safeParse({ ...base, type: 'drop_database', taskId: 'x' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    const withExtra = createTask({ sqlToRun: 'DROP TABLE tasks' });
    expect(assistantActionSchema.safeParse(withExtra).success).toBe(false);
  });

  it('rejects fields that belong to a different intent', () => {
    // A delete action has no business carrying a recurrence rule.
    const contaminated = {
      type: 'delete_task',
      ...base,
      taskId: 'task-1',
      taskTitle: null,
      recurrenceRule: 'FREQ=DAILY',
    };
    expect(assistantActionSchema.safeParse(contaminated).success).toBe(false);
  });

  it('rejects a confidence outside 0–1', () => {
    expect(assistantActionSchema.safeParse(createTask({ confidence: 1.5 })).success).toBe(false);
    expect(assistantActionSchema.safeParse(createTask({ confidence: -0.1 })).success).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(assistantActionSchema.safeParse(createTask({ dueAt: 'next Tuesday-ish' })).success).toBe(
      false,
    );
    expect(assistantActionSchema.safeParse(createTask({ dueAt: '' })).success).toBe(false);
  });

  it('rejects a duration outside the domain limits', () => {
    expect(assistantActionSchema.safeParse(createTask({ durationMinutes: 1 })).success).toBe(false);
    expect(assistantActionSchema.safeParse(createTask({ durationMinutes: 100_000 })).success).toBe(
      false,
    );
    expect(assistantActionSchema.safeParse(createTask({ durationMinutes: 45.5 })).success).toBe(
      false,
    );
  });

  it('rejects an importance outside 1–5', () => {
    expect(assistantActionSchema.safeParse(createTask({ importance: 9 })).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(assistantActionSchema.safeParse(createTask({ title: '' })).success).toBe(false);
  });

  it('rejects a title beyond the stored column length', () => {
    const tooLong = 'x'.repeat(DOMAIN_LIMITS.taskTitleMaxLength + 1);
    expect(assistantActionSchema.safeParse(createTask({ title: tooLong })).success).toBe(false);
  });

  it('rejects an omitted field rather than treating it as absent', () => {
    // Structured Outputs requires every key; `null` is how "absent" is expressed.
    const missing = createTask() as Record<string, unknown>;
    delete missing.dueAt;
    expect(assistantActionSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects a batch larger than the documented maximum', () => {
    const actions = Array.from({ length: DOMAIN_LIMITS.maxActionsPerBatch + 1 }, () =>
      createTask(),
    );
    expect(assistantPlanSchema.safeParse({ summary: 'Too many', actions }).success).toBe(false);
  });

  it('rejects a malformed target date on a goal', () => {
    const action = {
      type: 'create_goal',
      ...base,
      title: 'Ship a project',
      description: null,
      category: 'project',
      priorityWeight: 4,
      targetDate: '2026-13-45',
      weeklyTargetMinutes: null,
    };
    expect(assistantActionSchema.safeParse(action).success).toBe(false);
  });
});

describe('hallucinated identifiers', () => {
  const knownTaskId = 'task-real';
  const knownGoalId = 'goal-real';
  const known = {
    taskIds: new Set([knownTaskId]),
    goalIds: new Set([knownGoalId]),
  };

  function planWith(actions: AssistantAction[]): AssistantPlan {
    return { summary: 'test', actions };
  }

  it('drops an action that targets a task id that was never offered', () => {
    const plan = planWith([
      {
        type: 'delete_task',
        ...base,
        requiresConfirmation: true,
        taskId: 'task-invented',
        taskTitle: 'Something',
      },
    ]);

    const result = validatePlanAgainstContext(plan, known);
    expect(result.plan.actions).toHaveLength(0);
    expect(result.issues[0]?.message).toMatch(/task that does not exist/i);
  });

  it('keeps an action that targets a real task id', () => {
    const plan = planWith([
      {
        type: 'complete_task',
        ...base,
        taskId: knownTaskId,
        taskTitle: 'Real task',
      },
    ]);

    const result = validatePlanAgainstContext(plan, known);
    expect(result.plan.actions).toHaveLength(1);
    expect(result.issues).toHaveLength(0);
  });

  it('keeps the task but strips an invented goal link, since that is recoverable', () => {
    const plan = planWith([assistantActionSchema.parse(createTask({ goalId: 'goal-invented' }))]);

    const result = validatePlanAgainstContext(plan, known);
    expect(result.plan.actions).toHaveLength(1);
    const action = result.plan.actions[0];
    expect(action?.type).toBe('create_task');
    if (action?.type === 'create_task') expect(action.goalId).toBeNull();
    expect(result.issues[0]?.message).toMatch(/goal link was removed/i);
  });

  it('reports the index of each rejected action', () => {
    const plan = planWith([
      assistantActionSchema.parse(createTask()),
      {
        type: 'delete_task',
        ...base,
        requiresConfirmation: true,
        taskId: 'nope',
        taskTitle: null,
      },
    ]);

    const result = validatePlanAgainstContext(plan, known);
    expect(result.issues[0]?.index).toBe(1);
  });
});

describe('confirmation policy', () => {
  const options = { batchSize: 1, confirmAll: false };

  it('always confirms a delete, whatever the model claimed', () => {
    const action = assistantActionSchema.parse({
      type: 'delete_task',
      ...base,
      requiresConfirmation: false,
      taskId: 'task-1',
      taskTitle: null,
    });
    expect(requiresConfirmation(action, options)).toBe(true);
  });

  it('always confirms an edit to an existing record', () => {
    const action = assistantActionSchema.parse({
      type: 'update_task',
      ...base,
      requiresConfirmation: false,
      taskId: 'task-1',
      taskTitle: null,
      title: 'New title',
      notes: null,
      dueAt: null,
      durationMinutes: null,
      manualPriority: null,
      importance: null,
      energy: null,
      goalId: null,
      status: null,
      clearDueAt: false,
      clearSchedule: false,
    });
    expect(requiresConfirmation(action, options)).toBe(true);
  });

  it('does not force confirmation for a single plain task creation', () => {
    const action = assistantActionSchema.parse(createTask());
    expect(requiresConfirmation(action, options)).toBe(false);
  });

  it('confirms a large batch even when every action is a simple creation', () => {
    const action = assistantActionSchema.parse(createTask());
    expect(requiresConfirmation(action, { batchSize: 9, confirmAll: false })).toBe(true);
  });

  it('honours the model raising the requirement', () => {
    const action = assistantActionSchema.parse(createTask({ requiresConfirmation: true }));
    expect(requiresConfirmation(action, options)).toBe(true);
  });

  it('confirms everything when the user asked for that', () => {
    const action = assistantActionSchema.parse(createTask());
    expect(requiresConfirmation(action, { batchSize: 1, confirmAll: true })).toBe(true);
  });

  it('confirms a plan replacement but not a plain fill-in', () => {
    const replace = assistantActionSchema.parse({
      type: 'optimize_day',
      ...base,
      requiresConfirmation: false,
      date: '2026-03-10',
      replaceExisting: true,
    });
    const fill = assistantActionSchema.parse({
      type: 'optimize_day',
      ...base,
      requiresConfirmation: false,
      date: '2026-03-10',
      replaceExisting: false,
    });

    expect(requiresConfirmation(replace, options)).toBe(true);
    expect(requiresConfirmation(fill, options)).toBe(false);
  });
});

describe('reference helpers', () => {
  it('extracts the referenced task id only for intents that have one', () => {
    const complete = assistantActionSchema.parse({
      type: 'complete_task',
      ...base,
      taskId: 'task-9',
      taskTitle: null,
    });
    expect(referencedTaskId(complete)).toBe('task-9');
    expect(referencedTaskId(assistantActionSchema.parse(createTask()))).toBeNull();
  });

  it('extracts the referenced goal id from both task and goal intents', () => {
    const withGoal = assistantActionSchema.parse(createTask({ goalId: 'goal-2' }));
    expect(referencedGoalId(withGoal)).toBe('goal-2');
  });
});

describe('describeActionType', () => {
  it('provides a label for every intent in the union', () => {
    const types = [
      'create_task',
      'update_task',
      'complete_task',
      'delete_task',
      'schedule_task',
      'reschedule_task',
      'create_goal',
      'update_goal',
      'optimize_day',
      'clarify',
    ] as const;

    for (const type of types) {
      expect(describeActionType(type).length).toBeGreaterThan(0);
    }
  });
});
