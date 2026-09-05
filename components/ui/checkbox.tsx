'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Checkbox with a drawn (not faded-in) check.
 *
 * The stroke animation reads as "I did that" rather than "something appeared",
 * which matters because completing a task is the single most-repeated action in
 * the product. `motion-reduce` collapses it to an instant state change.
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'press peer border-line-strong bg-surface size-5 shrink-0 rounded-[6px] border-2',
        'hover:border-primary',
        'focus-visible:ring-primary/30 focus-visible:ring-2 focus-visible:outline-none',
        'data-[state=checked]:border-success data-[state=checked]:bg-success',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden focusable="false">
          <path
            d="M4.5 10.5l3.5 3.5 7.5-8"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-draw-check"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
