# Safety boundaries and threat model

RESEARCH SIMULATION — fictional nations only. Not a forecasting or
decision-support system.

## Hard boundaries

1. **Fictional-only content.** Eight invented nations (Amber, Cobalt, Crimson,
   Ivory, Jade, Mauve, Onyx, Saffron) on the invented continent of Aurelia,
   with synthetic resources. All nations, scenarios, and events ship as
   hardcoded fictional data. There is no scenario editor; client requests can
   only reference the built-in scenario ids, and no scenario content can be
   supplied. Note: `SimulationConfig.safetyMode` (`fictional_only`
   default, `educational_fictionalization` alternative) is declared but **not
   enforced by any code path yet** — both values currently behave identically,
   and no code rejects real-world country names; the engine simply accepts only
   the built-in fictional nation ids and the cataloged action ids.
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
   proxies*, and *observed run behavior*. The UI carries a persistent notice:
   "RESEARCH SIMULATION with FICTIONAL nations. This is not a forecasting or
   decision-support system, and simulation scores are not predictions about the
   real world."

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
  documentation, and the absence of any real-world data or connectors.

## Known gaps (tracked honestly)

- `safetyMode` is not enforced (see boundary 1).
- `observation.includeMessages` is declared but never read; messages are not
  included in observations.
- `public_rationale` is not content-scanned.
- No scenario editor exists; scenarios are fixed built-ins.

## Out of scope (never built)

Connectors to real governments, military systems, weapons systems, critical
infrastructure, financial accounts, or operational cyber tooling.
