// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationConfig, WorldState } from '@aiww/schemas';
import { ReplayView } from '../src/views/ReplayView';

const config = {
  seed: 'replay-seed',
  fictionPackId: 'baseline_8',
} as SimulationConfig;

const currentWorld = {
  turn: 2,
  totalTurns: 2,
  nations: {},
  events: [],
} as unknown as WorldState;

const replayResponse = {
  turn: 1,
  before: null,
  after: { turn: 1, nations: {} } as unknown as WorldState,
  events: [],
  reRunConfig: config,
};

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/simulations/sim-a')) {
      return jsonResponse({
        id: 'sim-a', status: 'completed', phase: 'complete', stopReason: null,
        turn: 2, totalTurns: 2, world: currentWorld, config,
      });
    }
    if (url.includes('/api/simulations/sim-a/replay?turn=')) return jsonResponse(replayResponse);
    if (url === '/api/simulations' && init?.method === 'POST') return jsonResponse({ id: 'sim-b', status: 'idle' });
    return jsonResponse({});
  }) as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('replay rerun flow', () => {
  it('confirms in-app and offers to open a separately created simulation', async () => {
    const onOpenSimulation = vi.fn();
    render(<ReplayView simId="sim-a" onOpenSimulation={onOpenSimulation} />);

    const rerunButton = await screen.findByRole('button', { name: 'Re-run from seed' });
    await waitFor(() => expect(rerunButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(rerunButton);
    expect(screen.getByRole('group', { name: /Create a separate simulation from the seed/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create separate simulation' }));

    const openButton = await screen.findByRole('button', { name: 'Open in Live' });
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Separate simulation sim-b created'))).toBe(true);
    fireEvent.click(openButton);
    expect(onOpenSimulation).toHaveBeenCalledWith('sim-b');
  });
});
