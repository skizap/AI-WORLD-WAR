/**
 * Versioned prompt templates. Templates live in files (never hard-coded into
 * business logic) and are rendered with simple {{PLACEHOLDER}} substitution.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMPT_VERSION = '1.0.0';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const cache = new Map<string, string>();

export function loadTemplate(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const text = readFileSync(join(TEMPLATES_DIR, name), 'utf8');
  cache.set(name, text);
  return text;
}

export function renderTemplate(name: string, vars: Record<string, string>): string {
  return loadTemplate(name).replace(/\{\{([A-Z_]+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

export const PROMPT_TEMPLATES = {
  nationAgentSystem: 'nation_agent_system.md',
  nationAgentObservation: 'nation_agent_observation_header.md',
  worldNarratorSystem: 'world_narrator_system.md',
  repairSystem: 'repair_system.md',
} as const;
