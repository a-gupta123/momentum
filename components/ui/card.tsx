import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Surface container. `tone="sunken"` is for wells that sit *inside* a card
 * (e.g. the action preview), so nesting reads as depth rather than repetition.
 */
export function Card({
  className,
  tone = 'raised',
  ...props
}: React.ComponentProps<'div'> & { tone?: 'raised' | 'flat' | 'sunken' }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-lg border',
        tone === 'raised' && 'border-line bg-surface shadow-sm',
        tone === 'flat' && 'border-line bg-surface',
        tone === 'sunken' && 'border-line bg-surface-sunken',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1 px-5 pt-5 pb-3', className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  as: Comp = 'h3',
  ...props
}: React.ComponentProps<'h3'> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn('text-ink text-base leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-ink-muted text-sm leading-relaxed', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('border-line flex items-center gap-2 border-t px-5 py-3.5', className)}
      {...props}
    />
  );
}
