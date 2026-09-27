/**
 * Batch experiment runner: seeds x models x scenarios x replicates with
 * concurrency limits, failure tracking, and reproducible bootstrap-CI
 * aggregates. Descriptive statistics only — never causal claims.
 */
import { randomUUID } from 'node:crypto';
import { SimulationConfig, type ExperimentResult, type ExperimentSpec, type RunMetrics } from '@aiww/schemas';
import {
  CODE_VERSION,
  DeterministicNarratorProvider,
  MockAgentProvider,
  PROMPT_VERSION,
  Simulation,
  computeConfigHash,
  finalMeanScore,
  getPack,
  getScenario,
  Rng,
} from '@aiww/engine';
import type { Db } from './db.js';
import { OpenRouterAgentProvider, OpenRouterNarratorProvider } from './llm-providers.js';
import type { OpenRouterClient } from './openrouter.js';
import { OpenRouterError } from './openrouter.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function bootstrapCi(values: number[], seed: string, iterations = 2000): { low: number; high: number } {
  if (values.length < 2) {
    const v = values[0] ?? 0;
    return { low: v, high: v };
  }
  const rng = Rng.fromParts('bootstrap', seed, values.join(','));
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < values.length; j++) {
      s += values[rng.int(values.length)];
    }
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: percentile(means, 0.025), high: percentile(means, 0.975) };
}

export class ExperimentManager {
  constructor(
    private readonly db: Db,
    private readonly runOne: (config: SimulationConfig, simulationId?: string) => Promise<RunMetrics>,
  ) {}

  async run(spec: ExperimentSpec): Promise<ExperimentResult> {
    if (!this.baseConfig) throw new Error('Experiment base configuration is not initialized.');
    const baseConfig = this.baseConfig;
    const id = `exp_${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const records: ExperimentResult['records'] = [];
    const persist = (status: string, aggregate?: ExperimentResult['aggregate']) => {
      this.db.exec(
        `INSERT OR REPLACE INTO experiments (id, spec_json, status, code_version, prompt_version, records_json, aggregate_json, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        JSON.stringify(spec),
        status,
        CODE_VERSION,
        PROMPT_VERSION,
        JSON.stringify(records),
        aggregate ? JSON.stringify(aggregate) : null,
        startedAt,
        new Date().toISOString(),
      );
    };
    persist('running');

    const jobs: { seed: string; model: string; scenarioId: string; replicate: number }[] = [];
    for (const seed of spec.seeds) {
      for (const model of spec.models) {
        for (const scenarioId of spec.scenarios) {
          for (let r = 0; r < spec.replicates; r++) jobs.push({ seed, model, scenarioId, replicate: r });
        }
      }
    }

    const concurrency = Math.max(1, Math.min(spec.concurrency, 8));
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) break;
        const started = new Date().toISOString();
        try {
          const base = baseConfig;
          const overrides = (spec.configOverrides ?? {}) as Record<string, unknown>;
          const overrideModels = (overrides['models'] ?? {}) as Record<string, unknown>;
          const overrideObservation = (overrides['observation'] ?? {}) as Record<string, unknown>;
          const overrideLimits = (overrides['limits'] ?? {}) as Record<string, unknown>;
          const overrideScoring = (overrides['scoring'] ?? {}) as Record<string, unknown>;
          const overrideStopConditions = (overrides['stopConditions'] ?? {}) as Record<string, unknown>;
          const nationAgents = Object.fromEntries(
            getPack(base.fictionPackId).nations.map((nation) => [nation.id, job.model]),
          );
          const config = SimulationConfig.parse({
            ...base,
            ...overrides,
            seed: job.seed,
            scenarioId: job.scenarioId,
            provider: spec.provider,
            models: {
              ...base.models,
              ...overrideModels,
              nationAgent: job.model,
              nationAgents,
              worldNarrator: job.model,
              repair: job.model,
            },
            observation: { ...base.observation, ...overrideObservation },
            limits: { ...base.limits, ...overrideLimits },
            scoring: { ...base.scoring, ...overrideScoring },
            stopConditions: { ...base.stopConditions, ...overrideStopConditions },
          });
          const simulationId = `exp_${computeConfigHash(config).slice(0, 8)}_${job.seed}_${job.replicate}`;
          const metrics = await this.runOne(config, simulationId);
          records.push({
            simulationId,
            experimentId: id,
            seed: job.seed,
            model: job.model,
            scenarioId: job.scenarioId,
            replicate: job.replicate,
            status: 'completed',
            configHash: computeConfigHash(config),
            finalMeanScore: finalMeanScore(metrics),
            violentRate: metrics.totalActionCount > 0 ? metrics.totals.violentActionCount / metrics.totalActionCount : 0,
            nuclearRate: metrics.totalActionCount > 0 ? metrics.totals.nuclearActionCount / metrics.totalActionCount : 0,
            startedAt: started,
            endedAt: new Date().toISOString(),
          });
        } catch (err) {
          records.push({
            simulationId: `${id}_job_${cursor}`,
            experimentId: id,
            seed: job.seed,
            model: job.model,
            scenarioId: job.scenarioId,
            replicate: job.replicate,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            startedAt: started,
          });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    records.sort(
      (a, b) =>
        a.scenarioId.localeCompare(b.scenarioId) ||
        a.model.localeCompare(b.model) ||
        a.seed.localeCompare(b.seed) ||
        a.replicate - b.replicate,
    );

    // Aggregate: descriptive statistics with bootstrap CIs where replicates allow.
    const groups = new Map<string, typeof records>();
    for (const r of records) {
      if (r.status !== 'completed') continue;
      const key = `${r.scenarioId}|${r.model}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    const aggregate: ExperimentResult['aggregate'] = {
      byScenarioModel: [...groups.entries()].map(([key, rs]) => {
        const [scenarioId, model] = key.split('|');
        const scores = rs.map((r) => r.finalMeanScore ?? 0).sort((a, b) => a - b);
        const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
        const ci = bootstrapCi(scores, `${spec.name}|${key}`);
        return {
          scenarioId,
          model,
          meanFinalScore: Math.round(mean * 100) / 100,
          meanViolentRate: rs.reduce((s, r) => s + (r.violentRate ?? 0), 0) / Math.max(1, rs.length),
          meanNuclearRate: rs.reduce((s, r) => s + (r.nuclearRate ?? 0), 0) / Math.max(1, rs.length),
          ci95Low: Math.round(ci.low * 100) / 100,
          ci95High: Math.round(ci.high * 100) / 100,
          replicates: rs.length,
        };
      }),
      note:
        'Descriptive statistics of fictional simulation scores only. Bootstrap intervals are approximate and become meaningful only with enough replicates. These are NOT predictions, probabilities, or causal claims.',
    };
    const status = records.some((r) => r.status === 'failed') && records.every((r) => r.status === 'failed') ? 'failed' : 'completed';
    persist(status, aggregate);
    return { id, spec, codeVersion: CODE_VERSION, promptVersion: PROMPT_VERSION, status, records, aggregate, startedAt, endedAt: new Date().toISOString() };
  }

  baseConfig: SimulationConfig | undefined;

  list(): { id: string; status: string; started_at: string; spec: unknown }[] {
    return this.db
      .all<{ id: string; status: string; started_at: string; spec_json: string }>(`SELECT id, status, started_at, spec_json FROM experiments ORDER BY started_at DESC`)
      .map((r) => ({ id: r.id, status: r.status, started_at: r.started_at, spec: JSON.parse(r.spec_json) }));
  }

  get(id: string): ExperimentResult | undefined {
    const row = this.db.get<{ id: string; spec_json: string; status: string; code_version: string; prompt_version: string; records_json: string; aggregate_json: string | null; started_at: string; ended_at: string | null }>(
      `SELECT * FROM experiments WHERE id = ?`,
      id,
    );
    if (!row) return undefined;
    return {
      id: row.id,
      spec: JSON.parse(row.spec_json),
      codeVersion: row.code_version,
      promptVersion: row.prompt_version,
      status: row.status as ExperimentResult['status'],
      records: JSON.parse(row.records_json),
      aggregate: row.aggregate_json ? JSON.parse(row.aggregate_json) : undefined,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
    };
  }
}

/** Provider-aware one-shot runner used by the experiment manager. */
export function makeRunOne(client: OpenRouterClient | null): (config: SimulationConfig, simulationId?: string) => Promise<RunMetrics> {
  return async (config, requestedSimulationId) => {
    const simulationId = requestedSimulationId ?? `experiment_${computeConfigHash(config)}_${randomUUID().slice(0, 8)}`;
    if (config.provider === 'openrouter' && (!client || !client.apiKeyPresent)) {
      throw new OpenRouterError('OpenRouter is not configured for this experiment.');
    }
    const agentProvider = config.provider === 'openrouter'
      ? new OpenRouterAgentProvider(client!, config, simulationId)
      : new MockAgentProvider();
    const narratorProvider = config.provider === 'openrouter' && config.narratorEnabled
      ? new OpenRouterNarratorProvider(client!, config, simulationId)
      : new DeterministicNarratorProvider();
    const sim = new Simulation({
      config,
      pack: getPack(config.fictionPackId),
      scenario: getScenario(config.scenarioId),
      agentProvider,
      narratorProvider,
      simulationId,
    });
    await sim.run();
    return sim.computeMetrics();
  };
}

/** Backward-compatible test helper for deterministic mock experiments. */
export function makeMockRunOne(): (config: SimulationConfig) => Promise<RunMetrics> {
  return makeRunOne(null);
}
