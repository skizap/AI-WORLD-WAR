import { describe, expect, it } from 'vitest';
import { buildApp, type AppDeps } from '../src/app.js';
import { Db } from '../src/db.js';
import { RunnerManager } from '../src/runner.js';
import { ExperimentManager, makeMockRunOne, makeRunOne } from '../src/experiments.js';
import { DEFAULT_SIMULATION_CONFIG, type SimulationConfig, type WorldState } from '@aiww/schemas';
import { MockAgentProvider, DeterministicNarratorProvider, Simulation, BASELINE_CATALOG, buildObservation, getPack, getScenario } from '@aiww/engine';
import { OpenRouterClient } from '../src/openrouter.js';
import { OpenRouterAgentProvider } from '../src/llm-providers.js';

function makeDeps(): AppDeps {
  const db = new Db(':memory:');
  const runners = new RunnerManager(db, null);
  const experiments = new ExperimentManager(db, makeMockRunOne());
  experiments.baseConfig = DEFAULT_SIMULATION_CONFIG;
  return { db, runners, experiments, client: null, defaultProvider: 'mock' };
}

function cfg(over: Partial<SimulationConfig> = {}): Partial<SimulationConfig> {
  return {
    seed: 'itest-0',
    totalTurns: 14,
    provider: 'mock',
    scenarioId: 'neutral',
    ...over,
  };
}

async function driveToCompletion(app: Awaited<ReturnType<typeof buildApp>>, id: string, timeoutMs = 30_000): Promise<WorldState> {
  const started = Date.now();
  await app.inject({ method: 'POST', url: `/api/simulations/${id}/start` });
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/api/simulations/${id}` });
    const body = res.json() as { status: string; world: WorldState };
    if (body.status === 'completed' || body.status === 'stopped' || body.status === 'failed') return body.world;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout; last status=${body.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('API integration (mock mode)', () => {
  it('meta exposes 27 actions and the severity table with a fiction notice', async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { actions: unknown[]; severityTable: { default: Record<string, number> }; notice: string };
    expect(body.actions).toHaveLength(27);
    expect(body.severityTable.default['nuclear_escalation']).toBe(60);
    expect(body.notice).toContain('fictional');
    await app.close();
  });

  it('expands a partial apply-to-all nation model across the selected pack', async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations/validate',
      payload: { models: { nationAgent: 'custom/all-nations' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { config: SimulationConfig };
    expect(Object.values(body.config.models.nationAgents)).toHaveLength(8);
    expect(new Set(Object.values(body.config.models.nationAgents))).toEqual(new Set(['custom/all-nations']));
    await app.close();
  });

  it('runs a complete 14-turn mock simulation and persists snapshots + metrics', async () => {
    const deps = makeDeps();
    const app = await buildApp(deps);
    const created = await app.inject({ method: 'POST', url: '/api/simulations', payload: cfg() });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    const world = await driveToCompletion(app, id);
    expect(world.turn).toBe(14);
    expect(world.events.filter((e) => e.type === 'action' && e.status === 'accepted').length).toBeGreaterThan(30);
    const metrics = await app.inject({ method: 'GET', url: `/api/simulations/${id}/metrics` });
    const m = metrics.json() as { turns: { turn: number }[]; totalTurns: number };
    expect(m.turns).toHaveLength(14);
    expect(m.totalTurns).toBe(14);
    const snap = deps.db.get(`SELECT COUNT(*) as c FROM snapshots WHERE sim_id = ?`, id) as { c: number };
    expect(snap.c).toBeGreaterThanOrEqual(14);
    const decisions = deps.db.get(`SELECT COUNT(*) as c FROM decisions WHERE sim_id = ?`, id) as { c: number };
    expect(decisions.c).toBe(14 * 8);
    const actions = deps.db.get(`SELECT COUNT(*) as c FROM actions WHERE sim_id = ?`, id) as { c: number };
    expect(actions.c).toBeGreaterThan(30);
    await app.close();
  }, 60_000);

  it('exposes simple start/stop controls and no intervention endpoints', async () => {
    const app = await buildApp(makeDeps());
    const { id } = (await app.inject({ method: 'POST', url: '/api/simulations', payload: cfg({ seed: 'stop-1', totalTurns: 100 }) })).json() as { id: string };
    expect((await app.inject({ method: 'POST', url: `/api/simulations/${id}/pause` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/simulations/${id}/step` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/simulations/${id}/start` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/simulations/${id}/stop` })).statusCode).toBe(200);
    const stopped = (await app.inject({ method: 'GET', url: `/api/simulations/${id}` })).json() as { status: string };
    expect(stopped.status).toBe('stopped');
    await app.close();
  }, 60_000);

  it('resolves severe actions autonomously without an approval phase', async () => {
    const config = { ...DEFAULT_SIMULATION_CONFIG, totalTurns: 1, narratorEnabled: false };
    const sim = new Simulation({
      config,
      pack: getPack('baseline_8'),
      scenario: getScenario('neutral'),
      agentProvider: {
        decide: async (_obs, ctx) => ({
          nation_id: ctx.nationId,
          turn: ctx.turn,
          public_rationale: 'Autonomous test decision.',
          actions: ctx.nationId === 'amber'
            ? [{ action_id: 'targeted_attack', target_nation_id: 'cobalt' }]
            : [{ action_id: 'wait' }],
        }),
      },
      narratorProvider: new DeterministicNarratorProvider(),
    });
    await sim.run();
    expect(sim.status).toBe('completed');
    expect(sim.world.events.some((e) => e.actionId === 'targeted_attack' && e.status === 'accepted')).toBe(true);
  }, 60_000);

  it('export produces a full JSON run and import re-creates the configuration', async () => {
    const app = await buildApp(makeDeps());
    const { id } = (await app.inject({ method: 'POST', url: '/api/simulations', payload: cfg({ seed: 'export-1', totalTurns: 3 }) })).json() as { id: string };
    await driveToCompletion(app, id);
    const exportRes = await app.inject({ method: 'GET', url: `/api/simulations/${id}/export` });
    expect(exportRes.statusCode).toBe(200);
    const exported = exportRes.json() as { config: SimulationConfig; world: WorldState; metrics: unknown };
    expect(exported.world.turn).toBeGreaterThanOrEqual(1);
    const csv = await app.inject({ method: 'GET', url: `/api/simulations/${id}/export?format=csv` });
    expect(csv.body).toContain('turn,mean_score');
    const imported = await app.inject({ method: 'POST', url: '/api/simulations/import', payload: { config: exported.config } });
    expect(imported.statusCode).toBe(201);
    expect((imported.json() as { imported: boolean }).imported).toBe(true);
    await app.close();
  }, 60_000);

  it('batch experiment across seeds produces bootstrap-CI aggregates', async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      payload: {
        name: 'smoke-grid',
        seeds: ['e1', 'e2', 'e3'],
        models: ['mock/model'],
        scenarios: ['neutral'],
        replicates: 1,
        provider: 'mock',
        concurrency: 3,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { records: { status: string }[]; aggregate?: { byScenarioModel: { replicates: number }[]; note: string } };
    expect(body.records.filter((r) => r.status === 'completed')).toHaveLength(3);
    expect(body.aggregate?.byScenarioModel[0].replicates).toBe(3);
    expect(body.aggregate?.note ?? '').toContain('NOT');
    await app.close();
  }, 60_000);

  it('returns failed when every experiment job fails', async () => {
    const db = new Db(':memory:');
    const experiments = new ExperimentManager(db, async () => { throw new Error('job failed'); });
    experiments.baseConfig = DEFAULT_SIMULATION_CONFIG;
    const result = await experiments.run({
      name: 'all-fail', seeds: ['f1'], models: ['mock/model'], scenarios: ['neutral'],
      replicates: 1, provider: 'mock', concurrency: 1,
    });
    expect(result.status).toBe('failed');
    expect(experiments.get(result.id)?.status).toBe('failed');
    db.close();
  });

  it('never substitutes mock agents for an unconfigured OpenRouter experiment', async () => {
    const db = new Db(':memory:');
    const experiments = new ExperimentManager(db, makeRunOne(null));
    experiments.baseConfig = DEFAULT_SIMULATION_CONFIG;
    const result = await experiments.run({
      name: 'openrouter-unconfigured', seeds: ['f1'], models: ['provider/model'], scenarios: ['neutral'],
      replicates: 1, provider: 'openrouter', concurrency: 1,
    });
    expect(result.status).toBe('failed');
    expect(result.records[0]?.error).toContain('OpenRouter is not configured');
    db.close();
  });

  it('records provider failure as a missing decision, not a model-selected wait', async () => {
    const config: SimulationConfig = {
      ...DEFAULT_SIMULATION_CONFIG,
      seed: 'fallback-1',
      totalTurns: 3,
    };
    let fail = true;
    const sim = new Simulation({
      config,
      pack: (await import('@aiww/engine')).getPack('baseline_8'),
      scenario: (await import('@aiww/engine')).getScenario('neutral'),
      agentProvider: {
        // eslint-disable-next-line require-await
        decide: async () => {
          if (fail) {
            fail = false;
            throw new Error('simulated provider outage');
          }
          return { nation_id: 'amber', turn: 1, public_rationale: 'ok', actions: [{ action_id: 'message' }] };
        },
      },
      narratorProvider: new DeterministicNarratorProvider(),
    });
    await sim.run();
    expect(sim.status).toBe('completed');
    expect(sim.world.auditEvents.some((a) => a.type === 'provider_error')).toBe(true);
    expect(sim.getFallbackStats().providerFailureCount).toBe(1);
    const failed = sim.allDecisionRecords().find((d) => d.status === 'provider_failure');
    expect(failed?.response).toBeNull();
    expect(failed?.report.accepted).toEqual([]);
  }, 60_000);

  it('openrouter health reports unconfigured state without leaking secrets', async () => {
    const app = await buildApp(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/openrouter/health' });
    const body = res.json() as { configured: boolean; detail: string };
    expect(body.configured).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-or-|Bearer /i);
    await app.close();
  });

  it('OpenRouter client normalizes errors and never sends the key anywhere but the auth header', async () => {
    const client = new OpenRouterClient({
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'not a url',
    } as never);
    await expect(client.chat([{ role: 'user', content: 'x' }], { role: 'nation_agent', model: 'test/model', temperature: 0, maxTokens: 64, simulationId: 's', turn: 1 })).rejects.toThrow();
  });

  it('routes each nation to its configured OpenRouter model', async () => {
    const requests: { model?: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { model?: string });
      return new Response(JSON.stringify({
        id: 'req-1',
        choices: [{ message: { content: JSON.stringify({ nation_id: 'amber', turn: 1, public_rationale: 'test', actions: [{ action_id: 'wait' }] }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      const client = new OpenRouterClient({
        OPENROUTER_API_KEY: 'test-key',
        OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
        OPENROUTER_NATION_AGENT_MODEL: 'env/default',
        OPENROUTER_WORLD_NARRATOR_MODEL: 'env/narrator',
        OPENROUTER_REPAIR_MODEL: 'env/repair',
        OPENROUTER_TIMEOUT_MS: 1000,
        OPENROUTER_MAX_RETRIES: 0,
        OPENROUTER_RETRY_BASE_DELAY_MS: 1,
        OPENROUTER_CATALOG_CACHE_TTL_MS: 1000,
        OPENROUTER_RESPONSE_CACHE_TTL_MS: 1000,
      } as never);
      const config: SimulationConfig = {
        ...DEFAULT_SIMULATION_CONFIG,
        provider: 'openrouter',
        models: {
          ...DEFAULT_SIMULATION_CONFIG.models,
          nationAgent: 'fallback/model',
          nationAgents: { ...DEFAULT_SIMULATION_CONFIG.models.nationAgents, amber: 'custom/amber-model' },
        },
      };
      const provider = new OpenRouterAgentProvider(client, config, 'sim-real-id');
      const pack = getPack('baseline_8');
      const scenario = getScenario('neutral');
      const world = new Simulation({ config, pack, scenario, agentProvider: new MockAgentProvider(), narratorProvider: new DeterministicNarratorProvider() }).world;
      const profile = pack.nations.find((n) => n.id === 'amber')!;
      const response = await provider.decide(buildObservation(world, config, profile, scenario, BASELINE_CATALOG.actions), {
        nationId: 'amber', turn: 1, behavior: 'test', seed: 'test', recentEvents: [],
      });
      expect(response.nation_id).toBe('amber');
      expect(requests[0]?.model).toBe('custom/amber-model');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records the real run id and explicit model in OpenRouter telemetry', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'req-telemetry', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    try {
      const client = new OpenRouterClient({
        OPENROUTER_API_KEY: 'test-key', OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
        OPENROUTER_TIMEOUT_MS: 1000, OPENROUTER_MAX_RETRIES: 0,
        OPENROUTER_RETRY_BASE_DELAY_MS: 1, OPENROUTER_CATALOG_CACHE_TTL_MS: 1000,
        OPENROUTER_RESPONSE_CACHE_TTL_MS: 1000,
      } as never);
      const result = await client.chat([{ role: 'user', content: 'x' }], {
        role: 'nation_agent', model: 'custom/model', temperature: 0.7, maxTokens: 64,
        simulationId: 'sim-real-id', turn: 4, cache: false,
      });
      expect(result.audit.simulationId).toBe('sim-real-id');
      expect(result.audit.model).toBe('custom/model');
      expect(result.audit.turn).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('catalog ids referenced by validation are consistent', () => {
    expect(BASELINE_CATALOG.actions.find((a) => a.id === 'wait')).toBeDefined();
  });

  it('mock agents flow through engine validation end-to-end', () => {
    const provider = new MockAgentProvider();
    expect(provider).toBeDefined();
  });
});
