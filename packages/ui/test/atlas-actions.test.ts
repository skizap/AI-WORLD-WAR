import { describe, expect, it } from 'vitest';
import { ACTION_VISUAL_KIND, ACTION_VISUAL_KIND_IDS, ATLAS_EVENT_KIND_LABEL, classifyAction } from '../src/atlas/actions';

describe('atlas visual action categories', () => {
  it('declares a visual kind for every one of the 27 catalog actions', () => {
    expect(ACTION_VISUAL_KIND_IDS).toHaveLength(27);
    expect(new Set(ACTION_VISUAL_KIND_IDS).size).toBe(27);
  });

  it('maps known actions to their declared category', () => {
    expect(classifyAction('cyber_attack')).toBe('cyber');
    expect(classifyAction('trade_agreement')).toBe('trade');
    expect(classifyAction('full_invasion')).toBe('military');
    expect(classifyAction('high_level_visit')).toBe('diplomacy');
    expect(classifyAction('blockade_basic_supplies')).toBe('trade');
  });

  it('returns unknown for unrecognized ids instead of defaulting to diplomacy', () => {
    expect(classifyAction('totally_unknown_action')).toBe('unknown');
    expect(ATLAS_EVENT_KIND_LABEL.unknown).toMatch(/uncategorized/i);
  });

  it('keeps every declared kind inside the supported label table', () => {
    for (const id of ACTION_VISUAL_KIND_IDS) {
      const kind = ACTION_VISUAL_KIND[id];
      expect(ATLAS_EVENT_KIND_LABEL[kind as keyof typeof ATLAS_EVENT_KIND_LABEL]).toBeDefined();
    }
  });
});