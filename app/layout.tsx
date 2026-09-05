import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import { AppProviders } from '@/components/providers/app-providers';
import { resolveCapabilities } from '@/lib/validation/server-env';

import './globals.css';

const capabilities = resolveCapabilities();

export const metadata: Metadata = {
  metadataBase: new URL(capabilities.appUrl),
  title: {
    default: 'Momentum — turn a brain dump into a realistic day',
    // Page titles read as "Today · Momentum", which is what shows in a tab
    // strip with a dozen tabs open.
    template: '%s · Momentum',
  },
  description:
    'Momentum turns what you type into structured tasks, ranks them against your long-term goals, and builds a time-blocked day that fits the hours you actually have.',
  applicationName: 'Momentum',
  keywords: ['daily planner', 'task management', 'time blocking', 'goal tracking', 'productivity'],
  authors: [{ name: 'Aryan Gupta' }],
  openGraph: {
    type: 'website',
    siteName: 'Momentum',
    title: 'Momentum — turn a brain dump into a realistic day',
    description:
      'An AI-assisted daily planner that ranks your work against your goals and schedules only what actually fits.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Momentum — turn a brain dump into a realistic day',
    description:
      'An AI-assisted daily planner that ranks your work against your goals and schedules only what actually fits.',
  },
  robots: { index: true, follow: true },
  // No `icons` block on purpose. Declaring it here *overrides* Next's file
  // conventions, so the hand-written URLs would have to be kept in sync with
  // whatever `app/icon.svg`, `app/apple-icon.tsx`, and `app/opengraph-image.tsx`
  // actually resolve to — including their cache-busting hashes. Letting the
  // conventions emit the tags keeps one source of truth.
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is not capped. Capping it is a common way to break the app for anyone
  // who needs to enlarge text.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f4' },
    { media: '(prefers-color-scheme: dark)', color: '#12141c' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is required by the theme provider: it writes
    // the resolved theme class onto <html> before React hydrates, to avoid a
    // flash of the wrong theme. That deliberate mismatch is the only one
    // suppressed here.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="bg-canvas text-ink min-h-dvh font-sans antialiased">
        <AppProviders capabilities={capabilities}>{children}</AppProviders>
      </body>
    </html>
  );
}
