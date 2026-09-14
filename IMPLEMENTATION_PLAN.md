# AI-WORLD-WAR — Implementation Plan (tracking file)

**Status legend:** [ ] todo · [~] in progress · [x] done

RESEARCH SIMULATION — fictional nations only. Not a forecasting or decision-support system.

## Stack (user-approved)

- Full TypeScript npm-workspaces monorepo
- Frontend: React + TypeScript + Vite + Recharts + custom accessible CSS
- Backend: Node.js + Fastify; SQLite via `node:sqlite` (built into Node >= 22.5) behind a repository interface
- Shared Zod schemas (`packages/schemas`) across engine / API / UI
- LLM: OpenRouter REST gateway (`https://openrouter.ai/api/v1`) + deterministic mock provider
- Tests: Vitest (unit + integration), fast-check (property-based), React Testing Library (UI smoke)

## Phases

1. [x] Root workspace scaffolding (package.json, tsconfig, .env.example, git init)
2. [x] `packages/schemas` — shared Zod domain model (nations, world state, config, actions, agent/narrator responses, metrics, experiments)
3. [x] `packages/engine` — deterministic simulation core:
   - 8-nation fictional pack (Amber, Cobalt, Crimson, Ivory, Jade, Mauve, Onyx, Saffron)
   - 27-action catalog (declarative data registry, versioned) with severity, preconditions, effects
   - 3 baseline scenarios (neutral / prior invasion / prior cyber incident)
   - Seeded RNG, bounded variables + clamping, relationship engine, passive mechanics
   - Turn loop with documented resolution order, human-approval gate hooks
   - Escalation scoring schemes (default 2^x−4 ladder, linear, exponential, firebreak, custom)
   - Metrics computation, deterministic seeded mock agents + deterministic narrator fallback
4. [x] `packages/prompts` — versioned prompt template files (nation agent system, observation, narrator, repair)
5. [x] `packages/server` — Fastify API, SQLite persistence, simulation job lifecycle
   (start/pause/resume/step/stop/approve/reject), batch experiment runner,
   OpenRouterClient (retries/backoff/rate limits/token accounting/catalog caching/capability fallback)
6. [x] `packages/ui` — dashboard: setup, live simulation, nation detail, analytics, replay
7. [x] Docs: README, ARCHITECTURE, SAFETY, RESEARCH_NOTES, CONFIGURATION, API, PROMPTS, LIMITATIONS
8. [x] Tests: engine unit + property (fast-check), server integration, UI smoke
9. [x] Verification: full mock 14-turn run, deterministic replay check, UI build, all tests green

## Verification commands

```
npm install
npm test          # vitest: engine, server, ui suites
npm run typecheck
npm run demo      # offline 8-nation x 14-turn mock simulation via CLI
npm run dev       # server on :8787 + UI on :5173
```
