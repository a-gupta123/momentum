'use client';

/**
 * Why a task ranks where it does.
 *
 * This component is the reason the priority engine returns a factor breakdown
 * instead of just a number. A ranking a user cannot interrogate is a ranking
 * they will not trust — and if they do not trust it, they ignore the order and
 * the whole feature is decoration. So every score is fully openable: each
 * weighted factor, its normalized value, the points it contributed, and the
 * plain-English reason.
 *
 * The bars are `<meter>`-like but rendered as divs with explicit `aria` text,
 * because the accessible version of "deadline urgency 0.82" is the sentence
 * "Due tomorrow", not a number a screen reader has to interpret.
 */
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type { TaskScore } from '@/lib/domain/priority';
import { cn } from '@/lib/utils';

export function ScoreBreakdown({ score, className }: { score: TaskScore; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-ink-subtle text-[0.6875rem] font-semibold tracking-wide uppercase">
            Priority score
          </p>
          <p className="text-ink text-2xl font-semibold" data-numeric>
            {score.score.toFixed(1)}
            <span className="text-ink-subtle ml-1 text-sm font-normal">/ 100</span>
          </p>
        </div>
        {score.blocked ? (
          <Badge tone="warning">
            Blocked by {score.blockedBy.length === 1 ? '1 task' : `${score.blockedBy.length} tasks`}
          </Badge>
        ) : null}
      </div>

      <ul className="space-y-2.5">
        {score.factors.map((factor) => (
          <li key={factor.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink font-medium">{factor.label}</span>
              <span className="text-ink-subtle shrink-0" data-numeric>
                {factor.contribution.toFixed(1)} pts
              </span>
            </div>
            <div
              className="bg-surface-sunken h-1.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`${factor.label}: ${factor.detail}. Contributed ${factor.contribution.toFixed(1)} of a possible ${(factor.weight * 100).toFixed(0)} points.`}
            >
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-300 ease-out"
                // Width is the factor's share of *its own* weight, so a small
                // weight at full value still reads as "maxed out" rather than
                // looking negligible next to a large weight at half value.
                style={{ width: `${Math.round(factor.value * 100)}%` }}
              />
            </div>
            <p className="text-ink-subtle text-[0.6875rem] leading-relaxed">{factor.detail}</p>
          </li>
        ))}
      </ul>

      {score.boosts.length > 0 ? (
        <div className="border-line space-y-1.5 border-t pt-2.5">
          <p className="text-ink-subtle text-[0.6875rem] font-semibold tracking-wide uppercase">
            Adjustments
          </p>
          <ul className="space-y-1">
            {score.boosts.map((boost) => (
              <li key={boost.key} className="flex justify-between gap-2 text-xs">
                <span className="text-ink">{boost.label}</span>
                <span className="text-success-ink" data-numeric>
                  +{boost.points.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-ink-subtle text-[0.6875rem]">
        Scoring rules: <span className="font-mono">{score.scoreVersion}</span>
      </p>
    </div>
  );
}

/**
 * The collapsed form used inline in a task row.
 *
 * Native `<details>` rather than a custom disclosure: it is keyboard
 * accessible, announces its state, and works before hydration.
 */
export function ScoreDisclosure({ score }: { score: TaskScore }) {
  return (
    <details className="group">
      <summary
        className={cn(
          'flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-[0.6875rem]',
          'text-ink-subtle hover:text-ink-muted font-medium',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        Why this rank
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-line bg-surface-sunken mt-2.5 rounded-md border p-3">
        <ScoreBreakdown score={score} />
      </div>
    </details>
  );
}

/** The two or three strongest reasons, for a row that has no room to expand. */
export function TopReasons({ score }: { score: TaskScore }) {
  if (score.topReasons.length === 0) return null;
  return <p className="text-ink-subtle text-xs leading-relaxed">{score.topReasons.join(' · ')}</p>;
}
