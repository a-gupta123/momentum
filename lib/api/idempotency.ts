import 'server-only';

/**
 * Idempotency for the apply endpoint.
 *
 * ## The problem this solves
 *
 * "Confirm" is the one click in this product that must not double-fire. A flaky
 * connection, an impatient second click, or a browser retry on a 502 can all
 * deliver the same batch twice, and the user would see their brain dump appear
 * as duplicate tasks with no obvious cause.
 *
 * The client generates a key per confirmation attempt and resends the *same*
 * key on retry. The first request executes and its response is remembered; a
 * replay returns the stored response without touching the database.
 *
 * ## In-flight requests
 *
 * A key is reserved *before* the work starts, so two concurrent requests with
 * the same key do not both execute. The second gets a `conflict` result and can
 * retry once the first has landed. This is the case a naive
 * "check-then-store" cache misses entirely.
 *
 * ## Same caveat as the rate limiter
 *
 * Module-level state: correct on one instance, best-effort across several. The
 * durable version is a `idempotency_keys` table with a unique constraint on the
 * key and the response stored alongside it, which is a change confined to this
 * file.
 */

interface Entry {
  /** Absent while the original request is still running. */
  response: { status: number; body: unknown } | null;
  expiresAt: number;
}

/**
 * Long enough to cover a user retrying a failed confirmation by hand, short
 * enough that a key reused days later is not silently swallowed.
 */
const TTL_MS = 10 * 60_000;
const MAX_TRACKED_KEYS = 5_000;

const entries = new Map<string, Entry>();

export type IdempotencyLookup =
  | { status: 'fresh' }
  | { status: 'replay'; response: { status: number; body: unknown } }
  | { status: 'in_flight' };

function sweep(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

/**
 * Claims `key` for the current request.
 *
 * Returns `fresh` exactly once per key per TTL. The caller must follow a
 * `fresh` claim with either `recordResponse` or `release`, or the key stays
 * `in_flight` until it expires.
 */
export function claimIdempotencyKey(key: string): IdempotencyLookup {
  const now = Date.now();
  const existing = entries.get(key);

  if (existing && existing.expiresAt > now) {
    if (existing.response) return { status: 'replay', response: existing.response };
    return { status: 'in_flight' };
  }

  if (entries.size >= MAX_TRACKED_KEYS) sweep(now);
  entries.set(key, { response: null, expiresAt: now + TTL_MS });
  return { status: 'fresh' };
}

/** Stores the outcome so a replay of the same key returns it verbatim. */
export function recordResponse(key: string, status: number, body: unknown): void {
  const entry = entries.get(key);
  const expiresAt = entry?.expiresAt ?? Date.now() + TTL_MS;
  entries.set(key, { response: { status, body }, expiresAt });
}

/**
 * Frees a claimed key without recording a result.
 *
 * Used when the handler failed in a way that leaves nothing applied — the
 * request should be safely retryable with the same key rather than permanently
 * blocked by its own failure.
 */
export function releaseIdempotencyKey(key: string): void {
  const entry = entries.get(key);
  if (entry && !entry.response) entries.delete(key);
}

/** Namespaces keys by user so two accounts cannot collide or read each other. */
export function scopedIdempotencyKey(userId: string, clientKey: string): string {
  return `${userId}:${clientKey}`;
}

/** Test-only reset. */
export function __resetIdempotency(): void {
  entries.clear();
}
