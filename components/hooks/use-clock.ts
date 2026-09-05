'use client';

/**
 * A shared, render-safe clock.
 *
 * Reading `Date.now()` during render is a bug in two directions: the server and
 * the client disagree about it, which is a hydration mismatch, and the value
 * then goes stale with nothing scheduled to correct it. An overdue badge that
 * only appears on refresh is the visible symptom.
 *
 * `useSyncExternalStore` is the sanctioned way to read a mutable external
 * source, and a clock is one. Snapshots are truncated to the tick interval so
 * `getSnapshot` returns a *referentially stable* number between ticks —
 * returning a raw `Date.now()` would make React see a changed store on every
 * read and re-render without end.
 *
 * The server snapshot is `null`. Time-dependent UI renders its neutral state
 * during SSR and corrects on hydration, which is honest: the server genuinely
 * does not know what time it is in the user's timezone.
 */
import * as React from 'react';

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

interface Clock {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => number | null;
  getServerSnapshot: () => number | null;
}

function makeClock(intervalMs: number): Clock {
  return {
    subscribe: (onStoreChange) => {
      const interval = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(interval);
    },
    getSnapshot: () => Math.floor(Date.now() / intervalMs) * intervalMs,
    getServerSnapshot: () => null,
  };
}

/**
 * Reports no time and subscribes to nothing.
 *
 * Swapped in when a caller does not currently need to tick — a paused focus
 * timer should not wake the tree once a second to redisplay a number that is
 * not changing. Module-level so its function identities are stable; React
 * resubscribes when `subscribe` changes, which is exactly the intent here.
 */
const idleClock: Clock = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  getServerSnapshot: () => null,
};

const minuteClock = makeClock(MINUTE_MS);
const secondClock = makeClock(SECOND_MS);

/**
 * Milliseconds since the epoch, truncated to the minute.
 *
 * `null` until hydrated. Minute resolution is right for deadlines, day
 * headings, and the timeline's "now" line — a per-second tick would re-render
 * those trees sixty times more often to move a line by less than a pixel.
 */
export function useMinuteNow(): number | null {
  return React.useSyncExternalStore(
    minuteClock.subscribe,
    minuteClock.getSnapshot,
    minuteClock.getServerSnapshot,
  );
}

/**
 * Milliseconds since the epoch, truncated to the second, while `active`.
 *
 * Returns `null` when inactive or before hydration, so callers must handle the
 * absence of a clock rather than silently substituting one.
 */
export function useSecondNow(active: boolean): number | null {
  const clock = active ? secondClock : idleClock;
  return React.useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getServerSnapshot);
}

/**
 * True once the client has hydrated, false during SSR and the first render.
 *
 * The same `useSyncExternalStore` trick with a store that never changes: the
 * only difference between server and client is which snapshot function React
 * calls. This replaces the `useState(false)` + `useEffect(() => setMounted(true))`
 * idiom, which does the same job by deliberately triggering a second render
 * pass — a cascading render that React's own lint rules now flag.
 *
 * Use it only for genuinely server-unknowable things, like a stored theme
 * preference. Gating ordinary content on hydration just delays it.
 */
export function useIsHydrated(): boolean {
  return React.useSyncExternalStore(idleClock.subscribe, alwaysTrue, alwaysFalse);
}

const alwaysTrue = (): boolean => true;
const alwaysFalse = (): boolean => false;
