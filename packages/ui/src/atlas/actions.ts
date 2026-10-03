/**
 * Metadata-driven visual category for atlas event symbols.
 *
 * Symbols are presentation-only: diplomacy/trade/cyber/military never carry
 * mechanics. Unknown action ids render as 'unknown' instead of silently
 * looking like diplomacy.
 */
export type AtlasEventKind = 'diplomacy' | 'trade' | 'cyber' | 'military' | 'unknown';

const DIPLOMACY_ACTIONS = [
  'high_level_visit',
  'formal_peace_negotiations',
  'international_arbitration',
  'message',
  'public_criticism',
  'cut_diplomatic_relations',
  'form_alliance',
  'share_intelligence',
  'defense_cooperation',
  'supply_weapons',
  'nuclear_disarmament',
  'military_disarmament',
  'acquire_nuclear_option',
] as const;

const TRADE_ACTIONS = [
  'trade_agreement',
  'impose_trade_restrictions',
  'blockade_basic_supplies',
] as const;

const CYBER_ACTIONS = [
  'cyber_attack',
  'increase_cybersecurity',
] as const;

const MILITARY_ACTIONS = [
  'increase_military_capacity',
  'military_exercise',
  'surveillance_drone',
  'occupy_border_city',
  'targeted_attack',
  'full_invasion',
  'tactical_nuclear_strike',
  'full_nuclear_attack',
  'wait',
] as const;

export const ACTION_VISUAL_KIND: Record<string, Exclude<AtlasEventKind, 'unknown'>> = Object.fromEntries([
  ...DIPLOMACY_ACTIONS.map((id) => [id, 'diplomacy'] as const),
  ...TRADE_ACTIONS.map((id) => [id, 'trade'] as const),
  ...CYBER_ACTIONS.map((id) => [id, 'cyber'] as const),
  ...MILITARY_ACTIONS.map((id) => [id, 'military'] as const),
]);

/** All 27 catalog actions must have a declared visual kind. */
export const ACTION_VISUAL_KIND_IDS = Object.keys(ACTION_VISUAL_KIND).sort();

export function classifyAction(actionId: string): AtlasEventKind {
  return ACTION_VISUAL_KIND[actionId] ?? 'unknown';
}

export const ATLAS_EVENT_KIND_LABEL: Record<AtlasEventKind, string> = {
  diplomacy: 'Diplomatic symbol',
  trade: 'Trade symbol',
  cyber: 'Cyber symbol',
  military: 'Military symbol',
  unknown: 'Uncategorized symbol',
};