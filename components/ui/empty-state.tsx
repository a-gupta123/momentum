import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.ComponentProps<'div'> {
  icon: LucideIcon;
  title: string;
  /** One sentence that says what to do next, not just that nothing is here. */
  description: string;
  action?: React.ReactNode;
  size?: 'sm' | 'md';
}

/**
 * Empty state.
 *
 * Every empty state in the product explains the next action, because an empty
 * planner is the most common first-run experience and a blank panel teaches
 * nothing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'md',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-12' : 'gap-2 px-4 py-8',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'bg-surface-sunken text-ink-subtle flex items-center justify-center rounded-full',
          size === 'md' ? 'size-12' : 'size-10',
        )}
      >
        <Icon className={size === 'md' ? 'size-5' : 'size-4'} aria-hidden />
      </div>
      <div className="space-y-1">
        <p className={cn('text-ink font-semibold', size === 'md' ? 'text-[0.9375rem]' : 'text-sm')}>
          {title}
        </p>
        <p className="text-ink-muted mx-auto max-w-sm text-sm leading-relaxed">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
