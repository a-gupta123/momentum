/**
 * Magic-link callback.
 *
 * Exchanges the one-time code for a session and sets the cookies. Two details
 * matter here and are easy to get wrong:
 *
 * 1. **The `next` parameter is validated as a local path.** Reflecting it into
 *    a redirect unchecked is a textbook open-redirect: `?next=https://evil.tld`
 *    would send a freshly authenticated user straight off the site.
 *
 * 2. **Failures redirect, they do not render an error page.** A user who
 *    clicked a stale link should land back on sign-in with a readable reason,
 *    not on a stack trace.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getServerSupabase } from '@/lib/supabase/server';

/** Only same-origin absolute paths are accepted as a post-login destination. */
function safeNext(value: string | null): string {
  if (!value) return '/today';
  // `//evil.tld` and `/\evil.tld` are protocol-relative URLs, not local paths.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/today';
  }
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  const authError = searchParams.get('error_description') ?? searchParams.get('error');
  if (authError) {
    return NextResponse.redirect(`${origin}/signin?error=${encodeURIComponent(authError)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/signin?error=missing_code`);
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/signin?error=auth_unavailable`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/signin?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
