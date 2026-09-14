# AI-WORLD-WAR

> **Research simulation — not a forecasting or decision-support system.**
>
> AI-WORLD-WAR is a **fictional** multi-agent geopolitical wargame simulator for
> studying how language-model-controlled *fictional governments* make domestic,
> diplomatic, economic, cyber, military, and nuclear-policy decisions in a
> turn-based world. All countries, geography, resources, and events are
> fictional. Model outputs are **never** facts about real countries and
> **never** predictions of real behavior.

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

Open the UI, complete the **safety acknowledgment**, pick a scenario and seed,
and launch a simulation. Pause, step, approve severe actions, inspect analytics
and replay, and export results — all offline with deterministic mock agents.

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

Model slugs are configurable per role (`nation_agent`, `world_narrator`,
`repair`) via `.env` and per-simulation in the UI — nothing is hard-coded in
business logic. All production calls go through the OpenRouter REST gateway
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
  second-order effects. Same seed + config => byte-identical replay.
- **Three baseline scenarios**: neutral, prior invasion, prior cyber incident
  (all fictional and abstract).
- **Human approval gate** for severe actions (violent/nuclear by default) with
  a full audit trail of overrides.
- **World narrator** (LLM or deterministic fallback) summarizes each turn from
  validated engine deltas — the engine stays authoritative.
- **Escalation metrics**: simulation scores / escalation proxies per the
  paper's ladder (`2^x - 4`), plus linear, exponential, firebreak, and custom
  schemes. Descriptive only — never called predictions or risk probabilities.
- **Batch experiments** across seeds x models x scenarios x replicates with
  bootstrap-CI aggregates and full provenance (config hash, code version,
  prompt version, model slug, seed).
- **Dashboard**: setup with safety acknowledgment, live simulation view,
  nation detail, analytics charts (escalation over time, severity stacks,
  resource trajectories, relationship heatmap), and a replay scrubber with
  deterministic re-run.

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

## Safety boundaries

- Fictional countries/geography only; no connections to real governments,
  military systems, weapons, infrastructure, financial accounts, or operational
  cyber tooling.
- Model output can never execute code or mutate state outside the validated
  engine; URLs, shell syntax, and operational content are rejected at
  validation.
- Scenario setup rejects real-world country names; severe fictional events are
  clearly labeled.
- `.env` is gitignored; API keys are never logged or exported.

See `docs/SAFETY.md`.

## Configuration

Every tunable (turn counts, action limits, ablations, scoring scheme, stop
conditions, passive mechanics, seeds, models) is documented in
`docs/CONFIGURATION.md` and exposed through `SimulationConfig`.

## Known limitations

Prompt sensitivity, construct validity, synthetic transition rules, and the
impossibility of extrapolating these fictional simulation scores to real
governments are covered in `docs/LIMITATIONS.md`. The original paper found
model-dependent escalation behavior in **its own setup**; those findings are
not universal laws about LLMs, and changing prompts, models, action
descriptions, scoring, history, sampling, or turn ordering here will change
results.

## License / status

Research prototype for studying LLM behavior in fictional wargame settings.
Provided as-is, with no warranty, for research and education.
