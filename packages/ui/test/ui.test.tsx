// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';
import { App } from '../src/App';
import { api } from '../src/api';
import { afterEach } from 'vitest';

const META = {
  notice: 'RESEARCH SIMULATION with fictional nation identities, actions, and outcomes. This is not a forecasting or decision-support system.',
  codeVersion: '0.3.0',
  promptVersion: '1.1.0',
  catalogVersion: 3,
  defaultProvider: 'mock',
  openRouterKeyConfigured: false,
  defaultConfig: {
    name: 'Paper-inspired baseline',
    seed: 'aiww-0',
    scenarioId: 'neutral',
    fictionPackId: 'baseline_8',
    totalTurns: 14,
    provider: 'mock',
    models: { nationAgent: 'openai/gpt-4o-mini', nationAgents: {}, worldNarrator: 'openai/gpt-4o-mini', repair: 'openai/gpt-4o-mini' },
    temperature: 0.7,
    maxTokens: 1024,
    observation: { includeHistory: true, includeGoals: true, stateMode: 'full', severityVisibility: 'hidden', framing: 'neutral', includeNarratorSummaries: false },
    limits: { nonMessagePerTurn: 3, messagePerTurn: 4, maxMessageLength: 280, maxRationaleLength: 1000, allowDuplicates: false },
    scoring: { scheme: 'default' },
    narratorEnabled: true,
    passiveRulesEnabled: true,
    turnOrderMode: 'seeded_shuffle',
    stopConditions: { populationCollapseThreshold: 10, maxViolentActionsPerTurn: 6, globalStabilityFloor: 5 },
    safetyMode: 'fictional_only',
  },
  packs: [{
    id: 'baseline_8', name: 'Baseline Aurelia-8 (fictional)', description: 'Eight fictional nations at a calm baseline.',
    nations: ['amber', 'cobalt', 'crimson', 'ivory', 'jade', 'mauve', 'onyx', 'saffron'].map((id) => ({
      id, name: id[0].toUpperCase() + id.slice(1), description: 'd', governanceType: 'democracy',
      strategicOrientation: 'mixed', mapPosition: { x: 0, y: 0 }, goals: [],
    })),
  }],
  scenarios: [{ id: 'neutral', name: 'Neutral start (fictional)', description: 'Eight nations at baseline relations.', publicNarrative: 'n' }],
  actions: [],
  severityTable: { note: 'n', default: {} },
};

afterEach(cleanup);

beforeEach(() => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/meta')) {
      return { ok: true, json: async () => META } as Response;
    }
    if (String(url).includes('/simulations')) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('UI smoke checks', () => {
  it('does not declare JSON for bodyless simulation controls', async () => {
    await api.control('sim-test', 'start');
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('declares JSON when a request has a JSON body', async () => {
    await api.createSimulation({ seed: 'header-test' });
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(init?.body).toBe(JSON.stringify({ seed: 'header-test' }));
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('renders the simulation notice and creates without a blocking acknowledgment', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/RESEARCH SIMULATION with fictional nation identities/)); // canonical meta.notice
    expect(screen.getByRole('tab', { name: 'Setup' })).toBeTruthy();
    const createBtn = await waitFor(() => screen.getByRole('button', { name: /Create simulation/ })) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Apply to all nations/ })).toBeTruthy();
    expect(screen.getByLabelText('Amber model')).toBeTruthy();
    expect(screen.getByLabelText('Saffron model')).toBeTruthy();
  });

  it('shows scenario/pack descriptions, threshold semantics, and the effective run summary', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Eight nations at baseline relations\./));
    expect(screen.getByText(/Scenario relationship overrides take precedence over the pack baseline/)).toBeTruthy();
    expect(screen.getByText(/BELOW this value/)).toBeTruthy(); // population threshold direction
    expect(screen.getByText(/MORE than this many accepted violent/)).toBeTruthy(); // violent stop semantics
    expect(screen.getByText(/Effective run:/)).toBeTruthy();
    expect(screen.getByText(/Estimated model requests/)).toBeTruthy();
  });

  it('exposes editable custom scoring weights only for the custom scheme', async () => {
    render(<App />);
    await waitFor(() => screen.getByRole('button', { name: /Create simulation/ }));
    expect(screen.queryByLabelText('Nuclear escalation', { selector: 'input' })).toBeNull();
    const scheme = screen.getByLabelText('Scoring scheme') as HTMLSelectElement;
    scheme.value = 'custom';
    scheme.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => screen.getByLabelText('Nuclear escalation', { selector: 'input' }));
    expect(screen.getByLabelText('De-escalation', { selector: 'input' })).toBeTruthy();
  });

  it('renders tab navigation across all five views', async () => {
    render(<App />);
    await waitFor(() => screen.getAllByRole('tab', { name: 'Replay' }).length > 0);
    for (const tab of ['Setup', 'Live', 'Nations', 'Analytics', 'Replay']) {
      expect(screen.getByRole('tab', { name: tab })).toBeTruthy();
    }
  });
});

describe('charts render with empty, small, and large datasets', () => {
  const harness = (points: number) =>
    Array.from({ length: points }, (_, i) => ({ turn: i + 1, meanScore: (i % 7) * 3 }));

  it('empty dataset renders an svg without crashing', () => {
    const { container } = render(
      <LineChart width={400} height={200} data={[]}>
        <XAxis dataKey="turn" />
        <YAxis />
        <Line dataKey="meanScore" />
      </LineChart>,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('small dataset (5 points) renders paths', () => {
    const { container } = render(
      <LineChart width={400} height={200} data={harness(5)}>
        <XAxis dataKey="turn" />
        <YAxis />
        <Line dataKey="meanScore" />
      </LineChart>,
    );
    expect(container.querySelectorAll('path.recharts-line-curve').length).toBeGreaterThan(0);
  });

  it('large dataset (200 points) renders paths', () => {
    const { container } = render(
      <LineChart width={400} height={200} data={harness(200)}>
        <XAxis dataKey="turn" />
        <YAxis />
        <Line dataKey="meanScore" />
      </LineChart>,
    );
    expect(container.querySelectorAll('path.recharts-line-curve').length).toBeGreaterThan(0);
  });
});
