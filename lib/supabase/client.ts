'use client';

/**
 * Browser Supabase client.
 *
 * Created lazily and memoized: the client owns an auth listener and a token
 * refresh timer, so constructing a second one during a React re-render would
 * produce duplicate refreshes and duplicate `onAuthStateChange` callbacks.
 *
 * Returns `null` instead of throwing when Supabase is not configured. Guest
 * Demo is a fully supported mode, not a degraded one, so an unconfigured
 * deployment has to be an ordinary branch rather than an exception.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '@/lib/validation/env';
import type { Database } from '@/lib/supabase/types';

export type TypedSupabaseClient = SupabaseClient<Database>;

let cached: TypedSupabaseClient | null = null;

export function getBrowserSupabase(): TypedSupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) return null;
  cached ??= createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
  return cached;
}
