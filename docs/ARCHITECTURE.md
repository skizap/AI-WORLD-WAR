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
│  (27-action catalog v3, 8-nation pack, 4 scenarios)          │
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
   Effects apply through `applyEffects()` only — clamped, with typed
   before/after deltas for nation variables, relationship dimensions, and
   world-level structure (`structuralChanges`: global stability, alliance
   records, dispute identity, intelligence sharing, ongoing effects,
   provocations). Every mutating or rejected event is audited exactly once
   through `addEvent()`.
6. **Second-order reactions** (alliance solidarity, extra trust collapse),
   each recorded as its own audited event.
7. **Passive mechanics** (growth/decay/recovery/ongoing effects/alliance
   maintenance), then global clamp.
8. **Narrator** (LLM or deterministic fallback) summarizes validated deltas;
   a narrator failure can never corrupt state. Narrator prose is display-only
   by default and is fed back only in the explicit
   `includeNarratorSummaries` ablation.
9. **Snapshot + metrics**: the engine records a snapshot per turn in memory
   and exposes `computeMetrics()` (metric contract version 2: per-turn global
   stability from typed deltas, a true cumulative mean score, and a
   civilian-impact proxy that includes passive/ongoing population losses);
   the server runner persists snapshots and metrics to SQLite and evaluates
   **stop conditions**.

## Run lifecycle

- `requestStop()` is an idempotent runtime flag: the current turn finishes
  and is persisted, then the run finalizes as `stopped`. A begun turn with
  no recorded progress is rewound so `world.turn` never points at an
  unreplayable partial turn. Stop requests on terminal runs are no-ops —
  terminal statuses are immutable.
- Failures finalize as explicit `failed` partial records with an auditable
  system event; all previously persisted turns stay readable.
- Alliance state has one canonical representation: the global
  `world.alliances` records and both directed relationship entries are
  reconciled after every alliance mutation, including the baseline pact from
  fiction packs and the alliance-termination declared for `full_invasion`
  (catalog v3).
- Experiment replicates derive deterministic per-replicate effective seeds
  (`seed` for replicate 0, `seed#rN` for later replicates), recorded in the
  experiment record, so mock replicates are independent samples.

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
Per-turn persistence is transactional (events/decisions + snapshot + metrics
land together), so a turn never looks fully saved when only some records
landed.

Active runs live in memory (`RunnerManager`); the database is the durable
record **and the read source for runs after a server restart**: list, detail,
state, events, nation detail, metrics, replay, and export all fall back to
SQLite for archived runs. On startup, rows still marked `running` become
`interrupted` read-only records (no agent loop is ever resumed). Terminal
runners are retained in memory within a small bounded window; older terminal
runs are evicted and served from SQLite. Re-running an archived
configuration means creating a new simulation from its saved configuration —
the record itself is immutable.

## Turn-order semantics

Configurable: `seeded_shuffle` (default) or `fixed_pack_order`. Within a phase,
nations act in the fixed turn-order rank; the model call order is irrelevant to
outcomes.
