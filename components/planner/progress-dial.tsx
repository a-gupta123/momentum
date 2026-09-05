'use client';

/**
 * The day's progress, as a ring.
 *
 * A ring rather than a bar because it sits in the header next to the date and a
 * bar there would read as a loading indicator. The number in the middle is
 * tasks completed over tasks planned, which is the figure a person actually
 * checks; minutes are the secondary line beneath.
 *
 * `prefers-reduced-motion` removes the sweep animation but keeps the value —
 * the ring is information, not decoration, so it must never be the thing that
 * disappears.
 */
import * as React from 'react';

import { formatDuration } from '@/lib/dates';
import { cn, percent } from '@/lib/utils';

export interface ProgressDialProps {
  completedCount: number;
  totalCount: number;
  completedMinutes: number;
  plannedMinutes: number;
  size?: number;
  className?: string;
}

export function ProgressDial({
  completedCount,
  totalCount,
  completedMinutes,
  plannedMinutes,
  size = 92,
  className,
}: ProgressDialProps) {
  const share = totalCount === 0 ? 0 : completedCount / totalCount;
  const pct = percent(completedCount, totalCount);

  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * Math.min(1, Math.max(0, share));

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          // Rotated so progress starts at 12 o'clock, which is where people
          // expect a dial to begin.
          className="-rotate-90"
          role="img"
          aria-label={
            totalCount === 0
              ? 'Nothing planned for today yet.'
              : `${completedCount} of ${totalCount} tasks complete, ${pct} percent.`
          }
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--surface-sunken)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={share >= 1 ? 'var(--success)' : 'var(--primary)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-[stroke-dasharray,stroke] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-ink text-lg leading-none font-semibold" data-numeric>
            {pct}
            <span className="text-ink-subtle text-xs font-normal">%</span>
          </span>
        </div>
      </div>

      <div className="min-w-0 space-y-0.5">
        <p className="text-ink text-sm font-medium" data-numeric>
          {completedCount} of {totalCount} done
        </p>
        <p className="text-ink-subtle text-xs" data-numeric>
          {formatDuration(completedMinutes)} of {formatDuration(plannedMinutes)}
        </p>
      </div>
    </div>
  );
}
