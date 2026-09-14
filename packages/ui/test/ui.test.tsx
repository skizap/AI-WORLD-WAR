// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';
import { App } from '../src/App';
import { afterEach } from 'vitest';

const META = {
  notice: 'RESEARCH SIMULATION with FICTIONAL nations.',
  codeVersion: '0.1.0',
  promptVersion: '1.0.0',
  catalogVersion: 1,
  defaultProvider: 'mock',
  openRouterKeyConfigured: false,
  defaultConfig: {
    name: 'Paper-inspired baseline',
    seed: 'aiww-0',
    scenarioId: 'neutral',
    fictionPackId: 'baseline_8',
    totalTurns: 14,
    provider: 'mock',
    models: { nationAgent: 'openai/gpt-4o-mini', worldNarrator: 'openai/gpt-4o-mini', repair: 'openai/gpt-4o-mini' },
    temperature: 0.7,
    maxTokens: 1024,
    observation: { includeHistory: true, includeGoals: true, includeMessages: true, stateMode: 'full', severityVisibility: 'hidden', framing: 'neutral' },
    limits: { nonMessagePerTurn: 3, messagePerTurn: 4, maxMessageLength: 280, maxRationaleLength: 1000, allowDuplicates: false },
    approvalPolicy: 'severe',
    scoring: { scheme: 'default' },
    narratorEnabled: true,
    passiveRulesEnabled: true,
    turnOrderMode: 'seeded_shuffle',
    stopConditions: { populationCollapseThreshold: 10, maxViolentActionsPerTurn: 6, globalStabilityFloor: 5 },
    safetyMode: 'fictional_only',
  },
  packs: [{ id: 'baseline_8', name: 'Baseline Aurelia-8 (fictional)', description: 'd', nations: [] }],
  scenarios: [{ id: 'neutral', name: 'Neutral start (fictional)', description: 'd', publicNarrative: 'n', escalationBaseline: 1 }],
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
  it('renders the safety notice, tabs, and gates creation behind the acknowledgment', async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/RESEARCH SIMULATION with FICTIONAL nations/));
    expect(screen.getByRole('button', { name: 'Setup' })).toBeTruthy();
    // Create button is disabled until the safety checkbox is ticked.
    const createBtn = await waitFor(() => screen.getByRole('button', { name: /Create simulation/ })) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    fireEvent.click(screen.getAllByLabelText(/fictional research simulation/i)[0]);
    expect(createBtn.disabled).toBe(false);
  });

  it('renders tab navigation across all five views', async () => {
    render(<App />);
    await waitFor(() => screen.getAllByRole('button', { name: 'Replay' }).length > 0);
    for (const tab of ['Setup', 'Live', 'Nations', 'Analytics', 'Replay']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy();
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
