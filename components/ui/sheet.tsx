'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Side drawer for detail editing.
 *
 * On phones it becomes a near-fullscreen panel so long forms get the whole
 * viewport; on desktop it docks to the right so the day plan stays visible
 * behind it and the user keeps their place.
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: 'right' | 'left' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-overlay bg-ink/25 fixed inset-0 z-50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'anim-sheet bg-surface fixed z-50 flex flex-col shadow-lg',
          'border-line inset-x-0 bottom-0 max-h-[92vh] rounded-t-xl border',
          'sm:anim-drawer sm:inset-y-0 sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none',
          side === 'right'
            ? 'sm:right-0 sm:left-auto sm:border-y-0 sm:border-r-0 sm:border-l'
            : 'sm:right-auto sm:left-0 sm:border-y-0 sm:border-r sm:border-l-0',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'press text-ink-subtle absolute top-4 right-4 rounded-sm p-1.5',
            'hover:bg-surface-hover hover:text-ink',
          )}
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-line flex flex-col gap-1 border-b px-5 py-4 pr-14', className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-ink text-base leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-ink-muted text-sm', className)} {...props} />
  );
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'border-line flex items-center gap-2 border-t px-5 py-4',
        'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4',
        className,
      )}
      {...props}
    />
  );
}
