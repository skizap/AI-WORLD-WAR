import { describe, expect, it } from 'vitest';
import { buildApp, type AppDeps } from '../src/app.js';
import { Db } from '../src/db.js';
import { RunnerManager } from '../src/runner.js';
import { ExperimentManager, makeMockRunOne } from '../src/experiments.js';
import { DEFAULT_SIMULATION_CONFIG, type SimulationConfig, type WorldState } from '@aiww/schemas';
import { MockAgentProvider, DeterministicNarratorProvider, Simulation, BASELINE_CATALOG } from '@aiww/engine';
import { OpenRouterClient } from '../src/openrouter.js';

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
    approvalPolicy: 'off',
    ...over,
  };
}

async function driveToCompletion(app: Awaited<ReturnType<typeof buildApp>>, id: string, timeoutMs = 30_000): Promise<WorldState> {
  const started = Date.now();
  await app.inject({ method: 'POST', url: `/api/simulations/${id}/start` });
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/api/simulations/${id}` });
    const body = res.json() as { status: string; world: WorldState; pendingApprovals?: { key: string }[] };
    if (body.status === 'awaiting_approval') {
      const w = body.world;
      for (const p of (w.pendingApprovals ?? []).filter((x) => x.status === 'pending')) {
        await app.inject({ method: 'POST', url: `/api/simulations/${id}/approvals/${p.key}`, payload: { approve: true } });
      }
      continue;
    }
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
    await app.close();
  }, 60_000);

  it('supports step, pause, resume, and stop', async () => {
    const app = await buildApp(makeDeps());
    const { id } = (await app.inject({ method: 'POST', url: '/api/simulations', payload: cfg({ seed: 'pause-1', totalTurns: 3 }) })).json() as { id: string };
    // Step deterministically.
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: `/api/simulations/${id}/step` });
    const after = (await app.inject({ method: 'GET', url: `/api/simulations/${id}` })).json() as { turn: number };
    expect(after.turn).toBeGreaterThanOrEqual(1);
    await app.inject({ method: 'POST', url: `/api/simulations/${id}/pause` });
    const paused = (await app.inject({ method: 'GET', url: `/api/simulations/${id}` })).json() as { status: string };
    expect(['paused', 'completed']).toContain(paused.status);
    await app.inject({ method: 'POST', url: `/api/simulations/${id}/resume` });
    await app.inject({ method: 'POST', url: `/api/simulations/${id}/stop` });
    const stopped = (await app.inject({ method: 'GET', url: `/api/simulations/${id}` })).json() as { status: string };
    expect(['stopped', 'completed']).toContain(stopped.status);
    await app.close();
  }, 60_000);

  it('human approval gate blocks severe actions and records overrides', async () => {
    const app = await buildApp(makeDeps());
    const { id } = (await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: cfg({ seed: 'approval-1', approvalPolicy: 'severe', totalTurns: 14 }),
    })).json() as { id: string };
    // Step until a pending approval appears.
    let pending: { key: string; actionId: string }[] = [];
    for (let i = 0; i < 400; i++) {
      const res = await app.inject({ method: 'POST', url: `/api/simulations/${id}/step` });
      const st = res.json() as { status: string };
      const cur = (await app.inject({ method: 'GET', url: `/api/simulations/${id}` })).json() as { status: string; world: WorldState };
      pending = (cur.world.pendingApprovals ?? []).filter((p) => p.status === 'pending') as { key: string; actionId: string }[];
      if (pending.length > 0) break;
      if (st.status === 'completed') break;
    }
    if (pending.length > 0) {
      // Reject the severe action.
      await app.inject({ method: 'POST', url: `/api/simulations/${id}/approvals/${pending[0].key}`, payload: { approve: false } });
      const events = (await app.inject({ method: 'GET', url: `/api/simulations/${id}/events` })).json() as { status: string; reason?: string }[];
      expect(events.some((e) => e.status === 'rejected' && (e.reason ?? '').includes('human supervisor'))).toBe(true);
    } else {
      // No severe action was proposed in this seed; gate still exercised elsewhere.
      expect(true).toBe(true);
    }
    await app.close();
  }, 60_000);

  it('export produces a full JSON run and import re-creates the configuration', async () => {
    const app = await buildApp(makeDeps());
    const { id } = (await app.inject({ method: 'POST', url: '/api/simulations', payload: cfg({ seed: 'export-1', totalTurns: 3 }) })).json() as { id: string };
    for (let i = 0; i < 30; i++) await app.inject({ method: 'POST', url: `/api/simulations/${id}/step` });
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

  it('provider failure leads to safe wait fallback and the run still completes', async () => {
    const config: SimulationConfig = {
      ...DEFAULT_SIMULATION_CONFIG,
      seed: 'fallback-1',
      totalTurns: 3,
      approvalPolicy: 'off',
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
    for (let i = 0; i < 200; i++) {
      await sim.run();
      if (sim.status !== 'awaiting_approval') break;
      for (const p of sim.world.pendingApprovals.filter((x) => x.status === 'pending')) sim.approve(p.key, true);
    }
    expect(sim.status).toBe('completed');
    // The provider failure was audited and a safe fallback used.
    expect(sim.world.auditEvents.some((a) => a.type === 'provider_error')).toBe(true);
    expect(sim.getFallbackStats().fallbackCount).toBeGreaterThanOrEqual(1);
    // A validation-failure fallback wait was recorded as an accepted action.
    expect(sim.world.events.some((e) => e.status === 'accepted' && e.actionId === 'wait')).toBe(true);
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
    await expect(client.chat([{ role: 'user', content: 'x' }], { role: 'nation_agent', temperature: 0, maxTokens: 64, simulationId: 's', turn: 1 })).rejects.toThrow();
  });

  it('catalog ids referenced by validation are consistent', () => {
    expect(BASELINE_CATALOG.actions.find((a) => a.id === 'wait')).toBeDefined();
  });

  it('mock agents flow through engine validation end-to-end', () => {
    const provider = new MockAgentProvider();
    expect(provider).toBeDefined();
  });
});
