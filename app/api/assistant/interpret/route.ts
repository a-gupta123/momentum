/**
 * `POST /api/assistant/interpret`
 *
 * Turns a capture into a batch of *proposed* actions. This endpoint is
 * deliberately read-only: nothing it returns has been written anywhere, and the
 * user confirms in the UI before `/api/actions/apply` touches the database.
 * Keeping interpretation and application as two endpoints is what makes the
 * preview meaningful rather than decorative.
 *
 * Where the context comes from depends on who is asking:
 *
 * - **Signed in** — read from Postgres under the caller's own RLS. Any context
 *   in the request body is ignored, because a client that can describe its own
 *   task list can describe someone else's.
 * - **Guest** — supplied in the body, because the data lives in the visitor's
 *   own localStorage and the server has no copy. It is used only to build a
 *   prompt and is never persisted.
 *
 * The route always answers 200 with a usable plan unless the request itself was
 * malformed or rate limited. A missing API key, a provider outage or a timeout
 * degrade to the deterministic parser inside `interpretCapture`.
 */
import { interpretCapture } from '@/lib/ai/interpret';
import {
  INTERPRET_RULE,
  checkRateLimit,
  rateLimitHeaders,
  rateLimitKey,
} from '@/lib/api/rate-limit';
import { ERROR_CODES, fieldErrors, jsonError, jsonOk, readJsonBody } from '@/lib/api/responses';
import { SupabasePlannerRepository } from '@/lib/repositories/supabase';
import { getCurrentUser, getServerSupabase } from '@/lib/supabase/server';
import { todayKey } from '@/lib/dates';
import type { Goal, Profile, Task } from '@/lib/domain/types';
import { interpretRequestSchema } from '@/lib/validation/api-schemas';

/**
 * Node runtime, not Edge. The OpenAI SDK and the `server-only` env module both
 * expect Node built-ins, and the model call's latency dominates cold-start
 * differences anyway.
 */
export const runtime = 'nodejs';
/** Never cached: the response depends on the caller's data and the clock. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  // Signed-in callers are keyed by user id, which cannot be spoofed the way a
  // forwarded IP can.
  const limit = checkRateLimit(rateLimitKey(request, 'interpret', user?.id), INTERPRET_RULE);
  if (!limit.ok) {
    return jsonError(
      429,
      ERROR_CODES.rateLimited,
      'That was a lot of captures at once. Try again in a moment.',
      { headers: rateLimitHeaders(limit) },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = interpretRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, ERROR_CODES.invalidRequest, 'That capture could not be read.', {
      fields: fieldErrors(parsed.error.issues),
      headers: rateLimitHeaders(limit),
    });
  }

  let profile: Profile;
  let tasks: readonly Task[];
  let goals: readonly Goal[];

  if (user) {
    const supabase = await getServerSupabase();
    if (!supabase) {
      return jsonError(
        500,
        ERROR_CODES.serverError,
        'This deployment is not configured for accounts.',
      );
    }

    try {
      const repository = new SupabasePlannerRepository({
        client: supabase,
        userId: user.id,
        // The snapshot's own profile is authoritative; this is only the
        // timezone used to pick which day to load, before that profile is read.
        timezone: 'UTC',
      });
      const snapshot = await repository.getSnapshot(todayKey('UTC'));
      profile = snapshot.profile;
      tasks = snapshot.tasks;
      goals = snapshot.goals;
    } catch {
      return jsonError(
        503,
        ERROR_CODES.serverError,
        'Your planner could not be loaded just now. Try again in a moment.',
      );
    }
  } else {
    if (!parsed.data.context) {
      return jsonError(
        400,
        ERROR_CODES.invalidRequest,
        'Guest captures need to include your current planner context.',
        { headers: rateLimitHeaders(limit) },
      );
    }
    // Zod has already confirmed the shape; the cast narrows the validated
    // structural type to the nominal domain type without re-checking.
    profile = parsed.data.context.profile as Profile;
    tasks = parsed.data.context.tasks as Task[];
    goals = parsed.data.context.goals as Goal[];
  }

  const result = await interpretCapture({
    text: parsed.data.text,
    profile,
    tasks,
    goals,
    now: new Date(),
  });

  return jsonOk(
    {
      summary: result.plan.summary,
      actions: result.plan.actions,
      source: result.source,
      fallbackReason: result.fallbackReason,
      issues: result.issues,
    },
    {
      headers: {
        ...rateLimitHeaders(limit),
        // Useful when watching latency in production; carries no user data.
        'Server-Timing': `interpret;dur=${result.latencyMs}`,
      },
    },
  );
}

/**
 * Everything else is rejected explicitly.
 *
 * Without this, a `GET` would fall through to Next's default 405 with no
 * `Allow` header, which is a worse answer to give a confused client than a
 * precise one.
 */
export async function GET(): Promise<Response> {
  return jsonError(405, ERROR_CODES.invalidRequest, 'Use POST to interpret a capture.', {
    headers: { Allow: 'POST' },
  });
}
