import * as React from 'react';

import { cn } from '@/lib/utils';

export const inputBaseClass = cn(
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink shadow-xs',
  'transition-colors placeholder:text-ink-subtle',
  'hover:border-line-strong',
  'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60',
  // `aria-invalid` drives the error styling so validity and appearance can
  // never drift apart.
  'aria-invalid:border-urgent aria-invalid:ring-2 aria-invalid:ring-urgent/20',
);

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(inputBaseClass, 'h-10', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(inputBaseClass, 'min-h-20 resize-y py-2.5 leading-relaxed', className)}
      {...props}
    />
  );
}
