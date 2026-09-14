# API reference

Base: `http://127.0.0.1:8787/api`. All responses fictional; the meta endpoint
returns the standing fiction notice.

## Meta & health

- `GET /meta` → notice, code/prompt/catalog versions, default config, packs,
  scenarios, 27-action catalog (with `severityHiddenFromAgents`), severity table.
- `GET /openrouter/health` → `{ configured, ok, detail }` (no secrets).
- `GET /openrouter/models?force=true` → cached OpenRouter catalog with
  context length and pricing metadata.

## Simulations

- `POST /simulations` — body: partial `SimulationConfig`; validates against the
  pack/scenario registry; returns `{ id, status, config }` (201).
- `POST /simulations/validate` — same validation without creating.
- `GET /simulations` — list with id/status/turn/scenario/provider/model.
- `GET /simulations/:id` — status, phase, stopReason, full world state, config.
- `GET /simulations/:id/state` — `{ turn, status, world }`.
- `POST /simulations/:id/start|pause|resume|stop|cancel|step`.
- `GET /simulations/:id/events?fromTurn=N` — validated event stream.
- `GET /simulations/:id/nations/:nid` — profile, variable history (per turn),
  current state, action history with rationales and rejection reasons, metrics.
- `GET /simulations/:id/metrics` — `RunMetrics` (turns, spikes, totals, rates).
- `POST /simulations/:id/approvals/:key` — body `{ approve: boolean }`.
- `GET /simulations/:id/replay?turn=N` — before/after snapshots, event trace,
  narrator summary, and the exact `reRunConfig`.
- `GET /simulations/:id/export?format=csv|json` — CSV metrics or full JSON run
  (config, world, snapshots, metrics, decisions incl. validation reports).
- `POST /simulations/import` — body `{ config }` → new run from an exported
  configuration.

## Experiments

- `POST /experiments` — body: `ExperimentSpec` `{ name, seeds[], models[],
  scenarios[], replicates, provider, concurrency, configOverrides? }` →
  experiment result with per-record provenance and bootstrap-CI aggregate
  (descriptive statistics only).
- `GET /experiments` · `GET /experiments/:id`.

## Simulation statuses

`idle → running ⇄ paused`, `running ⇄ awaiting_approval`, terminal:
`completed | stopped | failed`.
