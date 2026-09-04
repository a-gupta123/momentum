import { beforeEach, describe, expect, it } from 'vitest';

import { toIso } from '@/lib/dates';
import { buildDaySchedule } from '@/lib/domain/scheduler';
import {
  createMemoryStorage,
  LocalPlannerRepository,
  type KeyValueStorage,
} from '@/lib/repositories/local';
import { StaleWriteError, type Mutation } from '@/lib/repositories/types';
import { GUEST_STORAGE_KEY, loadGuestState } from '@/lib/validation/guest-state';

import { sequentialIds } from './factories';

const NY = 'America/New_York';
const NOW = new Date('2026-03-10T15:00:00.000Z');

function makeRepo(options: { storage?: KeyValueStorage; now?: Date } = {}) {
  const storage = options.storage ?? createMemoryStorage();
  const repo = new LocalPlannerRepository({
    storage,
    timezone: NY,
    now: () => options.now ?? NOW,
    generateId: sequentialIds(),
  });
  return { repo, storage };
}

describe('seeding and persistence', () => {
  it('seeds a demo dataset on first use and writes it through', async () => {
    const { repo, storage } = makeRepo();
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(snapshot.tasks.length).toBeGreaterThan(5);
    expect(snapshot.goals).toHaveLength(4);
    expect(storage.getItem(GUEST_STORAGE_KEY)).not.toBeNull();
  });

  it('reloads the same data in a new instance rather than reseeding', async () => {
    const storage = createMemoryStorage();
    const first = makeRepo({ storage }).repo;
    const created = await first.createTask({ title: 'Persisted task' });

    const second = makeRepo({ storage }).repo;
    const snapshot = await second.getSnapshot('2026-03-10');

    expect(snapshot.tasks.some((task) => task.id === created.id)).toBe(true);
  });

  it('keeps the stored payload valid after every write', async () => {
    const { repo, storage } = makeRepo();
    await repo.createTask({ title: 'Something new' });
    await repo.updateProfile({ workdayStart: '08:00' });

    expect(loadGuestState(storage.getItem(GUEST_STORAGE_KEY)).status).toBe('ok');
  });

  it('reports itself as guest mode', () => {
    expect(makeRepo().repo.mode).toBe('guest');
  });
});

describe('storage failure handling', () => {
  it('keeps working in memory when the browser refuses to persist', async () => {
    const warnings: string[] = [];
    const failing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      removeItem: () => {},
    };

    const repo = new LocalPlannerRepository({
      storage: failing,
      timezone: NY,
      now: () => NOW,
      generateId: sequentialIds(),
      onWarning: (message) => warnings.push(message),
    });

    const task = await repo.createTask({ title: 'Still works' });
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(task.title).toBe('Still works');
    expect(snapshot.tasks.some((entry) => entry.id === task.id)).toBe(true);
    expect(repo.isDurable).toBe(false);
    expect(warnings.some((message) => /only for this session/i.test(message))).toBe(true);
  });

  it('recovers from corrupt stored data with a fresh demo and a warning', async () => {
    const storage = createMemoryStorage();
    storage.setItem(GUEST_STORAGE_KEY, '{"version":2,"tasks":"not-an-array"}');
    const warnings: string[] = [];

    const repo = new LocalPlannerRepository({
      storage,
      timezone: NY,
      now: () => NOW,
      generateId: sequentialIds(),
      onWarning: (message) => warnings.push(message),
    });

    const snapshot = await repo.getSnapshot('2026-03-10');
    expect(snapshot.goals).toHaveLength(4);
    expect(warnings.some((message) => /fresh demo/i.test(message))).toBe(true);
  });
});

describe('stale demo refresh', () => {
  it('regenerates an untouched demo seeded on an earlier day', async () => {
    const storage = createMemoryStorage();
    makeRepo({ storage, now: new Date('2026-03-01T15:00:00.000Z') });

    const laterRepo = new LocalPlannerRepository({
      storage,
      timezone: NY,
      now: () => NOW,
      generateId: sequentialIds('cccccccc'),
    });

    const snapshot = await laterRepo.getSnapshot('2026-03-10');
    const parsed = loadGuestState(storage.getItem(GUEST_STORAGE_KEY));

    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') expect(parsed.state.seedDayKey).toBe('2026-03-10');
    expect(snapshot.tasks.length).toBeGreaterThan(0);
  });

  it('never discards data once the visitor has changed something', async () => {
    const storage = createMemoryStorage();
    const early = new LocalPlannerRepository({
      storage,
      timezone: NY,
      now: () => new Date('2026-03-01T15:00:00.000Z'),
      generateId: sequentialIds(),
    });
    const mine = await early.createTask({ title: 'My own task' });

    const later = new LocalPlannerRepository({
      storage,
      timezone: NY,
      now: () => NOW,
      generateId: sequentialIds('cccccccc'),
    });

    const snapshot = await later.getSnapshot('2026-03-10');
    expect(snapshot.tasks.some((task) => task.id === mine.id)).toBe(true);
  });
});

describe('task lifecycle', () => {
  it('creates a task with sensible defaults', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: '  Padded title  ' });

    expect(task.title).toBe('Padded title');
    expect(task.status).toBe('inbox');
    expect(task.durationMinutes).toBe(45); // profile default
    expect(task.manualPriority).toBe('normal');
  });

  it('marks a task planned and derives its end when given a start', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Scheduled work',
      scheduledStart: '2026-03-10T18:00:00.000Z',
      durationMinutes: 60,
    });

    expect(task.status).toBe('planned');
    expect(task.scheduledEnd).toBe('2026-03-10T19:00:00.000Z');
  });

  it('appends new tasks after the existing queue', async () => {
    const { repo } = makeRepo();
    const before = await repo.getSnapshot('2026-03-10');
    const maxPosition = Math.max(...before.tasks.map((task) => task.position));
    const task = await repo.createTask({ title: 'Last in queue' });

    expect(task.position).toBeGreaterThan(maxPosition);
  });

  it('duplicates a task without copying its completion history', async () => {
    const { repo } = makeRepo();
    const original = await repo.createTask({ title: 'Original', durationMinutes: 90 });
    await repo.completeTask(original.id, 100);

    const copy = await repo.duplicateTask(original.id);
    expect(copy.title).toBe('Original (copy)');
    expect(copy.status).toBe('inbox');
    expect(copy.completedAt).toBeNull();
    expect(copy.actualMinutes).toBeNull();
    expect(copy.durationMinutes).toBe(90);
  });

  it('deletes a task along with its dependency edges', async () => {
    const { repo } = makeRepo();
    const first = await repo.createTask({ title: 'Prerequisite' });
    const second = await repo.createTask({ title: 'Dependent' });
    await repo.addDependency(second.id, first.id);

    await repo.deleteTask(first.id);
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(snapshot.tasks.some((task) => task.id === first.id)).toBe(false);
    expect(snapshot.dependencies).toHaveLength(1); // only the seeded edge remains
    expect(
      snapshot.dependencies.some((edge) => edge.dependsOnTaskId === first.id),
    ).toBe(false);
  });

  it('persists a manual reordering of the queue', async () => {
    const { repo } = makeRepo();
    const a = await repo.createTask({ title: 'A' });
    const b = await repo.createTask({ title: 'B' });

    await repo.reorderTasks([b.id, a.id]);
    const snapshot = await repo.getSnapshot('2026-03-10');

    const positionOf = (id: string) =>
      snapshot.tasks.find((task) => task.id === id)?.position ?? -1;
    expect(positionOf(b.id)).toBeLessThan(positionOf(a.id));
  });

  it('rejects a stale update rather than clobbering a newer value', async () => {
    // The concurrency guard compares `updatedAt`, so this test needs a clock
    // that actually advances between the two writes.
    let tick = 0;
    const repo = new LocalPlannerRepository({
      storage: createMemoryStorage(),
      timezone: NY,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      generateId: sequentialIds(),
    });

    const task = await repo.createTask({ title: 'Contested' });
    await repo.updateTask(task.id, { title: 'Changed elsewhere' });

    await expect(
      repo.updateTask(task.id, { title: 'My edit' }, task.updatedAt),
    ).rejects.toThrow(StaleWriteError);

    // The concurrent value survives; the stale edit is discarded.
    const snapshot = await repo.getSnapshot('2026-03-10');
    expect(snapshot.tasks.find((entry) => entry.id === task.id)?.title).toBe(
      'Changed elsewhere',
    );
  });

  it('records actual minutes on completion', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Timed', durationMinutes: 60 });
    const result = await repo.completeTask(task.id, 75);

    expect(result.task.status).toBe('completed');
    expect(result.task.actualMinutes).toBe(75);
    expect(result.task.completedAt).not.toBeNull();
  });

  it('restores a task to the queue when a completion is undone', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Undo me' });
    await repo.completeTask(task.id);
    const restored = await repo.uncompleteTask(task.id);

    expect(restored.status).toBe('inbox');
    expect(restored.completedAt).toBeNull();
  });

  it('restores an unscheduled-but-planned task to planned when undone', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Planned work',
      scheduledStart: '2026-03-10T18:00:00.000Z',
    });
    await repo.completeTask(task.id);

    expect((await repo.uncompleteTask(task.id)).status).toBe('planned');
  });
});

describe('recurring completion', () => {
  it('leaves the occurrence completed and creates the next one', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Daily practice',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      dueAt: '2026-03-10T14:00:00.000Z',
    });

    const result = await repo.completeTask(task.id);

    expect(result.task.status).toBe('completed');
    expect(result.nextOccurrence).not.toBeNull();
    expect(result.nextOccurrence?.dueAt).toBe('2026-03-11T14:00:00.000Z');
    expect(result.nextOccurrence?.status).toBe('inbox');
  });

  it('does not duplicate the successor when completion is retried', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Daily practice',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      dueAt: '2026-03-10T14:00:00.000Z',
    });

    await repo.completeTask(task.id);
    const second = await repo.completeTask(task.id);

    const snapshot = await repo.getSnapshot('2026-03-10');
    const occurrences = snapshot.tasks.filter(
      (entry) => entry.recurrenceOccurrenceAt === '2026-03-11T14:00:00.000Z',
    );

    expect(second.nextOccurrence).toBeNull();
    expect(occurrences).toHaveLength(1);
  });

  it('withdraws the untouched successor when the completion is undone', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Daily practice',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceOccurrenceAt: '2026-03-10T14:00:00.000Z',
      dueAt: '2026-03-10T14:00:00.000Z',
    });

    await repo.completeTask(task.id);
    await repo.uncompleteTask(task.id);

    const snapshot = await repo.getSnapshot('2026-03-10');
    expect(
      snapshot.tasks.filter(
        (entry) => entry.recurrenceOccurrenceAt === '2026-03-11T14:00:00.000Z',
      ),
    ).toHaveLength(0);
  });
});

describe('dependencies', () => {
  it('refuses a self-dependency', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Lonely' });
    await expect(repo.addDependency(task.id, task.id)).rejects.toThrow(/cannot depend on itself/i);
  });

  it('refuses a cycle', async () => {
    const { repo } = makeRepo();
    const a = await repo.createTask({ title: 'A' });
    const b = await repo.createTask({ title: 'B' });

    await repo.addDependency(b.id, a.id);
    await expect(repo.addDependency(a.id, b.id)).rejects.toThrow(/circular/i);
  });

  it('refuses a longer cycle', async () => {
    const { repo } = makeRepo();
    const a = await repo.createTask({ title: 'A' });
    const b = await repo.createTask({ title: 'B' });
    const c = await repo.createTask({ title: 'C' });

    await repo.addDependency(b.id, a.id);
    await repo.addDependency(c.id, b.id);
    await expect(repo.addDependency(a.id, c.id)).rejects.toThrow(/circular/i);
  });

  it('ignores a duplicate edge instead of storing it twice', async () => {
    const { repo } = makeRepo();
    const a = await repo.createTask({ title: 'A' });
    const b = await repo.createTask({ title: 'B' });

    await repo.addDependency(b.id, a.id);
    await repo.addDependency(b.id, a.id);

    const snapshot = await repo.getSnapshot('2026-03-10');
    expect(
      snapshot.dependencies.filter(
        (edge) => edge.taskId === b.id && edge.dependsOnTaskId === a.id,
      ),
    ).toHaveLength(1);
  });
});

describe('plan persistence', () => {
  it('saves a plan, its blocks and the mirrored task times together', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Deep work', durationMinutes: 60 });

    const schedule = buildDaySchedule({
      date: '2026-03-10',
      timezone: NY,
      workdayStart: '09:00',
      workdayEnd: '17:00',
      breakMinutes: 0,
      highEnergyStart: '09:00',
      highEnergyEnd: '12:00',
      fixedBlocks: [],
      tasks: [
        {
          id: task.id,
          title: task.title,
          durationMinutes: 60,
          score: 80,
          dueAt: null,
          energy: 'medium',
          importance: 3,
          splittable: false,
          blocked: false,
          position: 1,
          preferredWindow: null,
        },
      ],
      allowSplitting: true,
      now: new Date('2026-03-10T09:00:00.000Z'),
    });

    const saved = await repo.savePlan({ schedule });
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(saved.plan.planDate).toBe('2026-03-10');
    expect(saved.plan.scoreVersion).toBe(schedule.scoreVersion);
    expect(snapshot.blocks.length).toBeGreaterThan(0);

    const stored = snapshot.tasks.find((entry) => entry.id === task.id);
    expect(stored?.scheduledStart).toBe(schedule.blocks[0]?.startAt);
    expect(stored?.status).toBe('planned');
  });

  it('replaces an earlier plan for the same day instead of accumulating', async () => {
    const { repo } = makeRepo();
    const baseSchedule = {
      date: '2026-03-10',
      timezone: NY,
      workdayStart: '09:00',
      workdayEnd: '17:00',
      breakMinutes: 0,
      highEnergyStart: '09:00',
      highEnergyEnd: '12:00',
      fixedBlocks: [],
      tasks: [],
      allowSplitting: true,
      now: new Date('2026-03-10T09:00:00.000Z'),
    } as const;

    const first = await repo.savePlan({ schedule: buildDaySchedule(baseSchedule) });
    const second = await repo.savePlan({ schedule: buildDaySchedule(baseSchedule) });
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(second.plan.id).toBe(first.plan.id);
    expect(snapshot.plan?.id).toBe(first.plan.id);
  });

  it('returns overflowed work to the queue rather than leaving a stale time', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({
      title: 'Too big for the day',
      durationMinutes: 240,
      scheduledStart: '2026-03-10T18:00:00.000Z',
    });

    const schedule = buildDaySchedule({
      date: '2026-03-10',
      timezone: NY,
      workdayStart: '09:00',
      workdayEnd: '10:00',
      breakMinutes: 0,
      highEnergyStart: '09:00',
      highEnergyEnd: '10:00',
      fixedBlocks: [],
      tasks: [
        {
          id: task.id,
          title: task.title,
          durationMinutes: 240,
          score: 80,
          dueAt: null,
          energy: 'medium',
          importance: 3,
          splittable: false,
          blocked: false,
          position: 1,
          preferredWindow: null,
        },
      ],
      allowSplitting: true,
      now: new Date('2026-03-10T09:00:00.000Z'),
    });

    await repo.savePlan({ schedule });
    const snapshot = await repo.getSnapshot('2026-03-10');
    const stored = snapshot.tasks.find((entry) => entry.id === task.id);

    expect(schedule.overflow).toHaveLength(1);
    expect(stored?.scheduledStart).toBeNull();
    expect(stored?.status).toBe('inbox');
  });
});

describe('focus sessions', () => {
  it('persists a running session so a refresh cannot lose it', async () => {
    const storage = createMemoryStorage();
    const { repo } = makeRepo({ storage });
    const task = await repo.createTask({ title: 'Focus target' });

    await repo.setFocusSession({
      taskId: task.id,
      startedAt: toIso(NOW),
      accumulatedMinutes: 0,
      isPaused: false,
    });

    const reloaded = makeRepo({ storage }).repo;
    const session = await reloaded.getFocusSession();

    expect(session?.taskId).toBe(task.id);
    expect(session?.startedAt).toBe(toIso(NOW));
  });

  it('clears the session when the focused task is deleted', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Focus target' });
    await repo.setFocusSession({
      taskId: task.id,
      startedAt: toIso(NOW),
      accumulatedMinutes: 0,
      isPaused: false,
    });

    await repo.deleteTask(task.id);
    expect(await repo.getFocusSession()).toBeNull();
  });
});

describe('batch apply and undo', () => {
  it('applies a batch and reports what it created', async () => {
    const { repo } = makeRepo();
    const snapshot = await repo.getSnapshot('2026-03-10');
    const target = snapshot.tasks[0]!;

    const mutations: Mutation[] = [
      {
        kind: 'create_task',
        task: { ...target, id: 'new-task-1', title: 'Batch created', status: 'inbox' },
      },
      {
        kind: 'update_task',
        id: target.id,
        patch: { title: 'Batch renamed' },
        expectedUpdatedAt: target.updatedAt,
      },
    ];

    const outcome = await repo.applyMutations(mutations);
    const after = await repo.getSnapshot('2026-03-10');

    expect(outcome.appliedCount).toBe(2);
    expect(outcome.createdTaskIds).toEqual(['new-task-1']);
    expect(after.tasks.find((task) => task.id === target.id)?.title).toBe('Batch renamed');
  });

  it('rejects a stale mutation without applying it', async () => {
    const { repo } = makeRepo();
    const snapshot = await repo.getSnapshot('2026-03-10');
    const target = snapshot.tasks[0]!;

    const outcome = await repo.applyMutations([
      {
        kind: 'update_task',
        id: target.id,
        patch: { title: 'Should not stick' },
        expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
      },
    ]);

    const after = await repo.getSnapshot('2026-03-10');
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toMatch(/changed since the preview/i);
    expect(after.tasks.find((task) => task.id === target.id)?.title).toBe(target.title);
  });

  it('reverses a batch exactly via its inverse operations', async () => {
    const { repo } = makeRepo();
    const snapshot = await repo.getSnapshot('2026-03-10');
    const target = snapshot.tasks[0]!;
    const originalTitle = target.title;

    const outcome = await repo.applyMutations([
      {
        kind: 'create_task',
        task: { ...target, id: 'new-task-2', title: 'Temporary' },
      },
      {
        kind: 'update_task',
        id: target.id,
        patch: { title: 'Renamed' },
        expectedUpdatedAt: target.updatedAt,
      },
    ]);

    await repo.applyInverse(outcome.inverse);
    const after = await repo.getSnapshot('2026-03-10');

    expect(after.tasks.some((task) => task.id === 'new-task-2')).toBe(false);
    expect(after.tasks.find((task) => task.id === target.id)?.title).toBe(originalTitle);
  });

  it('restores a deleted task on undo', async () => {
    const { repo } = makeRepo();
    const task = await repo.createTask({ title: 'Delete then undo' });

    const outcome = await repo.applyMutations([{ kind: 'delete_task', id: task.id }]);
    expect((await repo.getSnapshot('2026-03-10')).tasks.some((e) => e.id === task.id)).toBe(false);

    await repo.applyInverse(outcome.inverse);
    const restored = (await repo.getSnapshot('2026-03-10')).tasks.find((e) => e.id === task.id);
    expect(restored?.title).toBe('Delete then undo');
  });
});

describe('reset', () => {
  it('discards local changes and reseeds the demo', async () => {
    const { repo } = makeRepo();
    const mine = await repo.createTask({ title: 'My scratch task' });

    await repo.resetDemoData();
    const snapshot = await repo.getSnapshot('2026-03-10');

    expect(snapshot.tasks.some((task) => task.id === mine.id)).toBe(false);
    expect(snapshot.goals).toHaveLength(4);
  });
});
