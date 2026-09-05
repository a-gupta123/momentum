import { BarChart3, CalendarCheck, Settings, Target, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown under the label in the command palette. */
  description: string;
}

/**
 * The four destinations, in the order the product is meant to be used: plan the
 * day, define what it is for, see whether it worked, adjust the constraints.
 *
 * Shared between the desktop sidebar, the mobile bar and the command palette so
 * a new page cannot appear in one navigation surface and be missing from
 * another.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/today',
    label: 'Today',
    icon: CalendarCheck,
    description: 'Capture, prioritize and time-block your day',
  },
  {
    href: '/goals',
    label: 'Goals',
    icon: Target,
    description: 'What your daily work is supposed to add up to',
  },
  {
    href: '/insights',
    label: 'Insights',
    icon: BarChart3,
    description: 'Where your time actually went',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Working hours, energy windows and preferences',
  },
];

/** True when `pathname` is inside `href`, so nested routes stay highlighted. */
export function isActiveNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
