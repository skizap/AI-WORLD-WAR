/**
 * Batch experiment runner: seeds x models x scenarios x replicates with
 * concurrency limits, failure tracking, resumability, and bootstrap-CI
 * aggregates. Descriptive statistics only — never causal claims.
 */
import { randomUUID } from 'node:crypto';
import type { ExperimentResult, ExperimentSpec, RunMetrics, SimulationConfig } from '@aiww/schemas';
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
} from '@aiww/engine';
import type { Db } from './db.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function bootstrapCi(values: number[], iterations = 2000): { low: number; high: number } {
  if (values.length < 2) {
    const v = values[0] ?? 0;
    return { low: v, high: v };
  }
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < values.length; j++) {
      s += values[Math.floor(Math.random() * values.length)];
    }
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: percentile(means, 0.025), high: percentile(means, 0.975) };
}

export class ExperimentManager {
  constructor(
    private readonly db: Db,
    private readonly runOne: (config: SimulationConfig) => Promise<RunMetrics>,
  ) {}

  async run(spec: ExperimentSpec): Promise<ExperimentResult> {
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
          const config: SimulationConfig = {
            ...(this.baseConfig as SimulationConfig),
            seed: job.seed,
            scenarioId: job.scenarioId,
            provider: spec.provider,
            models: { ...this.baseConfig.models, nationAgent: job.model, worldNarrator: job.model, repair: job.model },
            ...(spec.configOverrides as Partial<SimulationConfig> | undefined),
          } as SimulationConfig;
          const metrics = await this.runOne(config);
          records.push({
            simulationId: `exp_${computeConfigHash(config).slice(0, 8)}_${job.seed}_${job.replicate}`,
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
        const scores = rs.map((r) => r.finalMeanScore ?? 0);
        const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
        const ci = bootstrapCi(scores);
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
    return { id, spec, codeVersion: CODE_VERSION, promptVersion: PROMPT_VERSION, status: 'completed', records, aggregate, startedAt, endedAt: new Date().toISOString() };
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

/** Factory for a mock-mode one-shot runner used by the experiment manager. */
export function makeMockRunOne(): (config: SimulationConfig) => Promise<RunMetrics> {
  return async (config) => {
    const sim = new Simulation({
      config,
      pack: getPack(config.fictionPackId),
      scenario: getScenario(config.scenarioId),
      agentProvider: new MockAgentProvider(),
      narratorProvider: new DeterministicNarratorProvider(),
    });
    for (let i = 0; i < 500; i++) {
      await sim.run();
      if (sim.status !== 'awaiting_approval') break;
      for (const p of sim.world.pendingApprovals.filter((x) => x.status === 'pending')) sim.approve(p.key, true);
    }
    return sim.computeMetrics();
  };
}
