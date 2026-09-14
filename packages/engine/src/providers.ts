/**
 * Provider interfaces and built-in mock providers.
 *
 * Mock agents produce the same AgentResponse JSON and pass through the same
 * validation/repair/fallback path as real LLM agents. The OpenRouter-backed
 * providers live in the server package and implement the same interfaces.
 */
import type { AgentResponse, NarratorResponse, WorldEvent, WorldState } from '@aiww/schemas';
import type { Observation } from './observation.js';
import { deterministicNarrator, mockDecide } from './mock.js';
import { toMockObservation } from './observation.js';
import type { SimulationConfig } from '@aiww/schemas';
import type { NationProfile } from '@aiww/schemas';

export interface RawEventRef {
  actorId?: string;
  targetId?: string;
  actionId?: string;
  status: string;
  type: string;
}

export interface AgentDecisionContext {
  nationId: string;
  turn: number;
  behavior: string;
  seed: string;
  recentEvents: RawEventRef[];
}

export interface AgentProvider {
  decide(obs: Observation, ctx: AgentDecisionContext): Promise<AgentResponse>;
}

export interface NarratorInput {
  turn: number;
  acceptedEvents: WorldEvent[];
  before: WorldState;
  after: WorldState;
}

export interface NarratorProvider {
  summarize(input: NarratorInput): Promise<NarratorResponse>;
}

/** Seeded deterministic mock agent provider (offline/CI mode). */
export class MockAgentProvider implements AgentProvider {
  async decide(obs: Observation, ctx: AgentDecisionContext): Promise<AgentResponse> {
    const mockObs = toMockObservation(obs, undefined as unknown as SimulationConfig, ctx.behavior, ctx.seed, ctx.recentEvents);
    return mockDecide(mockObs);
  }
}

/** Deterministic narrator (always available; also the validation-failure fallback). */
export class DeterministicNarratorProvider implements NarratorProvider {
  async summarize(input: NarratorInput): Promise<NarratorResponse> {
    return deterministicNarrator(input.turn, input.after.events, input.before, input.after);
  }
}

/** Profile lookup helper: behavior label for a nation. */
export function behaviorFor(profile: NationProfile): string {
  return profile.behavior ?? 'random_baseline';
}
