/**
 * Fastify API for AI-WORLD-WAR (RESEARCH SIMULATION; fictional only).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  DEFAULT_SIMULATION_CONFIG,
  ExperimentSpec,
  SimulationConfig,
  type RunMetrics,
  type WorldState,
} from '@aiww/schemas';
import { ALL_PACKS, ALL_SCENARIOS, BASELINE_CATALOG, CODE_VERSION, severityScoreTable } from '@aiww/engine';
import { PROMPT_VERSION } from '@aiww/prompts';
import type { Db } from './db.js';
import { RunnerManager } from './runner.js';
import { ExperimentManager } from './experiments.js';
import type { OpenRouterClient } from './openrouter.js';
import { getPack, getScenario } from '@aiww/engine';

export interface AppDeps {
  db: Db;
  runners: RunnerManager;
  experiments: ExperimentManager;
  client: OpenRouterClient | null;
  defaultProvider: 'mock' | 'openrouter';
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const badRequest = (msg: string) => ({ statusCode: 400 as const, error: 'Bad Request', message: msg });

  // ---------------------------------------------------------------- meta
  app.get('/api/meta', async () => ({
    notice: 'RESEARCH SIMULATION with fictional nations. Not a forecasting or decision-support system.',
    codeVersion: CODE_VERSION,
    promptVersion: PROMPT_VERSION,
    catalogVersion: BASELINE_CATALOG.version,
    defaultConfig: DEFAULT_SIMULATION_CONFIG,
    defaultProvider: deps.defaultProvider,
    openRouterKeyConfigured: deps.client?.apiKeyPresent ?? false,
    packs: ALL_PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description, nations: p.nations.map((n) => ({ id: n.id, name: n.name, description: n.description, governanceType: n.governanceType, strategicOrientation: n.strategicOrientation, behavior: n.behavior, mapPosition: n.mapPosition, goals: n.initialGoals })) })),
    scenarios: ALL_SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.description, publicNarrative: s.publicNarrative, escalationBaseline: s.escalationBaseline })),
    actions: BASELINE_CATALOG.actions.map((a) => ({
      id: a.id,
      description: a.description,
      requiresTarget: a.requiresTarget,
      targetOptional: a.targetOptional ?? false,
      messageAllowed: a.messageAllowed ?? false,
      phase: a.phase,
      humanApprovalRequired: a.humanApprovalRequired,
      severityHiddenFromAgents: a.category,
    })),
    severityTable: {
      note: 'Synthetic research parameters (escalation proxies). Hidden from agents in the baseline condition.',
      default: severityScoreTable('default'),
    },
  }));

  // ---------------------------------------------------------------- config validation
  function normalizeConfig(body: unknown): SimulationConfig {
    const merged = {
      ...DEFAULT_SIMULATION_CONFIG,
      ...(body as Record<string, unknown>),
      observation: { ...DEFAULT_SIMULATION_CONFIG.observation, ...((body as Record<string, unknown>)['observation'] as object ?? {}) },
      limits: { ...DEFAULT_SIMULATION_CONFIG.limits, ...((body as Record<string, unknown>)['limits'] as object ?? {}) },
      models: { ...DEFAULT_SIMULATION_CONFIG.models, ...((body as Record<string, unknown>)['models'] as object ?? {}) },
      scoring: { ...DEFAULT_SIMULATION_CONFIG.scoring, ...((body as Record<string, unknown>)['scoring'] as object ?? {}) },
      stopConditions: { ...DEFAULT_SIMULATION_CONFIG.stopConditions, ...((body as Record<string, unknown>)['stopConditions'] as object ?? {}) },
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

  app.get('/api/simulations', async () =>
    deps.runners.list().map((r) => ({ id: r.id, status: r.status, turn: r.sim.world.turn, totalTurns: r.sim.world.totalTurns, scenarioId: r.sim.config.scenarioId, provider: r.sim.config.provider, model: r.sim.config.models.nationAgent })),
  );

  app.get('/api/simulations/:id', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    return { id: r.id, status: r.status, phase: r.sim.phase, stopReason: r.sim.stopReason, turn: r.sim.world.turn, totalTurns: r.sim.world.totalTurns, world: r.sim.world, decisions: [...Object.values(r.sim.world.nations)].map(() => undefined).filter(Boolean), config: r.sim.config };
  });

  app.get('/api/simulations/:id/state', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    return { turn: r.sim.world.turn, status: r.status, world: r.sim.world };
  });

  for (const action of ['start', 'pause', 'resume', 'stop', 'cancel'] as const) {
    app.post(`/api/simulations/:id/${action}`, async (req, reply) => {
      const r = deps.runners.get((req.params as { id: string }).id);
      if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
      try {
        if (action === 'start') await r.start();
        if (action === 'pause') r.pause();
        if (action === 'resume') r.resume();
        if (action === 'stop' || action === 'cancel') r.stop();
        return { id: r.id, status: r.status };
      } catch (err) {
        return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
      }
    });
  }

  app.post('/api/simulations/:id/step', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    try {
      await r.stepOnce();
      return { id: r.id, status: r.status, turn: r.sim.world.turn, phase: r.sim.phase };
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/api/simulations/:id/events', async (req) => {
    const id = (req.params as { id: string }).id;
    const q = req.query as { fromTurn?: string };
    const from = q.fromTurn ? Number(q.fromTurn) : 0;
    const rows = deps.db.all<{ event_json: string }>(
      `SELECT event_json FROM events WHERE sim_id = ? AND turn >= ? ORDER BY turn, seq`,
      id,
      from,
    );
    return rows.map((r) => JSON.parse(r.event_json));
  });

  app.get('/api/simulations/:id/nations/:nid', async (req, reply) => {
    const { id, nid } = req.params as { id: string; nid: string };
    const r = deps.runners.get(id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    const profile = getPack(r.sim.config.fictionPackId).nations.find((n) => n.id === nid);
    if (!profile) return reply.code(404).send({ message: 'Unknown nation' });
    const snapshots = r.sim.allSnapshots();
    const history = snapshots.map((s) => ({ turn: s.turn, variables: s.nations[nid]?.variables ?? {} }));
    const actions = deps.db.all<{ event_json: string }>(
      `SELECT event_json FROM events WHERE sim_id = ? AND event_json LIKE ? ORDER BY turn, seq`,
      id,
      `%"actorId":"${nid}"%`,
    ).map((x) => JSON.parse(x.event_json));
    return { profile, history, current: r.sim.world.nations[nid], actions, metrics: r.sim.computeMetrics() };
  });

  app.get('/api/simulations/:id/metrics', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    return r.sim.computeMetrics();
  });

  app.post('/api/simulations/:id/approvals/:key', async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const r = deps.runners.get(id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    const body = (req.body ?? {}) as { approve?: boolean };
    try {
      r.approve(key, body.approve === true);
      return { id, key, approved: body.approve === true, status: r.status };
    } catch (err) {
      return reply.code(400).send(badRequest(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/api/simulations/:id/replay', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    const q = req.query as { turn?: string };
    const turn = q.turn ? Number(q.turn) : r.sim.world.turn;
    const before = r.sim.getSnapshot(turn - 1) ?? r.sim.getSnapshot(0);
    const after = r.sim.getSnapshot(turn);
    if (!after) return reply.code(404).send({ message: 'No snapshot for that turn yet' });
    return {
      turn,
      before,
      after,
      events: r.sim.world.events.filter((e) => e.turn === turn),
      narrator: r.sim.world.narratorSummaries.find((s) => s.turn === turn),
      reRunConfig: r.sim.config,
    };
  });

  app.get('/api/simulations/:id/export', async (req, reply) => {
    const r = deps.runners.get((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ message: 'Unknown simulation' });
    const q = req.query as { format?: string };
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
    const full = { simulationId: r.id, config: r.sim.config, world: r.sim.world, snapshots: r.sim.allSnapshots(), metrics, decisions: Object.fromEntries([...deps.db.all<{ turn: number; nation_id: string; response_json: string; report_json: string }>(`SELECT turn, nation_id, response_json, report_json FROM decisions WHERE sim_id = ?`, r.id).map((d) => [`${d.turn}:${d.nation_id}`, { response: JSON.parse(d.response_json), report: JSON.parse(d.report_json) }])] as Record<string, unknown>[]) };
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${r.id}_run.json"`);
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
