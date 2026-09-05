'use client';

import * as React from 'react';

import { publicCapabilities, type RuntimeCapabilities } from '@/lib/validation/env';

/**
 * What this deployment can do, resolved on the server and handed down.
 *
 * The browser must never try to work this out for itself: whether AI assist is
 * available depends on a server-only secret, so any client-side check would
 * either be wrong or require exposing the key. Passing the answer down as data
 * keeps the secret server-side and gives the UI something honest to render —
 * "Deterministic parsing" instead of a broken AI badge.
 */
const CapabilitiesContext = React.createContext<RuntimeCapabilities>(publicCapabilities);

export function CapabilitiesProvider({
  value,
  children,
}: {
  value: RuntimeCapabilities;
  children: React.ReactNode;
}) {
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): RuntimeCapabilities {
  return React.useContext(CapabilitiesContext);
}
