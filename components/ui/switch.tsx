'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent',
        'bg-line-strong transition-colors',
        'focus-visible:ring-primary/30 focus-visible:ring-offset-canvas focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-150 ease-out',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
