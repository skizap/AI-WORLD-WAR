# Limitations

Read this before drawing any research conclusion from AI-WORLD-WAR.

## Construct validity

- "Escalation" here is a **simulation score** derived from a synthetic severity
  ladder over a 27-action catalog. It is an *escalation proxy* for a fictional
  world, not a validated measure of real-world conflict escalation.
- Nation variables (military, GDP, population, territory, nuclear capability)
  are dimensionless synthetic units on fixed bounds. They do not correspond to
  measurable real quantities.

## Prompt & framing sensitivity

LLM agents are highly sensitive to prompt wording, action descriptions,
observation content, history windows, framing (neutral vs low-stakes), and
sampling temperature. The paper's own findings were model-dependent; ours are
no more universal. Ablations exist precisely because such choices change
results.

## Sampling variance

OpenRouter runs sample stochastically; identical configurations with
temperature > 0 do NOT reproduce exactly (unlike mock mode). Replicates and
bootstrap intervals describe the variance you observe; they do not license
causal claims.

## Narrator effects

Narrator summaries are display-only by default. The optional
`observation.includeNarratorSummaries` ablation feeds them into later
observations; when enabled, a narrative model can shift agent behavior beyond
the engine's recorded state and becomes a known confound. Narrator source is
recorded per turn.

## Synthetic transition rules

Effect magnitudes, passive mechanics, deterrence mitigation, ongoing effects,
and stop conditions are invented parameters (documented in CONFIGURATION.md),
not calibrated to any real or historical system. Changing them changes results.

## Turn-order and resolution artifacts

Fixed phase ordering and per-phase rank resolution avoid model-call-order
confounds but introduce their own ordering artifacts (early actors in a phase
act before later actors' counterfactual responses).

## Impossibility of extrapolation to real governments

Nothing in this simulator licenses statements about any real country, real
LLM deployment, or real crisis dynamics. The fictional agents are LLMs role-
playing under artificial rules; their observed run behavior cannot be
converted into predictions, probabilities, or safety certifications. Any use
suggesting otherwise would be a misrepresentation of this tool.

## Engineering limitations

- SQLite is local-only (Postgres repository seam planned but not implemented).
  Some reads (events, decisions, nation action history) issue raw SQL outside
  the `Db` class.
- Active runners are held in memory. Completed data is persisted, but
  reopening/resuming runs after a server restart is not implemented, and
  several tables (`simulations`, `snapshots`, `metrics`, `actions`, `narrator`,
  `audit`) are write-only today.
- Config fields `safetyMode` and `observation.includeMessages` are declared and
  schema-validated but are not enforced/read by any code path yet; the
  `escalationBaseline` scenario field and the `military_strain` ongoing effect
  are likewise defined but unused (see CONFIGURATION.md and SAFETY.md).
- No authentication layer (local research tool by design), and `LOG_LEVEL` is
  accepted but logging is currently disabled.
- LLM telemetry records only the final successful attempt of each call: failed
  calls and error details are not written to `llm_calls`, and the response
  cache is implemented but disabled (`cache: false` on all provider calls).
  There is no proactive rate limiting beyond 429 retry/backoff.
- Bootstrap CIs are naive percentile intervals and need enough replicates to
  mean anything.
