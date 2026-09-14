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

Narrator summaries are fed back into later observations; a narrative model can
shift agent behavior beyond the engine's recorded state. The deterministic
fallback exists for reliability, and narrator source is recorded per turn —
but narrator influence is a known confound.

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
- In-flight LLM calls are not durable across server restarts (completed turns
  are; the current partial turn resumes from the last snapshot). Mock mode is
  fully restart-safe.
- No authentication layer (local research tool by design).
- Bootstrap CIs are naive percentile intervals and need enough replicates to
  mean anything.
