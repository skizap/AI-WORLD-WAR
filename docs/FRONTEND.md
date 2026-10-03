# Frontend guide — the AI-WORLD-WAR dashboard (`packages/ui`)

> **Read this file first when working on the web interface.** The entire GUI
> lives in `packages/ui`; this document maps every frontend file, its
> responsibilities, the API contract it depends on, and the recipes for common
> changes — so you can work without scanning the whole repository.

Nation identities, scenarios, actions, resources, state, and event outcomes are
**fictional research-simulation content**. The Live atlas deliberately uses
Earth-derived Natural Earth boundary geometry under fictional aliases; it is
cartographic reference only, not simulation ownership or changing territory.
Keep the persistent fiction and geometry notices visible (see §7 and
`docs/SAFETY.md`).

## 0. Where the GUI lives (30-second orientation)

| Question | Answer |
|---|---|
| Which package contains the website? | `packages/ui` (npm workspace name `@aiww/ui`) — nothing else contains UI code |
| What is it? | A single-page React 18 + TypeScript app built with Vite; charts use Recharts |
| Entry HTML | `packages/ui/index.html` → `src/main.tsx` → `src/App.tsx` |
| Dev URL | `http://localhost:5173` (Vite), API proxied to `http://127.0.0.1:8787` |
| Production | `vite build` → `packages/ui/dist`, served by the Fastify API at `/` with an SPA fallback (`packages/server/src/app.ts`) |
| Local atlas | `public/atlas/aurelia-atlas.topo.json`; generated offline from `ne_50m_admin_0_countries/` |
| Routing | None — five tabs toggled by React state in `App.tsx` |
| Global state | None — `useState` per view; the current simulation id is lifted to `App.tsx` |
| Network layer | Exactly one module: `src/api.ts` |
| Styling | One global stylesheet: `src/styles.css` (CSS variables + utility classes; no Tailwind/CSS modules) |
| Tests | `packages/ui/test/*.test.*` (Vitest + jsdom + React Testing Library) |

If you only read three files: **`src/api.ts`** (backend contract),
**`src/App.tsx`** (shell + navigation), **`src/styles.css`** (design system).

## 1. TL;DR for agents

| I need to… | Touch these files |
|---|---|
| Change a label/layout on a screen | the relevant `src/views/*.tsx` |
| Add or change a simulation option | `src/views/SetupView.tsx` (state + `config` memo + JSX) |
| Add a new tab/screen | `src/views/NewView.tsx`, then `TABS` + render block in `src/App.tsx` |
| Call a new backend endpoint | add a method in `src/api.ts`, then use it from a view |
| Change colors/typography/spacing | `src/styles.css` (edit `:root` variables first) |
| Change what data a view shows | `src/api.ts` types + the view's `useEffect`/polling block |
| Run the app | `npm run dev` (root: API + UI) or `npm run dev:ui` (UI only) |
| Type-check / test | `npm run typecheck` · `npm test` from the repo root |

**Golden rules**

1. All HTTP goes through `api.ts`; never call `fetch` from a view (the two
   `<a download>` export links in `AnalyticsView` are the intentional
   exception).
2. No router, no state library, no context. Keep the existing pattern: local
   `useState` + `useEffect` + polling with `clearInterval` cleanup.
3. Reuse the CSS classes in `styles.css` (`.panel`, `.grid cols-2`, `.fieldrow`,
   `.badge`, `.notice`, `.table`, `.eventfeed`…). Inline `style` is only used
   for one-off sizing/palette values.
4. Never remove or soften the fiction / "not a forecasting system" notices.
5. Views must render useful output when `simId` is `null` ("Create a simulation
   first.") and when data arrays are empty.

## 2. Stack and tooling

| Item | Version / setting | Source |
|---|---|---|
| React / ReactDOM | ^18.3.1 | `packages/ui/package.json` |
| TypeScript | strict, ES2022, `jsx: react-jsx`, DOM libs | `tsconfig.base.json` + `packages/ui/tsconfig.json` |
| Vite | ^6, `@vitejs/plugin-react` | `packages/ui/vite.config.ts` |
| Recharts | ^2.13.3 | charts in `NationView`, `AnalyticsView` |
| Atlas runtime | `d3-geo`, `d3-zoom`, `d3-selection`, `topojson-client` | projection, pan/zoom, TopoJSON decoding |
| Atlas build-only | `shapefile`, `topojson-server` | Offline conversion; exact resolved versions are in `package-lock.json` |
| Schemas | `@aiww/schemas` workspace package (exports `src/index.ts`) | shared engine types |
| Tests | Vitest + jsdom + @testing-library/react | root `vitest.config.ts` |

Scripts (root `package.json`):

- `npm run dev` — API (:8787) + Vite (:5173) together
- `npm run dev:ui` — Vite only (expects the API on :8787)
- `npm run build` — builds `packages/ui/dist`
- `npm run build:atlas --workspace @aiww/ui` — regenerates the local sanitized atlas asset (requires the Natural Earth source bundle at the repository root)
- `npm start` — builds the UI, then serves API + dashboard from :8787
- `npm test` / `npm run typecheck` — all packages

The dev proxy (`vite.config.ts`): `'/api' → http://127.0.0.1:8787`; port 5173
(not `strictPort`, so Vite may pick another port if 5173 is busy).

## 3. File map — every frontend file

```text
packages/ui/
├── index.html                  # Vite entry; <div id="root">, title, loads src/main.tsx
├── package.json                # @aiww/ui: scripts + deps (react, recharts, schemas)
├── tsconfig.json               # extends ../../tsconfig.base.json; includes src + test
├── vite.config.ts              # react plugin, port 5173, /api proxy, outDir dist
├── src/
│   ├── main.tsx                # createRoot, StrictMode, and ErrorBoundary
│   ├── App.tsx                 # shell: accessible tabs, meta notice, simId, owned selected nation + setup draft
│   ├── ErrorBoundary.tsx       # render fallback for unexpected view errors
│   ├── api.ts                  # the ONLY network layer + shared UI constants/types
│   ├── styles.css              # global theme (CSS variables) + component classes
│   ├── atlas/
│   │   ├── AtlasMap.tsx        # projection, accessible regions, search, zoom, event symbols
│   │   ├── atlasData.ts        # runtime allowlist validation + TopoJSON decoding
│   │   ├── actions.ts          # metadata-driven visual event categories (unknown fallback)
│   │   ├── events.ts           # event order, dedupe, and visual eligibility
│   │   └── types.ts            # opaque region and fictional nation types
│   └── views/
│       ├── SetupView.tsx       # labeled config form (draft preserved across tabs) + effective summary + create
│       ├── LiveView.tsx        # run controls, atlas, ordered history, visual playback, nation cards
│       ├── NationView.tsx      # fresh per-nation profile, variable history chart, action history
│       ├── AnalyticsView.tsx   # 4 metric charts, spike table, run totals, CSV/JSON exports
│       └── ReplayView.tsx      # snapshot-derived scrubber, comparison, trace, confirmed re-run
├── public/atlas/
│   └── aurelia-atlas.topo.json # generated, fictionalized runtime geometry only
├── scripts/
│   └── build-atlas.mjs         # offline Natural Earth parser and TopoJSON builder
└── test/
    ├── atlas*.test.*           # sanitized data, region search, map symbols, action categories
    ├── events.test.ts          # stable ordering, overlap dedupe, visual eligibility
    ├── live-atlas.test.tsx     # hydration, new-event queue, simulation switching
    ├── app-shell.test.tsx      # tab keyboard behavior and error fallback
    ├── replay-view.test.tsx    # nonblocking replay re-run flow
    └── ui.test.tsx             # fetch headers, setup, tabs, charts

Related files outside the package:
- packages/server/src/app.ts ........ serves packages/ui/dist at / (SPA fallback) when built
- vitest.config.ts ................. test discovery (packages/*/test/**) + React dedupe
- tsconfig.base.json ............... strict TS baseline for the UI build
- root package.json ................ dev/build/start/test orchestration
```

There are no remote map tiles, external map SDKs, router config, or CSS-in-JS.
The generated TopoJSON under `public/atlas/` is the only runtime map geometry;
the raw `.shp`/`.dbf` inputs are used by the offline build script only.

## 4. Architecture and data flow

```text
index.html
   └─ main.tsx ──> App.tsx
                      │ owns: tab, meta, simId, selectedNationId, setupDraft, app error
                      │
                     ├─ SetupView     props: { meta, draft, onDraftChange, onCreated(id) } ─ create sim ─┐
                     │                                                                                 │
                     │   onCreated => App.setSimId(id) + App.setTab('Live') <──────────────────────────┘
                     │
                      ├─ LiveView      props: { simId, onPick, onViewNation } (polls 1.5 s)
                      ├─ NationView    props: { simId, selectedNationId, onSelectNation } (polls selected nation)
                      ├─ AnalyticsView props: { simId }                    (polls 2 s)
                      └─ ReplayView    props: { simId, onOpenSimulation }  (fetch per turn)
                                            │
                                            ▼
                                src/api.ts  →  /api/* + local atlas asset
```

Key behaviors:

- **No deep linking.** Switching tabs unmounts the previous view; refreshing
  the page resets to the Setup tab (the simulation list is re-fetched by
  LiveView, so runs can be re-picked from the dropdown).
- **`simId` can be `null`** until a run is created or picked. The atlas still
  renders without a selected simulation; event, nation, analytics, and replay
  surfaces show useful empty states.
- **Polling is view-local**: LiveView refreshes the selected world/events every
  1500 ms, AnalyticsView polls every 2000 ms, and NationView refreshes current
  nation details every 2500 ms while a run is active. Polling avoids overlap
  and cleans up on selection changes/unmount.
- **Error surface**: request errors are inline `role="alert"` notices; an app
  `ErrorBoundary` provides a reload fallback for unexpected render failures.
- `main.tsx` uses `React.StrictMode`, so effects run twice in dev; the polling
  cleanup makes this harmless.

## 5. The API client (`src/api.ts`) — complete reference

`req<T>(path, init?)`:

- Base URL is the constant `BASE = '/api'`.
- Sets `Content-Type: application/json` **only when the request has a body**.
  This matters: Fastify rejects an empty request that claims a JSON body, so
  `POST /simulations/:id/start|stop` must not declare JSON content type.
- Non-OK responses are parsed and thrown as `Error(body.message ?? 'HTTP <status>')`.
- Successful responses are returned as parsed JSON typed by the caller.

| `api` method | HTTP call | Returns (UI type) | Used by |
|---|---|---|---|
| `meta()` | `GET /meta` | `Meta` | `App.tsx` |
| `atlas()` | `GET /atlas/aurelia-atlas.topo.json` | sanitized local `AtlasTopology` | `AtlasMap` |
| `health()` | `GET /openrouter/health` | `{ configured, ok, detail }` | **unused** |
| `models()` | `GET /openrouter/models` | `{ count, models[{ id, name?, contextLength?, pricing? }] }` | `SetupView` (browse catalog) |
| `createSimulation(config)` | `POST /simulations` | `{ id, status }` | `SetupView`, `ReplayView` (re-run) |
| `listSimulations(signal?)` | `GET /simulations` | `{ id, status, turn, totalTurns, scenarioId, provider, model, archived }[]` — live runs and SQLite-archived records merged | `LiveView` |
| `getSimulation(id, signal?)` | `GET /simulations/:id` | `{ id, status, phase|null, stopReason, stopRequested, stopPending, turn, totalTurns, world|null, config, snapshotTurns[], archived }` — the server also returns `decisions`, not typed here | `LiveView`, `NationView`, `ReplayView` |
| `control(id, 'start'\|'stop')` | `POST /simulations/:id/start\|stop` | `{ id, status, stopRequested?, stopPending? }` — stop is idempotent and never rewrites terminal statuses | `LiveView` |
| `metrics(id)` | `GET /simulations/:id/metrics` | `RunMetrics` | `AnalyticsView` |
| `events(id, fromTurn?)` | `GET /simulations/:id/events?fromTurn=` | persisted `WorldEvent[]` | `LiveView` hydration for archived runs (world may be `null` there) |
| `nation(id, nid)` | `GET /simulations/:id/nations/:nid` | `{ profile, history[{turn,variables}], current, actions[], provocations[], archived }` | `NationView` |
| `replay(id, turn)` | `GET /simulations/:id/replay?turn=` | `{ turn, before|null, after, events, narrator?, reRunConfig, availableTurns[], archived }`; a missing snapshot is a 404 with `code: 'no_snapshot'` (unknown simulation → `'unknown_simulation'`) | `ReplayView` |
| `exportCsv(id)` | raw `fetch …/export?format=csv` | `Response` | **unused** (views use `<a download>` links) |
| `exportJson(id)` | raw `fetch …/export` | `Response` | **unused** |
| `runExperiment(spec)` | `POST /experiments` | `unknown` | **unused** — there is no experiments screen yet |

Shared UI constants (also in `api.ts`):

- `Meta` — type of `/api/meta` (notice, versions, `defaultConfig`,
  `defaultProvider`, `openRouterKeyConfigured`, packs, scenarios, actions,
  severityTable). `Meta.defaultConfig` is the **env-merged** server default and
  is what SetupView initializes its form from.
- `VARIABLE_LABELS` — snake/camel variable key → human label (all 10 variables).
- `SEVERITY_COLOR` / `SEVERITY_TEXT` — severity category → CSS variable/color and
  display name (used by `AnalyticsView`).

**Contract rule:** UI-side response types live inline in `api.ts` (method return
annotations) except engine types imported from `@aiww/schemas` (`RunMetrics`,
`SimulationConfig`, `WorldEvent`, `WorldState`). If the backend shape changes,
update `api.ts` first — views will then type-error where they need updating.

## 6. View reference

### 6.1 `App.tsx` (shell)

- State: `tab`, `meta`, `simId`, `selectedNationId` (single owner shared by the
  atlas and NationView), `setupDraft` (Setup form state preserved across tab
  switches), `error`; on mount calls `api.meta()`.
- Renders: top bar with code/prompt/catalog versions, the canonical persistent
  fiction notice served by the API (`meta.notice`), inline meta errors, a
  footer disclaimer, and a `role="tablist"` with arrow/Home/End keyboard
  navigation. The Earth-derived-boundary caveat lives on the atlas panel
  (`atlas-map-caption`, `role="note"`), not duplicated here.
- `TABS = ['Setup', 'Live', 'Nations', 'Analytics', 'Replay']`; add new tabs
  here with a matching tabpanel.
- Only the selected view mounts; inactive tabpanels are hidden empty sections
  that exist for `aria-controls` targets. SetupView additionally requires
  `meta` (`{meta && tab === 'Setup' && …}`).

### 6.2 `SetupView.tsx` (run configuration)

- Props: `{ meta: Meta; draft: SetupDraft | null; onDraftChange: (draft: SetupDraft) => void; onCreated: (id: string) => void }`.
- The form state is a single `SetupDraft` object owned by `App` (preserved
  across tab switches); `defaultSetupDraft(meta)` seeds it from the env-merged
  server defaults, and "Reset to server defaults" restores it.
- Exposed, labeled controls: scenario and pack (with descriptions and the
  scenario-over-pack precedence note), seed, turns, provider (with the env
  default noted), default + per-nation + narrator + repair models
  (with env-override notes), temperature, maxTokens, scoring scheme with
  editable custom weights (pre-seeded from the default ladder),
  severityVisibility, history, stateMode, framing, narrator toggles, action
  limits, and all three stop conditions with their threshold semantics
  spelled out (below-value/above-count/strictly-less-than semantics).
- `config` is a `useMemo<SimulationConfig>` that spreads `meta.defaultConfig`
  and overrides the form fields; `customWeights` is sent only when the scheme
  is `custom`. Hidden defaults (`turnOrderMode`, `safetyMode` — deprecated,
  `passiveRulesEnabled`) flow through from the server defaults.
- Numeric ranges, all model IDs, and custom weights are validated inline;
  Create remains disabled until corrections are made.
- An effective-run summary shows the resolved scenario/pack/seed/turns/
  provider, deduped model assignments, and an estimated request count
  (turns × nation-agent calls, plus narrator calls when enabled; repair adds
  at most one retry per agent call).
- Actions:
  - `applyModelToAll(model?)` — sets the default and every nation model of the
    selected pack (also used by catalog rows).
- `loadModels()` — `api.models()`, truncated to the first 100 for display;
  catalog search filters ID, name, context length, and pricing.
  - `create()` — `api.createSimulation(config)`, then `onCreated(id)` (App
    switches to Live). The draft is kept after a successful create and marked
    with a status line.
- Provider select disables `openrouter` unless `meta.openRouterKeyConfigured`.
- Two panels (`.grid cols-2`) + a full-width create panel; controls use
  `.fieldrow`/`.checkbox-row`. Turn order, passive rules, and the deprecated
  `safetyMode` are not exposed (they flow through from server defaults).

### 6.3 `LiveView.tsx` (map-led run monitor)

- Props: `{ simId: string | null; onPick: (id: string) => void; onViewNation? }`.
- `refresh` lists runs and calls `api.getSimulation` immediately and every
  **1500 ms**. An in-flight guard prevents overlap; an `AbortController` and
  active flag prevent stale responses after simulation changes.
- The run list merges live runners and SQLite-archived records (`archived`
  flag). For archived runs (`world === null`) the event stream hydrates from
  the persisted `/events` endpoint; nation cards show an empty state.
- Uses the current in-memory `world.events` snapshot for live runs instead of
  the SQLite-backed `/events` endpoint: initial events and events created
  during a provider wait can precede persistence flushes. Events are sorted by
  `(turn, seq)` and deduplicated by simulation ID + event ID.
- Renders the primary atlas alongside a collapsible event rail (the rail
  content container stays in the DOM with `hidden` so `aria-controls` always
  resolves). Regions are keyboard-accessible via roving focus and
  arrow/Home/End keys, searchable by fictional alias, zoomable/pannable, and
  selectable. Active features map one-to-one to the eight fiction-pack IDs;
  other polygons are neutral scenery.
- Newly observed `type: action`, `status: accepted` events enter a visual queue.
  Prior history is hydrated without playback until Replay history is requested.
  Rejected, passive, narrator, scenario, and system events stay in history but
  never create map movement. The queue supports event/turn stepping, speed,
  pause, replay history, and jump-to-live; these controls never pause or mutate
  the simulation and make no network calls. **Step turn** shows every event of
  the next visual turn in order, then pauses — no event is skipped.
- Event details render nation variables, relationship changes, and typed
  world-level `structuralChanges` (global stability, alliance transitions,
  dispute identity, intelligence sharing, ongoing effects, provocations).
- Map links and pulses are symbolic SVG marks only. The map does not show routes,
  units, logistics, real distances, influence, ownership changes, or border
  changes; this notice remains inside fullscreen presentation.
- Start/Stop, phase/status, progress, seed/scenario context, and the six
  synthetic nation variables remain available below/above the map. When a stop
  is pending the status shows "stop pending (finishing current turn)" — Stop
  is a turn-boundary contract, not an immediate kill.

### 6.4 `NationView.tsx` (per-nation detail)

- Props: `{ simId: string | null; selectedNationId: string | null; onSelectNation }`; selection is owned by `App` so the atlas and this view share one piece of state.
- Simulation and selected-nation responses are scoped to their IDs; stale
  requests are ignored, old data/errors are cleared on switches, and the
  selected detail refreshes every 2500 ms while status is `running`.
- Renders: nation `<select>`, profile panel (description, background,
  governance/orientation badges, aggression/force scores, goals), a Recharts
  line chart of five variables (`militaryCapacity, gdp, trade,
  politicalStability, softPower`; palette hard-coded hex), the recorded
  provocation audit trail (display-only; no automated retaliation), and an
  action-history feed (newest first) showing rejections with reasons and
  optional `details`.

### 6.5 `AnalyticsView.tsx` (charts and exports)

- Props: `{ simId: string | null }`; loading/empty/error states ("No metrics yet
  — start the simulation.").
- Polls `api.metrics(simId)` every **2000 ms**.
- Four Recharts panels (fixed-height wrapper + `ResponsiveContainer`):
  1. mean simulation score per turn (line),
  2. severity counts per turn (stacked bars; `Status_quo` uses a hard-coded gray
     `#55627d`, others come from `SEVERITY_COLOR`),
  3. cumulative score by nation (one line per nation, 8-color palette),
  4. global stability per turn.
- Plus: one-turn spike table (top 8), run totals line (violent/nuclear/
  de-escalation/rejected/alliances-formed — explicitly labeled "descriptive
  only"), CSV/JSON export `<a download>` links, and a variable-label reference
  list.
- Chart data transformations happen inline above the JSX (`escalationData`,
  `severityData`, `cumulativeData`, `stabilityData`).

### 6.6 `ReplayView.tsx` (turn scrubber)

- Props: `{ simId: string | null; onOpenSimulation?: (id) => void }`.
- Simulation and per-turn replay fetches are keyed by ID/turn, abort or ignore
  stale results, clear stale state, and show loading/empty/error/retry states.
- The scrubber range comes from `getSimulation(...).snapshotTurns` (completed
  turns only). A request for a turn without a stored snapshot is a distinct
  "pending" state (`code: 'no_snapshot'`), separate from unknown simulations
  (`'unknown_simulation'`) or storage failures; idle runs say no snapshots
  exist yet.
- "Before" values without a prior snapshot display as unknown (`— → x`) rather
  than zero, with an explicit note on the first turn.
- Re-run opens inline confirmation, creates a separate simulation from the
  saved seed/config, and displays the result with an optional Open in Live
  action; it does not block with `alert()`/`confirm()`.
- Before/after, action trace (action descriptions resolved from `meta.actions`
  labels), narrator summary (narrator event filtered to avoid duplicate
  display), and the first five variable columns remain.

### Atlas data and event semantics

- Source bundle: Natural Earth Admin-0 Countries 1:50m, version 5.1.1, WGS84,
  public domain; `ne_50m_admin_0_countries/` at the repository root. The supplied
  bundle has 242 polygon records (the HTML source README's 258-country summary
  is not its feature count) and 168 DBF attributes.
- Regenerate with `npm run build:atlas --workspace @aiww/ui`. The lockfile pins
  the `shapefile` reader and `topojson-server` converter. It validates source
  version/count, hashes `NE_ID` into opaque IDs, creates unique deterministic
  aliases, checks the eight one-to-one active-region mappings/visual anchors,
  and emits an allowlisted TopoJSON derivative. Normal builds consume only
  `packages/ui/public/atlas/aurelia-atlas.topo.json`.
- The asset keeps polygon geometry, `regionId`, `alias`, geographic `continent`,
  `activeNationId`, and `visualAnchor` for active features. It drops all source
  country names, political codes, identifiers, population/GDP, labels, and
  other DBF data. A runtime property validator and `packages/ui/test/atlas.test.ts`
  verify the 242 features, unique aliases/IDs, 8 active + 234 neutral, and the
  allowlist.
- The Natural Earth layer uses its default de-facto boundary depiction. That
  cartographic source choice is not a sovereignty or recognition assertion.
  No physical map coordinates feed simulation distances, influence, ownership,
  model observations, or event effects. `mapPosition`/`distances` in the legacy
  fiction pack remain synthetic and unused by the atlas.
- New simulations use the versioned `aurelia_world_8_v2` fiction pack and
  `neutral_world_v2` scenario so agent-visible Aurelia framing is a fictional
  world. `baseline_8` and the original `neutral` scenario retain their old
  continent wording/content for saved configurations and replay compatibility;
  no simulation mechanics change with this content revision.
- Accepted new action events alone animate. The in-memory world snapshot is
  intentionally preferred over the persisted events endpoint because SQLite
  event writes flush after simulation steps; initial/within-turn events can be
  absent there temporarily. Sequence is global per simulation; use `(turn,
  seq)` ordering and a simulation-scoped event ID for dedupe.

## 7. Styling system (`src/styles.css`)

Theme tokens (`:root`):

| Variable | Value | Used for |
|---|---|---|
| `--bg` | `#10181b` | page background |
| `--panel` / `--panel-2` | `#182428` / `#223237` | panels, inputs, cards, event rows |
| `--text` / `--muted` | `#e8efeb` / `#a5b4ae` | body text / secondary text |
| `--accent` | `#a8d4bd` | active accent and keyboard focus |
| `--ok` | `#8ac9a9` | accepted events, de-escalation |
| `--warn` | `#dfbc7d` | `.notice` disclaimers, posturing |
| `--danger` | `#df897d` | rejected events, errors, violent escalation |
| `--nuclear` | `#c4a5da` | nuclear escalation |
| `--border` | `#3a4d50` | borders, chart grids |
| `--radius` | `12px` | panel/badge rounding |
| `--atlas-ocean`, `--atlas-land`, `--atlas-<nation>` | slate/sea-glass palette | reference geometry and eight active features |

Component classes (all global, no modules):

| Class | Purpose / used by |
|---|---|
| `.app` | max-width page container |
| `header.topbar`, `nav.tabs` (with `[aria-selected='true']` state) | App shell |
| `.notice` | disclaimers and inline errors (App, Setup, Live, Nation, Analytics) |
| `.grid` + `.cols-2` / `.cols-3` | responsive auto-fit grids (all views) |
| `.panel`, `.panel h2/h3` | content cards |
| `.muted` | secondary text |
| `.badge` (+ `.severe`, `.info`) | status/severity labels (Live, Nation) |
| `.eventfeed`, `.event` (+ `.accepted`, `.rejected`, `.narrator`) | event/action feeds (Live, Nation, Replay) |
| `.progress` | run progress bar (Live) |
| `.varbar` + `.bar` | variable bars (Live) |
| `.table` | catalog, spike, replay tables |
| `.fieldrow`, `.checkbox-row` | form layout (Setup, Live, Nation, Replay) |
| `.model-assignments` | nine model inputs grid (Setup) |
| `.atlas-*`, `.live-*` | responsive map canvas, region legend, playback rail and event details |
| `.footer-note` | App footer disclaimer |
| `.heatmap`, `.stat` | **defined but currently unused** — safe to use in new UI |

Conventions and accessibility built in: focus outlines (`:focus-visible`),
`button:disabled` dimming, text labels alongside color, `role="note"`/
`role="alert"`, `aria-live` status text, a progressbar with min/max/now, labeled
controls, roving region focus, and arrow/Home/End tab navigation. Charts retain
Recharts' default keyboard limitations.

## 8. Backend contract notes

- The UI assumes the API is same-origin under `/api` (Vite proxy in dev,
  Fastify static serving in production). No base URL environment variable
  exists.
- Endpoint details/types: see `docs/API.md`; network calls and UI-side shapes:
  `src/api.ts` (§5).
- `POST /simulations` validates the merged config with Zod. Setup mirrors the
  schema's numeric bounds inline for quicker correction; the server remains
  authoritative and rejects invalid requests.
- `provider: 'openrouter'` creation fails with 400 when no API key is
  configured; the UI already disables that option in that case.
- App.tsx renders the canonical persistent fiction notice from
  `meta.notice`; the Earth-derived-boundary caveat stays on the atlas panel.

## 9. Testing (`packages/ui/test/ui.test.tsx`)

- Environment: jsdom via the file-level `// @vitest-environment jsdom` comment
  (root Vitest config defaults to node). React is deduped in
  `vitest.config.ts` to avoid duplicate-copy render errors with Recharts.
- `beforeEach` stubs `global.fetch` with a `vi.fn` returning canned responses
  (`/meta` → the fixture, `/simulations…` → `[]`).
- Current coverage spans the UI smoke, atlas, event helper, Live, app-shell, and
  Replay tests (run `npx vitest run packages/ui` for the current count — do not
  trust hard-coded numbers here):
  1. `api.control` sends **no** body and **no** JSON content-type.
  2. `api.createSimulation` sends JSON body + content-type.
  3. App renders the fiction notice, creates without a blocking acknowledgment,
     and renders all eight nation model inputs.
  4. Five accessible tabs, keyboard navigation, and the error fallback.
  5. Fictional map asset validation, 242 aliases/features, search/focus, and
     accepted/rejected event symbols.
  6. Live history hydration, overlap dedupe, new-event playback, and sim switch.
  7. Re-run confirmation/result and Open in Live callback.
  8–10. Recharts charts with empty, 5-point, and 200-point datasets.
- Run UI tests only: `npx vitest run packages/ui` (or `npm test` for all).
- When adding tests: follow the fetch-stub pattern, use
  `waitFor`/`findBy*` for async renders, and call `cleanup` (already in
  `afterEach`).

## 10. Known gaps and gotchas (do not "fix" blindly)

- **Dead API helpers**: `health`, `events`, `runExperiment`, `exportCsv`,
  `exportJson` exist in `api.ts` but no view uses them. Exports use plain
  `<a download>` links; experiments have no UI yet.
- **No experiments screen** even though the backend supports batch experiments
  (`POST /experiments`) — a ready extension point.
- **No global state, routing, or URL state**; refreshing loses the current tab
  and selected simulation.
- **No experiments screen** even though the backend supports batch experiments.
- **Catalog browse** intentionally shows the first 100 loaded models (searchable)
  and requires a configured OpenRouter key.
- **Map projection and area** are cartographic only; tiny neutral geometries
  may require alias search/focus, and the atlas does not encode simulated
  distances or changing territorial ownership.
- **Hidden config fields**: `includeMessages` (unimplemented in the engine),
  `safetyMode` (unenforced), `passiveRulesEnabled`, custom scoring weights,
  limits, stop conditions, and `turnOrderMode` are inheritable defaults but
  have no form controls.
- **Type breadth**: `getSimulation` UI type omits fields the server returns
  (e.g. `decisions`); `Meta.defaultProvider` is typed but unused by components.
- **React 18 runtime with `@types/react` 19** — keep component typings simple
  and check `npm run typecheck` after changes.

## 11. Recipes

**Add a Setup control (e.g. expose message limits)**

1. Add `useState` seeded from `base.limits.<field>` in `SetupView.tsx`.
2. Include the value in the `limits: { ...base.limits, <field> }` override in
   the `config` memo and in its dependency array.
3. Add a `<label>` inside an existing `.fieldrow` (or a new one).
4. Run `npm run typecheck` and `npm test`.

**Add a new tab/screen**

1. Create `src/views/MyView.tsx`, export `function MyView({ simId }: { simId: string | null })`.
2. Handle `simId === null` and empty data with a `.muted` message.
3. In `App.tsx`: add the name to `TABS`, import the view, and add
   `{tab === 'MyView' && <MyView simId={simId} />}`.
4. Style with existing classes; add new rules to `styles.css` only if needed.

**Add a backend call**

1. Add `myCall: (id: string) => req<MyResponse>('/simulations/...')` to the
   `api` object in `api.ts` (bodies go through `JSON.stringify`).
2. Use it from a view with `.catch((e: Error) => setError(e.message))`.
3. If polling, follow the LiveView pattern: immediate call + `setInterval` +
   `clearInterval` cleanup.

**Add a chart**

Copy the AnalyticsView pattern: fixed-height wrapper `<div style={{ height: N }}>`
→ `<ResponsiveContainer>` → chart component with `<CartesianGrid stroke="#33405c" />`,
`stroke="#9aa7bd"` axes, and the shared tooltip style. Read colors from CSS
variables where possible; Recharts needs literal color strings, so match the
palette in `styles.css`.

**Restyle the app**

Edit the `:root` variables in `styles.css` first — most surfaces inherit from
them. Chart strokes and a few fills are hard-coded hex values in the view files
and must be updated separately.

**Manual verification checklist**

1. `npm run typecheck` (strict TS across all packages).
2. `npm test`.
3. `npm run dev`, then: create a mock simulation → Live start → watch progress
   and feed → Nations charts → Analytics updates while running → Replay scrub →
   Export CSV/JSON downloads.
