import 'server-only';

/**
 * Capture interpretation.
 *
 * The contract this module exists to uphold: **a capture always produces a
 * usable result.** No API key, an expired key, a rate limit, a timeout, a
 * malformed response, a hallucinated id — every one of those degrades to the
 * deterministic `chrono-node` parser rather than showing the user an error. The
 * planner's core promise is "type what's on your mind and get structure back",
 * and that promise cannot be contingent on a third-party service being up.
 *
 * The AI never writes anything. It returns a proposal, that proposal is parsed
 * by the same Zod schema the client uses, ids are checked against the candidate
 * list that was actually sent, and only then is it shown to the user for
 * confirmation. `source` on the result tells the UI which path ran so it can
 * label the preview honestly.
 */
import OpenAI from 'openai';

import { parseCaptureDeterministically } from '@/lib/ai/fallback-parser';
import { toStructuredOutputSchema } from '@/lib/ai/json-schema';
import { buildPrompt, sanitizeCapture } from '@/lib/ai/prompt';
import type { Goal, Profile, Task } from '@/lib/domain/types';
import {
  assistantPlanSchema,
  validatePlanAgainstContext,
  type ActionValidationIssue,
  type AssistantPlan,
} from '@/lib/validation/ai-actions';
import { isOpenAiConfigured, openAiApiKey, openAiModel } from '@/lib/validation/server-env';

/** Which path produced the plan. Surfaced in the UI, not just logged. */
export type InterpretationSource = 'ai' | 'deterministic';

export interface InterpretResult {
  plan: AssistantPlan;
  source: InterpretationSource;
  /** Actions dropped or repaired during id validation. */
  issues: ActionValidationIssue[];
  /**
   * Why the deterministic parser ran, when it did. Shown to the user as a quiet
   * note so an unexpectedly literal interpretation is explainable rather than
   * mysterious.
   */
  fallbackReason: string | null;
  /** Round-trip time, for the response header only. Never user-facing. */
  latencyMs: number;
}

export interface InterpretInput {
  text: string;
  profile: Profile;
  tasks: readonly Task[];
  goals: readonly Goal[];
  now: Date;
}

/**
 * Hard ceiling on the model call.
 *
 * A capture is an interactive action: the user is waiting with their hands on
 * the keyboard. Past a few seconds the deterministic parser — which returns in
 * single-digit milliseconds — is simply the better product, so the timeout is
 * tuned to responsiveness rather than to giving the model every chance.
 */
const REQUEST_TIMEOUT_MS = 9_000;
const MAX_OUTPUT_TOKENS = 2_000;

/** Cached across warm invocations; building the schema on every call is waste. */
let cachedSchema: Record<string, unknown> | null = null;

function planJsonSchema(): Record<string, unknown> {
  cachedSchema ??= toStructuredOutputSchema(assistantPlanSchema);
  return cachedSchema;
}

let cachedClient: OpenAI | null = null;

function client(): OpenAI {
  if (!openAiApiKey) {
    throw new Error('OpenAI is not configured.');
  }
  cachedClient ??= new OpenAI({
    apiKey: openAiApiKey,
    timeout: REQUEST_TIMEOUT_MS,
    // One retry only, and only for the transient classes the SDK retries by
    // default. More would blow past the timeout budget above.
    maxRetries: 1,
  });
  return cachedClient;
}

/**
 * Interprets a capture, preferring the model and falling back silently.
 *
 * `aiAssistEnabled` on the profile is honoured as a user preference: somebody
 * who turned the assistant off gets the deterministic parser even on a fully
 * configured deployment.
 */
export async function interpretCapture(input: InterpretInput): Promise<InterpretResult> {
  const startedAt = Date.now();
  const capture = sanitizeCapture(input.text);

  const deterministic = (reason: string | null): InterpretResult => ({
    plan: parseCaptureDeterministically(capture, {
      now: input.now,
      timezone: input.profile.timezone,
      defaultDurationMinutes: input.profile.defaultTaskDurationMinutes,
      workdayStart: input.profile.workdayStart,
      workdayEnd: input.profile.workdayEnd,
      goals: input.goals
        .filter((goal) => goal.status === 'active' || goal.status === 'paused')
        .map((goal) => ({ id: goal.id, title: goal.title, category: goal.category })),
    }),
    source: 'deterministic',
    issues: [],
    fallbackReason: reason,
    latencyMs: Date.now() - startedAt,
  });

  if (!isOpenAiConfigured) return deterministic(null);
  if (!input.profile.aiAssistEnabled) return deterministic(null);
  if (!capture) return deterministic(null);

  try {
    const prompt = buildPrompt(capture, {
      profile: input.profile,
      now: input.now,
      tasks: input.tasks,
      goals: input.goals,
    });

    const response = await client().responses.create({
      model: openAiModel as string,
      instructions: prompt.system,
      input: prompt.user,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // Near-deterministic: the same note should not produce a different plan
      // on a retry, or the preview stops being trustworthy.
      temperature: 0.2,
      text: {
        format: {
          type: 'json_schema',
          name: 'momentum_assistant_plan',
          schema: planJsonSchema(),
          strict: true,
        },
      },
    });

    // A truncated response is not a valid plan even if the prefix parses.
    if (response.status === 'incomplete') {
      return deterministic('The assistant ran long, so your note was read literally.');
    }

    const raw = response.output_text;
    if (!raw || raw.trim().length === 0) {
      return deterministic('The assistant returned nothing, so your note was read literally.');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return deterministic(
        'The assistant returned an unreadable response, so your note was read literally.',
      );
    }

    // Structured Outputs makes this unlikely, but "unlikely" is not "cannot":
    // the shape is still verified against the same schema the client trusts.
    const parsed = assistantPlanSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return deterministic(
        'The assistant returned an unexpected shape, so your note was read literally.',
      );
    }

    // Last line of defence against invented ids.
    const validated = validatePlanAgainstContext(parsed.data, {
      taskIds: prompt.allowedTaskIds,
      goalIds: prompt.allowedGoalIds,
    });

    // If every action was dropped, the model effectively failed. The
    // deterministic parser at least captures the text as a task.
    if (validated.plan.actions.length === 0 && parsed.data.actions.length > 0) {
      return deterministic(
        'The assistant referred to items that no longer exist, so your note was read literally.',
      );
    }

    return {
      plan: validated.plan,
      source: 'ai',
      issues: validated.issues,
      fallbackReason: null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return deterministic(describeFailure(error));
  }
}

/**
 * Turns a failure into one calm sentence.
 *
 * Never includes the provider's message: it can contain account details, and a
 * user who typed a note about their essay does not need an HTTP status. The
 * distinction that *is* worth drawing is temporary versus configured, because
 * it tells the user whether retrying is worth their time.
 */
function describeFailure(error: unknown): string {
  if (error instanceof OpenAI.APIUserAbortError || isTimeout(error)) {
    return 'The assistant took too long, so your note was read literally.';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'The assistant is busy right now, so your note was read literally.';
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return 'The assistant is not available on this deployment, so your note was read literally.';
  }
  return 'The assistant is unavailable, so your note was read literally.';
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
