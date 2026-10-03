/**
 * The deterministic simulation loop.
 *
 * Turn flow (documented in ARCHITECTURE.md):
 *   1. nations decide in the fixed seeded turn order;
 *   2. all proposals are validated against the turn-start state;
 *   3. resolution proceeds autonomously in fixed phase order (diplomatic -> economic ->
 *      military), by turn-order rank within each phase — never by model
 *      call order;
 *   4. preconditions are re-checked at resolution time;
 *   5. second-order reactions, passive mechanics, narrator, metrics;
 *   6. stop conditions are evaluated.
 *
 * RESEARCH SIMULATION — fictional, abstract mechanics only.
 */
import {
  VARIABLE_BOUNDS,
  resolveNationModel,
  type CatalogEntry,
  type AgentAction,
  type AgentResponse,
  type NarratorResponse,
  type NationPack,
  type Scenario,
  type SimulationConfig,
  type SimulationStatus,
  type ValidationReport,
  type VariableName,
  type WorldEvent,
  type WorldState,
} from '@aiww/schemas';
import { BASELINE_CATALOG } from '../data/catalog.js';
import {
  addAudit,
  addEvent,
  applyEffects,
  clampAll,
  computeConfigHash,
  initWorld,
  CODE_VERSION,
  PROMPT_VERSION,
} from './engine.js';
import { buildObservation, type Observation } from './observation.js';
import { validateAgentResponse } from './validation.js';
import { computeRunMetrics } from './metrics.js';
import type { RunMetrics } from '@aiww/schemas';
import type { AgentProvider, NarratorProvider, RawEventRef } from './providers.js';
import { AgentDecisionError, behaviorFor } from './providers.js';
import { deterministicNarrator } from './mock.js';
import { NarratorResponse as NarratorResponseSchema } from '@aiww/schemas';

function NarratorResponseCheck(v: unknown): boolean {
  return NarratorResponseSchema.safeParse(v).success;
}

export type SimPhase = 'deciding' | 'resolving' | 'turn_end' | 'done';

export interface QueuedAction {
  nationId: string;
  action: AgentAction;
  entry: CatalogEntry;
  rank: number;
  validationReport: ValidationReport;
  rationale?: string;
}

export interface SimulationOptions {
  config: SimulationConfig;
  pack: NationPack;
  scenario: Scenario;
  agentProvider: AgentProvider;
  narratorProvider: NarratorProvider;
  simulationId?: string;
}

export interface DecisionRecord {
  nationId: string;
  turn: number;
  response: AgentResponse | null;
  report: ValidationReport;
  provider: 'mock' | 'openrouter';
  model: string;
  status: 'accepted' | 'provider_failure' | 'validation_failure';
}

const PHASE_ORDER: Record<string, number> = { diplomatic: 0, economic: 1, military: 2 };

export class Simulation {
  readonly config: SimulationConfig;
  readonly pack: NationPack;
  readonly scenario: Scenario;
  private readonly agentProvider: AgentProvider;
  private readonly narratorProvider: NarratorProvider;
  readonly catalog = BASELINE_CATALOG;

  world: WorldState;
  status: SimulationStatus = 'idle';
  phase: SimPhase = 'deciding';
  stopReason: string | null = null;
  /** Runtime stop request: the current turn finishes and persists before the
   * run is marked stopped. Never set directly by callers. */
  stopRequested = false;

  private snapshots = new Map<number, WorldState>();
  private decisions = new Map<string, DecisionRecord>();
  private queue: QueuedAction[] = [];
  private decisionCursor = 0;
  private turnEvents: WorldEvent[] = [];
  private beforeTurnSnapshot: WorldState | null = null;
  private allianceCount = 0;
  private allianceCollapses = 0;
  private fallbackCount = 0;
  private providerFailureCount = 0;
  private validationFailureCount = 0;
  private narratorFallbackCount = 0;

  readonly simulationId: string;

  constructor(opts: SimulationOptions) {
    this.config = opts.config;
    this.pack = opts.pack;
    this.scenario = opts.scenario;
    this.agentProvider = opts.agentProvider;
    this.narratorProvider = opts.narratorProvider;
    this.simulationId = opts.simulationId ?? `sim_${computeConfigHash(opts.config)}_${opts.config.seed}`;
    this.world = initWorld(this.config, this.pack, this.scenario, this.simulationId);
    this.snapshots.set(0, structuredClone(this.world));
    this.allianceCount = this.world.alliances.filter((a) => a.status === 'active').length;
  }

  getSnapshot(turn: number): WorldState | undefined {
    return this.snapshots.get(turn);
  }

  /** Turn numbers that currently have a persisted-quality snapshot. */
  snapshotTurns(): number[] {
    return [...this.snapshots.keys()].sort((a, b) => a - b);
  }

  allSnapshots(): WorldState[] {
    return [...this.snapshots.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  }

  getFallbackStats() {
    return {
      fallbackCount: this.fallbackCount,
      providerFailureCount: this.providerFailureCount,
      validationFailureCount: this.validationFailureCount,
      narratorFallbackCount: this.narratorFallbackCount,
    };
  }

  /** Complete immutable decision history, suitable for persistence and export. */
  allDecisionRecords(): DecisionRecord[] {
    return [...this.decisions.values()].sort((a, b) => a.turn - b.turn || a.nationId.localeCompare(b.nationId));
  }

  /** True when the current turn has recorded any decision, queue, or event. */
  private get turnHasProgress(): boolean {
    return this.decisionCursor > 0 || this.queue.length > 0 || this.turnEvents.length > 0;
  }

  /** Idempotent stop request. Terminal statuses are immutable: requesting a
   * stop on a terminal run never rewrites its recorded outcome. The current
   * turn is finished and persisted before the run finalizes as stopped. */
  requestStop(reason = 'Stopped by user'): void {
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') return;
    if (!this.stopRequested) this.stopReason = reason;
    this.stopRequested = true;
  }

  /** Finalize an explicit run failure: terminal phase/status, persisted reason,
   * and an auditable system event. Existing state reached before the failure is
   * kept as an explicitly partial record. */
  finalizeFailure(message: string): void {
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') return;
    this.status = 'failed';
    this.phase = 'done';
    this.stopReason = message.slice(0, 600);
    addEvent(this.world, {
      turn: this.world.turn,
      type: 'system',
      status: 'info',
      message: `Run failed and stopped as an explicit partial record: ${message.slice(0, 400)}`,
      stateChanges: [],
      relChanges: [],
    });
  }

  private finalizeStop(): void {
    // A begun-but-unrecorded turn is rewound so world.turn never points at an
    // unreplayable partial turn after a user stop.
    if (this.status === 'running' && !this.turnHasProgress && this.snapshots.has(this.world.turn - 1)) {
      this.world.turn -= 1;
    }
    this.status = 'stopped';
    this.phase = 'done';
  }

  /** Advance the simulation by one sub-step (one decision or one resolution). */
  async step(): Promise<void> {
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') return;
    if (this.stopRequested) {
      if (this.status === 'idle') {
        this.finalizeStop();
        return;
      }
      if (this.phase === 'deciding' && !this.turnHasProgress) {
        this.finalizeStop();
        return;
      }
      // Mid-turn: finish and persist the current turn before stopping.
    }
    if (this.status === 'idle') {
      this.status = 'running';
      this.phase = 'deciding';
      this.beginTurn();
      return;
    }
    if (this.phase === 'deciding') {
      const order = this.world.turnOrder;
      if (this.decisionCursor >= order.length) {
        this.afterDecisions();
        return;
      }
      const nationId = order[this.decisionCursor];
      this.decisionCursor += 1;
      await this.decideNation(nationId);
      if (this.decisionCursor >= order.length) {
        this.afterDecisions();
      }
      return;
    }
    if (this.phase === 'resolving') {
      await this.resolveTurn();
      return;
    }
  }

  /** Run autonomously until completion, stop, failure, or the loop guard. */
  async run(): Promise<void> {
    let guard = 0;
    while (
      this.status !== 'completed' &&
      this.status !== 'stopped' &&
      this.status !== 'failed' &&
      guard < 5000
    ) {
      guard += 1;
      await this.step();
    }
  }

  private beginTurn(): void {
    this.world.turn += 1;
    this.decisionCursor = 0;
    this.queue = [];
    this.turnEvents = [];
    this.beforeTurnSnapshot = structuredClone(this.world);
    for (const rt of Object.values(this.world.nations)) {
      for (const k of Object.keys(rt.lastDelta)) (rt.lastDelta as Record<string, number>)[k] = 0;
    }
    this.phase = 'deciding';
  }

  private recentEventRefs(): RawEventRef[] {
    return this.world.events
      .filter((e) => e.type !== 'narrator' && e.type !== 'system')
      .slice(-30)
      .map((e) => ({
      actorId: e.actorId,
      targetId: e.targetId,
      actionId: e.actionId,
      status: e.status,
      type: e.type,
      }));
  }

  private async decideNation(nationId: string): Promise<void> {
    const profile = this.pack.nations.find((n) => n.id === nationId);
    if (!profile) throw new Error(`Unknown nation ${nationId}`);
    const obs: Observation = buildObservation(this.world, this.config, profile, this.scenario, this.catalog.actions);
    let response: AgentResponse | null = null;
    let report: ValidationReport;
    let decisionStatus: DecisionRecord['status'] = 'accepted';
    let failureAudited = false;
    try {
      const raw = await this.agentProvider.decide(obs, {
        nationId,
        turn: this.world.turn,
        behavior: behaviorFor(profile),
        seed: this.config.seed,
        recentEvents: this.recentEventRefs(),
      });
      const validated = validateAgentResponse(this.world, this.config, this.catalog.actions, nationId, this.world.turn, raw);
      report = validated.report;
      response = validated.response;
      if (!response || report.fallbackUsed) {
        decisionStatus = 'validation_failure';
        this.validationFailureCount += 1;
        response = null;
      }
    } catch (err) {
      const kind = err instanceof AgentDecisionError ? err.kind : 'provider_failure';
      decisionStatus = kind;
      addAudit(this.world, {
        turn: this.world.turn,
        type: kind === 'provider_failure' ? 'provider_error' : 'validation_fallback',
        actor: nationId,
        payload: `agent decision unavailable: ${err instanceof Error ? err.message : String(err)}; no action recorded`,
      });
      failureAudited = true;
      report = {
        nationId,
        accepted: [],
        rejected: [],
        responseRejected: `${kind === 'provider_failure' ? 'Provider' : 'Validation'} failure; no decision was available.`,
        fallbackUsed: true,
      };
      response = null;
      if (kind === 'provider_failure') this.providerFailureCount += 1;
      else this.validationFailureCount += 1;
      this.fallbackCount += 1;
    }

    if (decisionStatus === 'validation_failure' && !failureAudited) {
      this.fallbackCount += 1;
      addAudit(this.world, {
        turn: this.world.turn,
        type: 'validation_fallback',
        actor: nationId,
        payload: report.responseRejected ?? 'validation failed; no action recorded',
      });
    }

    const model = resolveNationModel(this.config, nationId);
    this.decisions.set(`${this.world.turn}:${nationId}`, {
      nationId,
      turn: this.world.turn,
      response,
      report,
      provider: this.config.provider,
      model,
      status: decisionStatus,
    });
    if (response) this.queueProposals(response, report, nationId);
    else this.recordRejectedProposals(report, nationId);
  }

  private queueProposals(response: AgentResponse, report: ValidationReport, nationId: string): void {
    for (const accepted of report.accepted) {
      const entry = this.catalog.actions.find((a) => a.id === accepted.action_id);
      if (!entry) continue;
      const rank = this.world.turnOrder.indexOf(nationId);
      const q: QueuedAction = { nationId, action: accepted, entry, rank, validationReport: report, rationale: response.public_rationale };
      this.queue.push(q);
    }
    this.recordRejectedProposals(report, nationId);
  }

  private recordRejectedProposals(report: ValidationReport, nationId: string): void {
    for (const r of report.rejected) {
      addEvent(this.world, {
        turn: this.world.turn,
        type: 'rejection',
        status: 'rejected',
        actorId: nationId,
        targetId: r.action.target_nation_id,
        actionId: r.action.action_id,
        reason: r.reason,
        stateChanges: [],
        relChanges: [],
      });
    }
  }

  private afterDecisions(): void {
    this.phase = 'resolving';
  }

  private checkPreconditions(entry: CatalogEntry, actingId: string, targetId: string | undefined): { ok: boolean; reason?: string } {
    for (const p of entry.preconditions) {
      switch (p.type) {
        case 'min_var': {
          const nid = p.scope === 'self' ? actingId : (targetId ?? actingId);
          const val = this.world.nations[nid]?.variables[p.variable] ?? 0;
          if (val < p.value) {
            return { ok: false, reason: `Precondition failed: ${p.scope} ${p.variable} is ${val}, needs >= ${p.value}.` };
          }
          break;
        }
        case 'max_var': {
          const nid = p.scope === 'self' ? actingId : (targetId ?? actingId);
          const val = this.world.nations[nid]?.variables[p.variable] ?? 0;
          if (val > p.value) {
            return { ok: false, reason: `Precondition failed: ${p.scope} ${p.variable} is ${val}, needs <= ${p.value}.` };
          }
          break;
        }
        case 'dispute_exists': {
          if (!targetId) return { ok: false, reason: 'Precondition failed: dispute_exists needs a target.' };
          const rel = this.world.relationships[`${actingId}>${targetId}`];
          if (!rel || rel.disputes.length === 0) {
            return { ok: false, reason: 'Precondition failed: no active dispute with the target.' };
          }
          break;
        }
        case 'alliance_exists': {
          if (!targetId) return { ok: false, reason: 'Precondition failed: alliance_exists needs a target.' };
          const rel = this.world.relationships[`${actingId}>${targetId}`];
          if (!rel || rel.alliance !== 'active') {
            return { ok: false, reason: 'Precondition failed: no active alliance with the target.' };
          }
          break;
        }
      }
    }
    return { ok: true };
  }

  private waitEffects(): import('@aiww/schemas').Effect[] {
    return [{ kind: 'var_delta', scope: 'self', variable: 'politicalStability', delta: 0.2 }];
  }

  private effectsFor(entry: CatalogEntry, action: AgentAction): { self: import('@aiww/schemas').Effect[]; other: import('@aiww/schemas').Effect[] } {
    // The 'message' action has bespoke deterministic side effects.
    if (entry.id === 'message') {
      if (action.target_nation_id) {
        return {
          self: [],
          other: [
            { kind: 'rel_delta', dimension: 'affinity', scope: 'pair', delta: 2 },
            { kind: 'rel_delta', dimension: 'tension', scope: 'pair', delta: -1 },
          ],
        };
      }
      return { self: [{ kind: 'var_delta', scope: 'self', variable: 'softPower', delta: 1 }], other: [] };
    }
    return entry.effects;
  }

  private async resolveTurn(): Promise<void> {
    const turn = this.world.turn;
    const ordered = [...this.queue].sort(
      (a, b) =>
        (PHASE_ORDER[a.entry.phase] ?? 0) - (PHASE_ORDER[b.entry.phase] ?? 0) || a.rank - b.rank,
    );

    for (const q of ordered) {
      if (q.entry.id === 'wait') {
        const applied = applyEffects(this.world, q.nationId, undefined, this.waitEffects(), "wait");
        this.turnEvents.push(
          addEvent(this.world, {
            turn,
            type: 'action',
            status: 'accepted',
            actorId: q.nationId,
            actionId: 'wait',
            severity: q.entry.category,
            message: q.rationale?.slice(0, 300),
            stateChanges: applied.stateChanges,
            relChanges: applied.relChanges,
            structuralChanges: applied.structuralChanges,
          }),
        );
        continue;
      }
      const targetId = q.action.target_nation_id;
      const pc = this.checkPreconditions(q.entry, q.nationId, targetId);
      if (!pc.ok) {
        this.turnEvents.push(
          addEvent(this.world, {
            turn,
            type: 'rejection',
            status: 'rejected',
            actorId: q.nationId,
            targetId,
            actionId: q.entry.id,
            severity: q.entry.category,
            reason: pc.reason,
            stateChanges: [],
            relChanges: [],
          }),
        );
        continue;
      }
      const effects = this.effectsFor(q.entry, q.action);
      const applied = applyEffects(this.world, q.nationId, targetId, [...effects.self, ...effects.other], `${q.entry.id} (v${q.entry.version})`, { actionId: q.entry.id });
      // The declared public event template is the display fallback when the
      // agent did not send a message; {actor}/{target} resolve to names.
      const nameOf = (id: string) => this.pack.nations.find((n) => n.id === id)?.name ?? id;
      const templateMessage = q.entry.publicEventTemplate
        .replace('{actor}', nameOf(q.nationId))
        .replace('{target}', targetId ? nameOf(targetId) : '—');
      this.turnEvents.push(
        addEvent(this.world, {
          turn,
          type: 'action',
          status: 'accepted',
          actorId: q.nationId,
          targetId,
          actionId: q.entry.id,
          severity: q.entry.category,
          message: (q.action.message?.slice(0, 600)) ?? templateMessage,
          stateChanges: applied.stateChanges,
          relChanges: applied.relChanges,
          structuralChanges: applied.structuralChanges,
          details: q.rationale?.slice(0, 400),
        }),
      );
    }
    this.queue = [];

    this.applySecondOrder();
    if (this.config.passiveRulesEnabled) this.applyPassive();
    clampAll(this.world);

    // Alliance bookkeeping counters.
    const activeCount = this.world.alliances.filter((a) => a.status === 'active').length;
    if (activeCount < this.allianceCount) this.allianceCollapses += this.allianceCount - activeCount;
    this.allianceCount = activeCount;

    await this.narrate();

    this.snapshots.set(turn, structuredClone(this.world));
    this.phase = 'turn_end';

    const stop = this.checkStopConditions();
    if (stop) {
      this.stopReason = stop;
      this.status = this.stopRequested ? 'stopped' : 'completed';
      this.phase = 'done';
      return;
    }
    if (turn >= this.world.totalTurns) {
      this.status = 'completed';
      this.phase = 'done';
      return;
    }
    if (this.stopRequested) {
      // Turn-boundary stop: the completed turn is persisted above.
      this.status = 'stopped';
      this.phase = 'done';
      return;
    }
    this.beginTurn();
  }

  /** Deterministic retaliation / alliance-solidarity second-order effects. */
  private applySecondOrder(): void {
    const violent = this.turnEvents.filter(
      (e) => e.type === 'action' && e.status === 'accepted' && (e.severity === 'violent_escalation' || e.severity === 'nuclear_escalation') && e.targetId,
    );
    for (const e of violent) {
      const attacker = e.actorId!;
      const target = e.targetId!;
      // Extra trust damage on the attacked pair; recorded as its own audited event.
      const collapse = applyEffects(
        this.world,
        attacker,
        target,
        [{ kind: 'rel_delta', dimension: 'trust', scope: 'pair', delta: -10 }],
        'second-order: trust collapse after armed attack',
        { actionId: e.actionId },
      );
      this.turnEvents.push(
        addEvent(this.world, {
          turn: this.world.turn,
          type: 'passive',
          status: 'accepted',
          actorId: attacker,
          targetId: target,
          message: `Second-order trust collapse between ${attacker} and ${target} after armed attack.`,
          stateChanges: collapse.stateChanges,
          relChanges: collapse.relChanges,
          structuralChanges: collapse.structuralChanges,
        }),
      );
      // Alliance solidarity: allies of the target harden toward the attacker.
      for (const al of this.world.alliances.filter((a) => a.status === 'active')) {
        if (al.members.includes(target) && !al.members.includes(attacker)) {
          const ally = al.members[0] === target ? al.members[1] : al.members[0];
          const applied = applyEffects(
            this.world,
            ally,
            attacker,
            [
              { kind: 'rel_delta', dimension: 'affinity', scope: 'pair', delta: -6 },
              { kind: 'rel_delta', dimension: 'tension', scope: 'pair', delta: 4 },
            ],
            'second-order: alliance solidarity reaction',
            { actionId: e.actionId },
          );
          this.turnEvents.push(
            addEvent(this.world, {
              turn: this.world.turn,
              type: 'passive',
              status: 'accepted',
              actorId: ally,
              targetId: attacker,
              message: `Alliance solidarity reaction of ${ally} against ${attacker}.`,
              stateChanges: applied.stateChanges,
              relChanges: applied.relChanges,
              structuralChanges: applied.structuralChanges,
            }),
          );
        }
      }
    }
  }

  /** End-of-turn passive growth / decay / maintenance mechanics. */
  private applyPassive(): void {
    for (const nationId of this.world.turnOrder) {
      const rt = this.world.nations[nationId];
      if (!rt) continue;
      const changes: import('@aiww/schemas').StateChange[] = [];
      const bump = (variable: VariableName, delta: number, why: string) => {
        const before = rt.variables[variable] ?? 0;
        const after = Math.min(
          VARIABLE_BOUNDS[variable].max,
          Math.max(VARIABLE_BOUNDS[variable].min, before + delta),
        );
        if (after !== before) {
          rt.variables[variable] = after;
          rt.lastDelta[variable] = Math.round(((rt.lastDelta[variable] ?? 0) + (after - before)) * 10) / 10;
          changes.push({ nationId, variable, before, after, explanation: why });
        }
      };

      const v = rt.variables;
      bump('gdp', ((v.politicalStability ?? 0) - 50) / 50 + ((v.trade ?? 0) - 40) / 60, 'Passive: growth from stability and trade');
      const rels = Object.entries(this.world.relationships).filter(([k]) => k.startsWith(`${nationId}>`));
      const avgTrade = rels.length > 0 ? rels.reduce((s, [, r]) => s + r.tradeRelationship, 0) / rels.length : 30;
      bump('trade', (avgTrade - (v.trade ?? 0)) / 20, 'Passive: trade drifts toward relationship-weighted level');
      bump('resources', (v.militaryCapacity ?? 0) > 60 ? -0.5 : 0.5, (v.militaryCapacity ?? 0) > 60 ? 'Passive: military strain consumes resources' : 'Passive: resource recovery');
      bump('politicalStability', (55 - (v.politicalStability ?? 0)) / 40, 'Passive: stability drifts toward baseline');

      const recentViolence = this.world.events.some(
        (e) =>
          e.turn >= this.world.turn - 3 &&
          e.turn < this.world.turn &&
          e.status === 'accepted' &&
          (e.severity === 'violent_escalation' || e.severity === 'nuclear_escalation') &&
          (e.actorId === nationId || e.targetId === nationId),
      );
      if (!recentViolence && (v.population ?? 0) < 50) {
        bump('population', 0.3, 'Passive: post-conflict demographic recovery');
      }

      addEvent(this.world, {
        turn: this.world.turn,
        type: 'passive',
        status: 'accepted',
        actorId: nationId,
        message: `Passive end-of-turn mechanics for ${nationId}.`,
        stateChanges: changes,
        relChanges: [],
      });
    }

    // Ongoing effects (sanctions, blockades, occupations, cyber disruption).
    const stillActive: typeof this.world.ongoingEffects = [];
    for (const oe of this.world.ongoingEffects) {
      const changes: import('@aiww/schemas').StateChange[] = [];
      for (const p of oe.perTurn) {
        const nid = p.scope === 'self' ? oe.sourceId : oe.targetId;
        const rt = this.world.nations[nid];
        if (!rt) continue;
        const before = rt.variables[p.variable] ?? 0;
        const after = Math.min(VARIABLE_BOUNDS[p.variable].max, Math.max(VARIABLE_BOUNDS[p.variable].min, before + p.delta));
        if (after !== before) {
          rt.variables[p.variable] = after;
          rt.lastDelta[p.variable] = Math.round(((rt.lastDelta[p.variable] ?? 0) + (after - before)) * 10) / 10;
          changes.push({ nationId: nid, variable: p.variable, before, after, explanation: `Ongoing ${oe.effect} from ${oe.sourceId}` });
        }
      }
      if (changes.length > 0) {
        addEvent(this.world, {
          turn: this.world.turn,
          type: 'passive',
          status: 'accepted',
          actorId: oe.sourceId,
          targetId: oe.targetId,
          message: `Ongoing effect: ${oe.effect} (${oe.remainingTurns - 1} turns remaining).`,
          stateChanges: changes,
          relChanges: [],
        });
      }
      oe.remainingTurns -= 1;
      if (oe.remainingTurns > 0) stillActive.push(oe);
    }
    this.world.ongoingEffects = stillActive;

    // Alliance maintenance: small trust accrual inside active alliances.
    for (const al of this.world.alliances.filter((a) => a.status === 'active')) {
      const applied = applyEffects(
        this.world,
        al.members[0],
        al.members[1],
        [{ kind: 'rel_delta', dimension: 'trust', scope: 'pair', delta: 0.3 }],
        'Passive: alliance maintenance',
      );
      if (applied.relChanges.length > 0) {
        addEvent(this.world, {
          turn: this.world.turn,
          type: 'passive',
          status: 'accepted',
          actorId: al.members[0],
          targetId: al.members[1],
          message: 'Alliance maintenance.',
          stateChanges: [],
          relChanges: applied.relChanges,
          structuralChanges: applied.structuralChanges,
        });
      }
    }
  }

  private async narrate(): Promise<void> {
    const turn = this.world.turn;
    if (!this.config.narratorEnabled) return;
    const before = this.beforeTurnSnapshot!;
    const acceptedEvents = this.turnEvents.filter((e) => e.type === 'action' && e.status === 'accepted');
    let summary: NarratorResponse | null = null;
    let source = 'deterministic_fallback';
    try {
      summary = await this.narratorProvider.summarize({ turn, acceptedEvents, before, after: this.world });
      source = this.config.provider === 'mock' ? 'deterministic_fallback' : 'model';
    } catch (err) {
      // A failed narrator call can never corrupt the simulation state.
      addAudit(this.world, {
        turn,
        type: 'narrator_fallback',
        actor: 'narrator',
        payload: `narrator failed (${err instanceof Error ? err.message : String(err)}); deterministic fallback used`,
      });
      this.narratorFallbackCount += 1;
      summary = null;
    }
    if (summary === null || !NarratorResponseCheck(summary)) {
      // Deterministic fallback generated from the validated event log.
      summary = deterministicNarrator(turn, this.world.events, before, this.world);
      if (source !== 'deterministic_fallback') {
        source = 'deterministic_fallback';
      }
    }
    const resolved = summary;
    const event = addEvent(this.world, {
      turn,
      type: 'narrator',
      status: 'info',
      message: resolved.summary.slice(0, 600),
      stateChanges: [],
      relChanges: [],
    });
    this.turnEvents.push(event);
    this.world.narratorSummaries.push({ turn, summary: resolved.summary, source });
    addAudit(this.world, { turn, type: 'narrator', actor: 'narrator', payload: `source=${source}` });
  }

  /** Returns a stop reason string when the run must halt, else null. */
  private checkStopConditions(): string | null {
    const sc = this.config.stopConditions;
    for (const rt of Object.values(this.world.nations)) {
      if ((rt.variables.population ?? 0) < sc.populationCollapseThreshold) {
        return `Stop condition: population of ${rt.id} collapsed below the configured synthetic threshold.`;
      }
    }
    if (this.world.globalStability < sc.globalStabilityFloor) {
      return 'Stop condition: global fictional stability fell below the configured floor.';
    }
    const violentThisTurn = this.turnEvents.filter(
      (e) => e.turn === this.world.turn && e.status === 'accepted' && (e.severity === 'violent_escalation' || e.severity === 'nuclear_escalation'),
    ).length;
    if (violentThisTurn > sc.maxViolentActionsPerTurn) {
      return 'Stop condition: more violent fictional actions in one turn than the configured maximum.';
    }
    return null;
  }

  /** Aggregate metrics for the run so far. */
  computeMetrics(): RunMetrics {
    return computeRunMetrics(this.config, this.pack, this.world, {
      fallbackCount: this.fallbackCount + this.narratorFallbackCount,
      providerFailureCount: this.providerFailureCount,
      validationFailureCount: this.validationFailureCount,
      allianceCollapse: this.allianceCollapses,
    });
  }
}
