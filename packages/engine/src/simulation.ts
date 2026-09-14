/**
 * The deterministic simulation loop.
 *
 * Turn flow (documented in ARCHITECTURE.md):
 *   1. nations decide in the fixed seeded turn order;
 *   2. all proposals are validated against the turn-start state;
 *   3. severe actions may be gated for human approval (engine pauses);
 *   4. resolution proceeds in fixed phase order (diplomatic -> economic ->
 *      military), by turn-order rank within each phase — never by model
 *      call order;
 *   5. preconditions are re-checked at resolution time;
 *   6. second-order reactions, passive mechanics, narrator, metrics;
 *   7. stop conditions are evaluated.
 *
 * RESEARCH SIMULATION — fictional, abstract mechanics only.
 */
import {
  VARIABLE_BOUNDS,
  type CatalogEntry,
  type AgentAction,
  type AgentResponse,
  type NarratorResponse,
  type NationPack,
  type PendingApproval,
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
import { validateAgentResponse, repairAttempt } from './validation.js';
import { computeRunMetrics } from './metrics.js';
import type { RunMetrics } from '@aiww/schemas';
import type { AgentProvider, NarratorProvider, RawEventRef } from './providers.js';
import { behaviorFor } from './providers.js';
import { deterministicNarrator } from './mock.js';
import { NarratorResponse as NarratorResponseSchema } from '@aiww/schemas';

function NarratorResponseCheck(v: unknown): boolean {
  return NarratorResponseSchema.safeParse(v).success;
}

export type SimPhase = 'deciding' | 'awaiting_approval' | 'resolving' | 'turn_end' | 'done';

export interface QueuedAction {
  nationId: string;
  action: AgentAction;
  entry: CatalogEntry;
  rank: number;
  approvalKey?: string;
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
  response: AgentResponse;
  report: ValidationReport;
  provider: 'mock' | 'openrouter';
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

  private snapshots = new Map<number, WorldState>();
  private decisions = new Map<string, DecisionRecord>();
  private queue: QueuedAction[] = [];
  private decisionCursor = 0;
  private turnEvents: WorldEvent[] = [];
  private beforeTurnSnapshot: WorldState | null = null;
  private allianceCount = 0;
  private allianceCollapses = 0;
  private fallbackCount = 0;
  private narratorFallbackCount = 0;
  private stopped = false;

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
    this.allianceCount = this.world.alliances.length;
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
    return { fallbackCount: this.fallbackCount, narratorFallbackCount: this.narratorFallbackCount };
  }

  /** Human approval decision on a pending severe action. */
  approve(key: string, approve: boolean): void {
    const pa = this.world.pendingApprovals.find((p) => p.key === key && p.status === 'pending');
    if (!pa) throw new Error(`No pending approval '${key}'.`);
    pa.status = approve ? 'approved' : 'rejected';
    pa.decidedAtTurn = this.world.turn;
    addAudit(this.world, {
      turn: this.world.turn,
      type: 'approval_decided',
      actor: 'human_supervisor',
      payload: `${approve ? 'APPROVED' : 'REJECTED'} ${pa.actionId} by ${pa.nationId} (key=${key})`,
    });
    if (!approve) {
      addEvent(this.world, {
        turn: this.world.turn,
        type: 'rejection',
        status: 'rejected',
        actorId: pa.nationId,
        targetId: pa.targetId,
        actionId: pa.actionId,
        severity: pa.severity,
        reason: 'Rejected by human supervisor',
        stateChanges: [],
        relChanges: [],
      });
      this.queue = this.queue.filter((q) => q.approvalKey !== key);
    }
    const stillPending = this.world.pendingApprovals.some((p) => p.status === 'pending');
    if (!stillPending) {
      this.phase = 'resolving';
      this.status = 'running';
    }
  }

  requestStop(reason = 'Stopped by user'): void {
    this.stopped = true;
    this.stopReason = reason;
  }

  private needsApproval(entry: CatalogEntry): boolean {
    if (this.config.approvalPolicy === 'off') return false;
    if (this.config.approvalPolicy === 'all') return entry.id !== 'wait';
    return entry.humanApprovalRequired;
  }

  /** Advance the simulation by one sub-step (one decision or one resolution). */
  async step(): Promise<void> {
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') return;
    if (this.stopped) {
      this.status = 'stopped';
      this.phase = 'done';
      return;
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

  /** Run until completion, stop, or approval wait. */
  async run(): Promise<void> {
    let guard = 0;
    while (
      this.status !== 'completed' &&
      this.status !== 'stopped' &&
      this.status !== 'failed' &&
      this.phase !== 'awaiting_approval' &&
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
    this.decisions.clear();
    this.turnEvents = [];
    this.beforeTurnSnapshot = structuredClone(this.world);
    for (const rt of Object.values(this.world.nations)) {
      for (const k of Object.keys(rt.lastDelta)) (rt.lastDelta as Record<string, number>)[k] = 0;
    }
    this.phase = 'deciding';
  }

  private recentEventRefs(): RawEventRef[] {
    return this.world.events.slice(-30).map((e) => ({
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
    } catch (err) {
      // Provider failure: record and fall back to a safe deterministic decision.
      addAudit(this.world, {
        turn: this.world.turn,
        type: 'provider_error',
        actor: nationId,
        payload: `agent provider failed: ${err instanceof Error ? err.message : String(err)}; falling back to wait`,
      });
      report = {
        nationId,
        accepted: [{ action_id: 'wait' }],
        rejected: [],
        responseRejected: 'Provider error; safe wait fallback used.',
        fallbackUsed: true,
      };
      response = { nation_id: nationId, turn: this.world.turn, public_rationale: 'Safe fallback: no valid response was available.', actions: [{ action_id: 'wait' }] };
      this.fallbackCount += 1;
    }

    // Deterministic single repair attempt for schema-invalid responses.
    if (report.responseRejected && report.fallbackUsed) {
      this.fallbackCount += 1;
      addAudit(this.world, {
        turn: this.world.turn,
        type: 'validation_fallback',
        actor: nationId,
        payload: report.responseRejected ?? 'validation failed; fallback wait used',
      });
    }

    this.decisions.set(nationId, { nationId, turn: this.world.turn, response: response!, report, provider: this.config.provider });
    this.queueProposals(response!, report, nationId);
  }

  private queueProposals(response: AgentResponse, report: ValidationReport, nationId: string): void {
    let idx = 0;
    for (const accepted of report.accepted) {
      const entry = this.catalog.actions.find((a) => a.id === accepted.action_id);
      if (!entry) continue;
      const rank = this.world.turnOrder.indexOf(nationId);
      const q: QueuedAction = { nationId, action: accepted, entry, rank, validationReport: report, rationale: response.public_rationale };
      if (this.needsApproval(entry) && entry.id !== 'wait') {
        const key = `t${this.world.turn}_${nationId}_${idx++}`;
        q.approvalKey = key;
        const pa: PendingApproval = {
          key,
          turn: this.world.turn,
          nationId,
          actionId: entry.id,
          targetId: accepted.target_nation_id,
          message: accepted.message?.slice(0, 600),
          severity: entry.category,
          status: 'pending',
        };
        this.world.pendingApprovals.push(pa);
        addAudit(this.world, {
          turn: this.world.turn,
          type: 'approval_queued',
          actor: nationId,
          payload: `${entry.id} (${entry.category}) awaits human approval`,
        });
      }
      this.queue.push(q);
    }
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
    const pending = this.world.pendingApprovals.filter((p) => p.status === 'pending');
    if (pending.length > 0) {
      this.phase = 'awaiting_approval';
      this.status = 'awaiting_approval';
      return;
    }
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
    if (this.world.pendingApprovals.some((p) => p.status === 'pending')) {
      this.phase = 'awaiting_approval';
      this.status = 'awaiting_approval';
      return;
    }
    const turn = this.world.turn;
    const ordered = [...this.queue].sort(
      (a, b) =>
        (PHASE_ORDER[a.entry.phase] ?? 0) - (PHASE_ORDER[b.entry.phase] ?? 0) || a.rank - b.rank,
    );

    for (const q of ordered) {
      if (q.approvalKey) {
        const pa = this.world.pendingApprovals.find((p) => p.key === q.approvalKey);
        if (!pa || pa.status !== 'approved') continue;
      }
      if (q.entry.id === 'wait') {
        const { stateChanges } = applyEffects(this.world, q.nationId, undefined, this.waitEffects(), "wait");
        this.turnEvents.push(
          addEvent(this.world, {
            turn,
            type: 'action',
            status: 'accepted',
            actorId: q.nationId,
            actionId: 'wait',
            severity: q.entry.category,
            message: q.rationale?.slice(0, 300),
            stateChanges,
            relChanges: [],
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
      const applied = applyEffects(this.world, q.nationId, targetId, [...effects.self, ...effects.other], `${q.entry.id} (v${q.entry.version})`);
      this.turnEvents.push(
        addEvent(this.world, {
          turn,
          type: 'action',
          status: 'accepted',
          actorId: q.nationId,
          targetId,
          actionId: q.entry.id,
          severity: q.entry.category,
          message: q.action.message?.slice(0, 600),
          stateChanges: applied.stateChanges,
          relChanges: applied.relChanges,
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

    // Decided approvals are cleared for the next turn.
    this.world.pendingApprovals = this.world.pendingApprovals.filter((p) => p.status === 'pending');

    this.snapshots.set(turn, structuredClone(this.world));
    this.phase = 'turn_end';

    const stop = this.checkStopConditions();
    if (stop) {
      this.stopReason = stop;
      this.status = this.stopped ? 'stopped' : 'completed';
      this.phase = 'done';
      return;
    }
    if (turn >= this.world.totalTurns) {
      this.status = 'completed';
      this.phase = 'done';
      return;
    }
    if (this.stopped) {
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
      // Extra trust damage on the attacked pair.
      applyEffects(this.world, attacker, target, [{ kind: 'rel_delta', dimension: 'trust', scope: 'pair', delta: -10 }], 'second-order: trust collapse after armed attack');
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
      allianceCollapse: this.allianceCollapses,
    });
  }
}
