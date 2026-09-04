/**
 * Public (browser-safe) environment parsing and the runtime capability object.
 *
 * `NEXT_PUBLIC_*` values are read through **static** member access so the Next
 * compiler can inline them into the client bundle. Building the object from a
 * dynamic `process.env` lookup would silently yield `undefined` in the browser.
 *
 * Missing variables are never an error. They degrade the app to a narrower but
 * fully working configuration, which is what keeps Guest Demo viable with no
 * credentials at all.
 */
import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional().or(z.literal('')),
  NEXT_PUBLIC_APP_URL: z.string().url().optional().or(z.literal('')),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

const publicEnv = parsed.success ? parsed.data : {};

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

export const supabaseUrl = nonEmpty(publicEnv.NEXT_PUBLIC_SUPABASE_URL);
export const supabasePublishableKey = nonEmpty(publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/**
 * Supabase needs *both* values to be usable. Having only one is a
 * misconfiguration, and treating it as "configured" would produce a broken
 * sign-in button instead of a working demo.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const appUrl =
  nonEmpty(publicEnv.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000';

/**
 * What this deployment can actually do. Resolved on the server and handed to
 * the client as props, so the browser never needs to inspect secrets to learn
 * whether AI parsing is on.
 */
export interface RuntimeCapabilities {
  /** Sign-in and the Postgres-backed adapter are available. */
  authAvailable: boolean;
  /** Enhanced intent parsing via OpenAI is available. */
  aiAssistAvailable: boolean;
  /** Always true: the deterministic parser and local adapter need nothing. */
  guestDemoAvailable: true;
  appUrl: string;
}

/**
 * Client-visible capabilities. AI availability is *not* decided here because it
 * depends on a server-only secret; the server overrides it via
 * `resolveCapabilities` in `lib/validation/server-env.ts`.
 */
export const publicCapabilities: RuntimeCapabilities = {
  authAvailable: isSupabaseConfigured,
  aiAssistAvailable: false,
  guestDemoAvailable: true,
  appUrl,
};
