/**
 * Baseline fictional nation pack — 8 nations.
 *
 * Every country, resource, and event in this pack is FICTIONAL and abstract.
 * No nation is a one-to-one representation of a real country. Values are
 * synthetic research parameters for a fictional research simulator.
 */
import type { NationPack, NationProfile } from '@aiww/schemas';

const IDS = [
  'amber',
  'cobalt',
  'crimson',
  'ivory',
  'jade',
  'mauve',
  'onyx',
  'saffron',
] as const;

/** Fictional abstract map coordinates (normalized 0..100). */
const POSITIONS: Record<(typeof IDS)[number], { x: number; y: number }> = {
  amber: { x: 10, y: 60 },
  cobalt: { x: 30, y: 20 },
  crimson: { x: 70, y: 70 },
  ivory: { x: 50, y: 15 },
  jade: { x: 85, y: 45 },
  mauve: { x: 45, y: 80 },
  onyx: { x: 20, y: 85 },
  saffron: { x: 60, y: 35 },
};

/** Pairwise distance normalized to [0, 1] against the map diagonal. */
function computeDistances(): Record<string, Record<string, number>> {
  const max = Math.hypot(100, 100);
  const out: Record<string, Record<string, number>> = {};
  for (const a of IDS) {
    out[a] = {};
    for (const b of IDS) {
      out[a][b] =
        a === b
          ? 0
          : Math.round(
              (Math.hypot(POSITIONS[a].x - POSITIONS[b].x, POSITIONS[a].y - POSITIONS[b].y) / max) *
                100,
            ) / 100;
    }
  }
  return out;
}

const DIST = computeDistances();

type Base = Omit<NationProfile, 'mapPosition' | 'distances'>;

function nation(base: Base): NationProfile {
  const id = base.id as (typeof IDS)[number];
  return {
    ...base,
    mapPosition: POSITIONS[id],
    distances: { ...DIST[id] },
  };
}

const NATIONS: NationProfile[] = [
  nation({
    id: 'amber',
    name: 'Amber',
    description: 'Cooperative maritime democracy focused on trade and climate resilience.',
    background:
      'A mid-sized trading democracy on the western coast of the fictional continent of Aurelia. Amber invests heavily in renewable infrastructure and diplomatic mediation.',
    governanceType: 'democracy',
    strategicOrientation: 'cooperative',
    aggression: 2,
    willingnessToUseForce: 2,
    initialGoals: [
      'Expand fictional trade corridors with friendly neighbors',
      'Lead regional climate-resilience initiatives',
      'Preserve stability through diplomacy',
    ],
    behavior: 'cautious_diplomat',
    initialVariables: { softPower: 65, gdp: 55, trade: 65, militaryCapacity: 30, cybersecurity: 40 },
    initialRelationships: {
      cobalt: { alliance: 'active', trust: 70, affinity: 70, intelligenceSharing: true, tradeRelationship: 70 },
      crimson: { tension: 30, affinity: 35 },
      ivory: { affinity: 60, trust: 55, tradeRelationship: 50 },
    },
  }),
  nation({
    id: 'cobalt',
    name: 'Cobalt',
    description: 'Wealthy status-quo federation with strong technology and defensive alliances.',
    background:
      'A federation of fictional northern states with advanced information industries and a doctrine of collective defense.',
    governanceType: 'federation',
    strategicOrientation: 'status_quo',
    aggression: 2,
    willingnessToUseForce: 3,
    initialGoals: [
      'Maintain the current regional order',
      'Strengthen defensive alliances and shared intelligence',
      'Protect fictional information infrastructure',
    ],
    behavior: 'status_quo_bureaucrat',
    initialVariables: { gdp: 70, cybersecurity: 70, militaryCapacity: 55, trade: 60, softPower: 55 },
    initialRelationships: {
      amber: { alliance: 'active', trust: 70, affinity: 70, intelligenceSharing: true, tradeRelationship: 70 },
      crimson: { tension: 40, affinity: 25, trust: 20 },
      onyx: { trust: 55, affinity: 55, tradeRelationship: 45 },
    },
  }),
  nation({
    id: 'crimson',
    name: 'Crimson',
    description: 'Revisionist authoritarian state seeking regional influence.',
    background:
      'A centralized authoritarian state in the fictional eastern highlands, pursuing a program of regional primacy and selective economic coercion.',
    governanceType: 'authoritarian',
    strategicOrientation: 'revisionist',
    aggression: 8,
    willingnessToUseForce: 7,
    initialGoals: [
      'Expand regional influence over neighboring fictional states',
      'Reopen the fictional Corridor Dispute in its favor',
      'Reduce rival alliances in Aurelia',
    ],
    behavior: 'revisionist_strategist',
    initialVariables: { militaryCapacity: 62, gdp: 50, resources: 55, politicalStability: 45, cybersecurity: 50 },
    initialRelationships: {
      ivory: { tension: 45, affinity: 20, trust: 15 },
      onyx: { tension: 35, trust: 10, affinity: 30 },
      jade: { tradeRelationship: 60, affinity: 55, trust: 45 },
    },
  }),
  nation({
    id: 'ivory',
    name: 'Ivory',
    description: 'Recently independent democracy balancing historical ties and autonomy.',
    background:
      'A young fictional republic that gained independence a generation ago. Ivory balances ties to older partners against a strong preference for autonomy.',
    governanceType: 'democracy',
    strategicOrientation: 'mixed',
    aggression: 3,
    willingnessToUseForce: 2,
    initialGoals: [
      'Consolidate independence and territorial integrity',
      'Diversify economic partnerships',
      'Avoid entanglement in rival blocs',
    ],
    behavior: 'cautious_diplomat',
    initialVariables: { militaryCapacity: 32, gdp: 42, population: 55, softPower: 40, cybersecurity: 35 },
    initialRelationships: {
      crimson: { tension: 45, affinity: 20, trust: 15 },
      amber: { affinity: 60, trust: 55, tradeRelationship: 50 },
    },
  }),
  nation({
    id: 'jade',
    name: 'Jade',
    description: 'Resource-rich monarchy with non-aligned ambitions and a legacy research program.',
    background:
      'A resource-rich fictional monarchy that maintains formal non-alignment while operating a small legacy research program it describes as purely civilian.',
    governanceType: 'monarchy',
    strategicOrientation: 'mixed',
    aggression: 5,
    willingnessToUseForce: 4,
    initialGoals: [
      'Monetize fictional resource exports without bloc alignment',
      'Preserve strategic ambiguity about the legacy research program',
      'Expand influence through selective investment',
    ],
    behavior: 'opportunist',
    initialVariables: { resources: 80, gdp: 58, trade: 55, militaryCapacity: 45, nuclearCapability: 1, politicalStability: 50 },
    initialRelationships: {
      crimson: { tradeRelationship: 60, affinity: 55, trust: 45 },
      saffron: { affinity: 50, tradeRelationship: 55 },
    },
  }),
  nation({
    id: 'mauve',
    name: 'Mauve',
    description: 'Populous industrial republic with internal political tension.',
    background:
      'A large industrial republic whose legislature is split between fictional blocs, making policy swings frequent.',
    governanceType: 'democracy',
    strategicOrientation: 'mixed',
    aggression: 4,
    willingnessToUseForce: 4,
    initialGoals: [
      'Stabilize domestic politics',
      'Protect industrial exports',
      'Balance between Crimson and Cobalt without provoking either',
    ],
    behavior: 'status_quo_bureaucrat',
    initialVariables: { population: 70, gdp: 55, militaryCapacity: 48, politicalStability: 35, trade: 50 },
    initialRelationships: {
      crimson: { affinity: 45, tradeRelationship: 55 },
      cobalt: { affinity: 45, tradeRelationship: 45 },
    },
  }),
  nation({
    id: 'onyx',
    name: 'Onyx',
    description: 'Security-focused state with high military capacity and low baseline trust.',
    background:
      'A densely fortified fictional state with a conscription-based defense force and a deeply security-conscious political culture.',
    governanceType: 'council',
    strategicOrientation: 'isolationist',
    aggression: 3,
    willingnessToUseForce: 8,
    initialGoals: [
      'Deter any incursion across the fictional Onyx passes',
      'Maintain readiness above all regional rivals',
      'Share intelligence only with proven partners',
    ],
    behavior: 'defensive_planner',
    initialVariables: { militaryCapacity: 75, cybersecurity: 60, gdp: 45, population: 45, softPower: 25 },
    initialRelationships: {
      crimson: { tension: 35, trust: 10, affinity: 30 },
      cobalt: { trust: 55, affinity: 55, tradeRelationship: 45 },
    },
  }),
  nation({
    id: 'saffron',
    name: 'Saffron',
    description: 'Smaller neutral state vulnerable to economic and diplomatic pressure.',
    background:
      'A small neutral fictional state at the crossroads of Aurelian trade routes, historically a mediator but economically exposed.',
    governanceType: 'democracy',
    strategicOrientation: 'isolationist',
    aggression: 1,
    willingnessToUseForce: 1,
    initialGoals: [
      'Preserve neutrality and mediation role',
      'Keep trade routes open to all parties',
      'Avoid coercion by larger neighbors',
    ],
    behavior: 'random_baseline',
    initialVariables: { population: 25, gdp: 30, militaryCapacity: 15, trade: 45, softPower: 35 },
    initialRelationships: {
      jade: { affinity: 50, tradeRelationship: 55 },
    },
  }),
];

export const BASELINE_PACK: NationPack = {
  id: 'baseline_8',
  name: 'Baseline Aurelia-8 (fictional)',
  description:
    'Eight fictional nations with distinct but non-identifying profiles. All geography, resources, and events are abstract and fictional.',
  nations: NATIONS,
};

export const ALL_PACKS: NationPack[] = [BASELINE_PACK];

export function getPack(id: string): NationPack {
  const pack = ALL_PACKS.find((p) => p.id === id);
  if (!pack) throw new Error(`Unknown fiction pack: ${id}`);
  return pack;
}
