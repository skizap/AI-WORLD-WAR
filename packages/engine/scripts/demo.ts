/**
 * Offline demo: runs a full 8-nation x 14-turn mock simulation and prints a
 * summary. No API key required.
 *
 *   npm run demo -w @aiww/engine
 */
import { DEFAULT_SIMULATION_CONFIG, type SimulationConfig } from '@aiww/schemas';
import { Simulation } from '../src/simulation.js';
import { MockAgentProvider, DeterministicNarratorProvider } from '../src/providers.js';
import { getPack, getScenario } from '../src/index.js';

const overrides = process.argv[2] ? (JSON.parse(process.argv[2]) as Partial<SimulationConfig>) : {};
const config: SimulationConfig = { ...DEFAULT_SIMULATION_CONFIG, ...overrides };

const sim = new Simulation({
  config,
  pack: getPack(config.fictionPackId),
  scenario: getScenario(config.scenarioId),
  agentProvider: new MockAgentProvider(),
  narratorProvider: new DeterministicNarratorProvider(),
});

console.log('AI-WORLD-WAR — RESEARCH SIMULATION (fictional). Mock run starting.');
console.log(`seed=${config.seed} scenario=${config.scenarioId} turns=${config.totalTurns}`);
// The demo auto-approves the human-approval gate (offline mode).
for (let i = 0; i < 100; i++) {
  await sim.run();
  if (sim.status !== 'awaiting_approval') break;
  for (const p of sim.world.pendingApprovals.filter((x) => x.status === 'pending')) {
    sim.approve(p.key, true);
  }
}
console.log(`Status: ${sim.status} (stop reason: ${sim.stopReason ?? 'turn limit'})`);

const metrics = sim.computeMetrics();
for (const t of metrics.turns) {
  const bar = '#'.repeat(Math.max(0, Math.min(40, Math.round(Math.abs(t.meanScore) / 2))));
  console.log(`turn ${String(t.turn).padStart(2)}  meanScore=${String(t.meanScore).padStart(7)}  stability=${String(Math.round(t.globalStability)).padStart(3)}  ${bar}`);
}
console.log('Totals:', JSON.stringify(metrics.totals, null, 2));
console.log(`Spikes (top): ${metrics.spikes.slice(0, 3).map((s) => `${s.nationId}@t${s.turn}:+${s.spike}`).join(', ') || 'none'}`);
console.log(`Fallbacks: ${metrics.fallbackCount}, rejected actions: ${metrics.rejectedActionCount}`);
console.log('Reminder: these are fictional simulation scores, not predictions about the real world.');
