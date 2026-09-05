import type { Goal, GoalCategory, GoalColorToken } from '@/lib/domain/types';
import { GOAL_COLOR_TOKENS, isGoalColorToken } from '@/lib/domain/types';

/**
 * Goal color resolution.
 *
 * Colors are stored as tokens (`'cobalt'`), never as hex. That indirection is
 * what lets the palette be retuned for dark mode — and lets a user's goals stay
 * legible in both themes — without rewriting stored data. Resolution happens
 * here, at render time, against the CSS variables in `globals.css`.
 */

/** The CSS variable for a token, for inline styles and chart props. */
export function goalColorVar(token: GoalColorToken): string {
  return `var(--goal-${token})`;
}

/** Resolves a goal's color, tolerating a token that predates the palette. */
export function resolveGoalColor(goal: Pick<Goal, 'color'> | null | undefined): string {
  if (!goal || !isGoalColorToken(goal.color)) return 'var(--ink-subtle)';
  return goalColorVar(goal.color);
}

/**
 * Suggests a color for a new goal.
 *
 * Category first, so a health goal is green and a career goal is cobalt without
 * the user choosing. When the category's default is already taken, the next
 * unused token is picked so a list of goals stays visually distinguishable —
 * which is the entire reason the color exists.
 */
export function suggestGoalColor(
  category: GoalCategory,
  existing: readonly Goal[],
): GoalColorToken {
  const used = new Set(
    existing.filter((goal) => goal.status !== 'archived').map((goal) => goal.color),
  );

  const preferred = CATEGORY_COLORS[category];
  if (!used.has(preferred)) return preferred;

  const unused = GOAL_COLOR_TOKENS.find((token) => !used.has(token));
  return unused ?? preferred;
}

const CATEGORY_COLORS: Record<GoalCategory, GoalColorToken> = {
  coursework: 'violet',
  career: 'cobalt',
  project: 'teal',
  health: 'moss',
  personal: 'amber',
  custom: 'slate',
};

/** Human label for a category, used in selects and chart legends. */
export const CATEGORY_LABELS: Record<GoalCategory, string> = {
  coursework: 'Coursework',
  career: 'Career',
  project: 'Project',
  health: 'Health',
  personal: 'Personal',
  custom: 'Custom',
};

/** Sentence-case label for a color token, for the color picker's labels. */
export function goalColorLabel(token: GoalColorToken): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}
