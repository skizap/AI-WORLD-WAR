// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '@aiww/schemas';
import { AtlasMap } from '../src/atlas/AtlasMap';

const atlasAsset = JSON.parse(
  readFileSync(resolve(process.cwd(), 'packages/ui/public/atlas/aurelia-atlas.topo.json'), 'utf8'),
);

const acceptedEvent: WorldEvent = {
  id: 'ev_1',
  turn: 1,
  seq: 1,
  type: 'action',
  status: 'accepted',
  actorId: 'amber',
  targetId: 'cobalt',
  actionId: 'trade_agreement',
  severity: 'de_escalation',
  stateChanges: [],
  relChanges: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => atlasAsset,
  }) as Response));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('interactive atlas', () => {
  it('renders all regions and focuses a fictional alias from search', async () => {
    const { container } = render(<AtlasMap event={null} onViewNation={vi.fn()} />);
    await screen.findByRole('group', { name: /Interactive map of fictional regions/ });

    expect(container.querySelectorAll('.atlas-region[role="button"]')).toHaveLength(242);
    const search = screen.getByRole('combobox', { name: 'Find a region' });
    fireEvent.change(search, { target: { value: 'Norliseon' } });
    fireEvent.submit(search.closest('form')!);

    expect(await screen.findByRole('heading', { name: 'Norliseon' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Amber nation detail' })).toBeTruthy();
    expect(screen.getByText(/Earth-derived boundary reference/)).toBeTruthy();
  });

  it('shows a symbolic trade link only for accepted action events', async () => {
    const { container, rerender } = render(<AtlasMap event={acceptedEvent} onViewNation={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.atlas-event-link.trade')).toBeTruthy());
    expect(container.textContent).toContain('map effects remain illustrative');

    rerender(<AtlasMap event={{ ...acceptedEvent, status: 'rejected', type: 'rejection' }} onViewNation={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.atlas-event-link')).toBeNull());
  });
});
