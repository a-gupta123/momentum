'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

/**
 * Toasts, restyled onto the design tokens.
 *
 * Sonner ships its own light/dark palette, which would be the one place in the
 * app whose colors are not tokens. Mapping its CSS variables to ours keeps
 * toasts in the same visual system as everything else, including the coral and
 * green that are reserved for urgency and completion.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      // Long enough to read a sentence and reach the Undo button, which is the
      // slowest thing a toast is ever asked to support.
      duration={6000}
      closeButton
      // One toast at a time reads as a status line; five stacked read as a
      // failure. Completing several tasks quickly should not bury the screen.
      visibleToasts={3}
      gap={10}
      toastOptions={{
        classNames: {
          toast: 'font-sans',
        },
        style: {
          background: 'var(--surface)',
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          fontSize: '0.875rem',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--ink)',
          '--normal-border': 'var(--line)',
          '--success-bg': 'var(--success-soft)',
          '--success-text': 'var(--success-ink)',
          '--success-border': 'var(--success-border)',
          '--error-bg': 'var(--urgent-soft)',
          '--error-text': 'var(--urgent-ink)',
          '--error-border': 'var(--urgent-border)',
          '--warning-bg': 'var(--warning-soft)',
          '--warning-text': 'var(--warning-ink)',
          '--warning-border': 'var(--warning-border)',
        } as React.CSSProperties
      }
    />
  );
}
