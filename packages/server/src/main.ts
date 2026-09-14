/**
 * Entry point: `npm run dev -w @aiww/server`
 */
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env regardless of the working directory npm chose.
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
dotenv.config({ path: rootEnv });
dotenv.config(); // also honor a local packages/server/.env if present
import { loadEnv, validateOpenRouterSettings } from './config.js';
import { Db } from './db.js';
import { OpenRouterClient, OpenRouterError } from './openrouter.js';
import { RunnerManager } from './runner.js';
import { ExperimentManager, makeMockRunOne } from './experiments.js';
import { buildApp } from './app.js';
import { DEFAULT_SIMULATION_CONFIG } from '@aiww/schemas';

const env = loadEnv();
const settings = validateOpenRouterSettings(env);
if (!settings.ok) {
  console.warn('[aiww] OpenRouter settings incomplete:', settings.problems.join('; '));
  console.warn('[aiww] The app will still run in mock mode; set OPENROUTER_* env vars for real model runs.');
}

const db = new Db(env.DB_PATH);
const client = new OpenRouterClient(env);
const runners = new RunnerManager(db, client);
const experiments = new ExperimentManager(db, makeMockRunOne());
const effectiveDefaultConfig = {
  ...DEFAULT_SIMULATION_CONFIG,
  provider: env.DEFAULT_PROVIDER,
  models: {
    nationAgent: env.OPENROUTER_NATION_AGENT_MODEL,
    worldNarrator: env.OPENROUTER_WORLD_NARRATOR_MODEL,
    repair: env.OPENROUTER_REPAIR_MODEL,
  },
};
experiments.baseConfig = effectiveDefaultConfig;

const app = await buildApp({
  db,
  runners,
  experiments,
  client,
  defaultProvider: env.DEFAULT_PROVIDER,
  defaultConfig: effectiveDefaultConfig,
});

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`[aiww] RESEARCH SIMULATION API on http://${env.HOST}:${env.PORT} (fictional only; provider=${env.DEFAULT_PROVIDER})`);
} catch (err) {
  if (err instanceof OpenRouterError) console.error('[aiww]', err.message);
  process.exit(1);
}
