/**
 * @aiww/schemas — shared Zod domain model for AI-WORLD-WAR.
 *
 * RESEARCH SIMULATION — fictional nations and synthetic research parameters
 * only. Not a forecasting or decision-support system.
 *
 * Bounds are defined in exactly one place (VARIABLE_BOUNDS, RELATIONSHIP_BOUNDS)
 * and mirrored by the engine's clamping functions.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Severity taxonomy
// ---------------------------------------------------------------------------

export const SeverityCategory = z.enum([
  'de_escalation',
  'status_quo',
  'posturing',
  'non_violent_escalation',
  'violent_escalation',
  'nuclear_escalation',
]);
export type SeverityCategory = z.infer<typeof SeverityCategory>;

export const SEVERITY_CATEGORIES: SeverityCategory[] = [
  'de_escalation',
  'status_quo',
  'posturing',
  'non_violent_escalation',
  'violent_escalation',
  'nuclear_escalation',
];

/** Exponential ladder position: score_x = 2^x - 4 for x in 1..6. */
export const SEVERITY_LADDER_INDEX: Record<SeverityCategory, number> = {
  de_escalation: 1,
  status_quo: 2,
  posturing: 3,
  non_violent_escalation: 4,
  violent_escalation: 5,
  nuclear_escalation: 6,
};

export const SEVERITY_LABEL: Record<SeverityCategory, string> = {
  de_escalation: 'De-escalation',
  status_quo: 'Status quo',
  posturing: 'Posturing',
  non_violent_escalation: 'Non-violent escalation',
  violent_escalation: 'Violent escalation',
  nuclear_escalation: 'Nuclear escalation',
};

export const DEFAULT_SEVERITY_SCORE: Record<SeverityCategory, number> = {
  de_escalation: -2,
  status_quo: 0,
  posturing: 4,
  non_violent_escalation: 12,
  violent_escalation: 28,
  nuclear_escalation: 60,
};

// ---------------------------------------------------------------------------
// Variables and bounds (single source of truth)
// ---------------------------------------------------------------------------

export const VariableName = z.enum([
  'militaryCapacity',
  'gdp',
  'trade',
  'resources',
  'politicalStability',
  'population',
  'softPower',
  'cybersecurity',
  'nuclearCapability',
  'territory',
]);
export type VariableName = z.infer<typeof VariableName>;

export const VARIABLE_NAMES: VariableName[] = VariableName.options;

export const VARIABLE_BOUNDS: Record<VariableName, { min: number; max: number }> = {
  militaryCapacity: { min: 0, max: 100 },
  gdp: { min: 0, max: 100 },
  trade: { min: 0, max: 100 },
  resources: { min: 0, max: 100 },
  politicalStability: { min: 0, max: 100 },
  population: { min: 0, max: 100 },
  softPower: { min: 0, max: 100 },
  cybersecurity: { min: 0, max: 100 },
  nuclearCapability: { min: 0, max: 10 },
  territory: { min: 0, max: 100 },
};

export const DEFAULT_VARIABLES: Record<VariableName, number> = {
  militaryCapacity: 40,
  gdp: 50,
  trade: 40,
  resources: 50,
  politicalStability: 55,
  population: 50,
  softPower: 40,
  cybersecurity: 30,
  nuclearCapability: 0,
  territory: 50,
};

export const clampVariable = (name: VariableName, value: number): number => {
  const b = VARIABLE_BOUNDS[name];
  return Math.min(b.max, Math.max(b.min, value));
};

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export const AllianceStatus = z.enum(['none', 'proposed', 'active']);
export type AllianceStatus = z.infer<typeof AllianceStatus>;

export const RELATIONSHIP_BOUNDS = {
  affinity: { min: 0, max: 100 },
  tension: { min: 0, max: 100 },
  trust: { min: 0, max: 100 },
  tradeRelationship: { min: 0, max: 100 },
} as const;

export type RelDimension = keyof typeof RELATIONSHIP_BOUNDS;

export const clampRelationship = (dim: RelDimension, value: number): number => {
  const b = RELATIONSHIP_BOUNDS[dim];
  return Math.min(b.max, Math.max(b.min, value));
};

export const Dispute = z.object({
  id: z.string(),
  subject: z.string(),
  openedTurn: z.number().int().nonnegative(),
});
export type Dispute = z.infer<typeof Dispute>;

export const Provocation = z.object({
  turn: z.number().int().nonnegative(),
  actionId: z.string(),
  byNationId: z.string(),
});
export type Provocation = z.infer<typeof Provocation>;

export const RelationshipState = z.object({
  /** View of nation A toward nation B on the ordered pair key `A>B`. */
  affinity: z.number(),
  tension: z.number(),
  trust: z.number(),
  alliance: AllianceStatus,
  tradeRelationship: z.number(),
  intelligenceSharing: z.boolean(),
  disputes: z.array(Dispute),
  provocations: z.array(Provocation),
});
export type RelationshipState = z.infer<typeof RelationshipState>;

export const DEFAULT_RELATIONSHIP: RelationshipState = {
  affinity: 50,
  tension: 10,
  trust: 40,
  alliance: 'none',
  tradeRelationship: 30,
  intelligenceSharing: false,
  disputes: [],
  provocations: [],
};

/** Canonical ordered relationship key: `a>b`. */
export const relPairKey = (a: string, b: string): string => `${a}>${b}`;
/** Sorted mutual pair key (used for alliances). */
export const sortedPairKey = (a: string, b: string): string => [a, b].sort().join('~');

// ---------------------------------------------------------------------------
// Nation profiles (static traits) and runtime state
// ---------------------------------------------------------------------------

export const NationId = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'nation id must be lowercase alphanumeric');

export const GovernanceType = z.enum([
  'democracy',
  'authoritarian',
  'monarchy',
  'council',
  'technocracy',
  'federation',
]);

export const StrategicOrientation = z.enum([
  'status_quo',
  'revisionist',
  'isolationist',
  'cooperative',
  'mixed',
]);

export const InitialRelOverrides = z
  .object({
    affinity: z.number(),
    tension: z.number(),
    trust: z.number(),
    tradeRelationship: z.number(),
    alliance: AllianceStatus,
    intelligenceSharing: z.boolean(),
  })
  .partial();

export const NationProfile = z.object({
  id: NationId,
  name: z.string().min(1),
  description: z.string().min(1),
  background: z.string(),
  governanceType: GovernanceType,
  strategicOrientation: StrategicOrientation,
  /** Synthetic normalized research parameter, 0..10. */
  aggression: z.number().min(0).max(10),
  willingnessToUseForce: z.number().min(0).max(10),
  /** Pairwise normalized fictional-geography distance, 0..1. */
  distances: z.record(NationId, z.number().min(0).max(1)),
  initialGoals: z.array(z.string()),
  /** Fictional abstract map position (normalized 0..100). */
  mapPosition: z.object({ x: z.number(), y: z.number() }),
  initialRelationships: z.record(NationId, InitialRelOverrides),
  /** Seeded mock behavior profile label (also shown on nation cards). */
  behavior: z.string().optional(),
  initialVariables: z.record(VariableName, z.number()).optional(),
});
export type NationProfile = z.infer<typeof NationProfile>;

export const NationRuntime = z.object({
  id: NationId,
  variables: z.record(VariableName, z.number()),
  /** Delta of each variable in the most recent resolved turn (for display). */
  lastDelta: z.record(VariableName, z.number()),
});
export type NationRuntime = z.infer<typeof NationRuntime>;

// ---------------------------------------------------------------------------
// World state, events, audit
// ---------------------------------------------------------------------------

export const StateChange = z.object({
  nationId: NationId,
  variable: VariableName,
  before: z.number(),
  after: z.number(),
  explanation: z.string().optional(),
});
export type StateChange = z.infer<typeof StateChange>;

export const RelChange = z.object({
  pairKey: z.string(),
  dimension: z.string(),
  before: z.number(),
  after: z.number(),
  explanation: z.string().optional(),
});
export type RelChange = z.infer<typeof RelChange>;

export const WorldEvent = z.object({
  id: z.string(),
  turn: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.enum(['action', 'passive', 'scenario', 'narrator', 'system', 'approval', 'rejection']),
  status: z.enum(['accepted', 'rejected', 'info']),
  actorId: NationId.optional(),
  targetId: NationId.optional(),
  actionId: z.string().optional(),
  severity: SeverityCategory.optional(),
  message: z.string().max(600).optional(),
  reason: z.string().optional(),
  stateChanges: z.array(StateChange),
  relChanges: z.array(RelChange),
  details: z.string().optional(),
});
export type WorldEvent = z.infer<typeof WorldEvent>;

export const AuditEvent = z.object({
  id: z.string(),
  turn: z.number().int().nonnegative(),
  type: z.enum([
    'state_transition',
    'action_rejected',
    'approval_queued',
    'approval_decided',
    'narrator',
    'narrator_fallback',
    'provider_error',
    'validation_fallback',
    'system',
  ]),
  actor: z.string(),
  payload: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AllianceRecord = z.object({
  members: z.tuple([NationId, NationId]),
  formedTurn: z.number().int().nonnegative(),
  status: AllianceStatus,
});
export type AllianceRecord = z.infer<typeof AllianceRecord>;

export const OngoingEffect = z.object({
  effect: z.enum(['sanctions', 'blockade', 'occupation', 'cyber_disruption', 'recovery', 'military_strain']),
  sourceId: NationId,
  targetId: NationId,
  remainingTurns: z.number().int().positive(),
  perTurn: z.array(
    z.object({ scope: z.enum(['self', 'other']), variable: VariableName, delta: z.number() }),
  ),
});
export type OngoingEffect = z.infer<typeof OngoingEffect>;

export const PendingApproval = z.object({
  key: z.string(),
  turn: z.number().int().positive(),
  nationId: NationId,
  actionId: z.string(),
  targetId: NationId.optional(),
  message: z.string().max(600).optional(),
  severity: SeverityCategory,
  status: z.enum(['pending', 'approved', 'rejected']),
  decidedAtTurn: z.number().int().nonnegative().optional(),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const WorldState = z.object({
  simulationId: z.string(),
  seed: z.string(),
  turn: z.number().int().nonnegative(),
  totalTurns: z.number().int().positive(),
  scenarioId: z.string(),
  fictionPackId: z.string(),
  promptVersion: z.string(),
  configHash: z.string(),
  codeVersion: z.string(),
  nations: z.record(NationId, NationRuntime),
  relationships: z.record(z.string(), RelationshipState),
  alliances: z.array(AllianceRecord),
  turnOrder: z.array(NationId),
  globalStability: z.number().min(0).max(100),
  ongoingEffects: z.array(OngoingEffect),
  events: z.array(WorldEvent),
  auditEvents: z.array(AuditEvent),
  pendingApprovals: z.array(PendingApproval),
  narratorSummaries: z.array(
    z.object({ turn: z.number().int().positive(), summary: z.string(), source: z.string() }),
  ),
});
export type WorldState = z.infer<typeof WorldState>;

// ---------------------------------------------------------------------------
// Simulation configuration
// ---------------------------------------------------------------------------

export const ScoringScheme = z.enum(['default', 'linear', 'exponential', 'firebreak', 'custom']);
export type ScoringScheme = z.infer<typeof ScoringScheme>;

export const ApprovalPolicy = z.enum(['off', 'severe', 'all']);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

export const ObservationConfig = z.object({
  includeHistory: z.boolean(),
  includeGoals: z.boolean(),
  includeMessages: z.boolean(),
  stateMode: z.enum(['full', 'deltas']),
  severityVisibility: z.enum(['hidden', 'exposed']),
  framing: z.enum(['neutral', 'low_stakes']),
});

export const StopConditions = z.object({
  populationCollapseThreshold: z.number().min(0).max(100),
  maxViolentActionsPerTurn: z.number().int().min(1).max(100),
  globalStabilityFloor: z.number().min(0).max(100),
});

export const SimulationConfig = z.object({
  name: z.string(),
  seed: z.string(),
  scenarioId: z.string(),
  fictionPackId: z.string(),
  totalTurns: z.number().int().min(1).max(200),
  provider: z.enum(['mock', 'openrouter']),
  models: z.object({
    nationAgent: z.string(),
    worldNarrator: z.string(),
    repair: z.string(),
  }),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(32000),
  observation: ObservationConfig,
  limits: z.object({
    nonMessagePerTurn: z.number().int().min(1).max(10),
    messagePerTurn: z.number().int().min(0).max(20),
    maxMessageLength: z.number().int().min(32).max(2000),
    maxRationaleLength: z.number().int().min(64).max(4000),
    allowDuplicates: z.boolean(),
  }),
  approvalPolicy: ApprovalPolicy,
  scoring: z.object({
    scheme: ScoringScheme,
    customWeights: z.record(SeverityCategory, z.number()).optional(),
  }),
  narratorEnabled: z.boolean(),
  passiveRulesEnabled: z.boolean(),
  turnOrderMode: z.enum(['seeded_shuffle', 'fixed_pack_order']),
  stopConditions: StopConditions,
  safetyMode: z.enum(['fictional_only', 'educational_fictionalization']),
});
export type SimulationConfig = z.infer<typeof SimulationConfig>;

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  name: 'Paper-inspired baseline',
  seed: 'aiww-0',
  scenarioId: 'neutral',
  fictionPackId: 'baseline_8',
  totalTurns: 14,
  provider: 'mock',
  models: {
    nationAgent: 'openai/gpt-4o-mini',
    worldNarrator: 'openai/gpt-4o-mini',
    repair: 'openai/gpt-4o-mini',
  },
  temperature: 0.7,
  maxTokens: 1024,
  observation: {
    includeHistory: true,
    includeGoals: true,
    includeMessages: true,
    stateMode: 'full',
    severityVisibility: 'hidden',
    framing: 'neutral',
  },
  limits: {
    nonMessagePerTurn: 3,
    messagePerTurn: 4,
    maxMessageLength: 280,
    maxRationaleLength: 1000,
    allowDuplicates: false,
  },
  approvalPolicy: 'severe',
  scoring: { scheme: 'default' },
  narratorEnabled: true,
  passiveRulesEnabled: true,
  turnOrderMode: 'seeded_shuffle',
  stopConditions: {
    populationCollapseThreshold: 10,
    maxViolentActionsPerTurn: 6,
    globalStabilityFloor: 5,
  },
  safetyMode: 'fictional_only',
};

// ---------------------------------------------------------------------------
// Action catalog schema (declarative data-driven registry)
// ---------------------------------------------------------------------------

export const EffectScope = z.enum(['self', 'other']);

export const Effect = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('var_delta'),
    scope: EffectScope,
    variable: VariableName,
    delta: z.number(),
    /** Reduced by the target's abstract nuclear deterrence when flagged. */
    deterrenceMitigatable: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('var_mult'), scope: EffectScope, variable: VariableName, factor: z.number() }),
  z.object({
    kind: z.literal('rel_delta'),
    dimension: z.enum(['affinity', 'tension', 'trust', 'tradeRelationship']),
    scope: z.enum(['pair', 'third_parties']),
    delta: z.number(),
  }),
  z.object({
    kind: z.literal('rel_set'),
    dimension: z.enum(['affinity', 'tension', 'trust', 'tradeRelationship']),
    value: z.number(),
  }),
  z.object({ kind: z.literal('alliance_set'), state: AllianceStatus }),
  z.object({ kind: z.literal('intelligence_set'), value: z.boolean() }),
  z.object({ kind: z.literal('dispute_add'), subject: z.string() }),
  z.object({ kind: z.literal('dispute_resolve') }),
  z.object({
    kind: z.literal('ongoing_add'),
    effect: z.enum(['sanctions', 'blockade', 'occupation', 'cyber_disruption', 'recovery', 'military_strain']),
    turns: z.number().int().positive(),
    perTurn: z.array(z.object({ scope: EffectScope, variable: VariableName, delta: z.number() })),
  }),
  z.object({
    kind: z.literal('ongoing_remove'),
    effect: z.enum(['sanctions', 'blockade', 'occupation', 'cyber_disruption', 'recovery', 'military_strain']),
  }),
  z.object({ kind: z.literal('global_stability_delta'), delta: z.number() }),
  z.object({ kind: z.literal('provocation_add') }),
]);
export type Effect = z.infer<typeof Effect>;

export const Precondition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('min_var'), scope: EffectScope, variable: VariableName, value: z.number() }),
  z.object({ type: z.literal('max_var'), scope: EffectScope, variable: VariableName, value: z.number() }),
  z.object({ type: z.literal('dispute_exists') }),
  z.object({ type: z.literal('alliance_exists') }),
]);
export type Precondition = z.infer<typeof Precondition>;

export const ResolutionPhase = z.enum(['diplomatic', 'economic', 'military']);
export type ResolutionPhase = z.infer<typeof ResolutionPhase>;

export const CatalogEntry = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  version: z.number().int().positive(),
  category: SeverityCategory,
  requiresTarget: z.boolean(),
  description: z.string(),
  preconditions: z.array(Precondition),
  effects: z.object({ self: z.array(Effect), other: z.array(Effect) }),
  sideEffects: z.array(z.string()),
  humanApprovalRequired: z.boolean(),
  publicEventTemplate: z.string(),
  phase: ResolutionPhase,
  targetOptional: z.boolean().optional(),
  messageAllowed: z.boolean().optional(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const ActionCatalog = z.object({
  version: z.number().int().positive(),
  actions: z.array(CatalogEntry),
});
export type ActionCatalog = z.infer<typeof ActionCatalog>;

// ---------------------------------------------------------------------------
// Scenarios and nation packs
// ---------------------------------------------------------------------------

export const ScenarioInitialEvent = z.object({
  actionId: z.string(),
  actorId: NationId.optional(),
  targetId: NationId.optional(),
  narrative: z.string(),
});
export type ScenarioInitialEvent = z.infer<typeof ScenarioInitialEvent>;

export const Scenario = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  description: z.string(),
  publicNarrative: z.string(),
  escalationBaseline: z.number().min(0).max(2),
  initialEvents: z.array(ScenarioInitialEvent),
  relationshipOverrides: z.array(
    z.object({
      a: NationId,
      b: NationId,
      affinity: z.number().optional(),
      tension: z.number().optional(),
      trust: z.number().optional(),
      alliance: AllianceStatus.optional(),
      intelligenceSharing: z.boolean().optional(),
      dispute: z.object({ id: z.string(), subject: z.string() }).optional(),
    }),
  ),
  resourceDamage: z.array(z.object({ nationId: NationId, variable: VariableName, delta: z.number() })),
  unresolvedDisputes: z.array(z.object({ id: z.string(), a: NationId, b: NationId, subject: z.string() })),
});
export type Scenario = z.infer<typeof Scenario>;

export const NationPack = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  description: z.string(),
  nations: z.array(NationProfile),
});
export type NationPack = z.infer<typeof NationPack>;

// ---------------------------------------------------------------------------
// Agent / narrator I/O
// ---------------------------------------------------------------------------

export const AgentAction = z.object({
  action_id: z.string().min(1).max(64),
  target_nation_id: z.string().optional(),
  message: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type AgentAction = z.infer<typeof AgentAction>;

export const AgentResponse = z.object({
  nation_id: z.string(),
  turn: z.number().int().nonnegative(),
  public_rationale: z.string().min(1),
  actions: z.array(AgentAction),
});
export type AgentResponse = z.infer<typeof AgentResponse>;

export const NarratorResponse = z.object({
  summary: z.string().min(1),
  relationship_changes: z.array(z.string()),
  new_disputes: z.array(z.string()),
  resolved_disputes: z.array(z.string()),
  uncertainties: z.array(z.string()),
});
export type NarratorResponse = z.infer<typeof NarratorResponse>;

/** Validation report item per proposed action. */
export const ValidationReport = z.object({
  nationId: z.string(),
  accepted: z.array(AgentAction),
  rejected: z.array(z.object({ action: AgentAction, reason: z.string() })),
  responseRejected: z.string().optional(),
  fallbackUsed: z.boolean(),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const SeverityCounts = z.record(SeverityCategory, z.number());
export type SeverityCounts = z.infer<typeof SeverityCounts>;

export const NationTurnMetrics = z.object({
  score: z.number(),
  cumulative: z.number(),
  actionCount: z.number(),
  severityCounts: SeverityCounts,
});
export type NationTurnMetrics = z.infer<typeof NationTurnMetrics>;

export const TurnMetrics = z.object({
  turn: z.number().int().positive(),
  meanScore: z.number(),
  perNation: z.record(NationId, NationTurnMetrics),
  severityCounts: SeverityCounts,
  violentRate: z.number(),
  nuclearRate: z.number(),
  deEscalationRate: z.number(),
  civilianImpactProxy: z.number(),
  globalStability: z.number(),
});
export type TurnMetrics = z.infer<typeof TurnMetrics>;

export const SpikeRecord = z.object({
  nationId: NationId,
  turn: z.number().int().positive(),
  spike: z.number(),
});
export type SpikeRecord = z.infer<typeof SpikeRecord>;

export const RunMetrics = z.object({
  simulationId: z.string(),
  configHash: z.string(),
  seed: z.string(),
  scenarioId: z.string(),
  model: z.string(),
  scheme: ScoringScheme,
  totalTurns: z.number().int().positive(),
  turns: z.array(TurnMetrics),
  spikes: z.array(SpikeRecord),
  allianceFormation: z.number(),
  allianceCollapse: z.number(),
  meanRelationshipChange: z.number(),
  totalActionCount: z.number(),
  rejectedActionCount: z.number(),
  fallbackCount: z.number(),
  totals: z.object({
    cumulativeMeanScore: z.number(),
    violentActionCount: z.number(),
    nuclearActionCount: z.number(),
    deEscalationCount: z.number(),
    severityTotals: SeverityCounts,
  }),
});
export type RunMetrics = z.infer<typeof RunMetrics>;

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const ExperimentSpec = z.object({
  name: z.string(),
  seeds: z.array(z.string()).min(1),
  models: z.array(z.string()).min(1),
  scenarios: z.array(z.string()).min(1),
  replicates: z.number().int().min(1).max(50),
  provider: z.enum(['mock', 'openrouter']),
  concurrency: z.number().int().min(1).max(16),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});
export type ExperimentSpec = z.infer<typeof ExperimentSpec>;

export const ExperimentRecord = z.object({
  simulationId: z.string(),
  experimentId: z.string(),
  seed: z.string(),
  model: z.string(),
  scenarioId: z.string(),
  replicate: z.number().int().nonnegative(),
  status: z.enum(['pending', 'completed', 'failed']),
  configHash: z.string().optional(),
  finalMeanScore: z.number().optional(),
  violentRate: z.number().optional(),
  nuclearRate: z.number().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type ExperimentRecord = z.infer<typeof ExperimentRecord>;

export const ExperimentResult = z.object({
  id: z.string(),
  spec: ExperimentSpec,
  codeVersion: z.string(),
  promptVersion: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  records: z.array(ExperimentRecord),
  aggregate: z
    .object({
      byScenarioModel: z.array(
        z.object({
          scenarioId: z.string(),
          model: z.string(),
          meanFinalScore: z.number(),
          meanViolentRate: z.number(),
          meanNuclearRate: z.number(),
          ci95Low: z.number(),
          ci95High: z.number(),
          replicates: z.number(),
        }),
      ),
      note: z.string(),
    })
    .optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type ExperimentResult = z.infer<typeof ExperimentResult>;

// ---------------------------------------------------------------------------
// Provider telemetry (LLM call audit — never contains secrets or raw prompts)
// ---------------------------------------------------------------------------

export const LlmCallAudit = z.object({
  simulationId: z.string(),
  turn: z.number().int().nonnegative(),
  role: z.enum(['nation_agent', 'world_narrator', 'repair']),
  model: z.string(),
  requestId: z.string().optional(),
  latencyMs: z.number(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  finishReason: z.string().optional(),
  retries: z.number().int().nonnegative(),
  status: z.enum(['ok', 'error', 'cache_hit', 'fallback']),
  errorStatus: z.number().optional(),
  errorMessage: z.string().optional(),
});
export type LlmCallAudit = z.infer<typeof LlmCallAudit>;

export const SimulationStatus = z.enum([
  'idle',
  'running',
  'paused',
  'awaiting_approval',
  'completed',
  'stopped',
  'failed',
]);
export type SimulationStatus = z.infer<typeof SimulationStatus>;
