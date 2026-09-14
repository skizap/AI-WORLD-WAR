/**
 * OpenRouterClient — the required gateway for all production model calls.
 *
 * Base URL /chat/completions /models per https://openrouter.ai/docs/quickstart.
 * Supports per-role model selection, timeouts, retries with exponential
 * backoff, rate-limit handling, structured output where supported (with
 * JSON-instructions fallback + audit), request deduplication/response caching,
 * token/latency/request-id capture, and provider-error normalization.
 * API keys are never logged and never serialized into audit records.
 */
import { createHash } from 'node:crypto';
import type { LlmCallAudit } from '@aiww/schemas';
import type { Env } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  role: 'nation_agent' | 'world_narrator' | 'repair';
  temperature: number;
  maxTokens: number;
  simulationId: string;
  turn: number;
  /** Attempt structured JSON output; falls back to instructions if unsupported. */
  jsonMode?: boolean;
}

export interface ChatResult {
  content: string;
  raw: unknown;
  audit: LlmCallAudit;
  usedFallback: boolean;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface CachedEntry {
  expiresAt: number;
  result: ChatResult;
}

export class OpenRouterClient {
  private catalogCache: { expiresAt: number; models: OpenRouterModelInfo[] } | null = null;
  private responseCache = new Map<string, CachedEntry>();
  private jsonModeUnsupported = new Set<string>();

  constructor(private readonly env: Env) {}

  get apiKeyPresent(): boolean {
    return this.env.OPENROUTER_API_KEY.length > 0;
  }

  modelFor(role: ChatOptions['role']): string {
    switch (role) {
      case 'nation_agent':
        return this.env.OPENROUTER_NATION_AGENT_MODEL;
      case 'world_narrator':
        return this.env.OPENROUTER_WORLD_NARRATOR_MODEL;
      case 'repair':
        return this.env.OPENROUTER_REPAIR_MODEL;
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost:5173',
      'X-Title': 'AI-WORLD-WAR research simulator',
    };
  }

  private cacheKey(model: string, messages: ChatMessage[], opts: ChatOptions): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          m: model,
          c: messages.map((x) => x.role + ':' + createHash('sha256').update(x.content).digest('hex').slice(0, 16)),
          t: opts.temperature,
          x: opts.maxTokens,
          j: opts.jsonMode && !this.jsonModeUnsupported.has(model),
        }),
      )
      .digest('hex');
  }

  /** Single chat completion with retries + backoff. Never throws raw fetch errors. */
  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const model = this.modelFor(opts.role);
    const key = this.cacheKey(model, messages, opts);
    const cached = this.responseCache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return {
        ...cached.result,
        audit: { ...cached.result.audit, status: 'cache_hit', latencyMs: 0 },
      };
    }

    if (!this.apiKeyPresent) {
      throw new OpenRouterError('OPENROUTER_API_KEY is not configured; switch to mock mode or set the key.');
    }

    const useJsonMode = opts.jsonMode !== false && !this.jsonModeUnsupported.has(model);
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    };
    if (useJsonMode) body.response_format = { type: 'json_object' };

    let retries = 0;
    let lastError: OpenRouterError | null = null;
    const started = Date.now();
    while (retries <= this.env.OPENROUTER_MAX_RETRIES) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.env.OPENROUTER_TIMEOUT_MS);
        const res = await fetch(`${this.env.OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429 || res.status >= 500) {
          lastError = new OpenRouterError(`provider error ${res.status}`, res.status);
          retries += 1;
          await sleep(this.env.OPENROUTER_RETRY_BASE_DELAY_MS * 2 ** (retries - 1));
          continue;
        }
        if (res.status === 400 && useJsonMode) {
          // Model or provider may not support response_format: fall back.
          this.jsonModeUnsupported.add(model);
          delete body.response_format;
          const retry = await this.chat(messages, { ...opts, jsonMode: false });
          retry.usedFallback = true;
          retry.audit.status = 'fallback';
          return retry;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new OpenRouterError(`OpenRouter request failed: ${res.status} ${text.slice(0, 200)}`, res.status);
        }
        const json = (await res.json()) as {
          id?: string;
          choices?: { message?: { content?: string }; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = json.choices?.[0]?.message?.content ?? '';
        const audit: LlmCallAudit = {
          simulationId: opts.simulationId,
          turn: opts.turn,
          role: opts.role,
          model,
          requestId: json.id,
          latencyMs: Date.now() - started,
          promptTokens: json.usage?.prompt_tokens,
          completionTokens: json.usage?.completion_tokens,
          finishReason: json.choices?.[0]?.finish_reason,
          retries,
          status: retries > 0 ? 'ok' : 'ok',
        };
        const result: ChatResult = { content, raw: json, audit, usedFallback: false };
        this.responseCache.set(key, { expiresAt: now + this.env.OPENROUTER_RESPONSE_CACHE_TTL_MS, result });
        return result;
      } catch (err) {
        if (err instanceof OpenRouterError) throw err;
        lastError = new OpenRouterError(err instanceof Error ? err.message : String(err));
        retries += 1;
        if (retries > this.env.OPENROUTER_MAX_RETRIES) break;
        await sleep(this.env.OPENROUTER_RETRY_BASE_DELAY_MS * 2 ** (retries - 1));
      }
    }
    throw lastError ?? new OpenRouterError('OpenRouter request failed');
  }

  /** Model catalog with short configurable caching. */
  async listModels(force = false): Promise<OpenRouterModelInfo[]> {
    const now = Date.now();
    if (!force && this.catalogCache && this.catalogCache.expiresAt > now) {
      return this.catalogCache.models;
    }
    if (!this.apiKeyPresent) throw new OpenRouterError('OPENROUTER_API_KEY is not configured.');
    const res = await fetch(`${this.env.OPENROUTER_BASE_URL}/models`, { headers: this.headers() });
    if (!res.ok) throw new OpenRouterError(`catalog fetch failed: ${res.status}`, res.status);
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const models: OpenRouterModelInfo[] = (json.data ?? []).map((m) => ({
      id: String(m['id'] ?? ''),
      name: typeof m['name'] === 'string' ? (m['name'] as string) : undefined,
      contextLength: typeof m['context_length'] === 'number' ? (m['context_length'] as number) : undefined,
      pricing: m['pricing'] as Record<string, string> | undefined,
    }));
    this.catalogCache = { expiresAt: now + this.env.OPENROUTER_CATALOG_CACHE_TTL_MS, models };
    return models;
  }

  /** Connectivity check without exposing secrets. */
  async health(): Promise<{ ok: boolean; detail: string }> {
    if (!this.apiKeyPresent) return { ok: false, detail: 'API key not configured (mock mode available).' };
    try {
      await this.listModels();
      return { ok: true, detail: 'OpenRouter reachable; catalog fetched.' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

export interface OpenRouterModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  pricing?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
