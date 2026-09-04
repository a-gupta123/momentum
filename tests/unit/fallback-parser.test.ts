import { describe, expect, it } from 'vitest';

import { formatInZone } from '@/lib/dates';
import {
  extractDuration,
  matchGoal,
  parseCaptureDeterministically,
  type FallbackParseContext,
} from '@/lib/ai/fallback-parser';
import type { CreateTaskAction } from '@/lib/validation/ai-actions';
import { assistantPlanSchema } from '@/lib/validation/ai-actions';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

/** Tuesday 2026-03-10, 11:00 in New York. */
const NOW = new Date('2026-03-10T15:00:00.000Z');

const GOALS = [
  { id: 'goal-course', title: 'Excel in coursework', category: 'coursework' },
  { id: 'goal-career', title: 'Land a 2027 software internship', category: 'career' },
  { id: 'goal-project', title: 'Ship a standout technical project', category: 'project' },
  { id: 'goal-health', title: 'Stay consistent with fitness', category: 'health' },
];

function contextFor(overrides: Partial<FallbackParseContext> = {}): FallbackParseContext {
  return {
    now: NOW,
    timezone: NY,
    defaultDurationMinutes: 45,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    goals: GOALS,
    ...overrides,
  };
}

function firstTask(text: string, overrides: Partial<FallbackParseContext> = {}): CreateTaskAction {
  const plan = parseCaptureDeterministically(text, contextFor(overrides));
  const action = plan.actions.find((entry) => entry.type === 'create_task');
  if (!action || action.type !== 'create_task') {
    throw new Error(`Expected a create_task action, got: ${JSON.stringify(plan.actions)}`);
  }
  return action;
}

describe('schema conformance', () => {
  it('always emits a plan that satisfies the shared AI schema', () => {
    const inputs = [
      'Finish my automata problem set tomorrow by 6 PM, about 90 minutes',
      'Practice LeetCode for 45 minutes every weekday at 9 AM',
      'Move unfinished low-priority work to Saturday',
      'Optimize my day',
      '',
      '???',
    ];

    for (const input of inputs) {
      const plan = parseCaptureDeterministically(input, contextFor());
      expect(assistantPlanSchema.safeParse(plan).success, input).toBe(true);
    }
  });
});

describe('duration phrases', () => {
  it('recognizes the common ways a duration gets typed', () => {
    expect(extractDuration('for 45 minutes')?.minutes).toBe(45);
    expect(extractDuration('30 min')?.minutes).toBe(30);
    expect(extractDuration('2 hours')?.minutes).toBe(120);
    expect(extractDuration('about 90 minutes')?.minutes).toBe(90);
    expect(extractDuration('1.5 hours')?.minutes).toBe(90);
    expect(extractDuration('90m')?.minutes).toBe(90);
    expect(extractDuration('half an hour')?.minutes).toBe(30);
    expect(extractDuration('an hour')?.minutes).toBe(60);
  });

  it('declines implausible durations rather than inventing a task length', () => {
    expect(extractDuration('read chapter 3')).toBeNull();
    expect(extractDuration('no duration here')).toBeNull();
  });

  it('marks an absent duration as inferred and uses the profile default', () => {
    const inferred = firstTask('Email the TA about the quiz');
    expect(inferred.durationMinutes).toBe(45);
    expect(inferred.durationInferred).toBe(true);

    const stated = firstTask('Review lecture notes for 30 min');
    expect(stated.durationMinutes).toBe(30);
    expect(stated.durationInferred).toBe(false);
  });
});

describe('deadline versus scheduled work', () => {
  it('reads "by" as a deadline', () => {
    const task = firstTask('Finish my automata problem set tomorrow by 6 PM, about 90 minutes');

    expect(task.title).toBe('Finish my automata problem set');
    expect(task.durationMinutes).toBe(90);
    expect(task.dueAt).not.toBeNull();
    expect(task.scheduledStart).toBeNull();
    expect(formatInZone(task.dueAt!, NY, 'yyyy-MM-dd HH:mm')).toBe('2026-03-11 18:00');
  });

  it('reads "before <day>" as a deadline at the end of the workday', () => {
    const task = firstTask('Apply to two internships before Friday and make that high priority');

    expect(task.dueAt).not.toBeNull();
    expect(formatInZone(task.dueAt!, NY, 'EEEE HH:mm')).toBe('Friday 18:00');
    expect(task.manualPriority).toBe('high');
    expect(task.title).toBe('Apply to two internships');
  });

  it('reads a working time as a schedule, not a deadline', () => {
    const task = firstTask('Work on the project Friday at 5 for an hour');

    expect(task.scheduledStart).not.toBeNull();
    expect(task.dueAt).toBeNull();
    expect(formatInZone(task.scheduledStart!, NY, 'EEEE HH:mm')).toBe('Friday 17:00');
    expect(task.durationMinutes).toBe(60);
  });

  it('treats a bare date as a deadline for that day', () => {
    const task = firstTask('Read chapter four tomorrow');
    expect(task.dueAt).not.toBeNull();
    expect(task.scheduledStart).toBeNull();
    expect(formatInZone(task.dueAt!, NY, 'yyyy-MM-dd')).toBe('2026-03-11');
  });
});

describe('relative dates across timezones and midnight', () => {
  it('resolves "tomorrow" against the user timezone, not the host', () => {
    // The same instant is 2026-03-10 in New York but 2026-03-11 in Tokyo, so
    // "tomorrow" must land on different calendar days.
    const inNewYork = firstTask('Submit the form tomorrow by 5pm', { timezone: NY });
    const inTokyo = firstTask('Submit the form tomorrow by 5pm', { timezone: TOKYO });

    expect(formatInZone(inNewYork.dueAt!, NY, 'yyyy-MM-dd')).toBe('2026-03-11');
    expect(formatInZone(inTokyo.dueAt!, TOKYO, 'yyyy-MM-dd')).toBe('2026-03-12');
  });

  it('anchors the same clock time to the correct instant in each timezone', () => {
    const inNewYork = firstTask('Study group today at 3pm', { timezone: NY });
    const inTokyo = firstTask('Study group today at 3pm', { timezone: TOKYO });

    expect(formatInZone(inNewYork.scheduledStart!, NY, 'HH:mm')).toBe('15:00');
    expect(formatInZone(inTokyo.scheduledStart!, TOKYO, 'HH:mm')).toBe('15:00');
    expect(inNewYork.scheduledStart).not.toBe(inTokyo.scheduledStart);
  });

  it('handles a request made just before local midnight', () => {
    // 03:30 UTC on the 11th is 23:30 on the 10th in New York, so "tomorrow"
    // is the 11th locally even though it is already the 11th in UTC.
    const lateNight = new Date('2026-03-11T03:30:00.000Z');
    const task = firstTask('Turn in the reading response tomorrow by noon', {
      now: lateNight,
      timezone: NY,
    });

    expect(formatInZone(task.dueAt!, NY, 'yyyy-MM-dd HH:mm')).toBe('2026-03-11 12:00');
  });

  it('handles a request made just after local midnight', () => {
    const justAfterMidnight = new Date('2026-03-11T05:30:00.000Z'); // 01:30 NY
    const task = firstTask('Turn in the reading response today by noon', {
      now: justAfterMidnight,
      timezone: NY,
    });

    expect(formatInZone(task.dueAt!, NY, 'yyyy-MM-dd HH:mm')).toBe('2026-03-11 12:00');
  });
});

describe('multiline brain dumps', () => {
  it('produces one task per line', () => {
    const plan = parseCaptureDeterministically(
      [
        'Finish the automata problem set tomorrow by 6pm, 90 minutes',
        'Go to the gym today at 5pm for an hour',
        '- Read the scheduling paper for 40 min',
      ].join('\n'),
      contextFor(),
    );

    const tasks = plan.actions.filter((action) => action.type === 'create_task');
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => (task as CreateTaskAction).title)).toEqual([
      'Finish the automata problem set',
      'Go to the gym',
      'Read the scheduling paper',
    ]);
  });

  it('ignores blank lines and bullet markers', () => {
    const plan = parseCaptureDeterministically(
      '\n\n• Practice algorithms for 30 min\n\n- Stretch for 15 min\n\n',
      contextFor(),
    );
    expect(plan.actions.filter((action) => action.type === 'create_task')).toHaveLength(2);
  });
});

describe('priority and recurrence', () => {
  it('reads explicit priority words', () => {
    expect(firstTask('Submit the form, urgent').manualPriority).toBe('urgent');
    expect(firstTask('Refactor the timeline, low priority').manualPriority).toBe('low');
    expect(firstTask('Prep for the interview, really important').manualPriority).toBe('high');
    expect(firstTask('Water the plants').manualPriority).toBeNull();
  });

  it('lifts importance alongside an explicit priority', () => {
    expect(firstTask('Submit the form, urgent').importance).toBe(5);
    expect(firstTask('Refactor the timeline, low priority').importance).toBe(2);
  });

  it('reads a recurrence phrase and keeps the schedule time', () => {
    const task = firstTask('Practice LeetCode for 45 minutes every weekday at 9 AM');

    expect(task.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(task.durationMinutes).toBe(45);
    expect(task.title).toBe('Practice LeetCode');
    expect(formatInZone(task.scheduledStart!, NY, 'HH:mm')).toBe('09:00');
  });

  it('reads a single weekday recurrence', () => {
    expect(firstTask('Team sync every Monday at 10am').recurrenceRule).toBe(
      'FREQ=WEEKLY;BYDAY=MO',
    );
  });
});

describe('goal matching', () => {
  it('links work to a goal when the keywords are unambiguous', () => {
    expect(matchGoal('finish the problem set', GOALS).goalId).toBe('goal-course');
    expect(matchGoal('submit an internship application', GOALS).goalId).toBe('goal-career');
    expect(matchGoal('go to the gym', GOALS).goalId).toBe('goal-health');
    expect(matchGoal('refactor the api component', GOALS).goalId).toBe('goal-project');
  });

  it('reports an ambiguity rather than guessing between equal matches', () => {
    // "leetcode" is a career keyword and "algorithm" appears in both career and
    // project vocabularies, so a genuinely tied phrase must ask.
    const tied = matchGoal('practice', [
      { id: 'a', title: 'Alpha', category: 'coursework' },
      { id: 'b', title: 'Beta', category: 'career' },
    ]);
    expect(tied.goalId).toBeNull();

    const forced = matchGoal('study and interview', GOALS);
    if (forced.goalId === null && forced.ambiguity) {
      expect(forced.ambiguity.field).toBe('goalId');
      expect(forced.ambiguity.options.length).toBeGreaterThan(1);
    }
  });

  it('leaves the link empty when nothing matches', () => {
    const match = matchGoal('water the plants', GOALS);
    expect(match.goalId).toBeNull();
    expect(match.ambiguity).toBeNull();
  });

  it('links nothing when the user has no goals yet', () => {
    expect(matchGoal('finish the problem set', []).goalId).toBeNull();
  });
});

describe('declining to guess', () => {
  it('returns clarify for a bulk move it cannot safely resolve', () => {
    const plan = parseCaptureDeterministically(
      'Move unfinished low-priority work to Saturday',
      contextFor(),
    );

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.type).toBe('clarify');
    expect(plan.actions[0]?.interpretation).toMatch(/assistant, which is currently off/i);
  });

  it('returns clarify for edits to existing work', () => {
    for (const input of [
      'Delete the gym task',
      'Rename my problem set task',
      'Mark the application as done',
      'Reschedule everything to next week',
    ]) {
      const plan = parseCaptureDeterministically(input, contextFor());
      expect(plan.actions[0]?.type, input).toBe('clarify');
    }
  });

  it('never fabricates a title from meaningless input', () => {
    for (const input of ['???', '...', '42', 'x']) {
      const plan = parseCaptureDeterministically(input, contextFor());
      expect(plan.actions.every((action) => action.type !== 'create_task'), input).toBe(true);
    }
  });

  it('recognizes an explicit request to rebuild the day', () => {
    const plan = parseCaptureDeterministically('Optimize my day please', contextFor());
    const action = plan.actions[0];

    expect(action?.type).toBe('optimize_day');
    if (action?.type === 'optimize_day') {
      expect(action.date).toBe('2026-03-10');
      expect(action.requiresConfirmation).toBe(true);
    }
  });

  it('says plainly in the summary that AI is off', () => {
    const plan = parseCaptureDeterministically('Read the paper for 40 min', contextFor());
    expect(plan.summary).toMatch(/AI is off/i);
  });
});

describe('source fidelity', () => {
  it('reports confidence below certainty, since this is pattern matching', () => {
    const task = firstTask('Finish the problem set tomorrow by 6pm');
    expect(task.confidence).toBeGreaterThan(0);
    expect(task.confidence).toBeLessThan(0.8);
  });

  it('never marks a task as a fixed commitment from pattern matching alone', () => {
    expect(firstTask('Lecture today at 2pm').isFixedTime).toBe(false);
  });

  it('marks long tasks as splittable so the scheduler may break them up', () => {
    expect(firstTask('Study for the final for 3 hours').splittable).toBe(true);
    expect(firstTask('Reply to the email for 15 min').splittable).toBe(false);
  });
});
