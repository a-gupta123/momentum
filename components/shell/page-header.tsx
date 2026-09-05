'use client';

/**
 * Shared page framing.
 *
 * Every planner route opens the same way — an eyebrow, a title, a sentence of
 * orientation, and an optional slot for actions — so moving between them feels
 * like moving inside one product rather than between four screens that happen
 * to share a sidebar.
 */
import * as React from 'react';

import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1', className)}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-ink-subtle text-xs font-medium tracking-[0.08em] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-ink text-2xl leading-tight font-semibold text-balance sm:text-[1.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="text-ink-muted max-w-prose text-sm leading-relaxed text-pretty">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Standard page gutter and rhythm. Keeps every route on the same measure. */
export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8', className)}>
      {children}
    </div>
  );
}

/** A titled region inside a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-semibold">{title}</h2>
          {description ? <p className="text-ink-subtle text-xs">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
