import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@aiww/schemas';
import { eventKey, isVisualAction, mergeEventSnapshot, orderWorldEvents } from '../src/atlas/events';

function event(overrides: Partial<WorldEvent>): WorldEvent {
  return {
    id: 'ev_0',
    turn: 0,
    seq: 0,
    type: 'system',
    status: 'info',
    stateChanges: [],
    relChanges: [],
    ...overrides,
  };
}

describe('live event ordering and visual eligibility', () => {
  it('preserves (turn, seq) order and deduplicates overlapping snapshots per simulation', () => {
    const prior = event({ id: 'ev_0', turn: 0, seq: 0 });
    const first = event({ id: 'ev_2', turn: 1, seq: 2, type: 'action', status: 'accepted', actionId: 'wait', actorId: 'amber' });
    const second = event({ id: 'ev_1', turn: 1, seq: 1, type: 'action', status: 'accepted', actionId: 'message', actorId: 'cobalt' });

    expect(orderWorldEvents([first, second, prior])).toEqual([prior, second, first]);
    const merged = mergeEventSnapshot('sim-a', [prior], [first, second, prior, first]);
    expect(merged.events).toEqual([prior, second, first]);
    expect(merged.added).toEqual([second, first]);
    expect(eventKey('sim-a', first)).not.toBe(eventKey('sim-b', first));
  });

  it('makes only new accepted action events eligible for illustrative playback', () => {
    const accepted = event({ type: 'action', status: 'accepted', actorId: 'amber', actionId: 'trade_agreement' });
    const rejected = event({ type: 'rejection', status: 'rejected', actorId: 'amber', actionId: 'trade_agreement' });
    const passive = event({ type: 'passive', status: 'accepted', actorId: 'amber' });
    const narrator = event({ type: 'narrator', status: 'info', message: 'Summary' });

    expect(isVisualAction(accepted)).toBe(true);
    expect(isVisualAction(rejected)).toBe(false);
    expect(isVisualAction(passive)).toBe(false);
    expect(isVisualAction(narrator)).toBe(false);
    expect(isVisualAction(event({ type: 'action', status: 'accepted', actionId: 'wait' }))).toBe(false);
  });
});
