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
causal claims. Statistical replicates derive deterministic per-replicate
effective seeds (recorded in the experiment record), so mock replicates are
independent samples rather than identical reruns.

## Metric and rules versioning

- Metric contract version 2 (`metrics.metricVersion = '2'`) derives per-turn
  global stability from typed structural deltas, computes a true cumulative
  mean score, and counts passive/ongoing population losses in the
  civilian-impact proxy. Exports from engine versions before 0.3.0 use older
  conventions; rerunning an old configuration does NOT reproduce historical
  engine behavior (event text, catalog v3 effects, stop semantics, and metric
  derivations have changed). Compare runs only within matching
  code/metric/catalog versions.
- Catalog v3 implements the already-declared `full_invasion` side effect of
  ending the attacker–target alliance; records from earlier catalog versions
  keep their original v1/v2 event text.

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
- Terminal/interrupted runs are read from SQLite after a restart (list, detail,
  state, events, nation detail, metrics, replay, export), but there is no
  resume: an archived configuration can only be rerun as a new simulation.
- `safetyMode` is a deprecated, declared-only config field (both values behave
  identically); the persistent fiction notice is enforced in code. Scenario
  `escalationBaseline` and the `military_strain` ongoing-effect value were
  removed as unused no-ops.
- No authentication layer (local research tool by design). `LOG_LEVEL` selects
  the Fastify log level (`silent` by default).
- LLM telemetry records only the final successful attempt of each call: failed
  calls and error details are not written to `llm_calls`. Response caching is
  intentionally absent (stochastic calls are never deduplicated); there is no
  proactive rate limiting beyond 429 retry/backoff.
- Bootstrap CIs are naive percentile intervals and need enough replicates to
  mean anything.
