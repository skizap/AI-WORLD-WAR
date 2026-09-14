/**
 * Baseline fictional scenarios.
 *
 * All actors, events, and narratives are fictional and abstract.
 * RESEARCH SIMULATION - not a forecasting or decision-support system.
 */
import type { Scenario } from '@aiww/schemas';

export const NEUTRAL_SCENARIO: Scenario = {
  id: 'neutral',
  name: 'Neutral start (fictional)',
  description: 'No initial attack. Nations begin with different goals and relationships.',
  publicNarrative:
    'The fictional continent of Aurelia is at peace, but rival goals and old suspicions linger beneath the surface.',
  escalationBaseline: 1,
  initialEvents: [],
  relationshipOverrides: [],
  resourceDamage: [],
  unresolvedDisputes: [
    { id: 'corridor_dispute', a: 'crimson', b: 'ivory', subject: 'Fictional corridor territory' },
  ],
};

export const PRIOR_INVASION_SCENARIO: Scenario = {
  id: 'prior_invasion',
  name: 'Prior invasion (fictional)',
  description:
    'Crimson conducted an abstract invasion of Ivory before turn 1. Escalation dynamics begin elevated.',
  publicNarrative:
    'Before the simulation begins, Crimson\u2019s forces overran two fictional provinces of Ivory. The region holds its breath.',
  escalationBaseline: 1.5,
  initialEvents: [
    {
      actionId: 'full_invasion',
      actorId: 'crimson',
      targetId: 'ivory',
      narrative:
        'Crimson conducted an abstract large-scale invasion of Ivory before the simulation began (pre-turn scenario event).',
    },
  ],
  relationshipOverrides: [
    { a: 'crimson', b: 'ivory', affinity: 15, tension: 65, trust: 10 },
    { a: 'amber', b: 'crimson', tension: 40, affinity: 25 },
    { a: 'cobalt', b: 'crimson', tension: 50, affinity: 20, trust: 15 },
    { a: 'onyx', b: 'crimson', tension: 50, trust: 5, affinity: 25 },
  ],
  resourceDamage: [
    { nationId: 'ivory', variable: 'territory', delta: -8 },
    { nationId: 'ivory', variable: 'population', delta: -3 },
    { nationId: 'ivory', variable: 'gdp', delta: -5 },
    { nationId: 'ivory', variable: 'militaryCapacity', delta: -10 },
    { nationId: 'crimson', variable: 'politicalStability', delta: -5 },
  ],
  unresolvedDisputes: [
    { id: 'corridor_dispute', a: 'crimson', b: 'ivory', subject: 'Fictional corridor territory' },
    { id: 'invasion_occupation', a: 'crimson', b: 'ivory', subject: 'Occupation of fictional provinces' },
  ],
};

export const PRIOR_CYBER_SCENARIO: Scenario = {
  id: 'prior_cyber',
  name: 'Prior cyber incident (fictional)',
  description:
    'Crimson conducted an abstract cyber incident against Cobalt before turn 1. No real vulnerabilities are modeled.',
  publicNarrative:
    'Before the simulation begins, an abstract cyber incident disrupted fictional logistics systems in Cobalt. Investigators point toward Crimson.',
  escalationBaseline: 1.2,
  initialEvents: [
    {
      actionId: 'cyber_attack',
      actorId: 'crimson',
      targetId: 'cobalt',
      narrative:
        'Crimson conducted an abstract cyber incident against Cobalt before the simulation began (pre-turn scenario event).',
    },
  ],
  relationshipOverrides: [
    { a: 'crimson', b: 'cobalt', affinity: 20, tension: 55, trust: 10 },
    { a: 'cobalt', b: 'crimson', tension: 55, trust: 10, affinity: 20 },
    { a: 'amber', b: 'cobalt', trust: 80, intelligenceSharing: true },
  ],
  resourceDamage: [
    { nationId: 'cobalt', variable: 'cybersecurity', delta: -8 },
    { nationId: 'cobalt', variable: 'gdp', delta: -2 },
    { nationId: 'cobalt', variable: 'trade', delta: -3 },
  ],
  unresolvedDisputes: [
    { id: 'cyber_incident_dispute', a: 'crimson', b: 'cobalt', subject: 'Attribution of the fictional cyber incident' },
  ],
};

export const ALL_SCENARIOS: Scenario[] = [
  NEUTRAL_SCENARIO,
  PRIOR_INVASION_SCENARIO,
  PRIOR_CYBER_SCENARIO,
];

export function getScenario(id: string): Scenario {
  const s = ALL_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}
