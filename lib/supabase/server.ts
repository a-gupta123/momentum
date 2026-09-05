import 'server-only';

/**
 * Server Supabase client.
 *
 * Cookie handling is the whole reason this file exists. Supabase's SSR helper
 * needs to *read* the session cookie on every request and to *write* a rotated
 * one when the access token is refreshed. Server Components are not allowed to
 * set cookies, so the write path has to be tolerated as a no-op there — the
 * refreshed token is still valid in memory for the current render, and the
 * middleware (which *can* write) persists it on the next request.
 *
 * Swallowing that error is safe only because the middleware exists. Without it,
 * sessions would appear to work and then expire without ever refreshing.
 */
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '@/lib/validation/env';
import type { Database } from '@/lib/supabase/types';

export type TypedSupabaseClient = SupabaseClient<Database>;

/** Request-scoped client, or `null` when Supabase is not configured. */
export async function getServerSupabase(): Promise<TypedSupabaseClient | null> {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware performs the same refresh with a writable response, so
          // the rotated token is not lost.
        }
      },
    },
  });
}

/**
 * The signed-in user, verified against the auth server.
 *
 * Deliberately `getUser()` and not `getSession()`. `getSession` returns
 * whatever is in the cookie without checking the signature, so trusting it on
 * the server would let a forged cookie name any user id it liked. `getUser`
 * validates the token, which is the only acceptable basis for an
 * authorization decision.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
