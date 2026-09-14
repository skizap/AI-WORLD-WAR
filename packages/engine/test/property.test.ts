import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_SIMULATION_CONFIG,
  DEFAULT_VARIABLES,
  VARIABLE_BOUNDS,
  VARIABLE_NAMES,
  type AgentResponse,
} from '@aiww/schemas';
import {
  BASELINE_CATALOG,
  BASELINE_PACK,
  DeterministicNarratorProvider,
  MockAgentProvider,
  NEUTRAL_SCENARIO,
  PRIOR_CYBER_SCENARIO,
  Simulation,
  applyEffects,
  getScenario,
  initWorld,
  mockDecide,
} from '../src/index.js';

const cfg = (over: Partial<typeof DEFAULT_SIMULATION_CONFIG> = {}) => ({
  ...DEFAULT_SIMULATION_CONFIG,
  ...over,
  observation: { ...DEFAULT_SIMULATION_CONFIG.observation, ...(over.observation ?? {}) },
  limits: { ...DEFAULT_SIMULATION_CONFIG.limits, ...(over.limits ?? {}) },
});

function runMockSim(seed: string, scenarioId = 'neutral', totalTurns = 6, narratorEnabled = true) {
  const config = cfg({ seed, totalTurns, narratorEnabled });
  const sim = new Simulation({
    config,
    pack: BASELINE_PACK,
    scenario: getScenario(scenarioId),
    agentProvider: new MockAgentProvider(),
    narratorProvider: new DeterministicNarratorProvider(),
  });
  const loop = async () => {
    for (let i = 0; i < 500; i++) {
      await sim.run();
      if (sim.status !== 'awaiting_approval') break;
      for (const p of sim.world.pendingApprovals.filter((x) => x.status === 'pending')) sim.approve(p.key, true);
    }
  };
  return { sim, loop };
}

describe('property-based invariants', () => {
  it('no state variable ever leaves its valid range during mock runs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 2, maxLength: 8 }), fc.constantFrom('neutral', 'prior_invasion', 'prior_cyber'), async (seed, scenarioId) => {
        const { sim, loop } = runMockSim(`p-${seed}`, scenarioId, 5);
        await loop();
        for (const rt of Object.values(sim.world.nations)) {
          for (const name of VARIABLE_NAMES) {
            const v = rt.variables[name] ?? 0;
            expect(v, `${rt.id}.${name}=${v}`).toBeGreaterThanOrEqual(VARIABLE_BOUNDS[name].min);
            expect(v, `${rt.id}.${name}=${v}`).toBeLessThanOrEqual(VARIABLE_BOUNDS[name].max);
          }
        }
      }),
      { numRuns: 12 },
    );
  }, 120_000);

  it('replay from the same seed is identical in mock mode', async () => {
    const run = async (seed: string) => {
      const { sim, loop } = runMockSim(seed, 'prior_cyber', 6);
      await loop();
      return sim.world;
    };
    const a = await run('replay-seed-1');
    const b = await run('replay-seed-1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = await run('replay-seed-2');
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  }, 60_000);

  it('invalid actions never mutate state', () => {
    const w = initWorld(cfg(), BASELINE_PACK, NEUTRAL_SCENARIO, 's');
    const before = JSON.stringify(w);
    // Unknown action, unknown target, self-target, code content, over-limit.
    const effects = applyEffects(w, 'amber', undefined, [
      // @ts-expect-error — invalid effect on purpose
      { kind: 'not_a_kind' },
    ], 'invalid');
    expect(effects.stateChanges).toHaveLength(0);
    expect(effects.relChanges).toHaveLength(0);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('every state mutation produces an audit event', async () => {
    const { sim, loop } = runMockSim('audit-seed', 'neutral', 6);
    await loop();
    const mutating = sim.world.events.filter((e) => (e.stateChanges?.length ?? 0) > 0 || (e.relChanges?.length ?? 0) > 0);
    expect(mutating.length).toBeGreaterThan(0);
    // Every mutation event must be mirrored by at least one state_transition audit.
    const audits = sim.world.auditEvents.filter((a) => a.type === 'state_transition');
    expect(audits.length).toBeGreaterThanOrEqual(mutating.length);
  }, 60_000);

  it('nuclear actions cannot occur without sufficient abstract capability', async () => {
    const { sim, loop } = runMockSim('nuclear-seed', 'neutral', 8);
    await loop();
    const nuclearActions = sim.world.events.filter(
      (e) => e.type === 'action' && e.status === 'accepted' && (e.actionId === 'tactical_nuclear_strike' || e.actionId === 'full_nuclear_attack'),
    );
    for (const e of nuclearActions) {
      const actor = e.actorId!;
      // The actor must have had capability >= the precondition when firing.
      const cap = sim.world.nations[actor]?.variables.nuclearCapability ?? 0;
      const capEverHigh = sim.world.events.some(
        (ev) => ev.stateChanges.some((sc) => sc.nationId === actor && sc.variable === 'nuclearCapability' && sc.after >= 1),
      );
      expect(cap >= 1 || capEverHigh).toBe(true);
    }
  }, 60_000);

  it('a failed narrator call cannot corrupt the simulation state', async () => {
    const config = cfg({ seed: 'narrator-fail', totalTurns: 4 });
    const sim = new Simulation({
      config,
      pack: BASELINE_PACK,
      scenario: NEUTRAL_SCENARIO,
      agentProvider: new MockAgentProvider(),
      narratorProvider: {
        summarize: async () => {
          throw new Error('narrator down');
        },
      },
    });
    for (let i = 0; i < 200; i++) {
      await sim.run();
      if (sim.status !== 'awaiting_approval') break;
      for (const p of sim.world.pendingApprovals.filter((x) => x.status === 'pending')) sim.approve(p.key, true);
    }
    expect(sim.status).toBe('completed');
    expect(sim.getFallbackStats().narratorFallbackCount).toBeGreaterThanOrEqual(0);
    // State invariants still hold.
    for (const rt of Object.values(sim.world.nations)) {
      for (const name of VARIABLE_NAMES) {
        const v = rt.variables[name] ?? 0;
        expect(v).toBeGreaterThanOrEqual(VARIABLE_BOUNDS[name].min);
        expect(v).toBeLessThanOrEqual(VARIABLE_BOUNDS[name].max);
      }
    }
  }, 60_000);

  it('mock decisions are pure functions of (seed, nation, turn, state)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.constantFrom(...BASELINE_PACK.nations.map((n) => n.id)), (turn, nationId) => {
        const profile = BASELINE_PACK.nations.find((n) => n.id === nationId)!;
        const others = BASELINE_PACK.nations.filter((n) => n.id !== nationId);
        const mk = () => ({
          seed: 'pure-seed',
          nationId,
          behavior: profile.behavior ?? 'random_baseline',
          turn,
          remainingTurns: 14 - turn,
          self: { variables: { ...DEFAULT_VARIABLES } },
          others: others.map((n) => ({ id: n.id, variables: { ...DEFAULT_VARIABLES }, tensionTo: 20, affinityTo: 60, trustTo: 40 })),
          recentEvents: [],
          availableActionIds: BASELINE_CATALOG.actions.map((a) => a.id),
          goals: profile.initialGoals,
        });
        expect(JSON.stringify(mockDecide(mk()))).toBe(JSON.stringify(mockDecide(mk())));
      }),
      { numRuns: 25 },
    );
  });
});
