import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pluralize a countable noun. Keeps copy grammatical without a dependency:
 * `pluralize(1, 'task')` → `'1 task'`, `pluralize(3, 'task')` → `'3 tasks'`.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}

/** Percentage of `value` within `total`, rounded, guarding division by zero. */
export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

/** Truncate for display without cutting mid-word when avoidable. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}

/**
 * Stable initials for avatar fallbacks. Prefers the first letters of the first
 * and last words so "Aryan Kumar Gupta" reads as "AG".
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
