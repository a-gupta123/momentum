/**
 * The Guest Demo dataset.
 *
 * Everything is generated relative to the visitor's *current* date, so the demo
 * is never a museum of expired deadlines. It deliberately contains one of each
 * interesting case — completed, overdue, recurring, fixed-time, blocked, and
 * undated — so the ranking, scheduling and insight code all have something real
 * to chew on within seconds of the page loading.
 *
 * The content is intentionally generic. It portrays a plausible CS student's
 * week without any real person's private data: no email addresses, no course
 * numbers, no grades, no application outcomes.
 */
import {
  addDayKeys,
  addMinutesTo,
  toIso,
  todayKey,
  zonedTimeToInstant,
} from '@/lib/dates';
import { newId } from '@/lib/domain/ids';
import type {
  ActivityEvent,
  ActivityMetadata,
  DayKey,
  Goal,
  GoalCategory,
  GoalColorToken,
  Importance,
  PriorityWeight,
  Profile,
  Task,
  TaskDependency,
} from '@/lib/domain/types';
import { GUEST_STATE_VERSION, type GuestState } from '@/lib/validation/guest-state';

export interface DemoSeedOptions {
  timezone: string;
  now: Date;
  userId?: string;
  generateId?: () => string;
}

interface GoalSeed {
  key: string;
  title: string;
  description: string;
  category: GoalCategory;
  priorityWeight: PriorityWeight;
  color: GoalColorToken;
  weeklyTargetMinutes: number | null;
}

const GOAL_SEEDS: readonly GoalSeed[] = [
  {
    key: 'coursework',
    title: 'Excel in coursework',
    description: 'Stay ahead on problem sets instead of finishing them the night before.',
    category: 'coursework',
    priorityWeight: 5,
    color: 'cobalt',
    weeklyTargetMinutes: 600,
  },
  {
    key: 'internship',
    title: 'Land a 2027 software or quant internship',
    description: 'Steady applications and interview practice rather than one frantic week.',
    category: 'career',
    priorityWeight: 5,
    color: 'violet',
    weeklyTargetMinutes: 420,
  },
  {
    key: 'project',
    title: 'Ship a standout technical project',
    description: 'One deep project finished well beats four abandoned repositories.',
    category: 'project',
    priorityWeight: 4,
    color: 'teal',
    weeklyTargetMinutes: 360,
  },
  {
    key: 'fitness',
    title: 'Stay consistent with fitness',
    description: 'Three sessions a week, protected like any other commitment.',
    category: 'health',
    priorityWeight: 3,
    color: 'moss',
    weeklyTargetMinutes: 180,
  },
];

/** Builds a complete, validated-shape guest state for a first-time visitor. */
export function buildDemoState(options: DemoSeedOptions): GuestState {
  const generateId = options.generateId ?? newId;
  const { timezone, now } = options;
  const userId = options.userId ?? generateId();
  const nowIso = toIso(now);
  const today = todayKey(timezone, now);

  const at = (dayKey: DayKey, time: string): string =>
    toIso(zonedTimeToInstant(dayKey, time, timezone));
  const day = (offset: number): DayKey => addDayKeys(today, offset);

  const profile: Profile = {
    id: userId,
    displayName: 'Guest',
    timezone,
    workdayStart: '09:00',
    workdayEnd: '21:00',
    defaultTaskDurationMinutes: 45,
    breakMinutes: 10,
    highEnergyStart: '09:00',
    highEnergyEnd: '12:00',
    theme: 'system',
    aiAssistEnabled: true,
    confirmAllActions: false,
    splitLongTasks: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const goalIds = new Map<string, string>();
  const goals: Goal[] = GOAL_SEEDS.map((seed) => {
    const id = generateId();
    goalIds.set(seed.key, id);
    return {
      id,
      userId,
      title: seed.title,
      description: seed.description,
      category: seed.category,
      priorityWeight: seed.priorityWeight,
      targetDate: seed.key === 'internship' ? day(75) : null,
      weeklyTargetMinutes: seed.weeklyTargetMinutes,
      status: 'active',
      color: seed.color,
      createdAt: toIso(addMinutesTo(now, -60 * 24 * 21)),
      updatedAt: nowIso,
    };
  });

  const goalId = (key: string): string | null => goalIds.get(key) ?? null;

  let position = 0;
  const tasks: Task[] = [];
  const events: ActivityEvent[] = [];

  const addTask = (
    overrides: Partial<Task> & Pick<Task, 'title' | 'durationMinutes'>,
  ): Task => {
    position += 1;
    const task: Task = {
      id: generateId(),
      userId,
      goalId: null,
      parentTaskId: null,
      notes: null,
      status: 'inbox',
      manualPriority: 'normal',
      importance: 3,
      energy: 'medium',
      dueAt: null,
      scheduledStart: null,
      scheduledEnd: null,
      actualMinutes: null,
      isFixedTime: false,
      splittable: false,
      recurrenceRule: null,
      recurrenceSeriesId: null,
      recurrenceOccurrenceAt: null,
      source: 'demo',
      sourceText: null,
      position,
      // Staggered creation dates give the "waiting time" factor something real.
      createdAt: toIso(addMinutesTo(now, -60 * 24 * 3)),
      updatedAt: nowIso,
      completedAt: null,
      archivedAt: null,
      ...overrides,
    };
    tasks.push(task);
    return task;
  };

  const addEvent = (
    eventType: ActivityEvent['eventType'],
    occurredAt: string,
    taskId: string | null,
    durationMinutes: number | null = null,
    metadata: ActivityMetadata = {},
  ): void => {
    events.push({
      id: generateId(),
      userId,
      taskId,
      eventType,
      occurredAt,
      durationMinutes,
      metadata,
    });
  };

  // --- Today's live work -----------------------------------------------------

  const automata = addTask({
    title: 'Finish the automata problem set',
    notes: 'Questions 4 and 5 need the pumping lemma write-up.',
    goalId: goalId('coursework'),
    durationMinutes: 90,
    importance: 5,
    energy: 'high',
    manualPriority: 'high',
    dueAt: at(day(1), '18:00'),
    splittable: true,
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 4)),
  });

  addTask({
    title: 'Review differential equations notes before the quiz',
    goalId: goalId('coursework'),
    durationMinutes: 45,
    importance: 3,
    energy: 'medium',
    dueAt: at(day(3), '09:00'),
  });

  addTask({
    title: 'Finish and submit one internship application',
    notes: 'Tailor the project section to the scheduling work.',
    goalId: goalId('internship'),
    durationMinutes: 60,
    importance: 5,
    energy: 'high',
    manualPriority: 'high',
    dueAt: at(day(2), '17:00'),
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 6)),
  });

  // Recurring: the series anchor is this morning's occurrence.
  const leetcode = addTask({
    title: 'Solve two algorithm practice problems',
    goalId: goalId('internship'),
    durationMinutes: 45,
    importance: 4,
    energy: 'high',
    status: 'planned',
    scheduledStart: at(today, '09:00'),
    scheduledEnd: at(today, '09:45'),
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    source: 'recurrence',
  });
  leetcode.recurrenceSeriesId = leetcode.id;
  leetcode.recurrenceOccurrenceAt = at(today, '09:00');

  const schedulerTests = addTask({
    title: 'Write scheduling-engine tests for Momentum',
    notes: 'Cover overlap, capacity overflow and the split invariant.',
    goalId: goalId('project'),
    durationMinutes: 120,
    importance: 4,
    energy: 'high',
    splittable: true,
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 9)),
  });

  // Fixed-time commitment: placed by the clock, never re-ranked.
  addTask({
    title: 'Strength training at the gym',
    goalId: goalId('fitness'),
    durationMinutes: 60,
    importance: 3,
    energy: 'medium',
    status: 'planned',
    isFixedTime: true,
    scheduledStart: at(today, '17:30'),
    scheduledEnd: at(today, '18:30'),
  });

  // Overdue: yesterday's small thing that slipped.
  addTask({
    title: 'Ask about extra office hours before the quiz',
    goalId: goalId('coursework'),
    durationMinutes: 15,
    importance: 2,
    energy: 'low',
    dueAt: at(day(-1), '12:00'),
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 8)),
  });

  // Blocked: cannot start until the tests exist.
  const deploy = addTask({
    title: 'Deploy Momentum and write the README walkthrough',
    goalId: goalId('project'),
    durationMinutes: 60,
    importance: 4,
    energy: 'medium',
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 2)),
  });

  // No deadline, but still rankable and visible.
  addTask({
    title: 'Read the paper on constraint-based scheduling',
    goalId: goalId('project'),
    durationMinutes: 40,
    importance: 2,
    energy: 'low',
    manualPriority: 'low',
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 12)),
  });

  const dependencies: TaskDependency[] = [
    { taskId: deploy.id, dependsOnTaskId: schedulerTests.id, userId },
  ];

  // --- Completed history, so the dial, streak and insights have real data ----

  interface HistorySeed {
    title: string;
    goalKey: string;
    dayOffset: number;
    startTime: string;
    duration: number;
    actual: number;
    importance: Importance;
  }

  const history: readonly HistorySeed[] = [
    {
      title: 'Draft the resume bullet for the scheduling project',
      goalKey: 'internship',
      dayOffset: 0,
      startTime: '09:50',
      duration: 30,
      actual: 35,
      importance: 4,
    },
    {
      title: 'Rework the linear algebra practice set',
      goalKey: 'coursework',
      dayOffset: -1,
      startTime: '10:00',
      duration: 60,
      actual: 75,
      importance: 4,
    },
    {
      title: 'Cardio session',
      goalKey: 'fitness',
      dayOffset: -1,
      startTime: '18:00',
      duration: 45,
      actual: 40,
      importance: 3,
    },
    {
      title: 'Refactor the timeline component',
      goalKey: 'project',
      dayOffset: -2,
      startTime: '14:00',
      duration: 90,
      actual: 110,
      importance: 3,
    },
    {
      title: 'Mock interview practice with a friend',
      goalKey: 'internship',
      dayOffset: -3,
      startTime: '16:00',
      duration: 60,
      actual: 60,
      importance: 4,
    },
    {
      title: 'Summarize the discrete math lecture',
      goalKey: 'coursework',
      dayOffset: -3,
      startTime: '11:00',
      duration: 45,
      actual: 35,
      importance: 3,
    },
    {
      title: 'Strength training at the gym',
      goalKey: 'fitness',
      dayOffset: -4,
      startTime: '17:30',
      duration: 60,
      actual: 55,
      importance: 3,
    },
  ];

  for (const seed of history) {
    const dayKey = day(seed.dayOffset);
    const start = at(dayKey, seed.startTime);
    const completedAt = toIso(addMinutesTo(new Date(start), seed.actual));

    const task = addTask({
      title: seed.title,
      goalId: goalId(seed.goalKey),
      durationMinutes: seed.duration,
      actualMinutes: seed.actual,
      importance: seed.importance,
      status: 'completed',
      scheduledStart: start,
      scheduledEnd: toIso(addMinutesTo(new Date(start), seed.duration)),
      completedAt,
      createdAt: toIso(addMinutesTo(new Date(start), -60 * 24)),
      updatedAt: completedAt,
    });

    addEvent('task_completed', completedAt, task.id, seed.actual);
    addEvent('focus_session', completedAt, task.id, seed.actual, { source: 'demo' });
  }

  // One task that was scheduled two days ago and simply moved forward. This is
  // what makes the "3 tasks moved forward" copy real rather than decorative.
  addTask({
    title: 'Organize the semester reading list',
    goalId: goalId('coursework'),
    durationMinutes: 30,
    importance: 2,
    energy: 'low',
    status: 'planned',
    scheduledStart: at(day(-2), '15:00'),
    scheduledEnd: at(day(-2), '15:30'),
    createdAt: toIso(addMinutesTo(now, -60 * 24 * 10)),
  });

  addEvent('task_created', toIso(addMinutesTo(now, -60 * 24 * 4)), automata.id);

  return {
    version: GUEST_STATE_VERSION,
    profile,
    goals,
    tasks,
    dependencies,
    plans: [],
    blocks: [],
    events,
    focusSession: null,
    seedDayKey: today,
    userModified: false,
  };
}
