/**
 * Strict validation of model-produced agent responses.
 *
 * The schema rejects: unknown action ids, unknown nation ids, self-targeting,
 * duplicates beyond config, over-limit action counts, unsupported parameters,
 * empty/overlong messages, and any tool calls, code, shell commands, URLs, or
 * operational instructions inside action fields. Model output never mutates
 * state directly — only validated actions reach the engine.
 */
import {
  AgentResponse,
  type AgentAction,
  type CatalogEntry,
  type SimulationConfig,
  type ValidationReport,
  type WorldState,
} from '@aiww/schemas';

const DISALLOWED_CONTENT =
  /(https?:\/\/|www\.)|```|`|<script|\$\{|\b(?:sudo|chmod|rm\s+-rf|curl|wget|ssh\s|bash\s-c|powershell)\b|\bimport\s+\w|\beval\s*\(|\bexec\s*\(|SELECT\s+.+\s+FROM|INSERT\s+INTO|tool_call|function_call/i;

export function containsDisallowedContent(text: string): boolean {
  return DISALLOWED_CONTENT.test(text);
}

export interface ValidatedResponse {
  report: ValidationReport;
  response: AgentResponse | null;
}

/**
 * Validate a parsed-or-unparsed model response for `nationId` against the
 * current world state and configuration. Returns accepted/rejected actions
 * and a normalized response (with fallback `wait` if nothing is valid).
 */
export function validateAgentResponse(
  w: WorldState,
  config: SimulationConfig,
  catalog: CatalogEntry[],
  nationId: string,
  turn: number,
  raw: unknown,
): ValidatedResponse {
  const parsed = AgentResponse.safeParse(raw);
  if (!parsed.success) {
    return {
      report: {
        nationId,
        accepted: [],
        rejected: [],
        responseRejected: 'Schema validation failed: response does not match the required JSON shape.',
        fallbackUsed: true,
      },
      response: null,
    };
  }

  const response = parsed.data;
  const rejected: ValidationReport['rejected'] = [];
  const accepted: AgentAction[] = [];
  const seen = new Set<string>();
  let nonMessageCount = 0;
  let messageCount = 0;

  if (response.nation_id !== nationId) {
    return {
      report: {
        nationId,
        accepted: [],
        rejected: [],
        responseRejected: `Response nation_id '${response.nation_id}' does not match the acting nation '${nationId}'.`,
        fallbackUsed: true,
      },
      response: null,
    };
  }

  let rationale = response.public_rationale.trim();
  if (rationale.length === 0) rationale = 'No rationale provided.';
  if (rationale.length > config.limits.maxRationaleLength) {
    rationale = rationale.slice(0, config.limits.maxRationaleLength);
  }

  const normalized: AgentResponse = {
    nation_id: response.nation_id,
    turn: response.turn,
    public_rationale: rationale,
    actions: [],
  };

  for (const action of response.actions) {
    const reject = (reason: string) => rejected.push({ action, reason });

    if (containsDisallowedContent(action.action_id)) {
      reject('action_id contains disallowed content (URLs, code, or tool syntax).');
      continue;
    }
    const entry = catalog.find((a) => a.id === action.action_id);
    if (!entry) {
      reject(`Unknown action id '${action.action_id}'. Only cataloged actions are allowed.`);
      continue;
    }

    // Target validation.
    if (entry.requiresTarget || action.target_nation_id !== undefined) {
      if (entry.requiresTarget && action.target_nation_id === undefined && !entry.targetOptional) {
        reject(`Action '${action.action_id}' requires a target_nation_id.`);
        continue;
      }
      if (action.target_nation_id !== undefined) {
        if (!w.nations[action.target_nation_id]) {
          reject(`Unknown target nation '${action.target_nation_id}'.`);
          continue;
        }
        if (action.target_nation_id === nationId && entry.requiresTarget) {
          reject('Self-targeting is not allowed for this action.');
          continue;
        }
      }
    }

    // Duplicate policy.
    const dupKey = `${action.action_id}:${action.target_nation_id ?? ''}`;
    if (!config.limits.allowDuplicates && !entry.messageAllowed && seen.has(dupKey)) {
      reject(`Duplicate action '${action.action_id}' for the same target is not allowed.`);
      continue;
    }

    // Message field validation.
    if (action.message !== undefined) {
      const msg = action.message.trim();
      if (!entry.messageAllowed && msg.length > 0) {
        reject(`Action '${action.action_id}' does not accept a message field.`);
        continue;
      }
      if (msg.length > config.limits.maxMessageLength) {
        reject(`Message exceeds the maximum length of ${config.limits.maxMessageLength} characters.`);
        continue;
      }
      if (msg.length > 0 && containsDisallowedContent(msg)) {
        reject('Message contains disallowed content (URLs, code, or tool syntax).');
        continue;
      }
    }

    // Unsupported parameters.
    if (action.parameters !== undefined && Object.keys(action.parameters).length > 0) {
      reject('Unsupported parameters: this catalog version accepts no action parameters.');
      continue;
    }

    // Count limits.
    if (entry.messageAllowed && entry.id === 'message') {
      if (messageCount >= config.limits.messagePerTurn) {
        reject(`Message limit of ${config.limits.messagePerTurn} per turn exceeded.`);
        continue;
      }
      messageCount++;
    } else {
      if (nonMessageCount >= config.limits.nonMessagePerTurn) {
        reject(`Non-message action limit of ${config.limits.nonMessagePerTurn} per turn exceeded.`);
        continue;
      }
      nonMessageCount++;
    }

    seen.add(dupKey);
    accepted.push(action);
  }

  normalized.actions = accepted;

  const fallbackUsed = accepted.length === 0;
  if (fallbackUsed) {
    const waitAction: AgentAction = { action_id: 'wait' };
    accepted.push(waitAction);
    normalized.actions = [waitAction];
  }

  return {
    report: { nationId, accepted, rejected, fallbackUsed },
    response: normalized,
  };
}

/**
 * One deterministic repair attempt: extract the first JSON object from a raw
 * model output (stripping code fences / prose) and coerce obviously-repairable
 * fields. Returns null when no plausible object can be recovered.
 */
export function repairAttempt(raw: string, nationId: string, turn: number): AgentResponse | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  // Strip markdown fences.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Find first { and last }.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  const slice = text.slice(first, last + 1);
  try {
    const obj = JSON.parse(slice) as Record<string, unknown>;
    // Coerce common shape drift.
    const actions = Array.isArray(obj['actions']) ? obj['actions'] : [];
    const coercedActions = (actions as Record<string, unknown>[])
      .map((a) => ({
        action_id: typeof a['action_id'] === 'string' ? (a['action_id'] as string).trim() : null,
        target_nation_id: typeof a['target_nation_id'] === 'string' ? (a['target_nation_id'] as string) : undefined,
        message: typeof a['message'] === 'string' ? (a['message'] as string).slice(0, 280) : undefined,
      }))
      .filter((a) => a.action_id !== null)
      .map((a) => ({
        action_id: a.action_id as string,
        target_nation_id: a.target_nation_id,
        message: a.message,
      }));
    if (coercedActions.length === 0) return null;
    return {
      nation_id: typeof obj['nation_id'] === 'string' ? (obj['nation_id'] as string) : nationId,
      turn: typeof obj['turn'] === 'number' ? (obj['turn'] as number) : turn,
      public_rationale:
        typeof obj['public_rationale'] === 'string' && (obj['public_rationale'] as string).trim().length > 0
          ? (obj['public_rationale'] as string).slice(0, 1000)
          : 'Repaired response: rationale was missing or invalid.',
      actions: coercedActions,
    };
  } catch {
    return null;
  }
}
