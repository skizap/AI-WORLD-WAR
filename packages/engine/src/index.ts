/**
 * @aiww/engine — pure deterministic simulation domain layer.
 * No UI, no network, no persistence. RESEARCH SIMULATION (fictional only).
 */
export * from './rng.js';
export * from './scoring.js';
export {
  CODE_VERSION,
  PROMPT_VERSION,
  addAudit,
  addEvent,
  applyEffects,
  clampAll,
  computeConfigHash,
  initWorld,
  emptyRuntime,
  getRel,
  stableJson,
  newId,
  type AppliedChanges,
} from './engine.js';
export { BASELINE_CATALOG, CATALOG_BY_ID } from '../data/catalog.js';
export { BASELINE_PACK, ALL_PACKS, getPack } from '../data/nations.js';
export {
  ALL_SCENARIOS,
  NEUTRAL_SCENARIO,
  PRIOR_INVASION_SCENARIO,
  PRIOR_CYBER_SCENARIO,
  getScenario,
} from '../data/scenarios.js';
export { buildObservation, toMockObservation, type Observation, type AvailableAction } from './observation.js';
export { validateAgentResponse, repairAttempt, containsDisallowedContent, type ValidatedResponse } from './validation.js';
export { mockDecide, deterministicNarrator, type MockObservation } from './mock.js';
export {
  MockAgentProvider,
  DeterministicNarratorProvider,
  behaviorFor,
  type AgentProvider,
  type NarratorProvider,
  type AgentDecisionContext,
  type NarratorInput,
  type RawEventRef,
} from './providers.js';
export { computeRunMetrics, finalMeanScore } from './metrics.js';
export {
  Simulation,
  type SimulationOptions,
  type QueuedAction,
  type DecisionRecord,
  type SimPhase,
} from './simulation.js';
