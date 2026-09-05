'use client';

/**
 * The focus timer.
 *
 * The important property is that **elapsed time is derived, never counted**.
 * The persisted session stores `startedAt` and the minutes banked from earlier
 * paused stretches; the display recomputes from the wall clock on every tick.
 *
 * That is what makes a refresh, a closed laptop, a backgrounded tab or a
 * throttled `setInterval` harmless. A timer that increments a counter every
 * second loses minutes to every one of those, and the loss is invisible until
 * the user notices their two-hour session logged 47 minutes.
 *
 * Recording actual time also feeds estimate accuracy in Insights, which is the
 * only way the app can tell someone their 30-minute tasks really take 50.
 */
import { Pause, Play, Square, Timer } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
import { useSecondNow } from '@/components/hooks/use-clock';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDuration, parseIso, toIso } from '@/lib/dates';
import type { FocusSession } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export interface FocusController {
  session: FocusSession | null;
  start: (taskId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: (options?: { complete?: boolean }) => Promise<void>;
}

export function useFocusTimer(): FocusController {
  const { snapshot, setFocusSession, updateTask, completeTask, logEventMinutes } =
    useFocusDependencies();

  const session = snapshot?.focusSession ?? null;

  const commitElapsed = React.useCallback(
    async (current: FocusSession) => {
      const minutes = elapsedMinutes(current);
      if (minutes <= 0) return;
      await logEventMinutes(current.taskId, minutes);
    },
    [logEventMinutes],
  );

  const start = React.useCallback(
    async (taskId: string) => {
      // Starting a new session banks the current one rather than discarding it,
      // so switching tasks never silently loses the time already spent.
      if (session && session.taskId !== taskId) {
        await commitElapsed(session);
      }

      await setFocusSession({
        taskId,
        startedAt: toIso(new Date()),
        accumulatedMinutes: session?.taskId === taskId ? session.accumulatedMinutes : 0,
        isPaused: false,
      });

      await updateTask(taskId, { status: 'in_progress' });
    },
    [session, commitElapsed, setFocusSession, updateTask],
  );

  const pause = React.useCallback(async () => {
    if (!session || session.isPaused) return;
    // The running stretch is folded into `accumulatedMinutes` and the clock is
    // restarted, so resuming does not double-count the paused interval.
    await setFocusSession({
      ...session,
      accumulatedMinutes: elapsedMinutes(session),
      startedAt: toIso(new Date()),
      isPaused: true,
    });
  }, [session, setFocusSession]);

  const resume = React.useCallback(async () => {
    if (!session || !session.isPaused) return;
    await setFocusSession({ ...session, startedAt: toIso(new Date()), isPaused: false });
  }, [session, setFocusSession]);

  const stop = React.useCallback(
    async (options?: { complete?: boolean }) => {
      if (!session) return;

      const minutes = elapsedMinutes(session);
      const taskId = session.taskId;

      await setFocusSession(null);

      if (minutes > 0) {
        await logEventMinutes(taskId, minutes);
      }

      if (options?.complete) {
        await completeTask(taskId, minutes > 0 ? minutes : null);
        toast.success(`Logged ${formatDuration(minutes)} and marked it done.`);
        return;
      }

      await updateTask(taskId, {
        status: 'planned',
        actualMinutes: minutes > 0 ? minutes : null,
      });

      if (minutes > 0) toast.success(`Logged ${formatDuration(minutes)} of focus.`);
    },
    [session, setFocusSession, logEventMinutes, completeTask, updateTask],
  );

  return { session, start, pause, resume, stop };
}

/** Narrow view of the store, plus the one derived helper the timer needs. */
function useFocusDependencies() {
  const planner = usePlanner();

  const logEventMinutes = React.useCallback(
    async (taskId: string, minutes: number) => {
      await planner.repository?.logEvent({
        eventType: 'focus_session',
        taskId,
        durationMinutes: minutes,
      });
      // The task's own `actualMinutes` accumulates across sessions so estimate
      // accuracy reflects the whole effort, not just the last sitting.
      const task = planner.tasks.find((candidate) => candidate.id === taskId);
      if (task) {
        await planner.updateTask(taskId, {
          actualMinutes: (task.actualMinutes ?? 0) + minutes,
        });
      }
    },
    [planner],
  );

  return {
    snapshot: planner.snapshot,
    setFocusSession: planner.setFocusSession,
    updateTask: planner.updateTask,
    completeTask: planner.completeTask,
    logEventMinutes,
  };
}

export function FocusTimerCard({ controller }: { controller: FocusController }) {
  const { tasks } = usePlanner();
  const session = controller.session;
  const elapsed = useLiveElapsed(session);

  const task = React.useMemo(
    () => (session ? (tasks.find((candidate) => candidate.id === session.taskId) ?? null) : null),
    [tasks, session],
  );

  if (!session || !task) return null;

  return (
    <Card
      className={cn(
        'border-primary-border bg-primary-soft/60 sticky top-3 z-30 backdrop-blur-sm',
        'lg:top-4',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              'bg-primary text-primary-ink flex size-9 shrink-0 items-center justify-center rounded-full',
              // A gentle pulse while running, nothing while paused, so the
              // state is legible from across the room.
              !session.isPaused && 'motion-safe:animate-pulse',
            )}
            aria-hidden
          >
            <Timer className="size-4" />
          </span>

          <div className="min-w-0">
            <p className="text-ink truncate text-sm font-medium">{task.title}</p>
            <p className="text-ink-muted text-xs">
              {session.isPaused ? 'Paused' : 'Focusing'} · estimated{' '}
              {formatDuration(task.durationMinutes)}
            </p>
          </div>
        </div>

        <p
          className="text-ink text-2xl leading-none font-semibold tabular-nums"
          // Announced only on the minute, not every second — a per-second live
          // region makes a screen reader unusable.
          aria-live="polite"
          aria-atomic="true"
        >
          {formatClock(elapsed)}
        </p>

        <div className="flex items-center gap-1.5">
          {session.isPaused ? (
            <Button variant="secondary" size="sm" onClick={() => void controller.resume()}>
              <Play className="size-3.5" aria-hidden />
              Resume
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void controller.pause()}>
              <Pause className="size-3.5" aria-hidden />
              Pause
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void controller.stop()}>
            <Square className="size-3.5" aria-hidden />
            Stop
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void controller.stop({ complete: true })}
          >
            Done
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Minutes elapsed, recomputed from the clock rather than counted. */
function elapsedMinutes(session: FocusSession): number {
  if (session.isPaused) return session.accumulatedMinutes;
  const started = parseIso(session.startedAt);
  if (!started) return session.accumulatedMinutes;
  const running = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60_000));
  return session.accumulatedMinutes + running;
}

/**
 * Seconds elapsed, for the display. Same derivation, finer resolution.
 *
 * `nowMs` is passed in rather than read from `Date.now()` so the result is a
 * pure function of its arguments. A `null` clock means "no running clock to
 * read" — before hydration, or while paused — and only banked time counts.
 */
function elapsedSeconds(session: FocusSession, nowMs: number | null): number {
  const banked = session.accumulatedMinutes * 60;
  if (session.isPaused || nowMs === null) return banked;
  const started = parseIso(session.startedAt);
  if (!started) return banked;
  return banked + Math.max(0, Math.floor((nowMs - started.getTime()) / 1000));
}

/**
 * Elapsed time is derived, not counted.
 *
 * The subscription only provides a reason to re-render; the number itself is
 * recomputed from the session's start timestamp every time. That is what makes
 * a throttled background tab, a skipped interval, or a laptop resuming from
 * sleep self-correct instead of accumulating drift — and it means there is one
 * source of truth for elapsed time rather than a counter that can disagree
 * with the timestamps it was derived from.
 */
function useLiveElapsed(session: FocusSession | null): number {
  const isRunning = session !== null && !session.isPaused;
  const now = useSecondNow(isRunning);
  return session ? elapsedSeconds(session, now) : 0;
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
