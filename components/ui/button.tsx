'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  cn(
    'press inline-flex shrink-0 items-center justify-center gap-2 rounded-md',
    'text-sm font-medium whitespace-nowrap outline-none select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-ink shadow-sm hover:bg-primary-hover hover:shadow-md',
        secondary:
          'border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-surface-hover',
        ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
        subtle: 'bg-surface-sunken text-ink hover:bg-surface-hover',
        // Coral is reserved for genuinely destructive intent.
        danger: 'bg-urgent text-white shadow-sm hover:brightness-110',
        outlineDanger:
          'border border-urgent-border bg-urgent-soft text-urgent-ink hover:brightness-105',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 44px keeps the primary tap target comfortable on touch screens.
        lg: 'h-11 px-5 text-[0.9375rem]',
        md: 'h-10 px-4',
        sm: 'h-8 gap-1.5 rounded-sm px-3 text-[0.8125rem]',
        icon: 'size-10',
        iconSm: 'size-8 rounded-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render as the single child element, e.g. to make a `Link` look like a button. */
  asChild?: boolean;
  /** Show a spinner and block interaction while an action is in flight. */
  loading?: boolean;
}

/**
 * The one button in the app.
 *
 * `loading` disables the control and swaps in a spinner while preserving the
 * label, so the button never changes width mid-action and the user is never
 * able to submit twice.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  // Slot cannot host a spinner alongside its single child, so `loading` is only
  // rendered in the normal (non-`asChild`) case.
  if (asChild) {
    return (
      <Slot
        data-slot="button"
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      data-slot="button"
      type={props.type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export { buttonVariants };
