import 'server-only';

/**
 * Fixed-window rate limiting.
 *
 * ## Why in-memory
 *
 * This is a per-instance counter held in a module-level `Map`. On a single
 * server, or a single warm serverless instance, it works exactly as intended.
 * Across N instances the effective limit becomes N × the configured limit, and
 * a cold start resets the window.
 *
 * That is a deliberate trade, and the honest way to describe it is: this is
 * abuse *dampening*, not a billing control. It stops a runaway client loop and
 * a casual scraper from turning one capture box into thousands of model calls,
 * which is the realistic threat for this app. It is not a defence against a
 * distributed attacker.
 *
 * Making it correct across instances means moving the counter to shared
 * storage — Upstash Redis, or a Postgres table with a `SELECT ... FOR UPDATE`.
 * The interface below is deliberately narrow (`check` returning a decision) so
 * that swap is a one-file change with no call-site edits.
 */

export interface RateLimitDecision {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the current window ends. */
  resetAt: number;
  /** Seconds to wait, for the `Retry-After` header. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

/**
 * Model calls cost money and latency, so the assistant is the tighter bucket.
 * 20/minute is far above real human capture speed while still bounding a loop.
 */
export const INTERPRET_RULE: RateLimitRule = { limit: 20, windowMs: 60_000 };

/** Applying confirmed actions is cheap; the ceiling only bounds runaway retries. */
export const APPLY_RULE: RateLimitRule = { limit: 60, windowMs: 60_000 };

const buckets = new Map<string, Window>();

/**
 * Bound on distinct keys tracked at once.
 *
 * Without this, the map is an unbounded allocation driven by attacker-supplied
 * addresses — the rate limiter itself becomes the memory-exhaustion vector.
 */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

/** Records a request against `key` and reports whether it may proceed. */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitDecision {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    // Sweeping only on window creation keeps the common path O(1); the expired
    // entries being cleared are exactly the ones a new window would replace.
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);
    if (buckets.size >= MAX_TRACKED_KEYS) {
      // Still full of live windows: fail closed rather than grow without bound.
      return {
        ok: false,
        limit: rule.limit,
        remaining: 0,
        resetAt: now + rule.windowMs,
        retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
      };
    }

    const resetAt = now + rule.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, rule.limit - existing.count);
  const ok = existing.count <= rule.limit;

  return {
    ok,
    limit: rule.limit,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Best-effort client identity.
 *
 * A signed-in user is keyed by their id, which is trustworthy. An anonymous
 * guest is keyed by forwarded IP, which is not — `x-forwarded-for` is
 * client-supplied unless a proxy overwrites it. Vercel and most managed
 * platforms do overwrite it; a bare Node deployment behind no proxy does not.
 * Keyed this way the limiter is still useful for its actual purpose (bounding
 * accidental loops) without pretending to be an identity check.
 */
export function rateLimitKey(request: Request, scope: string, userId?: string | null): string {
  if (userId) return `${scope}:user:${userId}`;

  const forwarded = request.headers.get('x-forwarded-for');
  const address =
    forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')?.trim() ?? 'unknown';

  return `${scope}:ip:${address}`;
}

/** Standard rate-limit headers, so a client can back off without guessing. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(Math.ceil((decision.resetAt - Date.now()) / 1000)),
  };
  if (!decision.ok) headers['Retry-After'] = String(decision.retryAfterSeconds);
  return headers;
}

/** Test-only reset; module state would otherwise leak between test cases. */
export function __resetRateLimits(): void {
  buckets.clear();
}
