/**
 * @aiww/engine — pure deterministic simulation domain layer.
 * No UI, no network, no persistence. RESEARCH SIMULATION (fictional only).
 */
export * from './rng.js';
export * from './scoring.js';
export {
  CODE_VERSION,
  PROMPT_VERSION,
  INITIAL_GLOBAL_STABILITY,
  addAudit,
  addEvent,
  applyEffects,
  clampAll,
  computeConfigHash,
  initWorld,
  emptyRuntime,
  getRel,
  reconcileAlliances,
  stableJson,
  newId,
  type AppliedChanges,
  type EffectMeta,
} from './engine.js';
export { BASELINE_CATALOG, CATALOG_BY_ID } from '../data/catalog.js';
export { BASELINE_PACK, AURELIA_WORLD_PACK_V2, ALL_PACKS, getPack } from '../data/nations.js';
export {
  ALL_SCENARIOS,
  NEUTRAL_SCENARIO,
  NEUTRAL_WORLD_SCENARIO_V2,
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
  AgentDecisionError,
  behaviorFor,
  type AgentProvider,
  type NarratorProvider,
  type AgentDecisionContext,
  type NarratorInput,
  type RawEventRef,
} from './providers.js';
export { computeRunMetrics, finalMeanScore, METRIC_VERSION } from './metrics.js';
export {
  Simulation,
  type SimulationOptions,
  type QueuedAction,
  type DecisionRecord,
  type SimPhase,
} from './simulation.js';
