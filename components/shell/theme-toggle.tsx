'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsHydrated } from '@/components/hooks/use-clock';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/domain/types';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value !== undefined && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Theme switcher.
 *
 * Three explicit options rather than a two-state toggle. "System" is the
 * default and has to stay reachable: a binary toggle silently opts the user out
 * of following their OS, with no way back to it.
 */
export function ThemeToggle({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // The stored theme is unknown during SSR, so the icon renders neutral until
  // hydration. Guessing here would flash the wrong glyph on every load.
  const hydrated = useIsHydrated();

  const current = isThemePreference(theme) ? theme : 'system';
  const Icon = !hydrated ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label="Change theme">
          <Icon className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-36">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (isThemePreference(value)) setTheme(value);
          }}
        >
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" aria-hidden />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
