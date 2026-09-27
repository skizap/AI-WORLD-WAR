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

1. **Turn order** is fixed at initialization (seeded shuffle or pack order).
2. **Observation** built per nation from `WorldState` under the configured
   ablations (`observation.includeHistory`, `includeGoals`, `stateMode:
   full|deltas`, `severityVisibility`, `framing`, `includeNarratorSummaries`).
   `observation.includeMessages` is accepted by the config schema but is not
   read anywhere yet: messages are never included in observations.
3. **Agent provider** (mock or OpenRouter) returns strict JSON.
4. **Validation** (`packages/engine/src/validation.ts`) runs in this order:
   response schema → nation match → turn match → disallowed-content scan of
   `action_id` → known action id → target rules → duplicate policy → message
   rules (field allowed, length, content) → unsupported parameters → per-turn
   count limits. Invalid items are rejected with reasons. OpenRouter output
   gets one deterministic repair attempt (fence-stripping/field coercion),
   then one repair-model call. A provider or validation failure becomes an
   explicit missing decision for that nation and turn — never a fabricated
   `wait` choice.
5. **Resolution** runs autonomously in fixed phase order (diplomatic →
   economic → military), by turn-order rank within each phase. Preconditions
   are re-checked against current state; failures are recorded as rejections.
   Effects apply through `applyEffects()` only — clamped, before/after
   recorded, audited.
6. **Second-order reactions** (alliance solidarity, extra trust collapse).
7. **Passive mechanics** (growth/decay/recovery/ongoing effects/alliance
   maintenance), then global clamp.
8. **Narrator** (LLM or deterministic fallback) summarizes validated deltas;
   a narrator failure can never corrupt state. Narrator prose is display-only
   by default and is fed back only in the explicit
   `includeNarratorSummaries` ablation.
9. **Snapshot + metrics**: the engine records a snapshot per turn in memory
   and exposes `computeMetrics()`; the server runner persists snapshots and
   metrics to SQLite and evaluates **stop conditions**.

## Determinism

- All randomness flows through `Rng.fromParts(seed, context...)` (mulberry32).
- Event/audit ids derive from world-state array lengths, not global counters.
- Model call order never affects outcomes: all actions are validated against
  turn-start state and resolved in the documented order.
- In mock mode, the same seed + config reproduces identical world-state JSON
  (covered by the replay/determinism tests). Server-created run ids append a
  random suffix, so `simulationId` differs between separate server runs;
  experiment runs use deterministic ids
  (`exp_<configHash>_<seed>_<replicate>`).

## Persistence

SQLite (node:sqlite) tables: `simulations`, `snapshots` (full world JSON per
turn), `events`, `actions`, `decisions`, `narrator`, `metrics`, `llm_calls`
(telemetry only — no secrets, no raw prompts), `experiments`, `audit`.

Active runs live in memory (`RunnerManager`); the database is the durable
record. Several tables are currently write-only (`simulations`, `snapshots`,
`metrics`, `actions`, `narrator`, `audit`): there is no restart/resume path
and no DB-backed read API yet. The `Db` class is a repository-style seam; a
PostgreSQL implementation can replace it without touching the engine, though a
few read queries in the server currently use raw SQL directly.

## Turn-order semantics

Configurable: `seeded_shuffle` (default) or `fixed_pack_order`. Within a phase,
nations act in the fixed turn-order rank; the model call order is irrelevant to
outcomes.
