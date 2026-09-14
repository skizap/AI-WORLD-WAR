/**
 * Entry point: `npm run dev -w @aiww/server`
 */
import 'dotenv/config';
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
experiments.baseConfig = DEFAULT_SIMULATION_CONFIG;

const app = await buildApp({ db, runners, experiments, client, defaultProvider: env.DEFAULT_PROVIDER });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`[aiww] RESEARCH SIMULATION API on http://${env.HOST}:${env.PORT} (fictional only; provider=${env.DEFAULT_PROVIDER})`);
} catch (err) {
  if (err instanceof OpenRouterError) console.error('[aiww]', err.message);
  process.exit(1);
}
