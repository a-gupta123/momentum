'use client';

/**
 * Capacity summary and the commit action for the day's proposal.
 *
 * The scheduler runs continuously and its output is only a *proposal* until
 * the user commits it. That separation matters: the timeline can keep
 * re-planning as tasks change without the app silently rewriting a schedule
 * someone is actively working against.
 *
 * The honest part of this panel is the overflow list. A planner that quietly
 * drops what does not fit teaches you to distrust it; naming the work that
 * did not make the day — and why — is the whole point of a capacity model.
 */
import { AlertTriangle, CalendarCheck, RefreshCw, Wand2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { usePlanner } from '@/components/planner/planner-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { formatDuration } from '@/lib/dates';
import type { DaySchedule } from '@/lib/domain/scheduler';
import { cn, pluralize } from '@/lib/utils';

export interface PlanCommitController {
  commit: () => Promise<void>;
  isSaving: boolean;
  /** True when the saved plan is the one for the day on screen. */
  isCommitted: boolean;
}

/**
 * Committing the proposal, exposed as a hook so the assistant's `optimize_day`
 * action runs exactly the same path the button does. One code path means the
 * two entry points cannot drift into behaving differently.
 */
export function useCommitPlan(schedule: DaySchedule | null): PlanCommitController {
  const { repository, refresh, snapshot, dayKey } = usePlanner();
  const [isSaving, setIsSaving] = React.useState(false);

  const committed = snapshot?.plan ?? null;
  const isCommitted = committed !== null && committed.planDate === dayKey;

  const commit = React.useCallback(async () => {
    if (!repository || !schedule) return;
    setIsSaving(true);
    try {
      // Locked blocks survive the replace, so committing again never moves
      // something the user deliberately pinned.
      const lockedBlockIds = (snapshot?.blocks ?? [])
        .filter((block) => block.isLocked)
        .map((block) => block.id);

      await repository.savePlan({ schedule, lockedBlockIds });
      await refresh();

      const missed = schedule.diagnostics.overflowMinutes;
      toast.success(
        missed > 0 ? `Day planned. ${formatDuration(missed)} did not fit.` : 'Day planned.',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the plan.');
    } finally {
      setIsSaving(false);
    }
  }, [repository, refresh, schedule, snapshot]);

  return { commit, isSaving, isCommitted };
}

export function DayPlanPanel({
  schedule,
  commitController,
  onOpenTask,
}: {
  schedule: DaySchedule;
  commitController: PlanCommitController;
  onOpenTask: (id: string) => void;
}) {
  const { isMutating } = usePlanner();
  const { commit, isSaving, isCommitted } = commitController;

  const { availableMinutes, scheduledMinutes, fixedMinutes, overflowMinutes } =
    schedule.diagnostics;

  // Load is measured against the *available* window (what is left after fixed
  // commitments), because that is the number the user can actually spend.
  const load = availableMinutes === 0 ? 0 : Math.min(1, scheduledMinutes / availableMinutes);

  // Slack is derived from the two figures already on screen rather than read
  // from `freeMinutes`, which counts unused *slots* and drops to zero once
  // breaks are placed — a true number that contradicts the sentence above it.
  const slackMinutes = Math.max(0, availableMinutes - scheduledMinutes);
  const hasOverflow = overflowMinutes > 0;

  // Deliberately keyed to how full the day is, not to whether work overflowed.
  // Overflow is normal — there is almost always more to do than time to do it,
  // and it already gets a named, itemised amber panel below. Turning the
  // capacity bar red for it would flag a well-packed day as a failure.
  const tone = load >= 1 && hasOverflow ? 'urgent' : load >= 0.9 ? 'warning' : 'primary';

  const busy = isSaving || isMutating;

  return (
    <Card className="overflow-hidden">
      <div className="border-line-subtle flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-ink text-sm font-medium">
            {formatDuration(scheduledMinutes)} planned into {formatDuration(availableMinutes)} of
            open time
          </p>
          <p className="text-ink-subtle text-xs">
            {[
              fixedMinutes > 0 ? `${formatDuration(fixedMinutes)} already committed` : null,
              slackMinutes > 0 ? `${formatDuration(slackMinutes)} of slack` : 'no slack left',
              // "has no slot" rather than "left over": next to a row of
              // capacity figures, "left over" reads as spare time, which is
              // the opposite of what it means.
              hasOverflow ? `${formatDuration(overflowMinutes)} of work has no slot` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={isCommitted ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => void commit()}
            disabled={busy}
          >
            {isCommitted ? (
              <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} aria-hidden />
            ) : (
              <Wand2 className="size-3.5" aria-hidden />
            )}
            {isCommitted ? 'Re-plan' : 'Build my day'}
          </Button>
        </div>
      </div>

      <div className="px-4 py-3">
        <Progress
          value={load * 100}
          tone={tone}
          aria-label={`Day is ${Math.round(load * 100)} percent planned`}
        />

        {isCommitted ? (
          <p className="text-ink-subtle mt-2 flex items-center gap-1.5 text-xs">
            <CalendarCheck className="text-success size-3.5" aria-hidden />
            Committed. The timeline below is the saved plan.
          </p>
        ) : (
          <p className="text-ink-subtle mt-2 text-xs">
            This is a proposal. Nothing is saved until you build the day.
          </p>
        )}
      </div>

      {schedule.overflow.length > 0 ? (
        <div className="border-line-subtle bg-warning-soft/40 border-t px-4 py-3">
          <p className="text-ink flex items-center gap-1.5 text-xs font-medium">
            <AlertTriangle className="text-warning size-3.5" aria-hidden />
            {pluralize(schedule.overflow.length, 'task')} did not fit
          </p>

          <ul className="mt-2 space-y-1.5">
            {schedule.overflow.map((item) => (
              <li key={item.taskId} className="text-xs">
                <button
                  type="button"
                  onClick={() => onOpenTask(item.taskId)}
                  className="text-ink-muted hover:text-primary rounded-sm text-left font-medium"
                >
                  {item.title}
                </button>
                <span className="text-ink-subtle"> — {item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
