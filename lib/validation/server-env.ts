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
});

const parsed = serverEnvSchema.safeParse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
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

/** The authoritative capability object. Pass this to client components. */
export function resolveCapabilities(): RuntimeCapabilities {
  return {
    authAvailable: isSupabaseConfigured,
    aiAssistAvailable: isOpenAiConfigured,
    guestDemoAvailable: true,
    appUrl,
  };
}
