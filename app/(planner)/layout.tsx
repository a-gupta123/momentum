/**
 * The planner shell.
 *
 * Mode is resolved here, on the server, from a *verified* session. If there is
 * a signed-in user the Supabase adapter is used; otherwise the visitor gets
 * Guest Demo. Deciding this server-side means the client never has to guess,
 * and there is no flash of the wrong mode while a session is checked.
 *
 * Guest Demo is not a fallback for a failed auth check — it is the default
 * experience, which is what makes the deployed app usable by someone who
 * arrives from a README link and has no intention of signing up.
 */
import { PlannerProvider } from '@/components/planner/planner-store';
import { AppShell } from '@/components/shell/app-shell';
import { getCurrentUser } from '@/lib/supabase/server';
import { resolveCapabilities } from '@/lib/validation/server-env';

export default async function PlannerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const capabilities = resolveCapabilities();

  return (
    <PlannerProvider
      mode={user ? 'supabase' : 'guest'}
      userId={user?.id ?? null}
      capabilities={capabilities}
    >
      <AppShell>{children}</AppShell>
    </PlannerProvider>
  );
}
