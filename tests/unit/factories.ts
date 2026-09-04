/**
 * Test factories.
 *
 * Every factory produces a complete, valid record so a test only has to state
 * the fields it actually cares about. Ids are sequential and deterministic,
 * which keeps assertions about tie-breaking meaningful.
 */
import { toIso } from '@/lib/dates';
import type {
  ActivityEvent,
  ActivityEventType,
  Goal,
  Importance,
  PriorityWeight,
  Profile,
  Task,
} from '@/lib/domain/types';

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';

let counter = 0;
export function testId(prefix = 'aaaaaaaa'): string {
  counter += 1;
  const suffix = String(counter).padStart(12, '0');
  return `${prefix}-1111-4111-8111-${suffix}`;
}

export function resetTestIds(): void {
  counter = 0;
}

/** A stable, injectable id generator for deterministic assertions. */
export function sequentialIds(prefix = 'bbbbbbbb'): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `${prefix}-2222-4222-8222-${String(index).padStart(12, '0')}`;
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const now = toIso(new Date('2026-03-10T12:00:00.000Z'));
  return {
    id: TEST_USER_ID,
    displayName: 'Test User',
    timezone: 'America/New_York',
    workdayStart: '09:00',
    workdayEnd: '18:00',
    defaultTaskDurationMinutes: 45,
    breakMinutes: 0,
    highEnergyStart: '09:00',
    highEnergyEnd: '12:00',
    theme: 'system',
    aiAssistEnabled: true,
    confirmAllActions: false,
    splitLongTasks: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = toIso(new Date('2026-03-01T12:00:00.000Z'));
  return {
    id: testId('cccccccc'),
    userId: TEST_USER_ID,
    title: 'Test goal',
    description: null,
    category: 'project',
    priorityWeight: 3 as PriorityWeight,
    targetDate: null,
    weeklyTargetMinutes: null,
    status: 'active',
    color: 'cobalt',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = toIso(new Date('2026-03-10T12:00:00.000Z'));
  return {
    id: testId('dddddddd'),
    userId: TEST_USER_ID,
    goalId: null,
    parentTaskId: null,
    title: 'Test task',
    notes: null,
    status: 'inbox',
    manualPriority: 'normal',
    importance: 3 as Importance,
    energy: 'medium',
    dueAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: 60,
    actualMinutes: null,
    isFixedTime: false,
    splittable: false,
    recurrenceRule: null,
    recurrenceSeriesId: null,
    recurrenceOccurrenceAt: null,
    source: 'manual',
    sourceText: null,
    position: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

export function makeEvent(
  eventType: ActivityEventType,
  occurredAt: string,
  overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id: testId('eeeeeeee'),
    userId: TEST_USER_ID,
    taskId: null,
    eventType,
    occurredAt,
    durationMinutes: null,
    metadata: {},
    ...overrides,
  };
}
