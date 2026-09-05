/**
 * Auth shell.
 *
 * Deliberately outside the planner layout: sign-in has no sidebar, no command
 * palette and no planner state to load, and mounting the provider here would
 * make an unauthenticated page pay for a snapshot it will never render.
 */
import Link from 'next/link';

import { BrandLockup } from '@/components/shell/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 h-96 bg-[radial-gradient(50%_50%_at_50%_0%,var(--primary-soft),transparent_70%)] opacity-60"
      />

      <header className="relative flex items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="focus-visible:ring-ring rounded-sm focus-visible:ring-2">
          <BrandLockup />
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
