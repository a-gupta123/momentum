'use client';

/**
 * The application chrome.
 *
 * Layout is a fixed sidebar from `lg` up and a bottom bar below it. Two
 * decisions worth stating:
 *
 * - **A bottom bar, not a hamburger.** On a phone the planner is used
 *   one-handed while looking at a calendar; a persistent bar keeps all four
 *   destinations one thumb-reach away, where a drawer costs two taps for every
 *   move.
 *
 * - **The skip link is real.** Keyboard users land on it first and can jump
 *   past the whole navigation into the day, which is the only reason a skip
 *   link is worth having.
 */
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { CommandPalette } from '@/components/shell/command-palette';
import { BrandLockup } from '@/components/shell/brand';
import { ModeBadge } from '@/components/shell/mode-badge';
import { NAV_ITEMS, isActiveNav } from '@/components/shell/nav-items';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { usePlanner } from '@/components/planner/planner-store';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      <a
        href="#main"
        className={cn(
          'sr-focusable bg-primary fixed top-3 left-3 z-[60] rounded-md px-3 py-2',
          'text-primary-ink text-sm font-medium shadow-lg',
        )}
      >
        Skip to today&rsquo;s plan
      </a>

      <DesktopSidebar pathname={pathname} onOpenPalette={() => setPaletteOpen(true)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onOpenPalette={() => setPaletteOpen(true)} />

        <main
          id="main"
          // The bottom padding clears the mobile bar plus the home indicator.
          className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"
        >
          {children}
        </main>
      </div>

      <MobileNav pathname={pathname} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function DesktopSidebar({
  pathname,
  onOpenPalette,
}: {
  pathname: string;
  onOpenPalette: () => void;
}) {
  const { profile, mode } = usePlanner();

  return (
    <aside
      className={cn(
        'border-line sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r',
        'bg-canvas-tint lg:flex',
      )}
    >
      <div className="flex h-16 items-center px-5">
        <Link href="/today" className="rounded-sm" aria-label="Momentum, go to today">
          <BrandLockup />
        </Link>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const active = isActiveNav(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'press flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium',
                active
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
              )}
            >
              <item.icon
                className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-ink-subtle')}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            'press border-line bg-surface flex w-full items-center gap-2 rounded-md border',
            'text-ink-subtle px-2.5 py-2 text-left text-[0.8125rem]',
            'hover:border-line-strong hover:text-ink-muted',
          )}
        >
          <span className="flex-1">Search or jump to&hellip;</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>

      {/* Mode, identity and theme sit at the bottom, out of the way of the
          work but always answerable at a glance. */}
      <div className="border-line mt-auto space-y-3 border-t p-3">
        <ModeBadge />
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-ink-subtle min-w-0 truncate text-xs">
            {profile?.displayName ?? 'Loading…'}
          </p>
          <div className="flex items-center gap-0.5">
            {/* A form, not a link: sign-out is a POST so a prefetch or an
                embedded image cannot log the user out. */}
            {mode === 'supabase' ? (
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="iconSm" aria-label="Sign out">
                  <LogOut className="size-4" aria-hidden />
                </Button>
              </form>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <header
      className={cn(
        'border-line sticky top-0 z-40 flex h-14 items-center gap-2 border-b',
        'bg-canvas/85 px-4 backdrop-blur-md lg:hidden',
      )}
    >
      <Link href="/today" aria-label="Momentum, go to today">
        <BrandLockup />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onOpenPalette}
          aria-label="Search or jump to"
        >
          <SearchGlyph />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'border-line bg-canvas/90 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)] lg:hidden',
      )}
    >
      <ul className="flex items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isActiveNav(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // 3.5rem keeps every target comfortably above the 44px minimum.
                  'flex h-[3.5rem] flex-col items-center justify-center gap-1',
                  active ? 'text-primary' : 'text-ink-subtle',
                )}
              >
                <item.icon className="size-5" aria-hidden />
                <span className="text-[0.6875rem] font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden focusable="false">
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
