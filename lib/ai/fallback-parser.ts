/**
 * The deterministic capture parser.
 *
 * This is what makes "AI is off" an honest configuration rather than a broken
 * one. With no `OPENAI_API_KEY` the composer still turns real sentences into
 * structured, editable proposals — it simply declines to guess at the hard
 * cases instead of inventing an answer.
 *
 * It emits exactly the same `AssistantPlan` shape as the model, so the preview,
 * the confirmation rules and the apply pipeline are shared code with no
 * "fallback mode" branches downstream.
 *
 * **Timezone handling.** `chrono` interprets a `timezone` reference as an
 * abbreviation map, not an IANA zone, and its `.date()` resolves against the
 * host's offset. Both are wrong for a user in another zone. So we parse in a
 * *floating* frame (reference projected to UTC-looking wall time, offset forced
 * to 0), read back the individual calendar components, and re-anchor them with
 * `zonedTimeToInstant`. That is DST-correct and host-independent.
 */
import * as chrono from 'chrono-node';

import {
  addDayKeys,
  clamp,
  dayKeyOf,
  formatInZone,
  minutesToClockTime,
  normalizeClockTime,
  toIso,
  zonedTimeToInstant,
} from '@/lib/dates';
import { recurrenceFromPhrase } from '@/lib/domain/recurrence';
import { DOMAIN_LIMITS } from '@/lib/domain/tuning';
import type { ClockTime, EnergyLevel, Importance, ManualPriority } from '@/lib/domain/types';
import type { AssistantAction, AssistantPlan } from '@/lib/validation/ai-actions';

export interface FallbackGoalCandidate {
  id: string;
  title: string;
  category: string;
}

export interface FallbackParseContext {
  now: Date;
  timezone: string;
  defaultDurationMinutes: number;
  workdayStart: ClockTime;
  workdayEnd: ClockTime;
  goals: readonly FallbackGoalCandidate[];
}

/**
 * Phrases that clearly ask to modify or sweep *existing* work. The deterministic
 * parser cannot resolve which records are meant, and guessing would be worse
 * than asking, so these return `clarify`.
 *
 * These patterns are deliberately narrow. Imperative verbs like `finish`,
 * `complete`, `submit` and `set up` overwhelmingly begin *new* tasks — "Finish
 * my automata problem set" is a task, not a command to close one — so a
 * completion intent has to be signalled by an explicit marker such as
 * `mark … as done`, not by the verb alone.
 */
const BULK_OR_EDIT_PATTERNS: readonly RegExp[] = [
  /^\s*(move|reschedule|push back|postpone|shift|snooze|defer)\b/i,
  /^\s*(delete|remove|cancel|clear|drop)\s+(the|my|all|every)\b/i,
  /^\s*(mark|check off|tick off|cross off)\b/i,
  /^\s*(rename|retitle)\b/i,
  /^\s*(change|update|edit|set)\s+(the|my)\b/i,
  /\bas (done|complete|completed|finished)\b/i,
  /\b(is|are) (now )?(done|complete|completed|finished)\s*$/i,
  /\ball (my |the )?(unfinished|incomplete|remaining|open|low[- ]priority|pending)\b/i,
  /\beverything\b/i,
];

/** Requests to rebuild the day, which map onto a real deterministic action. */
const OPTIMIZE_PATTERNS: readonly RegExp[] = [
  /\b(optimi[sz]e|rebalance|rebuild|re-?plan|replan|reorganize)\b.*\b(day|today|schedule|plan)\b/i,
  /\b(plan|build|fill)\b\s+(out\s+)?(my\s+)?(day|today|schedule)\b/i,
];

/** Duration phrases, longest-form first so `minutes` wins over `min`. */
const DURATION_PATTERN =
  /(?:\bfor\s+|\babout\s+|\baround\s+|~)?\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;
const HALF_HOUR_PATTERN = /\b(half an hour|half-hour)\b/i;
const AN_HOUR_PATTERN = /\b(an|one) hour\b/i;

interface PriorityRule {
  pattern: RegExp;
  priority: ManualPriority;
  importance: Importance;
}

const PRIORITY_RULES: readonly PriorityRule[] = [
  { pattern: /\b(urgent|asap|critical|emergency)\b/i, priority: 'urgent', importance: 5 },
  {
    pattern: /\b(?:and\s+)?(?:make|mark)\s+(?:that|it|this)\s+(?:a\s+)?(?:high|top)\s*priority\b/i,
    priority: 'high',
    importance: 4,
  },
  { pattern: /\b(high|top)[- ]priority\b/i, priority: 'high', importance: 4 },
  { pattern: /\b(really important|very important|important)\b/i, priority: 'high', importance: 4 },
  {
    pattern: /\b(?:and\s+)?(?:make|mark)\s+(?:that|it|this)\s+(?:a\s+)?low\s*priority\b/i,
    priority: 'low',
    importance: 2,
  },
  { pattern: /\blow[- ]priority\b/i, priority: 'low', importance: 2 },
  { pattern: /\b(whenever|someday|no rush|eventually)\b/i, priority: 'low', importance: 2 },
];

/** Words that indicate a *deadline* rather than a working time. */
const DEADLINE_MARKERS = /\b(due|deadline|by|before|no later than|submit(?:ted)? by)\b/i;

const ENERGY_RULES: ReadonlyArray<{ pattern: RegExp; energy: EnergyLevel }> = [
  { pattern: /\b(deep work|focus session|deep focus)\b/i, energy: 'high' },
  { pattern: /\b(quick|easy|light|admin|errand)\b/i, energy: 'low' },
];

/** Category keywords used to suggest a goal link. */
const CATEGORY_KEYWORDS: Record<string, readonly string[]> = {
  coursework: [
    'problem set',
    'pset',
    'homework',
    'assignment',
    'quiz',
    'exam',
    'midterm',
    'final',
    'lecture',
    'notes',
    'class',
    'study',
    'reading',
    'essay',
    'lab',
    'office hours',
    'automata',
    'calculus',
    'algebra',
  ],
  career: [
    'internship',
    'application',
    'apply',
    'resume',
    'cover letter',
    'interview',
    'leetcode',
    'algorithm',
    'recruiting',
    'recruiter',
    'referral',
    'offer',
    'networking',
    'career fair',
  ],
  project: [
    'momentum',
    'build',
    'ship',
    'deploy',
    'implement',
    'refactor',
    'test',
    'tests',
    'bug',
    'feature',
    'repo',
    'readme',
    'api',
    'component',
    'schema',
    'migration',
  ],
  health: [
    'gym',
    'run',
    'running',
    'workout',
    'lift',
    'lifting',
    'cardio',
    'exercise',
    'fitness',
    'yoga',
    'swim',
    'walk',
    'sleep',
  ],
  personal: ['groceries', 'laundry', 'call', 'birthday', 'appointment', 'errand', 'clean'],
};

/**
 * Parses a capture into proposed actions.
 *
 * Multiline input is treated as one task per non-empty line, which is how a
 * brain dump is actually typed.
 */
export function parseCaptureDeterministically(
  text: string,
  context: FallbackParseContext,
): AssistantPlan {
  const trimmed = text.trim().slice(0, DOMAIN_LIMITS.captureMaxLength);

  if (!trimmed) {
    return {
      summary: 'Nothing to interpret yet.',
      actions: [
        clarify(
          'What would you like to add?',
          ['Add a task with a deadline', 'Schedule focus time'],
          'The message was empty.',
        ),
      ],
    };
  }

  const lines = trimmed
    .split(/\r?\n|(?:^|\s)[•*]\s+/m)
    .map((line) => line.replace(/^\s*[-–—]\s+/, '').trim())
    .filter((line) => line.length > 0);

  const actions: AssistantAction[] = [];

  for (const line of lines.slice(0, DOMAIN_LIMITS.maxActionsPerBatch)) {
    if (OPTIMIZE_PATTERNS.some((pattern) => pattern.test(line))) {
      actions.push({
        type: 'optimize_day',
        confidence: 0.9,
        interpretation: 'Rebuild today around your current priorities.',
        requiresConfirmation: true,
        ambiguity: null,
        date: dayKeyOf(context.now, context.timezone),
        replaceExisting: true,
      });
      continue;
    }

    if (BULK_OR_EDIT_PATTERNS.some((pattern) => pattern.test(line))) {
      actions.push(
        clarify(
          'Which task did you mean?',
          ['Open the task list and edit it directly'],
          'Editing or moving existing work needs the assistant, which is currently off. You can make this change directly in the task list.',
        ),
      );
      continue;
    }

    const parsed = parseSingleLine(line, context);
    if (parsed) actions.push(parsed);
    else {
      actions.push(
        clarify(
          'What should this task be called?',
          [],
          'That line did not contain anything that reads like a task.',
        ),
      );
    }
  }

  return { summary: buildSummary(actions), actions };
}

function parseSingleLine(line: string, context: FallbackParseContext): AssistantAction | null {
  let working = line;

  // --- Recurrence ----------------------------------------------------------
  const recurrenceRule = recurrenceFromPhrase(working);
  if (recurrenceRule) {
    working = working.replace(
      /\bevery (week ?day|business day|other week|weekend|day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i,
      ' ',
    );
    working = working.replace(/\b(daily|weekly|monthly)\b/i, ' ');
  }

  // --- Duration ------------------------------------------------------------
  const duration = extractDuration(working);
  if (duration) working = working.replace(duration.matchText, ' ');

  // --- Priority ------------------------------------------------------------
  let manualPriority: ManualPriority | null = null;
  let importance: Importance | null = null;
  for (const rule of PRIORITY_RULES) {
    const match = rule.pattern.exec(working);
    if (match) {
      manualPriority = rule.priority;
      importance = rule.importance;
      working = working.replace(match[0], ' ');
      break;
    }
  }

  // --- Energy --------------------------------------------------------------
  let energy: EnergyLevel | null = null;
  for (const rule of ENERGY_RULES) {
    if (rule.pattern.test(working)) {
      energy = rule.energy;
      break;
    }
  }

  // --- Date / time ---------------------------------------------------------
  const timing = extractTiming(working, context);
  if (timing) {
    for (const matchText of timing.matchTexts) {
      working = working.replace(matchText, ' ');
    }
  }

  const title = cleanTitle(working);
  if (!isPlausibleTitle(title)) return null;

  const goalMatch = matchGoal(line, context.goals);
  const resolvedDuration = duration?.minutes ?? context.defaultDurationMinutes;

  const interpretationParts: string[] = [];
  if (timing?.kind === 'due') {
    interpretationParts.push(
      `due ${describeInstant(timing.instant, context.timezone, timing.hasTime)}`,
    );
  } else if (timing?.kind === 'scheduled') {
    interpretationParts.push(
      `scheduled ${describeInstant(timing.instant, context.timezone, timing.hasTime)}`,
    );
  }
  interpretationParts.push(`${resolvedDuration} min`);
  if (recurrenceRule) interpretationParts.push('repeating');
  if (manualPriority && manualPriority !== 'normal') {
    interpretationParts.push(`${manualPriority} priority`);
  }

  return {
    type: 'create_task',
    // Deliberately below the model's typical confidence: this is pattern
    // matching, and the preview should read as a draft to check.
    confidence: timing ? 0.72 : 0.6,
    interpretation: `${title} — ${interpretationParts.join(', ')}`,
    requiresConfirmation: false,
    ambiguity: goalMatch.ambiguity,
    title,
    notes: null,
    dueAt: timing?.kind === 'due' ? toIso(timing.instant) : null,
    scheduledStart: timing?.kind === 'scheduled' ? toIso(timing.instant) : null,
    durationMinutes: resolvedDuration,
    durationInferred: duration === null,
    manualPriority,
    importance,
    energy,
    goalId: goalMatch.goalId,
    goalMatchTitle: goalMatch.goalTitle,
    // A fixed commitment is a claim about the world; pattern matching should not
    // make it. The user can flip this in the preview.
    isFixedTime: false,
    splittable: resolvedDuration > 90,
    recurrenceRule,
  };
}

interface DurationMatch {
  minutes: number;
  matchText: string;
}

/** Recognizes `for 45 minutes`, `30 min`, `2 hours`, `1.5 hours`, `half an hour`. */
export function extractDuration(text: string): DurationMatch | null {
  const half = HALF_HOUR_PATTERN.exec(text);
  if (half) return { minutes: 30, matchText: half[0] };

  const anHour = AN_HOUR_PATTERN.exec(text);
  if (anHour) return { minutes: 60, matchText: anHour[0] };

  const match = DURATION_PATTERN.exec(text);
  if (!match?.[1] || !match[2]) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const isHours = unit.startsWith('h');
  const minutes = Math.round(isHours ? amount * 60 : amount);

  // A bare number with a date nearby is far more likely to be a time than a
  // duration, so reject implausible values rather than inventing a 3-minute task.
  if (minutes < DOMAIN_LIMITS.minTaskDurationMinutes) return null;

  return {
    minutes: clamp(
      minutes,
      DOMAIN_LIMITS.minTaskDurationMinutes,
      DOMAIN_LIMITS.maxTaskDurationMinutes,
    ),
    matchText: match[0],
  };
}

interface TimingMatch {
  kind: 'due' | 'scheduled';
  instant: Date;
  hasTime: boolean;
  /** Every phrase consumed, so all of them can be stripped from the title. */
  matchTexts: string[];
}

/**
 * Resolves a date/time phrase to an absolute instant in the user's timezone,
 * and decides whether it reads as a deadline or as planned working time.
 *
 * chrono frequently reports `tomorrow` and `by 6 PM` as two *separate* results,
 * so the date and the time are gathered independently and recombined. Taking
 * only the first result would silently drop the time and quietly file the task
 * at the end of the day.
 */
export function extractTiming(text: string, context: FallbackParseContext): TimingMatch | null {
  const { timezone, now } = context;

  // Project the reference into a floating frame so chrono's UTC math lines up
  // with the user's wall clock, and force offset 0 so it adds no shift of its own.
  const floatingRef = new Date(`${formatInZone(now, timezone, "yyyy-MM-dd'T'HH:mm:ss")}Z`);

  const results = chrono.parse(text, { instant: floatingRef, timezone: 0 }, { forwardDate: true });
  if (results.length === 0) return null;

  const dateSource = results.find((result) => result.start.isCertain('day')) ?? results[0];
  const timeSource = results.find((result) => result.start.isCertain('hour')) ?? null;
  if (!dateSource) return null;

  const year = dateSource.start.get('year');
  const month = dateSource.start.get('month');
  const day = dateSource.start.get('day');
  if (year === null || month === null || day === null) return null;

  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const hasTime = timeSource !== null;

  const isDeadline = DEADLINE_MARKERS.test(text);
  const kind: TimingMatch['kind'] = isDeadline ? 'due' : hasTime ? 'scheduled' : 'due';

  let clockTime: ClockTime;
  if (timeSource) {
    clockTime = resolveClockTime(timeSource);
  } else {
    // A date-only deadline means "by the end of that day"; a date-only working
    // time means "sometime that day", so start of the workday.
    clockTime = normalizeClockTime(kind === 'due' ? context.workdayEnd : context.workdayStart);
  }

  const matchTexts = [dateSource.text];
  if (timeSource && timeSource !== dateSource) matchTexts.push(timeSource.text);

  return {
    kind,
    instant: zonedTimeToInstant(dayKey, clockTime, timezone),
    hasTime,
    matchTexts,
  };
}

/**
 * Reads the clock time from a chrono result.
 *
 * A bare early hour with no stated meridiem is treated as afternoon: "at 5" and
 * "at 6" mean the evening far more often than dawn when someone is planning
 * study time. Hours 8–12 are left alone, and an explicit `am`/`pm` always wins.
 * The preview shows the resolved time, so a wrong guess is one click to fix.
 */
function resolveClockTime(result: chrono.ParsedResult): ClockTime {
  const rawHour = result.start.get('hour') ?? 9;
  const minute = result.start.get('minute') ?? 0;
  const meridiemStated = result.start.isCertain('meridiem');

  const hour = !meridiemStated && rawHour >= 1 && rawHour <= 7 ? rawHour + 12 : rawHour;
  return minutesToClockTime(hour * 60 + minute);
}

interface GoalMatch {
  goalId: string | null;
  goalTitle: string | null;
  ambiguity: AssistantAction['ambiguity'];
}

/**
 * Suggests a goal from keyword overlap.
 *
 * A tie is reported as an ambiguity instead of being broken arbitrarily —
 * silently attaching work to the wrong goal quietly corrupts every ranking and
 * every insight that follows.
 */
export function matchGoal(text: string, goals: readonly FallbackGoalCandidate[]): GoalMatch {
  if (goals.length === 0) return { goalId: null, goalTitle: null, ambiguity: null };

  const lower = text.toLowerCase();
  const scored = goals.map((goal) => {
    let score = 0;

    for (const keyword of CATEGORY_KEYWORDS[goal.category] ?? []) {
      if (lower.includes(keyword)) score += 2;
    }

    // Distinctive words from the goal's own title.
    const titleWords = goal.title
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 4);
    for (const word of titleWords) {
      if (lower.includes(word)) score += 3;
    }

    return { goal, score };
  });

  const best = Math.max(...scored.map((entry) => entry.score));
  if (best === 0) return { goalId: null, goalTitle: null, ambiguity: null };

  const leaders = scored.filter((entry) => entry.score === best);
  if (leaders.length > 1) {
    return {
      goalId: null,
      goalTitle: null,
      ambiguity: {
        field: 'goalId',
        question: 'Which goal does this belong to?',
        options: leaders.map((entry) => entry.goal.title).slice(0, 6),
      },
    };
  }

  const winner = leaders[0]?.goal;
  return winner
    ? { goalId: winner.id, goalTitle: winner.title, ambiguity: null }
    : { goalId: null, goalTitle: null, ambiguity: null };
}

/** Strips leftover connectives and punctuation after extraction. */
function cleanTitle(text: string): string {
  let title = text
    .replace(/\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ' ')
    .replace(/\b(and|then|also|plus)\s*$/i, '')
    .replace(/^\s*(and|then|also|plus)\s+/i, '')
    .replace(/\s*\b(by|due|before|at|on|for|from|no later than)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  title = title.replace(/[\s\-–—:]+$/, '').trim();
  if (title.length === 0) return title;

  // Sentence case without disturbing an intentional acronym.
  const first = title.charAt(0);
  if (first === first.toLowerCase() && /[a-z]/.test(first)) {
    title = first.toUpperCase() + title.slice(1);
  }

  return title.slice(0, DOMAIN_LIMITS.taskTitleMaxLength);
}

/** Guards against fabricating a title out of stray punctuation or numbers. */
function isPlausibleTitle(title: string): boolean {
  if (title.length < 3) return false;
  if (!/[a-z]{2}/i.test(title)) return false;
  return true;
}

function describeInstant(instant: Date, timezone: string, hasTime: boolean): string {
  const today = dayKeyOf(new Date(), timezone);
  const target = dayKeyOf(instant, timezone);
  const dayLabel =
    target === today
      ? 'today'
      : target === addDayKeys(today, 1)
        ? 'tomorrow'
        : formatInZone(instant, timezone, 'EEE MMM d');

  return hasTime ? `${dayLabel} at ${formatInZone(instant, timezone, 'h:mm a')}` : dayLabel;
}

function clarify(question: string, options: string[], interpretation: string): AssistantAction {
  return {
    type: 'clarify',
    confidence: 1,
    interpretation,
    requiresConfirmation: false,
    ambiguity: null,
    question,
    options,
  };
}

function buildSummary(actions: readonly AssistantAction[]): string {
  const created = actions.filter((action) => action.type === 'create_task').length;
  const clarifications = actions.filter((action) => action.type === 'clarify').length;
  const optimizations = actions.filter((action) => action.type === 'optimize_day').length;

  const parts: string[] = [];
  if (created > 0) parts.push(`${created} ${created === 1 ? 'task' : 'tasks'} ready to add`);
  if (optimizations > 0) parts.push('a plan rebuild');
  if (clarifications > 0) {
    parts.push(`${clarifications} ${clarifications === 1 ? 'item needs' : 'items need'} a detail`);
  }

  if (parts.length === 0) return 'Nothing to apply.';
  return `${parts.join(' and ')}. AI is off, so common dates and times were read directly.`;
}
