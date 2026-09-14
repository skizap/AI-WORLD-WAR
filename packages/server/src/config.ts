/** Typed environment configuration. Secrets are never logged or serialized. */
import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('127.0.0.1'),
  DB_PATH: z.string().default('./data/aiww.sqlite'),
  LOG_LEVEL: z.string().default('info'),
  DEFAULT_PROVIDER: z.enum(['mock', 'openrouter']).default('mock'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_NATION_AGENT_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_WORLD_NARRATOR_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_REPAIR_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  OPENROUTER_MAX_RETRIES: z.coerce.number().int().default(3),
  OPENROUTER_RETRY_BASE_DELAY_MS: z.coerce.number().int().default(500),
  OPENROUTER_CATALOG_CACHE_TTL_MS: z.coerce.number().int().default(300_000),
  OPENROUTER_RESPONSE_CACHE_TTL_MS: z.coerce.number().int().default(600_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}

/** Validates OpenRouter settings at startup without exposing the key. */
export function validateOpenRouterSettings(env: Env): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  try {
    const url = new URL(env.OPENROUTER_BASE_URL);
    if (!/^https?:$/.test(url.protocol)) problems.push('OPENROUTER_BASE_URL must be http(s)');
  } catch {
    problems.push('OPENROUTER_BASE_URL is not a valid URL');
  }
  if (!env.OPENROUTER_NATION_AGENT_MODEL) problems.push('OPENROUTER_NATION_AGENT_MODEL is empty');
  if (!env.OPENROUTER_WORLD_NARRATOR_MODEL) problems.push('OPENROUTER_WORLD_NARRATOR_MODEL is empty');
  if (!env.OPENROUTER_REPAIR_MODEL) problems.push('OPENROUTER_REPAIR_MODEL is empty');
  return { ok: problems.length === 0, problems };
}
