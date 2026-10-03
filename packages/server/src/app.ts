/**
 * Fastify API for AI-WORLD-WAR (RESEARCH SIMULATION; fictional only).
 *
 * Read model: an active runner is the freshest source for a running
 * simulation; terminal/interrupted runs are read from SQLite and stay
 * selectable after a server restart. Historical records are read-only.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SIMULATION_CONFIG,
  ExperimentSpec,
  SimulationConfig,
  type RunMetrics,
  type SimulationStatus,
  type WorldEvent,
  type WorldState,
} from '@aiww/schemas';
import { ALL_PACKS, ALL_SCENARIOS, BASELINE_CATALOG, CODE_VERSION, computeRunMetrics, severityScoreTable } from '@aiww/engine';
import { PROMPT_VERSION } from '@aiww/prompts';
import type { Db } from './db.js';
import { RunnerManager, type SimRunner } from './runner.js';
import { ExperimentManager } from './experiments.js';
import type { OpenRouterClient } from './openrouter.js';
import { getPack, getScenario } from '@aiww/engine';
import { resolveNationModel } from '@aiww/schemas';

export interface AppDeps {
  db: Db;
  runners: RunnerManager;
  experiments: ExperimentManager;
  client: OpenRouterClient | null;
  defaultProvider: 'mock' | 'openrouter';
  defaultConfig?: SimulationConfig;
  /** Fastify log level ('silent' disables logging); undefined keeps tests quiet. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

interface SimulationRow {
  id: string;
  status: string;
  config_json: string;
  scenario_id: string;
  seed: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

const TERMINAL: SimulationStatus[] = ['completed', 'stopped', 'failed', 'interrupted'];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logLevel && deps.logLevel !== 'silent' ? { level: deps.logLevel } : false });
  await app.register(cors, { origin: true });
  const effectiveDefaultConfig = deps.defaultConfig ?? {
    ...DEFAULT_SIMULATION_CONFIG,
    provider: deps.defaultProvider,
  };

  // Serve the built dashboard (packages/ui/dist) when present.
  const uiDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui', 'dist');
  if (existsSync(join(uiDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: uiDist, prefix: '/' });
    // SPA fallback: any non-API GET renders the dashboard shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        void reply.sendFile('index.html', uiDist);
        return;
      }
      reply.code(404).send({ message: 'Not found' });
    });
  }

  const badRequest = (msg: string) => ({ statusCode: 400 as const, error: 'Bad Request', message: msg });

  // ------------------------------------------------------------- read model
  function getSimulationRow(id: string): SimulationRow | undefined {
    return deps.db.get<SimulationRow>(`SELECT * FROM simulations WHERE id = ?`, id);
  }

  function archivedSnapshotTurns(id: string): number[] {
    return deps.db
      .all<{ turn: number }>(`SELECT turn FROM snapshots WHERE sim_id = ? ORDER BY turn`, id)
      .map((r) => r.turn);
  }

  function archivedSnapshot(id: string, turn: number): WorldState | undefined {
    const row = deps.db.get<{ world_json: string }>(`SELECT world_json FROM snapshots WHERE sim_id = ? AND turn = ?`, id, turn);
    return row ? (JSON.parse(row.world_json) as WorldState) : undefined;
  }

  function archivedLatestWorld(id: string): WorldState | undefined {
    const row = deps.db.get<{ world_json: string }>(`SELECT world_json FROM snapshots WHERE sim_id = ? ORDER BY turn DESC LIMIT 1`, id);
    return row ? (JSON.parse(row.world_json) as WorldState) : undefined;
  }

  function archivedEvents(id: string, fromTurn = 0): WorldEvent[] {
    return deps.db
      .all<{ event_json: string }>(`SELECT event_json FROM events WHERE sim_id = ? AND turn >= ? ORDER BY turn, seq`, id, fromTurn)
      .map((r) => JSON.parse(r.event_json) as WorldEvent);
  }

  function archivedDecisions(id: string): unknown {
    const out: Record<string, unknown> = {};
    for (const d of deps.db.all<{ turn: number; nation_id: string; response_json: string; report_json: string; provider: string; model: string; status: string }>(
      `SELECT turn, nation_id, response_json, report_json, provider, model, status FROM decisions WHERE sim_id = ? ORDER BY turn, nation_id`,
      id,
    )) {
      out[`${d.turn}:${d.nation_id}`] = {
        response: JSON.parse(d.response_json),
        report: JSON.parse(d.report_json),
        provider: d.provider,
        model: d.model,
        status: d.status,
      };
    }
    return out;
  }

  function archivedMetrics(id: string): RunMetrics | undefined {
    const row = deps.db.get<{ metrics_json: string }>(`SELECT metrics_json FROM metrics WHERE sim_id = ? ORDER BY turn DESC LIMIT 1`, id);
    return row ? (JSON.parse(row.metrics_json) as RunMetrics) : undefined;
  }

  function archivedSummary(row: SimulationRow) {
    const config = JSON.parse(row.config_json) as SimulationConfig;
    const world = archivedLatestWorld(row.id);
    return {
      id: row.id,
      status: row.status as SimulationStatus,
      turn: world?.turn ?? 0,
      totalTurns: config.totalTurns,
      scenarioId: row.scenario_id,
      provider: row.provider,
      model: row.model,
      archived: true,
    };
  }

  function liveSummary(r: SimRunner) {
    return {
      id: r.id,
      status: r.status,
      turn: r.sim.world.turn,
      totalTurns: r.sim.config.totalTurns,
      scenarioId: r.sim.config.scenarioId,
      provider: r.sim.config.provider,
      model: new Set(getPack(r.sim.config.fictionPackId).nations.map((nation) => resolveNationModel(r.sim.config, nation.id))).size > 1
        ? 'mixed'
        : resolveNationModel(r.sim.config, getPack(r.sim.config.fictionPackId).nations[0]?.id ?? ''),
      archived: false,
    };
  }

  // ---------------------------------------------------------------- meta
  app.get('/api/meta', async () => ({
    notice: 'RESEARCH SIMULATION with fictional nations. Not a forecasting or decision-support system.',
    codeVersion: CODE_VERSION,
    promptVersion: PROMPT_VERSION,
    catalogVersion: BASELINE_CATALOG.version,
    defaultConfig: effectiveDefaultConfig,
    defaultProvider: deps.defaultProvider,
    openRouterKeyConfigured: deps.client?.apiKeyPresent ?? false,
    packs: ALL_PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description, nations: p.nations.map((n) => ({ id: n.id, name: n.name, description: n.description, governanceType: n.governanceType, strategicOrientation: n.strategicOrientation, behavior: n.behavior, mapPosition: n.mapPosition, goals: n.initialGoals })) })),
    scenarios: ALL_SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.description, publicNarrative: s.publicNarrative })),
    actions: BASELINE_CATALOG.actions.map((a) => ({
      id: a.id,
      description: a.description,
      requiresTarget: a.requiresTarget,
      targetOptional: a.targetOptional ?? false,
      messageAllowed: a.messageAllowed ?? false,
      phase: a.phase,
      severityHiddenFromAgents: a.category,
      sideEffects: a.sideEffects,
    })),
    severityTable: {
      note: 'Synthetic research parameters (escalation proxies). Hidden from agents in the baseline condition.',
      default: severityScoreTable('default'),
    },
  }));

  // ---------------------------------------------------------------- config validation
  function normalizeConfig(body: unknown): SimulationConfig {
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const inputModels = input['models'] && typeof input['models'] === 'object'
      ? input['models'] as Record<string, unknown>
      : {};
    const packId = typeof input['fictionPackId'] === 'string'
      ? input['fictionPackId']
      : effectiveDefaultConfig.fictionPackId;
    const fallbackNationModel = typeof inputModels['nationAgent'] === 'string'
      ? inputModels['nationAgent']
      : effectiveDefaultConfig.models.nationAgent;
    const nationAgents = inputModels['nationAgents'] ?? (
      inputModels['nationAgent'] !== undefined
        ? Object.fromEntries(getPack(packId).nations.map((nation) => [nation.id, fallbackNationModel]))
        : effectiveDefaultConfig.models.nationAgents
    );
    const merged = {
      ...effectiveDefaultConfig,
      ...input,
      observation: { ...effectiveDefaultConfig.observation, ...(input['observation'] as object ?? {}) },
      limits: { ...effectiveDefaultConfig.limits, ...(input['limits'] as object ?? {}) },
      models: { ...effectiveDefaultConfig.models, ...inputModels, nationAgents },
      scoring: { ...effectiveDefaultConfig.scoring, ...(input['scoring'] as object ?? {}) },
      stopConditions: { ...effectiveDefaultConfig.stopConditions, ...(input['stopConditions'] as object ?? {}) },
    };
    const parsed = SimulationConfig.safeParse(merged);
    if (!parsed.success) {
      throw Object.assign(new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`), { statusCode: 400 });
    }
    const config = parsed.data;
    // Validate referenced fictional content exists.
    getPack(config.fictionPackId);
    getScenario(config.scenarioId);
    return config;
  }

  app.post('/api/simulations/validate', async (req, reply) => {
    try {
      const config = normalizeConfig(req.body);
      return { valid: true, config };
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  // ---------------------------------------------------------------- simulations
  app.post('/api/simulations', async (req, reply) => {
    try {
      const config = normalizeConfig(req.body);
      const runner = deps.runners.create(config);
      return reply.code(201).send({ id: runner.id, status: runner.status, config });
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/api/simulations', async () => {
    const live = deps.runners.list().map(liveSummary);
    const liveIds = new Set(live.map((s) => s.id));
    const archived = deps.db
      .all<SimulationRow>(`SELECT * FROM simulations ORDER BY created_at DESC`)
      .filter((row) => !liveIds.has(row.id))
      .map(archivedSummary);
    return [...live, ...archived];
  });

  app.get('/api/simulations/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = deps.runners.get(id);
    if (r) {
      return {
        id: r.id,
        status: r.status,
        phase: r.sim.phase,
        stopReason: r.sim.stopReason,
        stopRequested: r.sim.stopRequested,
        stopPending: r.stopPending,
        turn: r.sim.world.turn,
        totalTurns: r.sim.config.totalTurns,
        world: r.sim.world,
        decisions: r.sim.allDecisionRecords(),
        config: r.sim.config,
        snapshotTurns: r.snapshotTurns(),
        archived: false,
      };
    }
    const row = getSimulationRow(id);
    if (!row) return reply.code(404).send({ message: 'Unknown simulation' });
    const world = archivedLatestWorld(id);
    return {
      id: row.id,
      status: row.status as SimulationStatus,
      phase: null,
      stopReason: row.status === 'interrupted' ? 'The server process ended while this run was active; it was saved as an interrupted record.' : null,
      stopRequested: false,
      stopPending: false,
      turn: world?.turn ?? 0,
      totalTurns: (JSON.parse(row.config_json) as SimulationConfig).totalTurns,
      world: world ?? null,
      decisions: archivedDecisions(id),
      config: JSON.parse(row.config_json) as SimulationConfig,
      snapshotTurns: archivedSnapshotTurns(id),
      archived: true,
    };
  });

  app.get('/api/simulations/:id/state', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = deps.runners.get(id);
    if (r) return { turn: r.sim.world.turn, status: r.status, world: r.sim.world, archived: false };
    const row = getSimulationRow(id);
    if (!row) return reply.code(404).send({ message: 'Unknown simulation' });
    const world = archivedLatestWorld(id);
    return { turn: world?.turn ?? 0, status: row.status as SimulationStatus, world: world ?? null, archived: true };
  });

  app.post('/api/simulations/:id/start', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = deps.runners.get(id);
    if (!r) {
      if (getSimulationRow(id)) {
        return reply.code(400).send(badRequest('This simulation is an archived record; create a new simulation from its configuration instead.'));
      }
      return reply.code(404).send({ message: 'Unknown simulation' });
    }
    try {
      await r.start();
      return { id: r.id, status: r.status };
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  app.post('/api/simulations/:id/stop', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = deps.runners.get(id);
    if (r) {
      // Idempotent: repeated stops never rewrite a terminal status or data.
      r.stop();
      return { id: r.id, status: r.status, stopRequested: r.sim.stopRequested, stopPending: r.stopPending };
    }
    const row = getSimulationRow(id);
    if (!row) return reply.code(404).send({ message: 'Unknown simulation' });
    // Terminal and interrupted records are immutable; report the saved status.
    const status = row.status as SimulationStatus;
    return {
      id,
      status: TERMINAL.includes(status) || status === 'idle' ? status : 'stopped',
      stopRequested: false,
      stopPending: false,
    };
  });

  app.get('/api/simulations/:id/events', async (req) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { fromTurn?: string };
    const from = q.fromTurn ? Number(q.fromTurn) : 0;
    return archivedEvents(id, from);
  });

  app.get('/api/simulations/:id/nations/:nid', async (req, reply) => {
    const { id, nid } = req.params as { id: string; nid: string };
    const r = deps.runners.get(id);
    const row = getSimulationRow(id);
    if (!r && !row) return reply.code(404).send({ message: 'Unknown simulation' });
    const config = r?.config ?? (row ? (JSON.parse(row.config_json) as SimulationConfig) : undefined);
    if (!config) return reply.code(404).send({ message: 'Unknown simulation' });
    const profile = getPack(config.fictionPackId).nations.find((n) => n.id === nid);
    if (!profile) return reply.code(404).send({ message: 'Unknown nation' });

    const snapshotList = r ? r.allSnapshots() : archivedSnapshotTurns(id).map((t) => archivedSnapshot(id, t)!).filter(Boolean);
    const history = snapshotList.map((s) => ({ turn: s.turn, variables: s.nations[nid]?.variables ?? {} }));
    const current = r ? r.sim.world.nations[nid] : archivedLatestWorld(id)?.nations[nid];
    const actions = archivedEvents(id).filter((e) => e.actorId === nid);
    const metrics = r ? r.sim.computeMetrics() : archivedMetrics(id);
    // Recorded provocations aimed at this nation (retention audit trail).
    const provocations = Object.entries((r?.sim.world ?? archivedLatestWorld(id))?.relationships ?? {})
      .filter(([key]) => key.startsWith(`${nid}>`))
      .flatMap(([, rel]) => rel.provocations)
      .sort((a, b) => a.turn - b.turn);
    return { profile, history, current, actions, provocations, metrics: metrics ?? null, archived: !r };
  });

  app.get('/api/simulations/:id/metrics', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = deps.runners.get(id);
    if (r) return r.sim.computeMetrics();
    if (!getSimulationRow(id)) return reply.code(404).send({ message: 'Unknown simulation' });
    const metrics = archivedMetrics(id);
    if (metrics) return metrics;
    const world = archivedLatestWorld(id);
    if (!world) return reply.code(404).send({ message: 'No metrics are saved for this simulation yet' });
    const row = getSimulationRow(id)!;
    const config = JSON.parse(row.config_json) as SimulationConfig;
    return computeArchivedMetrics(config, world);
  });

  function computeArchivedMetrics(config: SimulationConfig, world: WorldState): RunMetrics {
    return computeRunMetrics(config, getPack(config.fictionPackId), world, {
      fallbackCount: 0,
      providerFailureCount: 0,
      validationFailureCount: 0,
      allianceCollapse: 0,
    });
  }

  app.get('/api/simulations/:id/replay', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { turn?: string };
    const r = deps.runners.get(id);
    if (r) {
      const available = r.snapshotTurns();
      const turn = q.turn ? Number(q.turn) : (available[available.length - 1] ?? 0);
      if (!available.includes(turn)) {
        return reply.code(404).send({
          message: 'No snapshot for that turn yet',
          code: 'no_snapshot',
          availableTurns: available,
        });
      }
      const before = r.getSnapshot(turn - 1) ?? null;
      const after = r.getSnapshot(turn)!;
      return {
        turn,
        before,
        after,
        events: r.sim.world.events.filter((e) => e.turn === turn),
        narrator: r.sim.world.narratorSummaries.find((s) => s.turn === turn),
        reRunConfig: r.sim.config,
        availableTurns: available,
        archived: false,
      };
    }
    const row = getSimulationRow(id);
    if (!row) return reply.code(404).send({ message: 'Unknown simulation', code: 'unknown_simulation' });
    const available = archivedSnapshotTurns(id);
    const turn = q.turn ? Number(q.turn) : (available[available.length - 1] ?? 0);
    if (!available.includes(turn)) {
      return reply.code(404).send({
        message: 'No snapshot for that turn is stored for this simulation',
        code: 'no_snapshot',
        availableTurns: available,
      });
    }
    const after = archivedSnapshot(id, turn)!;
    const before = archivedSnapshot(id, turn - 1) ?? null;
    return {
      turn,
      before,
      after,
      events: archivedEvents(id).filter((e) => e.turn === turn),
      narrator: deps.db
        .all<{ summary_json: string }>(`SELECT summary_json FROM narrator WHERE sim_id = ? AND turn = ?`, id, turn)
        .map((n) => JSON.parse(n.summary_json) as { turn: number; summary: string; source: string })[0],
      reRunConfig: JSON.parse(row.config_json) as SimulationConfig,
      availableTurns: available,
      archived: true,
    };
  });

  app.get('/api/simulations/:id/export', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { format?: string };
    const r = deps.runners.get(id);
    if (r) {
      const metrics: RunMetrics = r.sim.computeMetrics();
      if (q.format === 'csv') {
        const header = 'turn,mean_score,violent_rate,nuclear_rate,de_escalation_rate,civilian_impact_proxy,global_stability';
        const lines = metrics.turns.map(
          (t) => `${t.turn},${t.meanScore},${t.violentRate},${t.nuclearRate},${t.deEscalationRate},${t.civilianImpactProxy},${t.globalStability}`,
        );
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="${r.id}_metrics.csv"`);
        return [header, ...lines].join('\n');
      }
      const full = { simulationId: r.id, config: r.sim.config, world: r.sim.world, snapshots: r.allSnapshots(), metrics, decisions: archivedDecisions(id) };
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${r.id}_run.json"`);
      return full;
    }
    const row = getSimulationRow(id);
    if (!row) return reply.code(404).send({ message: 'Unknown simulation' });
    const config = JSON.parse(row.config_json) as SimulationConfig;
    const world = archivedLatestWorld(id);
    const snapshots = archivedSnapshotTurns(id).map((t) => archivedSnapshot(id, t)!).filter(Boolean);
    const metrics = archivedMetrics(id) ?? (world ? computeArchivedMetrics(config, world) : undefined);
    if (q.format === 'csv') {
      const header = 'turn,mean_score,violent_rate,nuclear_rate,de_escalation_rate,civilian_impact_proxy,global_stability';
      const lines = (metrics?.turns ?? []).map(
        (t) => `${t.turn},${t.meanScore},${t.violentRate},${t.nuclearRate},${t.deEscalationRate},${t.civilianImpactProxy},${t.globalStability}`,
      );
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${id}_metrics.csv"`);
      return [header, ...lines].join('\n');
    }
    const full = { simulationId: id, config, world: world ?? null, snapshots, metrics: metrics ?? null, decisions: archivedDecisions(id), archived: true };
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${id}_run.json"`);
    return full;
  });

  // Import/export round-trip: accepts an exported run JSON and re-creates the sim.
  app.post('/api/simulations/import', async (req, reply) => {
    try {
      const body = req.body as { config?: SimulationConfig };
      if (!body?.config) return reply.code(400).send(badRequest('Missing config in import payload'));
      const config = normalizeConfig(body.config);
      const runner = deps.runners.create(config);
      return reply.code(201).send({ id: runner.id, status: runner.status, imported: true });
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  // ---------------------------------------------------------------- experiments
  app.post('/api/experiments', async (req, reply) => {
    const parsed = ExperimentSpec.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(badRequest(`Invalid experiment spec: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`));
    }
    const result = await deps.experiments.run(parsed.data);
    return reply.code(201).send(result);
  });

  app.get('/api/experiments', async () => deps.experiments.list());

  app.get('/api/experiments/:id', async (req, reply) => {
    const exp = deps.experiments.get((req.params as { id: string }).id);
    if (!exp) return reply.code(404).send({ message: 'Unknown experiment' });
    return exp;
  });

  // ---------------------------------------------------------------- OpenRouter
  app.get('/api/openrouter/health', async () => {
    if (!deps.client) return { configured: false, ok: false, detail: 'No OpenRouter client configured (mock mode).' };
    const health = await deps.client.health();
    return { configured: deps.client.apiKeyPresent, ...health };
  });

  app.get('/api/openrouter/models', async (req, reply) => {
    if (!deps.client) return reply.code(400).send(badRequest('No OpenRouter client configured (mock mode).'));
    const q = req.query as { force?: string };
    try {
      const models = await deps.client.listModels(q.force === 'true');
      return { count: models.length, models };
    } catch (err) {
      return reply.code(502).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}