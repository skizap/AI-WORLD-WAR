# Safety boundaries and threat model

RESEARCH SIMULATION — fictional nation identities and events, with Earth-derived
boundary geometry used only as a cartographic reference. Not a forecasting or
decision-support system.

## Hard boundaries

1. **Fictional identities and simulation content.** The eight active agents
   (Amber, Cobalt, Crimson, Ivory, Jade, Mauve, Onyx, Saffron), scenarios,
   actions, resources, state variables, and outcomes are fictional. There is no
   scenario editor; requests can only reference built-in scenario IDs. The Live
   atlas is the exception to an all-fictional-geography claim: it renders
   Earth-derived polygons with fictional aliases. Those polygons are visual
   references only and never define simulation ownership, action reach, or
   changing territory. `SimulationConfig.safetyMode` (`fictional_only` default,
   `educational_fictionalization` alternative) is declared but **not enforced**;
   no code rejects real-world names in free text, while engine actions accept
   only built-in fictional nation IDs and cataloged action IDs.
2. **No operational modeling.** Cyber, military, and nuclear actions are
   abstract resource-and-relationship deltas. No vulnerabilities, targets,
   procedures, weapon effects, or tactics are described anywhere in prompts,
   catalog text, events, or narration.
3. **Model output cannot mutate state.** All state changes flow through the
   validated transition registry. Model responses are JSON-only. URLs, code
   fences, shell syntax, tool-call shapes, and similar disallowed content are
   rejected with recorded reasons in `action_id` and `message` fields
   (packages/engine/src/validation.ts). Known gap: `public_rationale` is
   trimmed and length-capped but **not** content-scanned.
4. **No chain-of-thought solicitation.** Prompts request a concise public
   rationale suitable for audit — never hidden reasoning.
5. **Autonomous simulation.** Validated actions resolve without human
   intervention. Severity remains metadata for metrics and visualization, not a
   manual approval mechanism; the API has no approval endpoints and the UI has
   no blocking acknowledgment.
6. **Secrets.** API keys live in `.env` (gitignored). Keys are never logged,
   exported, or included in audit/telemetry records. Health checks report
   booleans, never key material.
7. **Honest labeling.** Metrics are called *simulation scores*, *escalation
   proxies*, and *observed run behavior*. The UI carries a persistent notice
   that identities, actions, and outcomes are fictional, and that the atlas
   boundaries are Earth-derived reference geometry rather than real-world
   actors or changing territory.

## Atlas data provenance

The local derivative is built from Natural Earth Admin-0 Countries 1:50m,
version 5.1.1, WGS84, public domain. The supplied bundle contains 242 polygon
features and 168 DBF fields. Its default de-facto boundary depiction is retained
for recognizable reference geometry only; it is not a recognition or
sovereignty claim.

`npm run build:atlas --workspace @aiww/ui` reads the source bundle from
`ne_50m_admin_0_countries/` and writes
`packages/ui/public/atlas/aurelia-atlas.topo.json`. The converter uses a
version-locked local toolchain, hashes the source feature key into an opaque
region ID, creates unique fictional aliases, and allowlists only geometry,
alias, the geographic continent label, active/neutral metadata, and eight visual
anchors. All source names, political identifiers, population/GDP fields, and
other unapproved DBF attributes are dropped. The browser loads only this
sanitized local TopoJSON; it never loads raw shapefiles, remote map tiles, or
external geography services.

The map uses existing fiction-pack IDs for the eight active features. Its
neutral features are scenery only. Existing synthetic `mapPosition` and
`distances` remain unrelated to this map; neither simulation distances nor
influence, ownership, actor behavior, routes, or unit movement are derived from
physical geometry. New runs use versioned `aurelia_world_8_v2` and
`neutral_world_v2` wording, while the original `baseline_8` pack and `neutral`
scenario remain available for recorded-run compatibility.

## Threat model (research-tool scope)

- **Jailbreak via simulation framing**: mitigated by schema+policy validation,
  content scanning of action ids and messages, non-operational catalog text,
  and audit records for provider failures and fallbacks.
- **State corruption by malformed output**: mitigated by the single transition
  funnel (`applyEffects`), clamping, and tests (including property-based
  invariants) covering invalid effects and bounded variables.
- **Silent mock substitution**: forbidden — provider failures surface to the
  user, who must explicitly switch modes. Starting an OpenRouter run without a
  configured key is rejected at creation, and mid-run provider failures become
  explicit missing decisions for that nation/turn.
- **Accidental real-world reuse**: mitigated by persistent fiction notices,
  documentation, fictional aliases, removal of source country names and IDs
  from the browser asset, and the absence of live real-world connectors. The
  Earth-derived boundary geometry remains recognizable and must continue to be
  labeled as reference-only.

## Known gaps (tracked honestly)

- `safetyMode` is not enforced (see boundary 1).
- `observation.includeMessages` is declared but never read; messages are not
  included in observations.
- `public_rationale` is not content-scanned.
- No scenario editor exists; scenarios are fixed built-ins.

## Out of scope (never built)

Connectors to real governments, military systems, weapons systems, critical
infrastructure, financial accounts, or operational cyber tooling.
