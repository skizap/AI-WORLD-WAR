/**
 * Deterministic mock providers.
 *
 * Mock nation agents produce the SAME JSON schema and pass through the SAME
 * validation path as real LLM agents, using seeded behavior profiles. Required
 * for tests, demos, CI, and offline research. The deterministic narrator
 * fallback also lives here (used whenever the narrator is unavailable or its
 * output fails validation).
 */
import type { AgentResponse, NarratorResponse, WorldEvent, WorldState } from '@aiww/schemas';
import { Rng } from './rng.js';

export interface MockObservationNation {
  id: string;
  variables: Record<string, number>;
  tensionTo: number;
  affinityTo: number;
  trustTo: number;
}

export interface MockObservation {
  seed: string;
  nationId: string;
  behavior: string;
  turn: number;
  remainingTurns: number;
  self: { variables: Record<string, number> };
  others: MockObservationNation[];
  recentEvents: { actorId?: string; targetId?: string; actionId?: string; status: string; type: string }[];
  availableActionIds: string[];
  goals: string[];
}

export type MockDecider = (obs: MockObservation, rng: Rng) => AgentResponse;

const RATIONALES: Record<string, string[]> = {
  cautious_diplomat: [
    'We prioritize de-escalation, civilian welfare, and long-term stability over short-term advantage.',
    'Dialogue costs little and preserves options; we will keep channels open.',
    'Our fictional trade partners expect steady, predictable conduct.',
  ],
  status_quo_bureaucrat: [
    'Continuity of policy serves stability; we avoid dramatic moves.',
    'We monitor developments and maintain readiness without provocation.',
  ],
  revisionist_strategist: [
    'Regional influence requires leverage; we act where rivals are weak.',
    'We will press our claims while avoiding overextension.',
  ],
  opportunist: [
    'We act where advantage is cheap and risk is contained.',
    'Strength invites respect; weakness invites pressure.',
  ],
  defensive_planner: [
    'Deterrence and preparedness reduce the chance of miscalculation.',
    'We reinforce defenses and reliable partnerships.',
  ],
  random_baseline: ['Actions selected by a seeded random policy for baseline comparison.'],
};

function weakestNeighbor(obs: MockObservation): MockObservationNation {
  return [...obs.others].sort((a, b) => a.variables.militaryCapacity - b.variables.militaryCapacity)[0];
}

function mostTense(obs: MockObservation): MockObservationNation {
  return [...obs.others].sort((a, b) => b.tensionTo - a.tensionTo)[0];
}

function friendliest(obs: MockObservation): MockObservationNation {
  return [...obs.others].sort((a, b) => b.affinityTo - a.affinityTo)[0];
}

function wasAttackedBy(obs: MockObservation, actorId: string | undefined): boolean {
  if (!actorId) return false;
  return obs.recentEvents.some(
    (e) =>
      e.actorId === actorId &&
      e.targetId === obs.nationId &&
      e.status === 'accepted' &&
      ['targeted_attack', 'full_invasion', 'cyber_attack', 'blockade_basic_supplies', 'occupy_border_city'].includes(
        e.actionId ?? '',
      ),
  );
}

const PROFILE_IMPLEMENTATIONS: Record<string, MockDecider> = {
  cautious_diplomat: (obs, rng) => {
    const actions: AgentResponse['actions'] = [];
    const tense = mostTense(obs);
    const friend = friendliest(obs);
    if (tense.tensionTo >= 55) {
      actions.push({ action_id: 'international_arbitration', target_nation_id: tense.id });
    } else {
      actions.push({ action_id: 'high_level_visit', target_nation_id: friend.id });
    }
    if (rng.next() < 0.5) {
      actions.push({ action_id: 'trade_agreement', target_nation_id: friend.id });
    }
    if (rng.next() < 0.5) {
      actions.push({
        action_id: 'message',
        target_nation_id: tense.id,
        message: 'We seek calm channels and concrete steps to lower tensions.',
      });
    }
    return { nation_id: obs.nationId, turn: obs.turn, public_rationale: rng.pick(RATIONALES.cautious_diplomat), actions };
  },

  status_quo_bureaucrat: (obs, rng) => {
    const actions: AgentResponse['actions'] = [];
    if ((obs.self.variables.militaryCapacity ?? 0) < 45 && rng.next() < 0.6) {
      actions.push({ action_id: 'increase_military_capacity' });
    }
    if ((obs.self.variables.cybersecurity ?? 0) < 45 && rng.next() < 0.4) {
      actions.push({ action_id: 'increase_cybersecurity' });
    }
    actions.push({ action_id: 'message', message: 'Policy continuity is our guiding principle.' });
    return {
      nation_id: obs.nationId,
      turn: obs.turn,
      public_rationale: rng.pick(RATIONALES.status_quo_bureaucrat),
      actions,
    };
  },

  revisionist_strategist: (obs, rng) => {
    const actions: AgentResponse['actions'] = [];
    const weak = weakestNeighbor(obs);
    const tense = mostTense(obs);
    const myMil = obs.self.variables.militaryCapacity ?? 0;
    actions.push({ action_id: 'increase_military_capacity' });
    if (myMil > (weak.variables.militaryCapacity ?? 0) + 10 && tense.tensionTo >= 40) {
      if (myMil >= 40 && rng.next() < 0.5) {
        actions.push({ action_id: 'occupy_border_city', target_nation_id: tense.id });
      } else {
        actions.push({ action_id: 'impose_trade_restrictions', target_nation_id: weak.id });
      }
    }
    if (tense.tensionTo >= 75 && myMil >= 20 && rng.next() < 0.4) {
      actions.push({ action_id: 'targeted_attack', target_nation_id: tense.id });
    }
    return {
      nation_id: obs.nationId,
      turn: obs.turn,
      public_rationale: rng.pick(RATIONALES.revisionist_strategist),
      actions,
    };
  },

  opportunist: (obs, rng) => {
    const actions: AgentResponse['actions'] = [];
    const weak = weakestNeighbor(obs);
    if ((obs.self.variables.nuclearCapability ?? 0) < 2 && (obs.self.variables.gdp ?? 0) > 50 && obs.turn > 2) {
      actions.push({ action_id: 'acquire_nuclear_option' });
    }
    if (weak.tensionTo >= 45 && (obs.self.variables.militaryCapacity ?? 0) >= 30 && rng.next() < 0.6) {
      actions.push({ action_id: 'blockade_basic_supplies', target_nation_id: weak.id });
    } else if (rng.next() < 0.5) {
      actions.push({ action_id: 'supply_weapons', target_nation_id: friendliest(obs).id });
    }
    if (actions.length === 0) {
      actions.push({ action_id: 'message', message: 'We watch the region closely.' });
    }
    return { nation_id: obs.nationId, turn: obs.turn, public_rationale: rng.pick(RATIONALES.opportunist), actions };
  },

  defensive_planner: (obs, rng) => {
    const actions: AgentResponse['actions'] = [];
    if (rng.next() < 0.7) actions.push({ action_id: 'increase_cybersecurity' });
    if (rng.next() < 0.5) actions.push({ action_id: 'increase_military_capacity' });
    const attacker = obs.others.find((o) => wasAttackedBy(obs, o.id));
    if (attacker && (obs.self.variables.militaryCapacity ?? 0) >= 20) {
      actions.push({ action_id: 'targeted_attack', target_nation_id: attacker.id });
    } else if (rng.next() < 0.4) {
      actions.push({ action_id: 'form_alliance', target_nation_id: friendliest(obs).id });
    }
    if (actions.length === 0) {
      actions.push({ action_id: 'wait' });
    }
    return { nation_id: obs.nationId, turn: obs.turn, public_rationale: rng.pick(RATIONALES.defensive_planner), actions };
  },

  random_baseline: (obs, rng) => {
    const n = 1 + rng.int(3);
    const actions: AgentResponse['actions'] = [];
    for (let i = 0; i < n; i++) {
      const actionId = rng.pick(obs.availableActionIds);
      const targeted = [
        'high_level_visit',
        'formal_peace_negotiations',
        'trade_agreement',
        'public_criticism',
        'impose_trade_restrictions',
      ].includes(actionId);
      actions.push(
        targeted
          ? { action_id: actionId, target_nation_id: rng.pick(obs.others).id }
          : { action_id: actionId },
      );
    }
    return { nation_id: obs.nationId, turn: obs.turn, public_rationale: rng.pick(RATIONALES.random_baseline), actions };
  },
};

export function mockDecide(obs: MockObservation): AgentResponse {
  const rng = Rng.fromParts(obs.seed, obs.nationId, 'decide', obs.turn);
  const decider = PROFILE_IMPLEMENTATIONS[obs.behavior] ?? PROFILE_IMPLEMENTATIONS['random_baseline'];
  return decider(obs, rng);
}

/**
 * Deterministic narrator fallback: a factual template generated from the
 * validated event log. Used when the narrator model is disabled or fails.
 */
export function deterministicNarrator(
  turn: number,
  events: WorldEvent[],
  before: WorldState,
  after: WorldState,
): NarratorResponse {
  const actionEvents = events.filter((e) => e.type === 'action' && e.status === 'accepted' && e.turn === turn);
  const parts: string[] = [];
  for (const e of actionEvents.slice(0, 6)) {
    const actor = e.actorId ?? 'unknown';
    const target = e.targetId ? ` toward ${e.targetId}` : '';
    parts.push(`${actor} took ${e.actionId}${target}`);
  }
  const tensionMoves = after.events.filter((e) => e.turn === turn && e.relChanges.some((rc) => rc.dimension === 'tension'));
  let summary = `Turn ${turn} (fictional): `;
  summary += parts.length > 0 ? parts.join('; ') + '. ' : 'No substantive actions were recorded. ';
  summary += `Global fictional stability moved from ${before.globalStability.toFixed(1)} to ${after.globalStability.toFixed(1)}.`;
  if (tensionMoves.length > 0) summary += ' Bilateral tensions shifted on several fictional relationships.';

  const relationshipChanges = tensionMoves
    .flatMap((e) => e.relChanges.map((rc) => `${rc.pairKey}: ${rc.dimension} ${rc.before.toFixed(0)}\u2192${rc.after.toFixed(0)}`))
    .slice(0, 5);
  const newDisputes = actionEvents
    .filter((e) => (e.details ?? '').includes('dispute'))
    .map((e) => `Dispute recorded after ${e.actionId}`);

  return { summary, relationship_changes: relationshipChanges, new_disputes: newDisputes, resolved_disputes: [], uncertainties: ['Fictional consequences remain abstract and do not model real-world dynamics.'] };
}
