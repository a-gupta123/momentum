'use client';

/**
 * Cross-cutting client providers.
 *
 * Kept to the three that genuinely need to wrap the whole tree — theme,
 * tooltips and toasts. The planner store is deliberately *not* here: it only
 * wraps the planner routes, so the landing page and the auth screens do not pay
 * for a repository they never read.
 */
import { ThemeProvider } from 'next-themes';
import * as React from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/providers/toaster';
import { CapabilitiesProvider } from '@/components/providers/capabilities';
import type { RuntimeCapabilities } from '@/lib/validation/env';

export function AppProviders({
  capabilities,
  children,
}: {
  capabilities: RuntimeCapabilities;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Cross-tab sync is off: switching theme in one tab yanking the theme in
      // another is startling, and the preference is already persisted.
      storageKey="momentum-theme"
      disableTransitionOnChange
    >
      <CapabilitiesProvider value={capabilities}>
        {/* A single provider means tooltip delays and dismissals behave
            consistently everywhere, including inside portals. */}
        <TooltipProvider delayDuration={250} skipDelayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </CapabilitiesProvider>
    </ThemeProvider>
  );
}
