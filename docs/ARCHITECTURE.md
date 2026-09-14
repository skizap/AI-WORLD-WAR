# Architecture

RESEARCH SIMULATION — fictional nations and synthetic research parameters only.

## Component overview

```text
┌──────────────────────────────────────────────────────────────┐
│                       packages/ui (React)                    │
│  Setup · Live · Nations · Analytics · Replay (Vite + Recharts)│
└───────────────────────────────┬──────────────────────────────┘
                                │ /api (HTTP)
┌───────────────────────────────▼──────────────────────────────┐
│                      packages/server (Fastify)               │
│  RunnerManager (job lifecycle) · ExperimentManager (batch)   │
│  OpenRouterClient (LLM gateway) · LLM providers + prompts    │
│  Db (SQLite via node:sqlite, repository-style)               │
└───────────────────────────────┬──────────────────────────────┘
                                │ in-process interfaces
┌───────────────────────────────▼──────────────────────────────┐
│                      packages/engine (pure TS)               │
│  Simulation turn loop · validation · transitions · scoring   │
│  metrics · observation · mock providers · data registry      │
│  (27-action catalog, 8-nation pack, 3 scenarios)             │
└───────────────────────────────┬──────────────────────────────┘
                                │ shared types
┌───────────────────────────────▼──────────────────────────────┐
│        packages/schemas (Zod) · packages/prompts (files)     │
└──────────────────────────────────────────────────────────────┘
```

## Data flow of one turn

1. **Turn order** fixed at initialization (seeded shuffle or pack order).
2. **Observation** built per nation from `WorldState` under the configured
   ablations (history on/off, goals on/off, messages on/off, full state vs
   deltas, severity hidden/exposed, neutral vs low-stakes framing).
3. **Agent provider** (mock or OpenRouter) returns strict JSON.
4. **Validation**: schema → nation match → known action ids → target rules →
   duplicates → limits → message/content rules → parameters. Invalid items are
   rejected with reasons; a fully invalid response gets one deterministic
   repair attempt (mock: JSON extraction; LLM: repair model) and then a safe
   `wait` fallback — always audited.
5. **Approval gate**: severe actions (per policy) pause the run as
   `awaiting_approval`; the human approves/rejects; rejections are recorded as
   events and dropped.
6. **Resolution** in fixed phase order (diplomatic → economic → military),
   by turn-order rank within each phase. Preconditions are re-checked against
   current state; failures are recorded as rejections. Effects apply through
   `applyEffects()` only — clamped, before/after recorded, audited.
7. **Second-order reactions** (alliance solidarity, extra trust collapse).
8. **Passive mechanics** (growth/decay/recovery/ongoing effects/alliance
   maintenance), then global clamp.
9. **Narrator** (LLM or deterministic fallback) summarizes validated deltas;
   a narrator failure can never corrupt state.
10. **Snapshot + metrics** persisted; **stop conditions** evaluated.

## Determinism

- All randomness flows through `Rng.fromParts(seed, context...)` (mulberry32).
- Event/audit ids derive from world-state array lengths, not global counters.
- Model call order never affects outcomes: all actions are validated against
  turn-start state and resolved in the documented order.
- Same seed + config in mock mode ⇒ byte-identical replay (property-tested).

## Persistence

SQLite (node:sqlite) tables: `simulations`, `snapshots` (full world JSON per
turn), `events`, `actions`, `decisions`, `narrator`, `approvals`, `metrics`,
`llm_calls` (telemetry only — no secrets, no raw prompts), `experiments`,
`audit`. The `Db` class is a repository-style seam; a PostgreSQL implementation
can replace it without touching the engine.

## Turn-order semantics

Configurable: `seeded_shuffle` (default) or `fixed_pack_order`. Within a phase,
nations act in the fixed turn-order rank; the model call order is irrelevant to
outcomes.
