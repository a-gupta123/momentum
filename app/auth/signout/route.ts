/**
 * Sign out.
 *
 * `POST` only, on purpose. A `GET` sign-out can be triggered by any image tag
 * or prefetch on any page, which turns logging the user out into a trivial
 * cross-site nuisance. Next's own link prefetching would be enough to do it by
 * accident.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  if (supabase) {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/', request.nextUrl.origin), {
    // 303 so the browser follows with GET rather than replaying the POST.
    status: 303,
  });
}
