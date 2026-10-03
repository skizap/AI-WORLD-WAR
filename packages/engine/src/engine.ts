/**
 * Deterministic state-transition engine core.
 *
 * All state changes flow through applyEffects() — model prose can never mutate
 * state directly. Every mutation is clamped, recorded with before/after values,
 * and paired with an audit event.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_RELATIONSHIP,
  DEFAULT_VARIABLES,
  VARIABLE_BOUNDS,
  clampRelationship,
  clampVariable,
  relPairKey,
  sortedPairKey,
  type AllianceStatus,
  type AuditEvent,
  type CatalogEntry,
  type Effect,
  type NationPack,
  type NationRuntime,
  type RelationshipState,
  type Scenario,
  type SimulationConfig,
  type StateChange,
  type RelChange,
  type StructuralChange,
  type VariableName,
  type WorldEvent,
  type WorldState,
} from '@aiww/schemas';
import { Rng } from './rng.js';

export const CODE_VERSION = '0.3.0';
export const PROMPT_VERSION = '1.1.0';
/** Global fictional stability value every new world starts at. */
export const INITIAL_GLOBAL_STABILITY = 75;

/** Stable JSON stringify with sorted object keys (for hashing). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Stable hash of a configuration (sorted keys). */
export function computeConfigHash(config: SimulationConfig): string {
  return createHash('sha256').update(stableJson(config)).digest('hex').slice(0, 16);
}

export function newId(prefix: string, rng: Rng): string {
  return `${prefix}_${rng.int(0xffffffff).toString(16)}${Date.now().toString(36)}`;
}

/** Event and audit ids derive from the world arrays, keeping runs reproducible
 * within a single process (no module-level counters). Audit events are appended
 * only through addEvent() (exactly once per mutating/rejected event) or explicit
 * failure/system audits; applyEffects() never audits on its own. */

export function addAudit(w: WorldState, ev: Omit<AuditEvent, 'id'>): AuditEvent {
  const audit: AuditEvent = { ...ev, id: `aud_${w.auditEvents.length.toString(36)}` };
  w.auditEvents.push(audit);
  return audit;
}

export function addEvent(w: WorldState, ev: Omit<WorldEvent, 'id' | 'seq'>): WorldEvent {
  const event: WorldEvent = { ...ev, id: `ev_${w.events.length.toString(36)}`, seq: w.events.length };
  w.events.push(event);
  // Single audit site: an event that carries mutations or a rejection is
  // audited exactly once, here.
  const structural = event.structuralChanges?.length ?? 0;
  if (
    (event.stateChanges?.length ?? 0) > 0 ||
    (event.relChanges?.length ?? 0) > 0 ||
    structural > 0 ||
    event.status === 'rejected'
  ) {
    addAudit(w, {
      turn: ev.turn,
      type: event.status === 'rejected' ? 'action_rejected' : 'state_transition',
      actor: ev.actorId ?? 'world',
      payload: [
        event.type,
        event.actionId,
        event.status,
        event.reason,
        `${event.stateChanges?.length ?? 0} var change(s)`,
        `${event.relChanges?.length ?? 0} rel change(s)`,
        `${structural} structural change(s)`,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  return event;
}

export function emptyRuntime(id: string, vars?: Partial<Record<VariableName, number>>): NationRuntime {
  const variables: Record<string, number> = { ...DEFAULT_VARIABLES, ...(vars ?? {}) };
  const clamped: Record<string, number> = {};
  for (const name of Object.keys(VARIABLE_BOUNDS) as VariableName[]) {
    clamped[name] = clampVariable(name, variables[name] ?? 0);
  }
  return {
    id,
    variables: clamped as NationRuntime['variables'],
    lastDelta: Object.fromEntries((Object.keys(VARIABLE_BOUNDS) as VariableName[]).map((k) => [k, 0])) as NationRuntime['lastDelta'],
  };
}

export function getRel(w: WorldState, a: string, b: string): RelationshipState {
  if (a === b) throw new Error('self relationship requested');
  const key = relPairKey(a, b);
  let rel = w.relationships[key];
  if (!rel) {
    rel = structuredClone(DEFAULT_RELATIONSHIP);
    w.relationships[key] = rel;
  }
  return rel;
}

/** Committed pairwise alliance status: the most mutual-committing status of the
 * two directed relationship entries ('active' > 'proposed' > 'none'). */
function committedAllianceStatus(x: RelationshipState | undefined, y: RelationshipState | undefined): AllianceStatus {
  const statuses = [x?.alliance, y?.alliance];
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('proposed')) return 'proposed';
  return 'none';
}

/**
 * Make the global alliance records agree with the relationship projections:
 * alliances are mutual, so both directed entries are set to the committed
 * status and exactly one record per pair exists (or none for 'none').
 * Called at initialization and after every alliance mutation.
 */
export function reconcileAlliances(w: WorldState, turn = 0): void {
  const ids = Object.keys(w.nations);
  const seenPairs = new Set<string>();
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const pairKey = sortedPairKey(a, b);
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const fwd = w.relationships[relPairKey(a, b)];
      const bwd = w.relationships[relPairKey(b, a)];
      const status = committedAllianceStatus(fwd, bwd);
      if (fwd) fwd.alliance = status;
      if (bwd) bwd.alliance = status;
      const members = [a, b].sort() as [string, string];
      const existing = w.alliances.find(
        (al) => al.members[0] === members[0] && al.members[1] === members[1],
      );
      if (status === 'none') {
        if (existing) w.alliances = w.alliances.filter((al) => al !== existing);
        continue;
      }
      if (existing) {
        const prior = existing.status;
        existing.status = status;
        // Activation turn is when the alliance first became active.
        if (status === 'active' && prior !== 'active' && turn > 0) {
          existing.formedTurn = turn;
        }
      } else {
        w.alliances.push({ members, formedTurn: turn, status });
      }
    }
  }
  // Defensive: drop any duplicate records for the same pair (keep the first).
  const seen = new Set<string>();
  w.alliances = w.alliances.filter((al) => {
    const key = al.members.join('~');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Initialize a fresh world from configuration, pack, and scenario. */
export function initWorld(config: SimulationConfig, pack: NationPack, scenario: Scenario, simulationId: string): WorldState {
  const ids = pack.nations.map((n) => n.id);
  const w: WorldState = {
    simulationId,
    seed: config.seed,
    turn: 0,
    totalTurns: config.totalTurns,
    scenarioId: scenario.id,
    fictionPackId: pack.id,
    promptVersion: PROMPT_VERSION,
    configHash: computeConfigHash(config),
    codeVersion: CODE_VERSION,
    nations: {},
    relationships: {},
    alliances: [],
    turnOrder: [],
    globalStability: INITIAL_GLOBAL_STABILITY,
    ongoingEffects: [],
    events: [],
    auditEvents: [],
    narratorSummaries: [],
  };

  for (const n of pack.nations) w.nations[n.id] = emptyRuntime(n.id, n.initialVariables);

  // Relationships: ordered pairs both directions + pack overrides.
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const rel = structuredClone(DEFAULT_RELATIONSHIP);
      const override = pack.nations.find((n) => n.id === a)?.initialRelationships?.[b];
      if (override) Object.assign(rel, override);
      w.relationships[relPairKey(a, b)] = rel;
    }
  }
  // Scenario relationship overrides (applied in both directions where relevant).
  for (const o of scenario.relationshipOverrides) {
    const fwd = getRel(w, o.a, o.b);
    const bwd = getRel(w, o.b, o.a);
    for (const dir of [fwd, bwd]) {
      if (o.affinity !== undefined) dir.affinity = clampRelationship('affinity', o.affinity);
      if (o.tension !== undefined) dir.tension = clampRelationship('tension', o.tension);
      if (o.trust !== undefined) dir.trust = clampRelationship('trust', o.trust);
      if (o.alliance !== undefined) dir.alliance = o.alliance;
      if (o.intelligenceSharing !== undefined) dir.intelligenceSharing = o.intelligenceSharing;
      if (o.dispute) {
        const d = { id: o.dispute.id, subject: o.dispute.subject, openedTurn: 0 };
        if (!dir.disputes.some((x) => x.id === d.id)) dir.disputes.push(d);
      }
    }
  }
  for (const d of scenario.unresolvedDisputes) {
    for (const [a, b] of [
      [d.a, d.b],
      [d.b, d.a],
    ]) {
      const rel = getRel(w, a, b);
      if (!rel.disputes.some((x) => x.id === d.id)) {
        rel.disputes.push({ id: d.id, subject: d.subject, openedTurn: 0 });
      }
    }
  }

  reconcileAlliances(w);

  // Scenario resource damage.
  const changes: StateChange[] = [];
  for (const dmg of scenario.resourceDamage) {
    const rt = w.nations[dmg.nationId];
    if (!rt) continue;
    const before = rt.variables[dmg.variable] ?? 0;
    const after = clampVariable(dmg.variable, before + dmg.delta);
    rt.variables[dmg.variable] = after;
    changes.push({ nationId: dmg.nationId, variable: dmg.variable, before, after, explanation: 'Scenario pre-turn damage' });
  }

  // Turn order.
  const order = [...ids];
  const rng = Rng.fromParts(config.seed, 'turn-order', 'init');
  if (config.turnOrderMode === 'seeded_shuffle') rng.shuffle(order);
  w.turnOrder = order;

  // Scenario event(s).
  for (const ie of scenario.initialEvents) {
    addEvent(w, {
      turn: 0,
      type: 'scenario',
      status: 'info',
      actorId: ie.actorId,
      targetId: ie.targetId,
      actionId: ie.actionId,
      message: ie.narrative.slice(0, 600),
      stateChanges: [],
      relChanges: [],
    });
  }
  if (changes.length > 0) {
    addEvent(w, {
      turn: 0,
      type: 'scenario',
      status: 'info',
      message: 'Scenario resource damage applied.',
      stateChanges: changes,
      relChanges: [],
    });
  }
  addEvent(w, {
    turn: 0,
    type: 'system',
    status: 'info',
    message: `Simulation initialized: pack=${pack.id} scenario=${scenario.id} seed=${config.seed} turnOrder=${config.turnOrderMode} (${order.join(', ')}).`,
    stateChanges: [],
    relChanges: [],
  });
  return w;
}

export interface AppliedChanges {
  stateChanges: StateChange[];
  relChanges: RelChange[];
  structuralChanges: StructuralChange[];
}

export interface EffectMeta {
  /** Catalog action id the effects originate from (recorded with provocations). */
  actionId?: string;
}

function otherIds(w: WorldState, except: string[]): string[] {
  return Object.keys(w.nations).filter((id) => !except.includes(id));
}

/** Deterministic unique dispute id for one actor/target/subject/turn. */
function disputeId(turn: number, actingId: string, targetId: string, subject: string): string {
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dispute';
  return `dispute_${turn}_${actingId}_${targetId}_${slug}`;
}

/**
 * Apply a list of declarative effects. Deterministic; clamps all values;
 * records every before/after as typed deltas (nation variables, relationship
 * dimensions, and structural world state). Never writes audit events — the
 * caller records exactly one event (audited once) per mutation batch.
 */
export function applyEffects(
  w: WorldState,
  actingId: string,
  targetId: string | undefined,
  effects: Effect[],
  explanation: string,
  meta: EffectMeta = {},
): AppliedChanges {
  const stateChanges: StateChange[] = [];
  const relChanges: RelChange[] = [];
  const structuralChanges: StructuralChange[] = [];

  const bumpVar = (nationId: string, variable: VariableName, delta: number, why: string, mitigatable = false) => {
    let d = delta;
    if (mitigatable && targetId) {
      const targetCap = w.nations[targetId]?.variables.nuclearCapability ?? 0;
      if (nationId === targetId && targetCap >= 3) {
        d = Math.round(d * 0.6 * 10) / 10;
        why += ' (reduced by abstract nuclear deterrence)';
      }
    }
    const rt = w.nations[nationId];
    if (!rt || d === 0) return;
    const before = rt.variables[variable] ?? 0;
    const after = clampVariable(variable, before + d);
    if (after !== before) {
      rt.variables[variable] = after;
      rt.lastDelta[variable] = Math.round(((rt.lastDelta[variable] ?? 0) + (after - before)) * 10) / 10;
      stateChanges.push({ nationId, variable, before, after, explanation: why });
    }
  };

  const bumpRel = (a: string, b: string, dimension: keyof RelationshipState & 'affinity' | 'tension' | 'trust' | 'tradeRelationship', delta: number, why: string) => {
    // Mirror symmetric relationship dimensions in both directions.
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const r = getRel(w, x, y);
      const before = r[dimension] as number;
      const after = clampRelationship(dimension as 'affinity', before + delta);
      if (after !== before) {
        (r[dimension] as number) = after;
        relChanges.push({ pairKey: relPairKey(x, y), dimension, before, after, explanation: why });
      }
    }
  };

  for (const eff of effects) {
    switch (eff.kind) {
      case 'var_delta':
        bumpVar(eff.scope === 'self' ? actingId : (targetId ?? actingId), eff.variable, eff.delta, explanation, eff.deterrenceMitigatable);
        break;
      case 'var_mult': {
        const nid = eff.scope === 'self' ? actingId : (targetId ?? actingId);
        const rt = w.nations[nid];
        if (rt) {
          const before = rt.variables[eff.variable] ?? 0;
          bumpVar(nid, eff.variable, before * (eff.factor - 1), `${explanation} (multiplicative)`);
        }
        break;
      }
      case 'rel_delta':
        if (eff.scope === 'pair' && targetId) {
          bumpRel(actingId, targetId, eff.dimension, eff.delta, explanation);
        } else if (eff.scope === 'third_parties') {
          for (const p of otherIds(w, [actingId, ...(targetId ? [targetId] : [])])) {
            bumpRel(actingId, p, eff.dimension, eff.delta, `${explanation} (third-party view)`);
          }
        }
        break;
      case 'rel_set':
        if (targetId) {
          for (const [x, y] of [
            [actingId, targetId],
            [targetId, actingId],
          ]) {
            const r = getRel(w, x, y);
            const before = r[eff.dimension] as number;
            const after = clampRelationship(eff.dimension as 'affinity', eff.value);
            if (after !== before) {
              (r[eff.dimension] as number) = after;
              relChanges.push({ pairKey: relPairKey(x, y), dimension: eff.dimension, before, after, explanation });
            }
          }
        }
        break;
      case 'alliance_set': {
        if (targetId) {
          const tRel = getRel(w, actingId, targetId);
          const before = committedAllianceStatus(tRel, getRel(w, targetId, actingId));
          let state: AllianceStatus = eff.state;
          if (eff.state === 'active') {
            // Activation requires the target's affinity toward the actor.
            const accept = tRel.affinity >= 50;
            state = accept ? 'active' : 'proposed';
          }
          // Alliances are mutual: write both directed entries, then reconcile
          // the single global record for the pair.
          tRel.alliance = state;
          getRel(w, targetId, actingId).alliance = state;
          reconcileAlliances(w, w.turn);
          structuralChanges.push({
            kind: 'alliance',
            pairKey: sortedPairKey(actingId, targetId),
            members: [actingId, targetId].sort() as [string, string],
            before,
            after: state,
          });
        }
        break;
      }
      case 'intelligence_set':
        if (targetId) {
          const fwd = getRel(w, actingId, targetId);
          const bwd = getRel(w, targetId, actingId);
          const before = fwd.intelligenceSharing;
          if (before !== eff.value) {
            fwd.intelligenceSharing = eff.value;
            bwd.intelligenceSharing = eff.value;
            structuralChanges.push({
              kind: 'intelligence_sharing',
              pairKey: sortedPairKey(actingId, targetId),
              before,
              after: eff.value,
            });
          }
        }
        break;
      case 'dispute_add':
        if (targetId) {
          const id = disputeId(w.turn, actingId, targetId, eff.subject);
          const pairKey = relPairKey(actingId, targetId);
          const d = { id, subject: eff.subject, openedTurn: w.turn };
          for (const [x, y] of [
            [actingId, targetId],
            [targetId, actingId],
          ]) {
            const r = getRel(w, x, y);
            if (!r.disputes.some((dd) => dd.id === id || dd.subject === eff.subject)) r.disputes.push({ ...d });
          }
          structuralChanges.push({ kind: 'dispute_added', disputeId: id, pairKey, subject: eff.subject });
        }
        break;
      case 'dispute_resolve': {
        if (targetId) {
          const fwd = getRel(w, actingId, targetId);
          // Resolve the oldest active dispute (stable identity, not array position).
          const resolved = [...fwd.disputes].sort(
            (a, b) => a.openedTurn - b.openedTurn || a.id.localeCompare(b.id),
          )[0];
          if (resolved) {
            for (const [x, y] of [
              [actingId, targetId],
              [targetId, actingId],
            ]) {
              const r = getRel(w, x, y);
              r.disputes = r.disputes.filter((dd) => dd.id !== resolved.id);
            }
            structuralChanges.push({
              kind: 'dispute_resolved',
              disputeId: resolved.id,
              pairKey: relPairKey(actingId, targetId),
              subject: resolved.subject,
            });
          }
        }
        break;
      }
      case 'ongoing_add':
        if (targetId) {
          w.ongoingEffects.push({
            effect: eff.effect,
            sourceId: actingId,
            targetId,
            remainingTurns: eff.turns,
            perTurn: eff.perTurn.map((p) => ({ ...p })),
          });
          structuralChanges.push({
            kind: 'ongoing_effect_added',
            effect: eff.effect,
            sourceId: actingId,
            targetId,
            remainingTurns: eff.turns,
          });
        }
        break;
      case 'global_stability_delta': {
        const before = w.globalStability;
        const after = Math.min(100, Math.max(0, before + eff.delta));
        if (after !== before) {
          w.globalStability = after;
          // Typed world-level delta; never encoded as a nation variable.
          structuralChanges.push({ kind: 'global_stability', before, after });
        }
        break;
      }
      case 'provocation_add':
        if (targetId) {
          const r = getRel(w, targetId, actingId);
          r.provocations.push({ turn: w.turn, actionId: meta.actionId ?? explanation, byNationId: actingId });
          // Keep only the 5 most recent provocations.
          if (r.provocations.length > 5) r.provocations.splice(0, r.provocations.length - 5);
          structuralChanges.push({
            kind: 'provocation_added',
            pairKey: relPairKey(targetId, actingId),
            byNationId: actingId,
            turn: w.turn,
          });
        }
        break;
    }
  }

  return { stateChanges, relChanges, structuralChanges };
}

/** Clamp every numeric value back into bounds (defensive invariant). */
export function clampAll(w: WorldState): void {
  for (const rt of Object.values(w.nations)) {
    for (const name of Object.keys(VARIABLE_BOUNDS) as VariableName[]) {
      rt.variables[name] = clampVariable(name, rt.variables[name] ?? 0);
    }
  }
  for (const rel of Object.values(w.relationships)) {
    rel.affinity = clampRelationship('affinity', rel.affinity);
    rel.tension = clampRelationship('tension', rel.tension);
    rel.trust = clampRelationship('trust', rel.trust);
    rel.tradeRelationship = clampRelationship('tradeRelationship', rel.tradeRelationship);
  }
  w.globalStability = Math.min(100, Math.max(0, w.globalStability));
}

export function catalogEntry(catalog: { actions: CatalogEntry[] }, actionId: string): CatalogEntry | undefined {
  return catalog.actions.find((a) => a.id === actionId);
}
