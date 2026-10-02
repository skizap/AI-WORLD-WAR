# AI-WORLD-WAR

> **Research simulation — not a forecasting or decision-support system.**
>
> AI-WORLD-WAR is a **fictional** multi-agent geopolitical wargame simulator for
> studying how language-model-controlled *fictional governments* make domestic,
> diplomatic, economic, cyber, military, and nuclear-policy decisions in a
> turn-based fictional world. Nation identities, scenarios, actions, resources,
> events, and outcomes are fictional. The Live atlas uses Earth-derived Natural
> Earth Admin-0 boundaries under fictional aliases as cartographic reference
> geometry only; it is not a political map or simulated territory. Model outputs
> are **never** facts about real countries and **never** predictions of real
> behavior.

Inspired by the methodology of *EscalAItion: A Benchmark for Evaluating the
Escalation Risks of Large Language Models in Simulated Wargames*
([arXiv:2401.03408](https://arxiv.org/abs/2401.03408)) and implemented as a
safe, extensible research tool. See `docs/RESEARCH_NOTES.md` for what is
paper-inspired vs. newly designed, and `docs/LIMITATIONS.md` for what the
results can and cannot mean.

---

## Quickstart (no API key required)

```bash
npm install
npm run demo          # offline 8-nation x 14-turn mock simulation in your terminal
```

Start the full app (server + dashboard) in **mock mode**:

```bash
npm run dev           # API on http://127.0.0.1:8787, UI on http://localhost:5173
```

Open the UI, pick a scenario and seed, assign one model to all nations or a
different model to each, and launch
an autonomous simulation. Stop it at any time, or let it finish and inspect the
analytics, replay, and exports. Mock mode is deterministic and fully offline.

## Running real models via OpenRouter

```bash
cp .env.example .env
# edit .env and set:
#   OPENROUTER_API_KEY=sk-or-...
#   DEFAULT_PROVIDER=openrouter
#   OPENROUTER_NATION_AGENT_MODEL=openai/gpt-4o-mini   (or any OpenRouter slug)
```

```bash
npm run dev:server
curl http://127.0.0.1:8787/api/openrouter/health     # connectivity check (never exposes the key)
curl http://127.0.0.1:8787/api/openrouter/models     # model catalog (context length + pricing)
```

Environment model slugs are startup defaults. In the UI, each of the eight
nations can be assigned a different OpenRouter model, with separate world-
narrator and repair models. The effective model is recorded with every
decision. All production calls go through the OpenRouter REST gateway
(`POST /chat/completions`, `GET /models`). If OpenRouter is unavailable the app
**surfaces the failure** and lets you switch explicitly to mock mode; it never
silently substitutes mock for a production run.

## Test suite

```bash
npm test          # engine unit + property-based (fast-check) + server integration + UI smoke
npm run typecheck # strict TS across all packages
```

## One-command run

```bash
npm start         # builds the UI, then serves the API + built dashboard
npm run dev       # development: API on :8787 + Vite dev server on :5173
```

## What it does

- **8 fictional nations** (Amber, Cobalt, Crimson, Ivory, Jade, Mauve, Onyx,
  Saffron) with static traits, goals, relationships, and bounded dynamic
  variables (military, GDP, trade, resources, stability, population, soft
  power, cybersecurity, nuclear capability, territory).
- **27-action versioned catalog** across six severity categories
  (de-escalation -> nuclear). Agents never see severity labels or scores in the
  baseline condition.
- **Deterministic engine**: seeded RNG, validated state transitions, clamping,
  pairwise relationship state, alliance/dispute tracking, passive mechanics,
  second-order effects. Same seed + config reproduces the run in mock mode
  (world-state JSON equality in the tests).
- **Four built-in scenario entries**: original neutral, prior invasion, prior
  cyber incident, and `neutral_world_v2`. The world-v2 neutral entry shares the
  original neutral mechanics but frames Aurelia as a fictional world; original
  scenario IDs remain available for recorded runs.
- **Autonomous resolution**: every validated action, including violent and
  nuclear actions, resolves without human intervention. The normal controls are
  Start and Stop.
- **World narrator** (LLM or deterministic fallback) summarizes each turn from
  validated engine deltas. It is display-only by default, so prose does not
  influence later decisions unless that experimental ablation is enabled.
- **Escalation metrics**: simulation scores / escalation proxies per the
  paper's ladder (`2^x - 4`), plus linear, exponential, firebreak, and custom
  schemes. Descriptive only — never called predictions or risk probabilities.
- **Batch experiments** across seeds x models x scenarios x replicates with
  bootstrap-CI aggregates and full provenance (config hash, code version,
  prompt version, effective model slug, seed). Mock and OpenRouter jobs use
  their requested provider; they are never silently substituted.
- **Dashboard**: a Live map-led atlas, ordered event rail and visual-only
  playback; per-nation model setup with a searchable OpenRouter catalog; nation
  details; analytics charts (escalation over time, severity stacks, cumulative
  scores, global stability, spikes); CSV/JSON exports; and a replay scrubber
  with an in-app separate-run confirmation. Event links are illustrative only:
  no routes, unit movement, territory changes, or geographic distances are
  simulated.

## Atlas data

The Live atlas renders the supplied Natural Earth Admin-0 Countries 1:50m
dataset (version 5.1.1, WGS84, public domain). This bundle contains 242 polygon
features. Its default de-facto boundary depiction is retained as a cartographic
reference, not as a statement about recognition or sovereignty.

The checked-in runtime asset is
`packages/ui/public/atlas/aurelia-atlas.topo.json`. It contains the geometry,
opaque hashed region IDs, unique fictional aliases, geographic continent labels,
active/neutral metadata, and visual anchors for the eight active agents. The
offline converter drops all source attributes, including real names, political
codes, population, and GDP; raw `.shp` and `.dbf` files are not loaded by the
browser or normal application runtime. Eight features are mapped one-to-one to
Amber, Cobalt, Crimson, Ivory, Jade, Mauve, Onyx, and Saffron; the other 234 are
neutral scenery without simulation state.

To regenerate the derivative after placing the pinned source bundle in
`ne_50m_admin_0_countries/` at the repository root:

```bash
npm run build:atlas --workspace @aiww/ui
```

The script checks the source version and feature count, alias and ID uniqueness,
active-region anchors, and the runtime-property allowlist. Normal UI builds use
the generated local asset and do not need the shapefile converter.

## Architecture (monorepo)

| Package | Purpose |
|---|---|
| `packages/schemas` | Shared Zod domain model (single source of truth for bounds) |
| `packages/engine` | Pure deterministic simulation core, catalog, scenarios, scoring, metrics, mock providers |
| `packages/prompts` | Versioned prompt template files |
| `packages/server` | Fastify API, SQLite persistence, job lifecycle, OpenRouter client, experiment runner |
| `packages/ui` | React + Vite + Recharts research dashboard |

See `docs/ARCHITECTURE.md` for data flow and `docs/API.md` for endpoint
schemas.

## Documentation map

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Components, per-turn data flow, determinism, persistence |
| `docs/FRONTEND.md` | Dashboard UI, sanitized atlas data pipeline, event semantics, views, styling, recipes |
| `docs/API.md` | HTTP endpoints, statuses, phases |
| `docs/CONFIGURATION.md` | `SimulationConfig` fields, bounds, catalog parameters, `.env` |
| `docs/PROMPTS.md` | Versioned prompt templates and placeholder contract |
| `docs/SAFETY.md` | Hard boundaries, threat model, known gaps |
| `docs/LIMITATIONS.md` | Construct validity, extrapolation limits, engineering gaps |
| `docs/RESEARCH_NOTES.md` | Paper-inspired vs. original design |

## Safety boundaries

- Fictional nation identities, scenarios, actions, resources, and events. Atlas
  polygons are Earth-derived visual references under fictional aliases; they
  do not represent simulation ownership or changing borders. There are no
  connections to real governments, military systems, weapons, infrastructure,
  financial accounts, or operational cyber tooling.
- Model output can never execute code or mutate state outside the validated
  engine; URLs, shell syntax, and operational content are rejected at
  validation in action ids and messages (rationale text is length-capped only).
- All nations and scenarios are built-in hardcoded fictional data; only the 27
  cataloged action ids and the fictional nation ids are accepted, and severe
  fictional events are labeled in the UI.
- `SimulationConfig.safetyMode` is declared (`fictional_only` default) but is
  not enforced by any code path yet — see `docs/SAFETY.md` for what is actually
  enforced.
- `.env` is gitignored; API keys are never logged or exported.

See `docs/SAFETY.md`.

## Configuration

Turn counts, action limits, observation ablations, scoring scheme, stop
conditions, passive mechanics, seeds, and models are exposed through
`SimulationConfig` and documented in `docs/CONFIGURATION.md`. A few server-side
choices are hard-coded (narrator/repair sampling, content-scan scope) and are
called out in that document. New runs default to the versioned
`aurelia_world_8_v2` fiction pack and `neutral_world_v2` scenario. The unchanged
`baseline_8` pack and `neutral` scenario remain available for saved
configurations and replay compatibility.

## Known limitations

Prompt sensitivity, construct validity, synthetic transition rules, engineering
gaps (declared-but-unenforced config fields, no run resume, no auth), and the
impossibility of extrapolating these fictional simulation scores to real
governments are covered in `docs/LIMITATIONS.md`. The original paper found
model-dependent escalation behavior in **its own setup**; those findings are
not universal laws about LLMs, and changing prompts, models, action
descriptions, scoring, history, sampling, or turn ordering here will change
results.

## License / status

Research prototype for studying LLM behavior in fictional wargame settings.
Provided as-is, with no warranty, for research and education.
