/** Typed fetch helpers for the AI-WORLD-WAR API. */
import type { RunMetrics, SimulationConfig, WorldEvent, WorldState } from '@aiww/schemas';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface Meta {
  notice: string;
  codeVersion: string;
  promptVersion: string;
  catalogVersion: number;
  defaultConfig: SimulationConfig;
  defaultProvider: 'mock' | 'openrouter';
  openRouterKeyConfigured: boolean;
  packs: { id: string; name: string; description: string; nations: { id: string; name: string; description: string; governanceType: string; strategicOrientation: string; behavior?: string; mapPosition: { x: number; y: number }; goals: string[] }[] }[];
  scenarios: { id: string; name: string; description: string; publicNarrative: string; escalationBaseline: number }[];
  actions: { id: string; description: string; requiresTarget: boolean; targetOptional: boolean; messageAllowed: boolean; phase: string; humanApprovalRequired: boolean; severityHiddenFromAgents: string }[];
  severityTable: { note: string; default: Record<string, number> };
}

export const api = {
  meta: () => req<Meta>('/meta'),
  health: () => req<{ configured: boolean; ok: boolean; detail: string }>('/openrouter/health'),
  models: () => req<{ count: number; models: { id: string; name?: string; contextLength?: number; pricing?: Record<string, string> }[] }>('/openrouter/models'),
  createSimulation: (config: Partial<SimulationConfig>) =>
    req<{ id: string; status: string }>('/simulations', { method: 'POST', body: JSON.stringify(config) }),
  listSimulations: () =>
    req<{ id: string; status: string; turn: number; totalTurns: number; scenarioId: string; provider: string; model: string }[]>('/simulations'),
  getSimulation: (id: string) =>
    req<{ id: string; status: string; phase: string; stopReason: string | null; turn: number; totalTurns: number; world: WorldState; config: SimulationConfig }>(`/simulations/${id}`),
  control: (id: string, action: 'start' | 'pause' | 'resume' | 'stop' | 'step') =>
    req<{ id: string; status: string }>(`/simulations/${id}/${action}`, { method: 'POST' }),
  approve: (id: string, key: string, approve: boolean) =>
    req<{ id: string; key: string; approved: boolean; status: string }>(`/simulations/${id}/approvals/${key}`, { method: 'POST', body: JSON.stringify({ approve }) }),
  metrics: (id: string) => req<RunMetrics>(`/simulations/${id}/metrics`),
  events: (id: string, fromTurn = 0) => req<WorldEvent[]>(`/simulations/${id}/events?fromTurn=${fromTurn}`),
  nation: (id: string, nid: string) =>
    req<{ profile: { id: string; name: string; description: string; background: string; governanceType: string; strategicOrientation: string; aggression: number; willingnessToUseForce: number; initialGoals: string[] }; history: { turn: number; variables: Record<string, number> }[]; current: { variables: Record<string, number>; lastDelta: Record<string, number> } | undefined; actions: WorldEvent[] }>(`/simulations/${id}/nations/${nid}`),
  replay: (id: string, turn: number) =>
    req<{ turn: number; before: WorldState | null; after: WorldState; events: WorldEvent[]; narrator?: { turn: number; summary: string; source: string }; reRunConfig: SimulationConfig }>(`/simulations/${id}/replay?turn=${turn}`),
  exportCsv: (id: string) => fetch(`${BASE}/simulations/${id}/export?format=csv`),
  exportJson: (id: string) => fetch(`${BASE}/simulations/${id}/export`),
  runExperiment: (spec: unknown) => req<unknown>('/experiments', { method: 'POST', body: JSON.stringify(spec) }),
};

export const VARIABLE_LABELS: Record<string, string> = {
  militaryCapacity: 'Military capacity',
  gdp: 'GDP (synthetic)',
  trade: 'Trade',
  resources: 'Resources',
  politicalStability: 'Political stability',
  population: 'Population (synthetic)',
  softPower: 'Soft power',
  cybersecurity: 'Cybersecurity',
  nuclearCapability: 'Nuclear capability (abstract)',
  territory: 'Territory',
};

export const SEVERITY_COLOR: Record<string, string> = {
  de_escalation: 'var(--ok)',
  status_quo: 'var(--muted)',
  posturing: 'var(--warn)',
  non_violent_escalation: '#ff9d5c',
  violent_escalation: 'var(--danger)',
  nuclear_escalation: 'var(--nuclear)',
};

export const SEVERITY_TEXT: Record<string, string> = {
  de_escalation: 'De-escalation',
  status_quo: 'Status quo',
  posturing: 'Posturing',
  non_violent_escalation: 'Non-violent escalation',
  violent_escalation: 'Violent escalation',
  nuclear_escalation: 'Nuclear escalation',
};
