'use client';

/**
 * Chart primitives.
 *
 * Recharts is styled here rather than at each call site so every chart in the
 * product shares one set of decisions:
 *
 * - **Design tokens, not hex.** Series colors are CSS variables, so charts
 *   re-theme with the rest of the app instead of staying light-mode blue.
 * - **No decorative chrome.** No 3D, no gradients-for-their-own-sake, no
 *   gridlines competing with the data.
 * - **Every chart has a text equivalent.** The SVG is `aria-hidden` and a
 *   visually hidden summary carries the same information, because a chart that
 *   only exists visually is data a screen-reader user simply does not get.
 */
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatDuration } from '@/lib/dates';
import { goalColorVar } from '@/lib/goal-colors';
import type {
  DailyPoint,
  EstimateAccuracy,
  GoalInvestmentSlice,
  PlannedVsActualPoint,
} from '@/lib/domain/analytics';
import { cn } from '@/lib/utils';

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--ink-subtle)',
} as const;

const GRID_STROKE = 'var(--line)';

/**
 * Charts render their final state immediately.
 *
 * Recharts' entrance animations sweep a clip path across the plot, which on a
 * page of six charts reads as six things loading rather than one page arriving.
 * Worse, the numbers are unreadable until the sweep finishes. Motion is for
 * things the user did; data on arrival is not one of them.
 */
const NO_ANIMATION = { isAnimationActive: false } as const;

/**
 * Axis ticks are chosen, not inherited.
 *
 * Recharts picks ticks from the raw domain, which for minute-valued data means
 * ticks like 35 and 70 — and a duration formatter then renders both as "1h".
 * Choosing round durations first and labelling them second keeps every tick
 * distinct and every gridline meaningful.
 */
const MINUTE_STEPS = [15, 30, 60, 120, 180, 240, 360, 480, 720] as const;

function minuteAxis(max: number): { domain: [number, number]; ticks: number[] } {
  const step = MINUTE_STEPS.find((candidate) => max / candidate <= 4) ?? 1440;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { domain: [0, top], ticks };
}

/** Compact enough for an axis: "45m", "2h", "1h30" — never "1h 30m". */
function formatAxisMinutes(minutes: number): string {
  if (minutes === 0) return '0';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}`;
}

function ratioAxis(max: number): { domain: [number, number]; ticks: number[] } {
  // Always include 1.0 with headroom above it, so the "perfect estimate"
  // reference line is never pinned to the top edge of the plot.
  const top = Math.max(1.5, Math.ceil(max * 2) / 2);
  const ticks: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += 0.5) ticks.push(Number(value.toFixed(1)));
  return { domain: [0, top], ticks };
}

function formatAxisRatio(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}×`;
}

/** Wraps a chart with its accessible text equivalent. */
function ChartFrame({
  height,
  summary,
  children,
  className,
}: {
  height: number;
  /** The same information the chart conveys, as a sentence. */
  summary: string;
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <figure className={cn('w-full', className)}>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function TooltipShell({
  label,
  rows,
}: {
  label: React.ReactNode;
  rows: Array<{ key: string; label: string; value: string; color?: string }>;
}) {
  return (
    <div className="border-line bg-surface-raised rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="text-ink mb-1 font-medium">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="text-ink-muted flex items-center gap-2">
            {row.color ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
            ) : null}
            <span>{row.label}</span>
            <span className="text-ink ml-auto font-medium tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompletionChart({ data }: { data: readonly DailyPoint[] }) {
  const points = data.map((point) => ({ ...point }));
  const busiest = points.reduce<DailyPoint | null>(
    (best, point) =>
      best === null || point.completedMinutes > best.completedMinutes ? point : best,
    null,
  );
  const axis = minuteAxis(busiest?.completedMinutes ?? 0);

  return (
    <ChartFrame
      height={200}
      summary={
        busiest && busiest.completedMinutes > 0
          ? `Daily completed time over the last ${points.length} days. Busiest day was ${busiest.fullLabel} with ${formatDuration(busiest.completedMinutes)} across ${busiest.completedCount} tasks. ${points.map((p) => `${p.label}: ${formatDuration(p.completedMinutes)}`).join('; ')}.`
          : 'No completed work recorded in this window yet.'
      }
    >
      <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="momentum-completion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={formatAxisMinutes}
        />
        <Tooltip
          cursor={{ stroke: GRID_STROKE }}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as DailyPoint | undefined) : undefined;
            if (!point) return null;
            return (
              <TooltipShell
                label={point.fullLabel}
                rows={[
                  {
                    key: 'time',
                    label: 'Completed',
                    value: formatDuration(point.completedMinutes),
                    color: 'var(--primary)',
                  },
                  {
                    key: 'count',
                    label: 'Tasks',
                    value: String(point.completedCount),
                  },
                ]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="completedMinutes"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#momentum-completion)"
          // Dots only on hover: seven dots on a seven-point series is noise.
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--primary)' }}
          {...NO_ANIMATION}
        />
      </AreaChart>
    </ChartFrame>
  );
}

export function PlannedVsActualChart({ data }: { data: readonly PlannedVsActualPoint[] }) {
  const points = data.map((point) => ({ ...point }));
  const axis = minuteAxis(
    points.reduce((max, point) => Math.max(max, point.plannedMinutes, point.actualMinutes), 0),
  );

  return (
    <ChartFrame
      height={200}
      summary={`Estimated against actual time for completed work. ${points
        .map(
          (point) =>
            `${point.label}: estimated ${formatDuration(point.plannedMinutes)}, actual ${formatDuration(point.actualMinutes)}`,
        )
        .join('; ')}.`}
    >
      <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={formatAxisMinutes}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-sunken)' }}
          content={({ active, payload }) => {
            const point = active
              ? (payload?.[0]?.payload as PlannedVsActualPoint | undefined)
              : undefined;
            if (!point) return null;
            return (
              <TooltipShell
                label={point.label}
                rows={[
                  {
                    key: 'planned',
                    label: 'Estimated',
                    value: formatDuration(point.plannedMinutes),
                    color: 'var(--ink-subtle)',
                  },
                  {
                    key: 'actual',
                    label: point.hasRecordedTime ? 'Actual' : 'Actual (estimated)',
                    value: formatDuration(point.actualMinutes),
                    color: 'var(--primary)',
                  },
                ]}
              />
            );
          }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={24}
          iconType="circle"
          iconSize={7}
          formatter={(value: string) => (
            <span className="text-ink-muted text-xs">
              {value === 'plannedMinutes' ? 'Estimated' : 'Actual'}
            </span>
          )}
        />
        <Bar
          dataKey="plannedMinutes"
          fill="var(--line-strong)"
          radius={[3, 3, 0, 0]}
          {...NO_ANIMATION}
        />
        <Bar
          dataKey="actualMinutes"
          fill="var(--primary)"
          radius={[3, 3, 0, 0]}
          {...NO_ANIMATION}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function GoalInvestmentChart({ data }: { data: readonly GoalInvestmentSlice[] }) {
  const slices = data.filter((slice) => slice.minutes > 0).map((slice) => ({ ...slice }));

  if (slices.length === 0) {
    return (
      <p className="text-ink-subtle py-10 text-center text-sm">
        No time invested in this window yet.
      </p>
    );
  }

  return (
    <ChartFrame
      height={220}
      summary={`Where your time went, by goal. ${slices
        .map(
          (slice) =>
            `${slice.label}: ${formatDuration(slice.minutes)}, ${Math.round(slice.share * 100)} percent`,
        )
        .join('; ')}.`}
    >
      <PieChart>
        <Pie
          data={slices}
          dataKey="minutes"
          nameKey="label"
          // A donut rather than a pie: the hole removes the central wedge
          // convergence that makes small slices hard to compare.
          innerRadius={52}
          outerRadius={82}
          paddingAngle={2}
          strokeWidth={0}
          {...NO_ANIMATION}
        >
          {slices.map((slice) => (
            <Cell key={slice.goalId ?? 'unassigned'} fill={goalColorVar(slice.color)} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            const slice = active
              ? (payload?.[0]?.payload as GoalInvestmentSlice | undefined)
              : undefined;
            if (!slice) return null;
            return (
              <TooltipShell
                label={slice.label}
                rows={[
                  {
                    key: 'minutes',
                    label: 'Invested',
                    value: formatDuration(slice.minutes),
                    color: goalColorVar(slice.color),
                  },
                  { key: 'share', label: 'Share', value: `${Math.round(slice.share * 100)}%` },
                  { key: 'tasks', label: 'Tasks', value: String(slice.taskCount) },
                ]}
              />
            );
          }}
        />
      </PieChart>
    </ChartFrame>
  );
}

export function EstimateAccuracyChart({ accuracy }: { accuracy: EstimateAccuracy }) {
  const points = accuracy.points.map((point) => ({ ...point }));
  const axis = ratioAxis(points.reduce((max, point) => Math.max(max, point.ratio), 0));

  return (
    <ChartFrame
      height={180}
      summary={`Ratio of actual to estimated time by day. A value of 1 means estimates were accurate. ${points
        .map((point) => `${point.label}: ${point.ratio.toFixed(2)}`)
        .join('; ')}.`}
    >
      <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={40}
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={formatAxisRatio}
        />
        {/* The line worth comparing against: 1.0 is a perfect estimate. */}
        <ReferenceLine y={1} stroke="var(--success)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: GRID_STROKE }}
          content={({ active, payload }) => {
            const point = active
              ? (payload?.[0]?.payload as (typeof points)[number] | undefined)
              : undefined;
            if (!point) return null;
            return (
              <TooltipShell
                label={point.label}
                rows={[
                  {
                    key: 'ratio',
                    label: point.ratio > 1 ? 'Over estimate' : 'Under estimate',
                    value: `${point.ratio.toFixed(2)}×`,
                    color: 'var(--primary)',
                  },
                  { key: 'n', label: 'Tasks', value: String(point.sampleSize) },
                ]}
              />
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="ratio"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: 'var(--primary)' }}
          activeDot={{ r: 5, strokeWidth: 0 }}
          {...NO_ANIMATION}
        />
      </LineChart>
    </ChartFrame>
  );
}
