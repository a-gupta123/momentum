'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Info } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function Tooltip({
  delayDuration = 250,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'anim-pop bg-ink z-50 max-w-64 rounded-sm px-2.5 py-1.5',
          'text-ink-inverted text-xs leading-snug shadow-md',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-ink" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Tooltip in one element.
 *
 * A tooltip is never the only source of a label — every trigger that uses this
 * also carries visible text or an `aria-label` — so this stays purely
 * supplementary information for pointer and keyboard users.
 */
export function Hint({
  label,
  children,
  side = 'top',
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The small circled `i` next to a metric or setting.
 *
 * It is a real `button` rather than an icon with a `title`, so the explanation
 * is reachable by keyboard and announced by a screen reader. The `aria-label`
 * repeats the text because a tooltip that only opens on hover is invisible to
 * anyone not using a pointer.
 */
export function InfoHint({
  text,
  side = 'top',
  className,
}: {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  return (
    <Hint label={text} side={side}>
      <button
        type="button"
        aria-label={text}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle',
          'text-ink-subtle hover:text-ink-muted transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
    </Hint>
  );
}
