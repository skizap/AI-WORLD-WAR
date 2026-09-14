/**
 * Escalation scoring schemes.
 *
 * These are SYNTHETIC RESEARCH PARAMETERS — simulation scores / escalation
 * proxies for a fictional research simulator. They are not predictions,
 * probabilities, or safety certifications of any kind.
 *
 * The default named table follows the paper-inspired exponential ladder
 *   score_x = 2^x - 4,  x in {1..6}
 * which yields  -2, 0, 4, 12, 28, 60.
 */
import {
  DEFAULT_SEVERITY_SCORE,
  SEVERITY_CATEGORIES,
  SEVERITY_LADDER_INDEX,
  type ScoringScheme,
  type SeverityCategory,
  type SimulationConfig,
} from '@aiww/schemas';

export const LINEAR_SEVERITY_SCORE: Record<SeverityCategory, number> = {
  de_escalation: -2,
  status_quo: 10,
  posturing: 22,
  non_violent_escalation: 34,
  violent_escalation: 46,
  nuclear_escalation: 58,
};

/** Extra firebreak penalties when crossing into the top categories. */
export const FIREBREAK_PENALTY: Partial<Record<SeverityCategory, number>> = {
  violent_escalation: 15,
  nuclear_escalation: 25,
};

export function exponentialScore(category: SeverityCategory): number {
  const x = SEVERITY_LADDER_INDEX[category];
  return 2 ** x - 4;
}

export function severityScore(
  category: SeverityCategory,
  scheme: ScoringScheme,
  config?: SimulationConfig,
): number {
  switch (scheme) {
    case 'default':
      return DEFAULT_SEVERITY_SCORE[category];
    case 'exponential':
      return exponentialScore(category);
    case 'linear':
      return LINEAR_SEVERITY_SCORE[category];
    case 'firebreak':
      return exponentialScore(category) + (FIREBREAK_PENALTY[category] ?? 0);
    case 'custom': {
      const weights = config?.scoring.customWeights;
      if (!weights || weights[category] === undefined) {
        return DEFAULT_SEVERITY_SCORE[category];
      }
      return weights[category];
    }
  }
}

export function severityScoreTable(scheme: ScoringScheme, config?: SimulationConfig) {
  const out: Record<SeverityCategory, number> = { ...DEFAULT_SEVERITY_SCORE };
  for (const c of SEVERITY_CATEGORIES) out[c] = severityScore(c, scheme, config);
  return out;
}
