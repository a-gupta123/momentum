/**
 * Session refresh.
 *
 * Server Components cannot write cookies, so `lib/supabase/server.ts` has to
 * swallow the write when a token is rotated during a render. This middleware is
 * the other half of that arrangement: it runs on a writable response, calls
 * `getUser()` to trigger the refresh, and persists the rotated cookies.
 *
 * Without it, sessions would silently stop refreshing and users would be logged
 * out roughly an hour after signing in — a bug that only appears in production
 * and only after a delay, which is the worst kind.
 *
 * It deliberately does **not** guard routes. Guest Demo is the default
 * experience, so `/today` must stay reachable with no session at all; the
 * planner layout decides which repository to use based on a verified user.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '@/lib/validation/env';

export default async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) return response;

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // The call itself is the point: it validates the token and rotates it when
  // it is close to expiring. The result is intentionally unused.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Refreshing a
     * session on a favicon request is pure latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
