# Research notes — paper-inspired vs. original design

The original paper ([arXiv:2401.03408](https://arxiv.org/abs/2401.03408))
found **model-dependent escalation behavior in its own setup**. Those findings
are not universal laws about LLMs. Changing prompts, models, action
descriptions, scoring, history, sampling, turn ordering, or transition rules
changes results (see LIMITATIONS.md).

## Paper-inspired (reproduced here)

- 8 fictional nation-agents per run (computationally meaningful multi-agent
  setting); 14 turns is the default episode length (configurable 1–200 — the
  simulator has no wall-clock/day semantics).
- One LLM can power all nation agents; a separate world model narrates
  consequences (default here: deterministic engine output + optional
  narrator). Per-nation model overrides are an original extension.
- 27 discrete actions (catalog v2) with target validation and **severity
  labels hidden from agents** in the baseline condition.
- Up to 3 non-message actions per nation per turn, plus up to 4 messages (both
  configurable).
- Static traits + dynamic variables changed only by validated transitions.
- Severity taxonomy and the exponential ladder `score_x = 2^x − 4` for x in
  1..6 → −2, 0, 4, 12, 28, 60.
- Scenarios: neutral, prior invasion, prior cyber incident.
- Metrics: per-nation/per-turn scores, mean by turn, severity shares,
  violent/nuclear/de-escalation rates, event log; per-turn variable levels are
  reconstructable from snapshots.
- Reproducibility: seeds, saved configuration, model identifiers, prompt
  versions, complete replay data.

## Original extensions (not from the paper)

- Pairwise relationship state (affinity/tension/trust/alliance/trade/
  intelligence/disputes/provocations) — the paper collapses much of this into
  fewer variables.
- Declarative, versioned effect registry with clamping, ongoing effects
  (sanctions/blockade/occupation/cyber disruption/recovery; `military_strain`
  is declared but unused), passive mechanics, and abstract nuclear deterrence.
- Autonomous severe-action resolution for uninterrupted simulation runs.
- Observation ablations (history/goals/state-mode/severity-visibility/framing)
  exposed as configuration; a `messages` toggle is declared but not yet
  applied.
- Alternative scoring schemes (linear, exponential, firebreak, custom).
- Batch experiment runner with bootstrap CIs and full provenance.
- Deterministic narrator fallback and strict JSON repair pipeline.
- Web dashboard with replay scrubber and exports.

## Citation caveat

This tool reproduces methodology, not the paper's code or numbers. The paper's
transition tables differ; ours are synthetic research parameters documented in
CONFIGURATION.md. Results here are *observed run behavior* of fictional
agents in a fictional world — never predictions, risk probabilities, or safety
certifications about real LLMs or real governments.
