/**
 * `POST /api/actions/apply`
 *
 * Applies actions the user has already confirmed in the preview. This is the
 * only route in the app that writes, and it exists for authenticated users
 * only — a guest's planner lives in their own browser, so the guest client
 * applies the same confirmed actions through the same pure planner
 * (`planMutations`) against the local adapter, with no network hop.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **The AI cannot reach this endpoint.** The model produces a proposal; a
 *    human presses Confirm; the browser sends the confirmed subset. The actions
 *    arrive as data on a user-initiated request and are re-validated against
 *    the same Zod schema and the same id-existence checks as before.
 *
 * 2. **Confirm is idempotent.** The client sends a key per confirmation
 *    attempt. A double tap, an impatient retry or a browser replay after a 502
 *    returns the first response instead of duplicating the batch — which for a
 *    brain dump is the difference between four tasks and eight.
 */
import { toIso, todayKey } from '@/lib/dates';
import { planMutations } from '@/lib/domain/apply-actions';
import { APPLY_RULE, checkRateLimit, rateLimitHeaders, rateLimitKey } from '@/lib/api/rate-limit';
import {
  claimIdempotencyKey,
  recordResponse,
  releaseIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/api/idempotency';
import { ERROR_CODES, fieldErrors, jsonError, jsonOk, readJsonBody } from '@/lib/api/responses';
import { SupabasePlannerRepository } from '@/lib/repositories/supabase';
import { StaleWriteError } from '@/lib/repositories/types';
import { getCurrentUser, getServerSupabase } from '@/lib/supabase/server';
import { validatePlanAgainstContext } from '@/lib/validation/ai-actions';
import { applyRequestSchema } from '@/lib/validation/api-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    // Not an error state for guests — it means they are on the local path and
    // should never have called this. The message says which mode applies.
    return jsonError(
      401,
      ERROR_CODES.unauthorized,
      'Sign in to save changes to an account. Guest Demo changes are applied in your browser.',
    );
  }

  const limit = checkRateLimit(rateLimitKey(request, 'apply', user.id), APPLY_RULE);
  if (!limit.ok) {
    return jsonError(429, ERROR_CODES.rateLimited, 'Too many changes at once. Try again shortly.', {
      headers: rateLimitHeaders(limit),
    });
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = applyRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, ERROR_CODES.invalidRequest, 'Those changes could not be read.', {
      fields: fieldErrors(parsed.error.issues),
      headers: rateLimitHeaders(limit),
    });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return jsonError(
      500,
      ERROR_CODES.serverError,
      'This deployment is not configured for accounts.',
    );
  }

  // Namespaced by user so two accounts cannot collide, and so one account
  // cannot probe another's keys.
  const key = scopedIdempotencyKey(user.id, parsed.data.idempotencyKey);
  const claim = claimIdempotencyKey(key);

  if (claim.status === 'replay') {
    return jsonOk(claim.response.body as object, {
      status: claim.response.status,
      headers: { ...rateLimitHeaders(limit), 'Idempotent-Replay': 'true' },
    });
  }

  if (claim.status === 'in_flight') {
    return jsonError(
      409,
      ERROR_CODES.conflict,
      'Those changes are still being saved. Give it a second.',
      { headers: { ...rateLimitHeaders(limit), 'Retry-After': '2' } },
    );
  }

  try {
    const repository = new SupabasePlannerRepository({
      client: supabase,
      userId: user.id,
      timezone: 'UTC',
    });

    const snapshot = await repository.getSnapshot(todayKey('UTC'));

    // Re-validate ids against what exists *now*, not against whatever the
    // preview was built from. A task deleted in another tab between preview and
    // confirm must not be resurrected by a stale reference.
    const validated = validatePlanAgainstContext(
      { summary: '', actions: parsed.data.actions },
      {
        taskIds: new Set(snapshot.tasks.map((task) => task.id)),
        goalIds: new Set(snapshot.goals.map((goal) => goal.id)),
      },
    );

    if (validated.plan.actions.length === 0) {
      const payload = {
        appliedCount: 0,
        createdTaskIds: [] as string[],
        createdGoalIds: [] as string[],
        rejected: validated.issues.map((issue) => ({
          index: issue.index,
          kind: issue.actionType,
          reason: issue.message,
        })),
        deferredOptimizeDates: [] as string[],
        skipped: [] as Array<{ index: number; type: string; reason: string }>,
      };
      recordResponse(key, 200, payload);
      return jsonOk(payload, { headers: rateLimitHeaders(limit) });
    }

    const now = new Date();
    const planned = planMutations(validated.plan.actions, {
      profile: snapshot.profile,
      tasks: snapshot.tasks,
      goals: snapshot.goals,
      now,
      sourceText: parsed.data.sourceText,
    });

    const outcome = await repository.applyMutations(planned.mutations);

    const payload = {
      appliedCount: outcome.appliedCount,
      createdTaskIds: outcome.createdTaskIds,
      createdGoalIds: outcome.createdGoalIds,
      rejected: [
        ...outcome.rejected,
        ...validated.issues.map((issue) => ({
          index: issue.index,
          kind: issue.actionType,
          reason: issue.message,
        })),
      ],
      /**
       * `optimize_day` is not a blind write: it needs the scheduler and a
       * before/after preview. The dates are handed back so the client can run
       * the normal Optimize Day flow instead of the server silently rewriting
       * somebody's afternoon.
       */
      deferredOptimizeDates: planned.deferred.map((action) => action.date),
      skipped: planned.skipped,
      /** Sent so the client can offer Undo without re-deriving the inverse. */
      inverse: outcome.inverse,
      appliedAt: toIso(now),
    };

    recordResponse(key, 200, payload);
    return jsonOk(payload, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    // Nothing durable was written on these paths, so the key is released and
    // the client may safely retry with the same one.
    releaseIdempotencyKey(key);

    if (error instanceof StaleWriteError) {
      return jsonError(409, ERROR_CODES.conflict, error.message, {
        headers: rateLimitHeaders(limit),
      });
    }

    return jsonError(
      500,
      ERROR_CODES.serverError,
      'Those changes could not be saved. Nothing was applied — try again.',
      { headers: rateLimitHeaders(limit) },
    );
  }
}

export async function GET(): Promise<Response> {
  return jsonError(405, ERROR_CODES.invalidRequest, 'Use POST to apply confirmed changes.', {
    headers: { Allow: 'POST' },
  });
}
