# API reference

Base: `http://127.0.0.1:8787/api` (configurable via `PORT`/`HOST`). All content
is fictional; `GET /meta` returns the standing fiction notice. There is no
authentication — this is a local research tool. When `packages/ui/dist` exists
(after `npm run build`), the same server serves the dashboard at `/` with an
SPA fallback for non-`/api` GETs.

Error shape: validation/route failures return
`400 { statusCode, error: 'Bad Request', message }`. Unknown ids return
`404 { message: ... }` (`'Unknown simulation'`, `'Unknown nation'`,
`'Unknown experiment'`). Missing replay snapshots are distinguished from
unknown simulations: `404 { message, code: 'no_snapshot', availableTurns[] }`
versus `404 { message, code: 'unknown_simulation' }`. OpenRouter catalog fetch
failures return `502 { message }`.

## Meta & health

- `GET /meta` → `{ notice, codeVersion, promptVersion, catalogVersion,
  defaultConfig, defaultProvider, openRouterKeyConfigured, packs[], scenarios[],
  actions[], severityTable }`. `actions[]` has 27 entries with `id`,
  `description`, `requiresTarget`, `targetOptional`, `messageAllowed`, `phase`,
  `severityHiddenFromAgents`, and `sideEffects` (the declared consequence
  descriptions); `severityTable.default` holds the 2^x−4 ladder.
  `defaultConfig` is the env-merged startup default.
- `GET /openrouter/health` → `{ configured, ok, detail }` (no secrets). In mock
  mode: `{ configured: false, ok: false, detail: 'No OpenRouter client
  configured (mock mode).' }`.
- `GET /openrouter/models?force=true` → `{ count, models }` with context length
  and pricing metadata. `400` when no client is configured; `502` when the
  upstream fetch fails.

## Simulations

- `POST /simulations` — body: partial `SimulationConfig`, merged over the
  env-derived defaults; pack/scenario ids must exist. Returns `201
  { id, status, config }`; `400` on invalid config or when
  `provider: openrouter` is requested without a configured API key.
- `POST /simulations/validate` — same merge/validation without creating a run;
  `200 { valid: true, config }` or `400`.
- `GET /simulations` — `[{ id, status, turn, totalTurns, scenarioId, provider,
  model, archived }]`; live runners and SQLite-archived records (including
  interrupted) merged; `model` is `'mixed'` when nations resolve to more than
  one model.
- `GET /simulations/:id` — `{ id, status, phase|null, stopReason,
  stopRequested, stopPending, turn, totalTurns, world|null, decisions, config,
  snapshotTurns[], archived }`. Archived (DB-backed) runs have `phase: null`
  and `world: null` when no snapshots exist; their events/metrics/replay are
  served from SQLite.
- `GET /simulations/:id/state` — `{ turn, status, world|null, archived }`.
- `POST /simulations/:id/start` — `{ id, status }`; `400` if already started.
  Archived records are read-only: `400` with guidance to create a new
  simulation from the saved configuration.
- `POST /simulations/:id/stop` — idempotent: `{ id, status, stopRequested,
  stopPending }`. The current turn finishes and persists before the run
  finalizes as `stopped`; repeated requests never rewrite a terminal or
  archived status.
- `GET /simulations/:id/events?fromTurn=N` — array of validated `WorldEvent`
  objects (no 404: unknown ids return `[]`).
- `GET /simulations/:id/nations/:nid` — `{ profile, history[{ turn, variables }],
  current, actions[], provocations[], metrics|null, archived }`.
- `GET /simulations/:id/metrics` — `RunMetrics` (turns, spikes, totals, rates,
  fallback/failure counts, `metricVersion`).
- `GET /simulations/:id/replay?turn=N` — `{ turn, before|null, after, events,
  narrator, reRunConfig, availableTurns[], archived }`; `404` with
  `code: 'no_snapshot'` until a snapshot exists for that turn.
- `GET /simulations/:id/export?format=csv|json` — CSV columns `turn,mean_score,
  violent_rate,nuclear_rate,de_escalation_rate,civilian_impact_proxy,
  global_stability`; JSON `{ simulationId, config, world, snapshots, metrics,
  decisions, archived? }` including validation reports.
- `POST /simulations/import` — body `{ config }` (other exported fields are
  ignored) → `201 { id, status, imported: true }`.

## Experiments

- `POST /experiments` — body: `ExperimentSpec` `{ name, seeds[≥1], models[≥1],
  scenarios[≥1], replicates (1–50), provider, concurrency (1–16, clamped to ≤8
  internally), configOverrides? }` → `201 ExperimentResult` with per-record
  provenance (`configHash`, seed, model, scenario, replicate, status) and a
  descriptive bootstrap-CI aggregate grouped by scenario × model. The batch
  runs synchronously inside the request; large batches block until finished.
- `GET /experiments` → `[{ id, status, started_at, spec }]`.
- `GET /experiments/:id` → stored `ExperimentResult`.

## Simulation statuses and phases

- `status`: `idle → running`; terminal: `completed | stopped | failed`.
  `completed` on turn-limit or stop-condition ends, `stopped` on user stop
  (turn-boundary), and `failed` is set by the server runner only when the
  drive loop throws. `interrupted` marks a saved record whose process ended
  while it was still marked `running`; it is read-only history and is never
  resumed. Archived records keep their terminal status unchanged by Stop.
- `phase`: `deciding | resolving | turn_end | done` (live runs only; archived
  runs return `phase: null`).
- `stopReason`: `null` for turn-limit completion, `'Stopped by user'`, a
  stop-condition message, or the failure error message.
