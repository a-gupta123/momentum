'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Separator */

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'bg-line shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- Progress */

export function Progress({
  className,
  value,
  tone = 'primary',
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  tone?: 'primary' | 'success' | 'warning' | 'urgent';
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-surface-sunken relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full w-full flex-1 rounded-full transition-transform duration-300 ease-out',
          tone === 'primary' && 'bg-primary',
          tone === 'success' && 'bg-success',
          tone === 'warning' && 'bg-warning',
          tone === 'urgent' && 'bg-urgent',
        )}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* ----------------------------------------------------------------------- Tabs */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-surface-sunken inline-flex h-9 items-center gap-1 rounded-md p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'press inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1',
        'text-ink-muted text-[0.8125rem] font-medium whitespace-nowrap',
        'hover:text-ink',
        'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-xs',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------- Slider */

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbCount = Array.isArray(props.value ?? props.defaultValue)
    ? (props.value ?? props.defaultValue ?? []).length
    : 1;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex w-full touch-none items-center select-none', className)}
      {...props}
    >
      <SliderPrimitive.Track className="bg-surface-sunken relative h-1.5 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            'border-primary bg-surface block size-4 rounded-full border-2 shadow-sm',
            'transition-transform hover:scale-110',
            'focus-visible:ring-primary/30 focus-visible:ring-2 focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/* ------------------------------------------------------------------- Skeleton */

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('skeleton rounded-sm', className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------------- Kbd */

/** Keyboard hint. Rendered as `<kbd>` so assistive tech announces it as a key. */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px]',
        'border-line bg-surface-sunken border px-1.5',
        'text-ink-subtle font-sans text-[0.6875rem] font-medium',
        className,
      )}
      {...props}
    />
  );
}
