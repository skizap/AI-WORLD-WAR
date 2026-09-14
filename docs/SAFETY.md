# Safety boundaries and threat model

RESEARCH SIMULATION — fictional nations only. Not a forecasting or
decision-support system.

## Hard boundaries

1. **Fictional-only content.** Eight invented nations (Amber, Cobalt, Crimson,
   Ivory, Jade, Mauve, Onyx, Saffron), an invented continent (Aurelia), and
   synthetic resources. No nation encodes a real country one-to-one. The
   scenario editor rejects real-world country names in the default
   `fictional_only` safety mode; `educational_fictionalization` remains fully
   abstract and non-operational.
2. **No operational modeling.** Cyber, military, and nuclear actions are
   abstract resource-and-relationship deltas. No vulnerabilities, targets,
   procedures, weapon effects, or tactics are described anywhere in prompts,
   catalog text, events, or narration.
3. **Model output cannot mutate state.** All state changes flow through the
   validated transition registry. Model responses are JSON-only; URLs, shell
   syntax, code fences, tool-call shapes, and operational instructions are
   rejected at validation with recorded reasons.
4. **No chain-of-thought solicitation.** Prompts request a concise public
   rationale suitable for audit — never hidden reasoning.
5. **Human approval gate.** Violent and nuclear categories (configurable to
   all actions) require explicit human approval; overrides are audit-logged.
6. **Secrets.** API keys live in `.env` (gitignored). Keys are never logged,
   exported, or included in audit/telemetry records. Health checks report
   booleans, never key material.
7. **Honest labeling.** Metrics are called *simulation scores*, *escalation
   proxies*, and *observed run behavior*. The UI carries a persistent notice:
   not a forecasting or decision-support system.

## Threat model (research-tool scope)

- **Jailbreak via simulation framing**: mitigated by schema+policy validation,
  content scanning, non-operational catalog text, and audit of fallbacks.
- **State corruption by malformed output**: mitigated by the single transition
  funnel (`applyEffects`), clamping, and property tests proving invalid actions
  never mutate state.
- **Silent mock substitution**: forbidden — provider failures surface to the
  user, who must explicitly switch modes.
- **Accidental real-world reuse**: mitigated by persistent fiction notices,
  safety acknowledgment, documentation, and absence of any real-world data.

## Out of scope (never built)

Connectors to real governments, military systems, weapons systems, critical
infrastructure, financial accounts, or operational cyber tooling.
