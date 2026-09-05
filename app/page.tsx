/**
 * The landing page.
 *
 * Written for one specific reader: somebody who clicked a link from a README
 * or a résumé and will decide in about eight seconds whether to keep going.
 * So the page makes exactly one promise, shows the mechanism instead of
 * describing it, and puts a working demo — no signup, no email — one click
 * away.
 *
 * It is a Server Component with no client JavaScript beyond the theme toggle,
 * which is the honest way to make a marketing page fast.
 */
import {
  ArrowRight,
  BrainCircuit,
  CalendarRange,
  Github,
  Layers,
  ListOrdered,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TodayPreview } from '@/components/marketing/today-preview';
import { BrandLockup } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { resolveCapabilities } from '@/lib/validation/server-env';
import { getCurrentUser } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Momentum — turn a brain dump into a realistic day',
};

/** The one place the repository link is configured. */
const REPO_URL = 'https://github.com/a-gupta123/momentum';

const BUILT_WITH = [
  'Next.js App Router',
  'TypeScript (strict)',
  'Tailwind CSS',
  'Supabase Postgres + RLS',
  'Zod',
  'OpenAI structured outputs',
  'Recharts',
  'Vitest',
  'Playwright',
] as const;

export default async function LandingPage() {
  const capabilities = resolveCapabilities();
  const user = await getCurrentUser();

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* A single soft light source behind the fold. Everything else on this
          page is flat, so one gradient reads as depth rather than decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[38rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--primary-soft),transparent_70%)] opacity-70"
      />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <BrandLockup />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              <Github className="size-4" aria-hidden />
              Source
            </a>
          </Button>
          <ThemeToggle />
          {capabilities.authAvailable ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={user ? '/today' : '/signin'}>{user ? 'Open planner' : 'Sign in'}</Link>
            </Button>
          ) : null}
        </nav>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
        <section className="py-12 sm:py-20">
          <Badge tone="primary" className="mb-5">
            <Sparkles className="size-3" aria-hidden />
            {capabilities.aiAssistAvailable
              ? 'AI-assisted, deterministic where it counts'
              : 'Deterministic planning, AI optional'}
          </Badge>

          <h1 className="text-ink max-w-3xl text-4xl leading-[1.08] font-semibold tracking-[-0.02em] text-balance sm:text-6xl">
            Turn a brain dump into a realistic day.
          </h1>

          <p className="text-ink-muted mt-5 max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
            Capture naturally, rank work against the goals you actually care about, and build a day
            that fits the hours you actually have. Every ranking shows its work. Nothing is
            scheduled that does not fit.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/today">
                Try the live demo
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            {/* The secondary action follows what this deployment can actually
                do: offering an account where none can be created is a dead end. */}
            {capabilities.authAvailable && !user ? (
              <Button asChild variant="secondary" size="lg">
                <Link href="/signin">Sign in</Link>
              </Button>
            ) : (
              <Button asChild variant="secondary" size="lg">
                <a href="#how-it-works">View how it works</a>
              </Button>
            )}
          </div>

          <p className="text-ink-subtle mt-3 text-xs">
            The demo runs entirely in your browser with a realistic dataset. No signup, no email,
            nothing sent anywhere.
          </p>

          <TodayPreview />
        </section>

        {/* Show the mechanism rather than claiming it. Three steps, in the
            product's own language, with the actual output at the end. */}
        <section className="scroll-mt-8 py-6" id="how-it-works" aria-labelledby="how-it-works-h">
          <h2 id="how-it-works-h" className="sr-only">
            How Momentum works
          </h2>

          <ol className="grid gap-4 lg:grid-cols-3">
            <StepCard
              step={1}
              icon={BrainCircuit}
              title="Say it in one breath"
              body="“Finish the data structures pset by Thursday, 3 hours. Gym Tue and Thu at 7am. Email Professor Chen tomorrow.” One paragraph, three tasks, two deadlines, a recurring commitment."
              example="Parsed into structured actions you review before anything is saved."
            />
            <StepCard
              step={2}
              icon={ListOrdered}
              title="See why it ranks that way"
              body="Deadline pressure, goal alignment, importance, effort fit and staleness each contribute a visible number. Disagree with the order and drag it — your judgement becomes an input, not an override that gets erased."
              example="Every score opens into its own breakdown."
            />
            <StepCard
              step={3}
              icon={CalendarRange}
              title="Get a day that fits"
              body="A capacity-aware scheduler places work around your fixed commitments, respects your high-energy window, and inserts real breaks. What does not fit is named, with the reason, instead of quietly dropped."
              example="Drag any block to move it; the plan re-checks itself."
            />
          </ol>
        </section>

        <section className="py-14" aria-labelledby="details">
          <h2
            id="details"
            className="text-ink text-2xl font-semibold tracking-[-0.01em] text-balance sm:text-3xl"
          >
            Built like something you&rsquo;d have to maintain
          </h2>
          <p className="text-ink-muted mt-2 max-w-2xl text-sm leading-relaxed text-pretty">
            The interesting parts of this project are the ones you cannot see from a screenshot.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={ShieldCheck}
              title="The AI never touches the database"
              body="The model proposes a typed, schema-validated batch of actions against a candidate list of real ids. Hallucinated references are dropped before they reach a repository, and you confirm anything destructive."
            />
            <FeatureCard
              icon={Layers}
              title="Two backends, one interface"
              body="The same repository contract is implemented over localStorage and over Postgres with row-level security. The UI cannot tell which one it is talking to, which is why the demo is the real app."
            />
            <FeatureCard
              icon={Timer}
              title="Timezone and DST correct"
              body="Deadlines, recurrence and the workday window are all evaluated in your zone, not the server's. A weekly 7am task stays at 7am across a clock change."
            />
            <FeatureCard
              icon={ListOrdered}
              title="Explainable, not magic"
              body="Priority is a pure function with named, tunable components. Every number on screen can be traced to a rule you can read in the source."
            />
            <FeatureCard
              icon={CalendarRange}
              title="Honest about capacity"
              body="The scheduler refuses to promise a fourteen-hour day. Overflow is surfaced with a reason — no slot before the deadline, blocked by a prerequisite, out of hours."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Safe writes"
              body="Optimistic concurrency on every update, idempotency keys on the apply endpoint, and atomic multi-row mutations through a single Postgres function."
            />
          </div>
        </section>

        <section className="py-6">
          <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="max-w-xl">
              <h2 className="text-ink text-xl font-semibold">
                The demo is the whole app, not a video
              </h2>
              <p className="text-ink-muted mt-1.5 text-sm leading-relaxed">
                Same scheduler, same ranking engine, same interface. It just writes to your browser
                instead of a database.
              </p>
            </div>
            <Button asChild variant="primary" size="lg" className="shrink-0">
              <Link href="/today">
                Open the planner
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </Card>
        </section>

        {/* Set as text, not logos. A wall of framework badges tells a reader
            nothing they could not guess, and it competes with the product for
            attention on the one page where the product should win. */}
        <section className="pt-12" aria-labelledby="built-with">
          <h2
            id="built-with"
            className="text-ink-subtle text-[0.6875rem] font-medium tracking-[0.1em] uppercase"
          >
            Built with
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {BUILT_WITH.map((item) => (
              <li key={item} className="text-ink-muted text-sm">
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-line relative border-t">
        <div className="text-ink-subtle mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs sm:px-6">
          <p>Momentum — built by Aryan Gupta. MIT licensed.</p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-ink-muted inline-flex items-center gap-1.5 rounded-sm"
          >
            <Github className="size-3.5" aria-hidden />
            Read the source
          </a>
        </div>
      </footer>
    </div>
  );
}

function StepCard({
  step,
  icon: Icon,
  title,
  body,
  example,
}: {
  step: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  example: string;
}) {
  return (
    <li>
      <Card className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center gap-2.5">
          <span
            className="bg-primary-soft text-primary flex size-8 items-center justify-center rounded-md"
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
          <span className="text-ink-subtle text-xs font-medium tracking-[0.08em] uppercase">
            Step {step}
          </span>
        </div>
        <h3 className="text-ink text-base font-semibold">{title}</h3>
        <p className="text-ink-muted text-sm leading-relaxed">{body}</p>
        <p className="border-line-subtle text-ink-subtle mt-auto border-t pt-3 text-xs">
          {example}
        </p>
      </Card>
    </li>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card tone="flat" className="space-y-2 p-5">
      <Icon className="text-primary size-4" aria-hidden />
      <h3 className="text-ink text-sm font-semibold">{title}</h3>
      <p className="text-ink-muted text-sm leading-relaxed">{body}</p>
    </Card>
  );
}
