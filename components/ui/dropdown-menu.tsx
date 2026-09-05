'use client';

import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const menuSurface = cn(
  'anim-pop z-50 min-w-[11rem] overflow-hidden rounded-md border border-line',
  'bg-surface p-1 shadow-lg',
);

const menuItem = cn(
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5',
  'text-sm text-ink outline-none select-none',
  'focus:bg-surface-hover data-[highlighted]:bg-surface-hover',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
  "[&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle",
);

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          menuSurface,
          'max-h-[var(--radix-dropdown-menu-content-available-height)]',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        menuItem,
        destructive && 'text-urgent-ink [&_svg]:text-urgent focus:bg-urgent-soft',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(menuItem, 'pl-7', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check className="text-primary size-3.5" aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItem, 'pl-7', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <span className="bg-primary size-2 rounded-full" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        'text-ink-subtle px-2 py-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('bg-line -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('text-ink-subtle ml-auto text-[0.6875rem] tracking-wide', className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItem, 'data-[state=open]:bg-surface-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" aria-hidden />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(menuSurface, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}
