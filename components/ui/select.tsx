'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  size = 'md',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'md' }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'border-line flex w-full items-center justify-between gap-2 rounded-md border',
        'bg-surface text-ink px-3 text-sm shadow-xs transition-colors',
        'hover:border-line-strong',
        'focus-visible:border-primary focus-visible:ring-primary/25 focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-invalid:border-urgent aria-invalid:ring-urgent/20 aria-invalid:ring-2',
        'data-[placeholder]:text-ink-subtle',
        size === 'md' ? 'h-10' : 'h-8 text-[0.8125rem]',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="text-ink-subtle size-4 shrink-0" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'anim-pop z-50 max-h-[min(24rem,var(--radix-select-content-available-height))]',
          'min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md',
          'border-line bg-surface border shadow-lg',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="text-ink-subtle flex h-6 items-center justify-center">
          <ChevronUp className="size-4" aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="text-ink-subtle flex h-6 items-center justify-center">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7',
        'text-ink text-sm outline-none select-none',
        'data-[highlighted]:bg-surface-hover',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="text-primary size-3.5" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'text-ink-subtle px-2 py-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn('bg-line -mx-1 my-1 h-px', className)} {...props} />
  );
}
