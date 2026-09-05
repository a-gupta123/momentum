/**
 * A preview of the Today surface, built from the same primitives as the real
 * thing.
 *
 * Deliberately not a screenshot. A PNG goes stale the moment a token changes,
 * ignores the reader's theme, cannot be read by a screen reader, and — on a
 * page whose whole argument is "the demo is the real app" — is exactly the
 * wrong artifact. This is markup: it re-themes, it scales, and it stays honest
 * because it is made of the components it depicts.
 *
 * It is also *only* a depiction. The figures are fixed and it has no
 * interactivity, so the `Try the live demo` button next to it is doing the
 * actual work of proving the product exists. The whole subtree is therefore
 * `aria-hidden`, with one text equivalent standing in for it: announcing a
 * decorative mock of a UI, item by item, would be noise to a screen-reader
 * user who has a link to the real thing.
 */
import { Check, Play } from 'lucide-react';

const DAILY_THREE = [
  {
    rank: 1,
    score: 86,
    title: 'Finish and submit one internship application',
    goal: 'Land a 2027 internship',
    color: 'var(--goal-violet)',
    meta: '1h · Due Sunday',
  },
  {
    rank: 2,
    score: 85,
    title: 'Finish the automata problem set',
    goal: 'Excel in coursework',
    color: 'var(--goal-cobalt)',
    meta: '1h 30m · Due tomorrow',
  },
  {
    rank: 3,
    score: 81,
    title: 'Ask about extra office hours',
    goal: 'Excel in coursework',
    color: 'var(--goal-cobalt)',
    meta: '15m · Overdue by 1 day',
  },
] as const;

interface PreviewBlock {
  label: string;
  time: string;
  /** Percentages, so the strip scales with its container, not the viewport. */
  left: number;
  width: number;
  color: string;
  /** A commitment the scheduler is not allowed to move. */
  fixed?: boolean;
}

const BLOCKS: readonly PreviewBlock[] = [
  {
    label: 'Internship application',
    time: '3:45 PM',
    left: 0,
    width: 26,
    color: 'var(--goal-violet)',
  },
  { label: 'Office hours', time: '5:00 PM', left: 28, width: 8, color: 'var(--goal-cobalt)' },
  {
    label: 'Strength training',
    time: '5:30 PM',
    left: 38,
    width: 18,
    color: 'var(--goal-moss)',
    fixed: true,
  },
  {
    label: 'Automata problem set',
    time: '6:30 PM',
    left: 58,
    width: 26,
    color: 'var(--goal-cobalt)',
  },
  { label: 'Review notes', time: '8:15 PM', left: 86, width: 14, color: 'var(--goal-cobalt)' },
];

export function TodayPreview() {
  return (
    <figure className="mt-12 sm:mt-16">
      <div
        aria-hidden
        className="border-line bg-surface overflow-hidden rounded-xl border shadow-lg"
      >
        {/* Window chrome. Frames the mock as "a screen" so it is not mistaken
            for live controls on this page. */}
        <div className="border-line-subtle bg-surface-sunken flex items-center gap-2 border-b px-4 py-2.5">
          <span className="bg-line-strong size-2 rounded-full" />
          <span className="bg-line-strong size-2 rounded-full" />
          <span className="bg-line-strong size-2 rounded-full" />
          <span className="text-ink-subtle ml-2 text-[0.6875rem] tracking-wide">
            momentum / today
          </span>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-ink-subtle text-[0.625rem] font-medium tracking-[0.1em] uppercase">
                Today
              </p>
              <p className="text-ink mt-1 text-lg font-semibold tracking-[-0.01em] sm:text-xl">
                Friday, September 4
              </p>
              <p className="text-ink-subtle mt-0.5 text-xs">
                1 task done of 3. 2h 45m of estimated work left.
              </p>
            </div>
            <Dial percent={33} />
          </div>

          <div>
            <p className="text-ink text-xs font-medium">Your Daily Three</p>
            <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
              {DAILY_THREE.map((task) => (
                <div
                  key={task.rank}
                  className="border-line bg-surface relative overflow-hidden rounded-lg border p-3 shadow-xs"
                >
                  <span
                    className="absolute inset-x-0 top-0 h-0.5"
                    style={{ backgroundColor: task.color }}
                  />
                  <div className="text-ink-subtle flex items-center justify-between text-[0.625rem]">
                    <span className="bg-surface-sunken text-ink-muted flex size-4 items-center justify-center rounded font-medium">
                      {task.rank}
                    </span>
                    <span className="tabular-nums">{task.score}</span>
                  </div>
                  <p className="text-ink mt-2 text-[0.8125rem] leading-snug font-medium">
                    {task.title}
                  </p>
                  <p className="text-ink-subtle mt-1.5 flex items-center gap-1 text-[0.625rem]">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: task.color }}
                    />
                    {task.goal}
                  </p>
                  <p className="text-ink-subtle mt-1 text-[0.625rem]">{task.meta}</p>
                  <div className="mt-3 flex gap-1.5">
                    <span className="bg-primary text-primary-ink flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[0.625rem] font-medium">
                      <Play className="size-2.5" />
                      Focus
                    </span>
                    <span className="border-line text-ink-muted flex items-center gap-1 rounded border px-2 py-1 text-[0.625rem] font-medium">
                      <Check className="size-2.5" />
                      Done
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-ink text-xs font-medium">
                2h 45m planned into 3h 45m of open time
              </p>
              <p className="text-ink-subtle text-[0.625rem]">5h 10m of work has no slot</p>
            </div>
            <div className="bg-surface-sunken mt-2 h-1.5 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: '73%' }} />
            </div>

            {/* The timeline, laid out horizontally. The real one is vertical;
                a wide strip is what fits above the fold at this width, and it
                makes the same point — the day is drawn to scale.

                Hidden on phones: a 15-minute block is about 25px there, which
                is a sliver with a truncated label. Showing an illegible version
                of the feature is worse for the argument than not showing it. */}
            <div className="border-line-subtle relative mt-4 hidden h-14 rounded-lg border border-dashed sm:block">
              {BLOCKS.map((block) => (
                <div
                  key={block.label}
                  className="absolute inset-y-1"
                  style={{ left: `${block.left}%`, width: `${block.width}%` }}
                >
                  <div
                    className={`bg-surface h-full overflow-hidden rounded border pl-1.5 ${
                      block.fixed ? 'border-line-strong' : 'border-line'
                    }`}
                    style={{ borderLeftColor: block.color, borderLeftWidth: 3 }}
                  >
                    <p className="text-ink truncate pt-1 text-[0.5625rem] leading-tight font-medium">
                      {block.label}
                    </p>
                    <p className="text-ink-subtle truncate text-[0.5rem]">{block.time}</p>
                  </div>
                </div>
              ))}
              {/* Now. The one red thing on the page, which is what keeps red
                  meaningful in the product too. */}
              <div
                className="absolute inset-y-0 w-px"
                style={{ left: '24%', backgroundColor: 'var(--timeline-now)' }}
              />
            </div>
          </div>
        </div>
      </div>

      <figcaption className="text-ink-subtle mt-3 text-center text-xs">
        The Today view: capture at the top, the three highest-leverage tasks with their scores, and
        the day drawn to scale around commitments that cannot move.
      </figcaption>
    </figure>
  );
}

/** The progress dial, as a stroked arc. */
function Dial({ percent }: { percent: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <svg viewBox="0 0 48 48" className="size-12 -rotate-90">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <div className="hidden sm:block">
        <p className="text-ink text-xs font-medium">1 of 3 done</p>
        <p className="text-ink-subtle text-[0.625rem]">35m logged</p>
      </div>
    </div>
  );
}
