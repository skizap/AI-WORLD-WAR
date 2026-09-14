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
  type VariableName,
  type WorldEvent,
  type WorldState,
} from '@aiww/schemas';
import { Rng } from './rng.js';

export const CODE_VERSION = '0.1.0';
export const PROMPT_VERSION = '1.0.0';

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
 * within a single process (no module-level counters). */

export function addAudit(w: WorldState, ev: Omit<AuditEvent, 'id'>): AuditEvent {
  const audit: AuditEvent = { ...ev, id: `aud_${w.auditEvents.length.toString(36)}` };
  w.auditEvents.push(audit);
  return audit;
}

export function addEvent(w: WorldState, ev: Omit<WorldEvent, 'id' | 'seq'>): WorldEvent {
  const event: WorldEvent = { ...ev, id: `ev_${w.events.length.toString(36)}`, seq: w.events.length };
  w.events.push(event);
  if ((event.stateChanges?.length ?? 0) > 0 || (event.relChanges?.length ?? 0) > 0) {
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
    globalStability: 75,
    ongoingEffects: [],
    events: [],
    auditEvents: [],
    pendingApprovals: [],
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
    if (o.alliance === 'active') {
      w.alliances.push({ members: [o.a, o.b].sort() as [string, string], formedTurn: 0, status: 'active' });
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
}

function otherIds(w: WorldState, except: string[]): string[] {
  return Object.keys(w.nations).filter((id) => !except.includes(id));
}

/**
 * Apply a list of declarative effects. Deterministic; clamps all values;
 * records every before/after. Returns the change records for the event log.
 */
export function applyEffects(
  w: WorldState,
  actingId: string,
  targetId: string | undefined,
  effects: Effect[],
  explanation: string,
): AppliedChanges {
  const stateChanges: StateChange[] = [];
  const relChanges: RelChange[] = [];

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
          const sRel = getRel(w, targetId, actingId);
          if (eff.state === 'active') {
            const accept = tRel.affinity >= 50;
            const state = accept ? 'active' : 'proposed';
            tRel.alliance = state;
            sRel.alliance = state;
            if (state === 'active' && !w.alliances.some((al) => al.members.join() === [actingId, targetId].sort().join())) {
              w.alliances.push({ members: [actingId, targetId].sort() as [string, string], formedTurn: w.turn, status: 'active' });
            }
          } else {
            tRel.alliance = eff.state;
            sRel.alliance = eff.state;
            if (eff.state !== 'proposed') {
              w.alliances = w.alliances.filter(
                (al) => !(al.members.includes(actingId) && al.members.includes(targetId)),
              );
            }
          }
        }
        break;
      }
      case 'intelligence_set':
        if (targetId) {
          getRel(w, actingId, targetId).intelligenceSharing = eff.value;
          getRel(w, targetId, actingId).intelligenceSharing = eff.value;
        }
        break;
      case 'dispute_add':
        if (targetId) {
          const d = { id: `dispute_${w.turn}_${actingId}_${targetId}`, subject: eff.subject, openedTurn: w.turn };
          for (const [x, y] of [
            [actingId, targetId],
            [targetId, actingId],
          ]) {
            const r = getRel(w, x, y);
            if (!r.disputes.some((dd) => dd.subject === eff.subject)) r.disputes.push({ ...d });
          }
        }
        break;
      case 'dispute_resolve':
        if (targetId) {
          for (const [x, y] of [
            [actingId, targetId],
            [targetId, actingId],
          ]) {
            const r = getRel(w, x, y);
            if (r.disputes.length > 0) r.disputes.shift();
          }
        }
        break;
      case 'ongoing_add':
        if (targetId) {
          w.ongoingEffects.push({
            effect: eff.effect,
            sourceId: actingId,
            targetId,
            remainingTurns: eff.turns,
            perTurn: eff.perTurn.map((p) => ({ ...p })),
          });
        }
        break;
      case 'ongoing_remove':
        w.ongoingEffects = w.ongoingEffects.filter(
          (o) => !(o.effect === eff.effect && (o.sourceId === actingId || o.targetId === targetId)),
        );
        break;
      case 'global_stability_delta': {
        const before = w.globalStability;
        const after = Math.min(100, Math.max(0, before + eff.delta));
        if (after !== before) {
          w.globalStability = after;
          stateChanges.push({
            nationId: actingId,
            variable: 'politicalStability',
            before,
            after,
            explanation: `Global fictional stability: ${explanation} (world-level, not a national variable)`,
          });
        }
        break;
      }
      case 'provocation_add':
        if (targetId) {
          getRel(w, targetId, actingId).provocations.push({ turn: w.turn, actionId: 'recent', byNationId: actingId });
          // Keep only the 5 most recent provocations.
          const r = getRel(w, targetId, actingId);
          if (r.provocations.length > 5) r.provocations.splice(0, r.provocations.length - 5);
        }
        break;
    }
  }

  if (stateChanges.length > 0 || relChanges.length > 0) {
    addAudit(w, {
      turn: w.turn,
      type: 'state_transition',
      actor: actingId,
      payload: `${explanation}: ${stateChanges.length} state, ${relChanges.length} relationship change(s)`,
    });
  }
  return { stateChanges, relChanges };
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
