import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border',
    'px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap',
    "[&_svg:not([class*='size-'])]:size-3",
  ),
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-ink-muted',
        primary: 'border-primary-border bg-primary-soft text-primary',
        urgent: 'border-urgent-border bg-urgent-soft text-urgent-ink',
        success: 'border-success-border bg-success-soft text-success-ink',
        warning: 'border-warning-border bg-warning-soft text-warning-ink',
        outline: 'border-line-strong bg-transparent text-ink-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
