'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

function Overlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('anim-overlay bg-ink/25 fixed inset-0 z-50 backdrop-blur-[2px]', className)}
      {...props}
    />
  );
}

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** Hide the built-in close button when the footer already offers a way out. */
  hideClose?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Centered modal on desktop, bottom sheet on small screens.
 *
 * The mobile variant rises from the bottom because that is where the thumb is;
 * one component covers both so a task can be edited identically on either form
 * factor without a second implementation drifting out of sync.
 */
export function DialogContent({
  className,
  children,
  hideClose = false,
  size = 'md',
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <Overlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'anim-sheet border-line bg-surface fixed z-50 flex flex-col border shadow-lg',
          // Mobile: bottom sheet, capped so context behind stays visible.
          'inset-x-0 bottom-0 max-h-[90vh] rounded-t-xl',
          // Desktop: centered card.
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh]',
          'sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className={cn(
              'press text-ink-subtle absolute top-4 right-4 rounded-sm p-1.5',
              'hover:bg-surface-hover hover:text-ink',
            )}
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 px-5 pt-5 pr-14 pb-3', className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-ink text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-ink-muted text-sm leading-relaxed', className)}
      {...props}
    />
  );
}

/** Scrollable middle region, so headers and footers stay pinned. */
export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-1', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'border-line flex flex-col-reverse gap-2 border-t px-5 py-4',
        // Safe-area padding keeps the confirm button clear of the home bar.
        'pb-[max(1rem,env(safe-area-inset-bottom))]',
        'sm:flex-row sm:justify-end sm:pb-4',
        className,
      )}
      {...props}
    />
  );
}
