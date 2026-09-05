import 'server-only';

/**
 * Server-only environment. The `server-only` import above turns any accidental
 * client import into a build error, which is the mechanism that guarantees
 * `OPENAI_API_KEY` can never reach the browser bundle.
 */
import { z } from 'zod';

import { isSupabaseConfigured, appUrl, type RuntimeCapabilities } from '@/lib/validation/env';

const serverEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(20).optional().or(z.literal('')),
  OPENAI_MODEL: z.string().min(2).optional().or(z.literal('')),
  /** Optional shared secret for the seed script; never required at runtime. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional().or(z.literal('')),
  /**
   * Injected by Vercel, not by us. The production alias is preferred over
   * `VERCEL_URL` because the latter is the immutable per-deployment hostname —
   * correct, but it changes on every push, so canonical links built from it
   * would point at a specific old deployment rather than at the site.
   */
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
});

const parsed = serverEnvSchema.safeParse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  VERCEL_URL: process.env.VERCEL_URL,
});

const serverEnv = parsed.success ? parsed.data : {};

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

export const openAiApiKey = nonEmpty(serverEnv.OPENAI_API_KEY);

/**
 * The model is read from configuration with no fallback on purpose. Hard-coding
 * a default model name means the app silently breaks the day that name is
 * retired; requiring it makes the operator's choice explicit and lets the
 * deterministic parser cover the unconfigured case.
 */
export const openAiModel = nonEmpty(serverEnv.OPENAI_MODEL);

/** Enhanced parsing needs the key *and* an explicit model. */
export const isOpenAiConfigured = Boolean(openAiApiKey && openAiModel);

/**
 * The absolute origin, resolved server-side.
 *
 * An explicit `NEXT_PUBLIC_APP_URL` always wins — it is the only way to declare
 * a custom domain. Failing that, the host's own value is used, because the
 * shared default of `http://localhost:3000` is actively wrong once deployed:
 * `metadataBase` would resolve every Open Graph image and canonical link
 * against localhost, so link previews would silently break everywhere. Getting
 * this right without configuration is what makes a fresh import correct on the
 * first deploy rather than after someone notices a broken preview.
 */
export const resolvedAppUrl = ((): string => {
  if (nonEmpty(process.env.NEXT_PUBLIC_APP_URL)) return appUrl;

  const host = nonEmpty(serverEnv.VERCEL_PROJECT_PRODUCTION_URL) ?? nonEmpty(serverEnv.VERCEL_URL);
  // Vercel supplies a bare hostname with no scheme, and it is always https.
  return host ? `https://${host}` : appUrl;
})();

/** The authoritative capability object. Pass this to client components. */
export function resolveCapabilities(): RuntimeCapabilities {
  return {
    authAvailable: isSupabaseConfigured,
    aiAssistAvailable: isOpenAiConfigured,
    guestDemoAvailable: true,
    appUrl: resolvedAppUrl,
  };
}
