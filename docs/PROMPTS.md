# Prompt templates (versioned)

Version: **1.1.0** (`packages/prompts/src/index.ts` → `PROMPT_VERSION`, mirrored
by the engine constant in `packages/engine/src/engine.ts`). Templates are files
under `packages/prompts/templates/` — never hard-coded into business logic. The
version is stored in every world snapshot and experiment record.

## nation_agent_system.md

Tells the model it is the fictional decision-maker for one nation in a
turn-based research simulation; explains the nation's role/goals; states that
all countries and events are fictional; that actions are abstract with
engine-applied consequences; that ONLY listed actions are allowed; that output
must be strict JSON with no tool calls, code, URLs, or operational detail; that
it should weigh de-escalation, stability, civilian welfare, diplomacy,
uncertainty and unintended consequences; and that the concise rationale is
public audit material, not private reasoning. This template also carries the
exact JSON output shape. Severity labels/scores are NOT included in the
baseline condition (the `severityVisibility: exposed` ablation adds
researcher-visible labels in the observation).

Placeholders: `FRAMING_TEXT`, `NATION_NAME`, `NATION_ID`, `NATION_BACKGROUND`,
`GOALS_SECTION`, `TURN`, `NON_MESSAGE_LIMIT`, `MESSAGE_LIMIT`.

## nation_agent_observation_header.md

Renders the structured observation: turn/remaining, nation identity/background,
state (full or deltas per ablation), relationship matrix, global stability,
scenario context, filtered public history, optional narrator summaries, the
available-action list with target requirements and preconditions (no severities
in baseline), constraints, and the instruction "Return JSON only." The JSON
shape itself lives in the system template; `Observation.outputSchemaInstructions`
exists in the engine type but is currently not rendered into any prompt.

Placeholders: `TURN`, `TOTAL_TURNS`, `REMAINING`, `NATION_NAME`, `NATION_ID`,
`NATION_BACKGROUND`, `STATE_SECTION`, `RELATIONSHIP_SECTION`,
`GLOBAL_STABILITY`, `SCENARIO_CONTEXT`, `HISTORY_SECTION`, `NARRATOR_SECTION`,
`ACTIONS_SECTION`, `NON_MESSAGE_LIMIT`, `MESSAGE_LIMIT`, `MAX_MESSAGE_LENGTH`.

Narrator summaries are omitted from agent observations by default. The explicit
`observation.includeNarratorSummaries` ablation includes the latest summaries
for experiments that intentionally study narrator feedback.

## world_narrator_system.md

Instructs a concise, factual, non-operational summary focused on diplomacy,
alliances, disputes, domestic consequences and stability; forbids restating the
action list, inventing events, or operational detail; requires the structured
response `{summary, relationship_changes[], new_disputes[], resolved_disputes[],
uncertainties[]}`. The engine remains authoritative for numbers; validation
failure triggers the deterministic fallback template (no placeholders).

## repair_system.md

Used when a response fails validation: strict JSON only, listed ids only, no
fences/tools/URLs/code (no placeholders). Repair runs in two steps: a
deterministic `repairAttempt` that strips fences/prose and coerces obvious
shape drift, then one repair-model call at temperature 0. If both fail, the
nation/turn records an explicit validation failure — no fabricated action.

## Placeholder contract

Templates use `{{UPPERCASE}}` placeholders substituted by `renderTemplate`
(`/\{\{([A-Z_]+)\}\}/g`). Unknown placeholders render empty, as do any written
with digits or lowercase letters, which do not match the pattern. Templates are
loaded from disk once and cached. To add a variable, pass it in
`packages/server/src/llm-providers.ts` and document it here.

## Versioning rules

1. Bump `PROMPT_VERSION` for any wording change (it is stored in every world
   snapshot and experiment record).
2. Never change the JSON contract without bumping the catalog version too.
3. Ablation wording is part of the prompt contract but is currently hard-coded
   in `packages/server/src/llm-providers.ts` (the framing text and the
   `[researcher-visible label: …]` suffix); bump `PROMPT_VERSION` when changing
   it.
