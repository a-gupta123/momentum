import { describe, expect, it } from 'vitest';

import { todayKey } from '@/lib/dates';
import { buildDemoState } from '@/lib/domain/demo-data';
import {
  GUEST_STATE_VERSION,
  guestStateSchema,
  loadGuestState,
  migrateGuestState,
  serializeGuestState,
} from '@/lib/validation/guest-state';

import { sequentialIds } from './factories';

const NY = 'America/New_York';
const NOW = new Date('2026-03-10T15:00:00.000Z');

function freshState() {
  return buildDemoState({ timezone: NY, now: NOW, generateId: sequentialIds() });
}

describe('demo seed shape', () => {
  it('produces a state that satisfies its own schema', () => {
    const result = guestStateSchema.safeParse(freshState());
    if (!result.success) {
      throw new Error(`Seed failed validation: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('survives a full serialize/parse round trip', () => {
    const state = freshState();
    const outcome = loadGuestState(serializeGuestState(state));

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.state.tasks).toHaveLength(state.tasks.length);
      expect(outcome.migratedFrom).toBeNull();
    }
  });

  it('anchors the dataset to the visitor current day, not a hard-coded date', () => {
    const state = freshState();
    expect(state.seedDayKey).toBe(todayKey(NY, NOW));
    expect(state.userModified).toBe(false);
  });

  it('includes each case the planner needs to demonstrate', () => {
    const { tasks, dependencies, goals } = freshState();

    expect(goals).toHaveLength(4);
    expect(goals.filter((goal) => goal.priorityWeight === 5)).toHaveLength(2);

    expect(tasks.some((task) => task.status === 'completed')).toBe(true);
    expect(tasks.some((task) => task.isFixedTime)).toBe(true);
    expect(tasks.some((task) => task.recurrenceRule !== null)).toBe(true);
    expect(tasks.some((task) => task.dueAt === null)).toBe(true);
    expect(
      tasks.some((task) => task.dueAt !== null && new Date(task.dueAt) < NOW),
      'expected one overdue task',
    ).toBe(true);
    expect(dependencies.length).toBeGreaterThan(0);
  });

  it('gives the recurring task a series identity anchored to itself', () => {
    const recurring = freshState().tasks.find((task) => task.recurrenceRule !== null);
    expect(recurring?.recurrenceSeriesId).toBe(recurring?.id);
    expect(recurring?.recurrenceOccurrenceAt).not.toBeNull();
  });

  it('seeds enough completion history for a streak and estimate accuracy', () => {
    const { tasks, events } = freshState();
    const withActuals = tasks.filter(
      (task) => task.status === 'completed' && task.actualMinutes !== null,
    );

    expect(withActuals.length).toBeGreaterThanOrEqual(3);
    expect(events.some((event) => event.eventType === 'focus_session')).toBe(true);
  });

  it('contains no personally identifying content', () => {
    const serialized = serializeGuestState(freshState()).toLowerCase();
    expect(serialized).not.toMatch(/@[a-z0-9-]+\.(com|edu|org)/);
    expect(serialized).not.toMatch(/\bssn\b|password|api[_-]?key/);
  });

  it('generates unique task positions so ordering is stable', () => {
    const positions = freshState().tasks.map((task) => task.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('loadGuestState', () => {
  it('reports an empty store distinctly from a corrupt one', () => {
    expect(loadGuestState(null).status).toBe('empty');
    expect(loadGuestState('').status).toBe('empty');
  });

  it('reports invalid JSON without throwing', () => {
    const outcome = loadGuestState('{ not json');
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.reason).toMatch(/not valid JSON/i);
  });

  it('rejects a payload that is the wrong kind of value', () => {
    expect(loadGuestState('"a string"').status).toBe('invalid');
    expect(loadGuestState('42').status).toBe('invalid');
    expect(loadGuestState('null').status).toBe('empty');
  });

  it('rejects a structurally wrong payload and names the offending field', () => {
    const state = freshState();
    const broken = { ...state, tasks: [{ id: 'only-an-id' }] };
    const outcome = loadGuestState(JSON.stringify(broken));

    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.reason).toMatch(/expected shape/i);
  });

  it('rejects a state carrying an unknown IANA timezone', () => {
    const state = freshState();
    const broken = { ...state, profile: { ...state.profile, timezone: 'Mars/Olympus_Mons' } };
    expect(loadGuestState(JSON.stringify(broken)).status).toBe('invalid');
  });

  it('refuses a payload from a newer version rather than mangling it', () => {
    const state = freshState();
    const future = { ...state, version: GUEST_STATE_VERSION + 5 };
    const outcome = loadGuestState(JSON.stringify(future));

    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.reason).toMatch(/newer version/i);
  });
});

describe('versioned migration', () => {
  /** A v1 payload: no assistant preferences, no activity log, no seed bookkeeping. */
  function buildV1Payload() {
    const current = freshState();
    const {
      aiAssistEnabled: _ai,
      confirmAllActions: _confirm,
      splitLongTasks: _split,
      ...v1Profile
    } = current.profile;

    return {
      version: 1,
      profile: v1Profile,
      goals: current.goals,
      tasks: current.tasks,
    };
  }

  it('upgrades a v1 payload to the current version', () => {
    const result = migrateGuestState(buildV1Payload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(1);
      expect((result.value as { version: number }).version).toBe(GUEST_STATE_VERSION);
    }
  });

  it('produces a v1 upgrade that passes the current schema', () => {
    const outcome = loadGuestState(JSON.stringify(buildV1Payload()));
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.migratedFrom).toBe(1);
      expect(outcome.state.version).toBe(GUEST_STATE_VERSION);
    }
  });

  it('supplies sensible defaults for fields v1 never had', () => {
    const outcome = loadGuestState(JSON.stringify(buildV1Payload()));
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.state.profile.aiAssistEnabled).toBe(true);
      expect(outcome.state.profile.confirmAllActions).toBe(false);
      expect(outcome.state.profile.splitLongTasks).toBe(true);
      expect(outcome.state.events).toEqual([]);
      expect(outcome.state.focusSession).toBeNull();
    }
  });

  it('preserves the user tasks and goals through the upgrade', () => {
    const payload = buildV1Payload();
    const outcome = loadGuestState(JSON.stringify(payload));

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.state.tasks).toHaveLength(payload.tasks.length);
      expect(outcome.state.goals.map((goal) => goal.title)).toEqual(
        payload.goals.map((goal) => goal.title),
      );
    }
  });

  it('marks migrated data as user-modified so it is never auto-reseeded', () => {
    const outcome = loadGuestState(JSON.stringify(buildV1Payload()));
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.state.userModified).toBe(true);
  });

  it('repairs an invalid timezone during migration instead of failing', () => {
    const payload = buildV1Payload();
    const broken = {
      ...payload,
      profile: { ...payload.profile, timezone: 'Somewhere/Invented' },
    };

    const outcome = loadGuestState(JSON.stringify(broken));
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.state.profile.timezone).toBe('America/New_York');
    }
  });

  it('treats a payload with no version field as v1', () => {
    const payload = buildV1Payload();
    const { version: _version, ...unversioned } = payload;
    const result = migrateGuestState(unversioned);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBe(1);
  });

  it('passes a current-version payload through untouched', () => {
    const state = freshState();
    const result = migrateGuestState(state);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBeNull();
  });

  it('refuses a non-object payload', () => {
    expect(migrateGuestState(null).ok).toBe(false);
    expect(migrateGuestState('nope').ok).toBe(false);
    expect(migrateGuestState(7).ok).toBe(false);
  });
});
