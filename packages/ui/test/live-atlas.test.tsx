// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEvent, WorldState } from '@aiww/schemas';
import { LiveView } from '../src/views/LiveView';

const atlasAsset = JSON.parse(
  readFileSync(resolve(process.cwd(), 'packages/ui/public/atlas/aurelia-atlas.topo.json'), 'utf8'),
);

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

function world(events: WorldEvent[]): WorldState {
  return {
    turn: 1,
    totalTurns: 4,
    scenarioId: 'neutral',
    seed: 'fixture-seed',
    events,
    nations: {},
  } as unknown as WorldState;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

const historicalAction = event({
  id: 'ev_1',
  turn: 1,
  seq: 1,
  type: 'action',
  status: 'accepted',
  actorId: 'amber',
  targetId: 'cobalt',
  actionId: 'high_level_visit',
  severity: 'de_escalation',
});

const simA = world([historicalAction]);
const simB = world([historicalAction]);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/atlas/aurelia-atlas.topo.json')) return jsonResponse(atlasAsset);
    if (url.endsWith('/api/simulations')) {
      return jsonResponse([
        { id: 'sim-a', status: 'running', turn: 1, totalTurns: 4, scenarioId: 'neutral', provider: 'mock', model: 'mock' },
        { id: 'sim-b', status: 'running', turn: 1, totalTurns: 4, scenarioId: 'neutral', provider: 'mock', model: 'mock' },
      ]);
    }
    if (url.endsWith('/api/simulations/sim-a')) {
      return jsonResponse({ id: 'sim-a', status: 'running', phase: 'agents', turn: 1, totalTurns: 4, world: simA, config: {} });
    }
    if (url.endsWith('/api/simulations/sim-b')) {
      return jsonResponse({ id: 'sim-b', status: 'running', phase: 'agents', turn: 1, totalTurns: 4, world: simB, config: {} });
    }
    return jsonResponse({});
  }) as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  simA.events = [historicalAction];
  simB.events = [historicalAction];
});

describe('Live atlas event playback', () => {
  it('hydrates history without animation, queues only new actions, and resets on simulation change', async () => {
    const { container, rerender } = render(<LiveView simId="sim-a" onPick={vi.fn()} />);
    await screen.findByText(/Amber · high_level_visit/);
    expect(screen.getByText('0 queued')).toBeTruthy();
    expect(container.querySelector('.atlas-event-link')).toBeNull();

    const nextAction = event({
      id: 'ev_2',
      turn: 2,
      seq: 2,
      type: 'action',
      status: 'accepted',
      actorId: 'amber',
      targetId: 'cobalt',
      actionId: 'trade_agreement',
      severity: 'de_escalation',
    });
    const rejected = event({
      id: 'ev_3',
      turn: 2,
      seq: 3,
      type: 'rejection',
      status: 'rejected',
      actorId: 'amber',
      targetId: 'ivory',
      actionId: 'full_invasion',
      reason: 'precondition not met',
    });
    simA.events = [historicalAction, nextAction, rejected];

    expect(await screen.findByText('1 queued', {}, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.atlas-event-link.trade.is-animating')).toBeTruthy());
    expect(screen.getByText(/precondition not met/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause visuals' }));
    rerender(<LiveView simId="sim-b" onPick={vi.fn()} />);
    await screen.findByText(/Amber · high_level_visit/);
    await waitFor(() => expect(screen.getByText('0 queued')).toBeTruthy());
    expect(container.querySelector('.atlas-event-link')).toBeNull();
  });
});
