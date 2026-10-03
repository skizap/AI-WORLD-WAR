/**
 * Autonomous simulation lifecycle (create/start/stop) with persistence of
 * snapshots, events, decisions, actions, narrator summaries, metrics, audit,
 * and LLM telemetry.
 */
import { randomUUID } from 'node:crypto';
import { resolveNationModel, type SimulationConfig, type SimulationStatus, type WorldState } from '@aiww/schemas';
import {
  DeterministicNarratorProvider,
  MockAgentProvider,
  Simulation,
  computeConfigHash,
  getPack,
  getScenario,
} from '@aiww/engine';
import { OpenRouterAgentProvider, OpenRouterNarratorProvider, onLlmCall } from './llm-providers.js';
import { OpenRouterClient, OpenRouterError } from './openrouter.js';
import type { Db } from './db.js';

export class SimRunner {
  sim: Simulation;
  private running = false;
  private persistedEventCount = 0;
  private persistedAuditCount = 0;
  private persistedNarratorCount = 0;
  private persistedDecisionKeys = new Set<string>();

  constructor(
    readonly id: string,
    config: SimulationConfig,
    private readonly db: Db,
    private readonly client: OpenRouterClient | null,
  ) {
    const simulationId = id;
    const agentProvider = config.provider === 'openrouter' && client
      ? new OpenRouterAgentProvider(client, config, simulationId)
      : new MockAgentProvider();
    const narratorProvider = config.provider === 'openrouter' && client && config.narratorEnabled
      ? new OpenRouterNarratorProvider(client, config, simulationId)
      : new DeterministicNarratorProvider();
    this.sim = new Simulation({
      config,
      pack: getPack(config.fictionPackId),
      scenario: getScenario(config.scenarioId),
      agentProvider,
      narratorProvider,
      simulationId,
    });
  }

  get status(): SimulationStatus {
    return this.sim.status;
  }

  /** A stop has been requested but the current turn is still finishing. */
  get stopPending(): boolean {
    return this.sim.stopRequested && this.status === 'running';
  }

  get turn(): number {
    return this.sim.world.turn;
  }

  get totalTurns(): number {
    return this.sim.config.totalTurns;
  }

  get config(): SimulationConfig {
    return this.sim.config;
  }

  snapshotTurns(): number[] {
    return this.sim.snapshotTurns();
  }

  getSnapshot(turn: number): WorldState | undefined {
    return this.sim.getSnapshot(turn);
  }

  allSnapshots(): WorldState[] {
    return this.sim.allSnapshots();
  }

  private persistRow(): void {
    const now = new Date().toISOString();
    const c = this.sim.config;
    this.db.exec(
      `INSERT INTO simulations (id, status, config_json, scenario_id, seed, model, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      this.id,
      this.status,
      JSON.stringify(c),
      c.scenarioId,
      c.seed,
      new Set(getPack(c.fictionPackId).nations.map((nation) => resolveNationModel(c, nation.id))).size > 1
        ? 'mixed'
        : resolveNationModel(c, getPack(c.fictionPackId).nations[0]?.id ?? ''),
      c.provider,
      now,
      now,
    );
  }

  create(): void {
    this.persistRow();
    this.persistSnapshot(0);
  }

  private persistedSnapshotTurns = new Set<number>();

  private persistSnapshot(turn: number): void {
    this.persistedSnapshotTurns.add(turn);
    const snap = this.sim.getSnapshot(turn);
    if (!snap) return;
    this.db.exec(
      `INSERT OR REPLACE INTO snapshots (sim_id, turn, world_json) VALUES (?, ?, ?)`,
      this.id,
      turn,
      JSON.stringify(snap),
    );
  }

  private persistDelta(): void {
    const w: WorldState = this.sim.world;
    // Events (event stream is append-only).
    while (this.persistedEventCount < w.events.length) {
      const e = w.events[this.persistedEventCount];
      this.db.exec(
        `INSERT OR REPLACE INTO events (sim_id, turn, seq, event_json) VALUES (?, ?, ?, ?)`,
        this.id,
        e.turn,
        e.seq,
        JSON.stringify(e),
      );
      if ((e.type === 'action' || e.type === 'rejection') && e.actionId && e.actorId) {
        this.db.exec(
          `INSERT OR REPLACE INTO actions (sim_id, turn, seq_in_turn, nation_id, action_id, target_id, status, reason, response_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          this.id,
          e.turn,
          e.seq,
          e.actorId,
          e.actionId,
          e.targetId ?? null,
          e.status,
          e.reason ?? null,
          JSON.stringify(e),
        );
      }
      this.persistedEventCount += 1;
    }
    // Audit.
    while (this.persistedAuditCount < w.auditEvents.length) {
      const a = w.auditEvents[this.persistedAuditCount];
      this.db.exec(
        `INSERT INTO audit (sim_id, turn, type, actor, payload, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        this.id,
        a.turn,
        a.type,
        a.actor,
        a.payload ?? null,
        new Date().toISOString(),
      );
      this.persistedAuditCount += 1;
    }
    // Narrator summaries.
    while (this.persistedNarratorCount < w.narratorSummaries.length) {
      const ns = w.narratorSummaries[this.persistedNarratorCount];
      this.db.exec(
        `INSERT OR REPLACE INTO narrator (sim_id, turn, summary_json, source) VALUES (?, ?, ?, ?)`,
        this.id,
        ns.turn,
        JSON.stringify(ns),
        ns.source,
      );
      this.persistedNarratorCount += 1;
    }
    // Decisions.
    for (const d of this.sim.allDecisionRecords()) {
      const key = `${d.turn}:${d.nationId}`;
      if (this.persistedDecisionKeys.has(key)) continue;
      this.db.exec(
        `INSERT OR REPLACE INTO decisions (sim_id, turn, nation_id, response_json, report_json, provider, model, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        this.id,
        d.turn,
        d.nationId,
        JSON.stringify(d.response),
        JSON.stringify(d.report),
        d.provider,
        d.model,
        d.status,
      );
      this.persistedDecisionKeys.add(key);
    }
  }

  /** Drive the simulation autonomously until stop, completion, or failure. */
  async drive(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.sim.status !== 'completed' && this.sim.status !== 'stopped' && this.sim.status !== 'failed') {
        await this.sim.step();
        // Each turn's events/decisions/snapshot/metrics persist atomically so a
        // crash cannot claim a fully saved turn when only some records landed.
        this.db.withTransaction(() => {
          this.persistDelta();
          this.persistNewSnapshots();
        });
      }
    } catch (err) {
      // Failures finalize as explicit, immutable partial records; everything
      // persisted before the failure stays readable.
      this.sim.finalizeFailure(err instanceof Error ? err.message : String(err));
      this.db.withTransaction(() => {
        this.persistDelta();
        this.persistNewSnapshots();
      });
    } finally {
      this.running = false;
      this.persistRow();
    }
  }

  async start(): Promise<void> {
    if (this.sim.status !== 'idle') throw new Error('Simulation already started.');
    void this.drive();
  }

  /** Persist any snapshots produced by the engine that are not yet stored. */
  private persistNewSnapshots(): void {
    for (const t of this.sim.snapshotTurns()) {
      if (!this.persistedSnapshotTurns.has(t)) {
        this.persistSnapshot(t);
        this.persistMetrics(t);
      }
    }
  }

  /** Set the runtime stop flag and persist the request without prematurely
   * writing a terminal status. The current turn is finished and persisted by
   * the engine before the run finalizes as stopped; repeated requests are
   * idempotent. */
  stop(): void {
    this.sim.requestStop();
    if (this.status !== 'running' || this.sim.stopRequested) {
      // Only persist non-terminal bookkeeping while the stop is pending.
      if (this.sim.status !== 'completed' && this.sim.status !== 'stopped' && this.sim.status !== 'failed') {
        this.persistRow();
      }
    }
  }

  private persistMetrics(turn: number): void {
    const m = this.sim.computeMetrics();
    this.db.exec(
      `INSERT OR REPLACE INTO metrics (sim_id, turn, metrics_json) VALUES (?, ?, ?)`,
      this.id,
      turn,
      JSON.stringify(m),
    );
  }
}

export class RunnerManager {
  private runners = new Map<string, SimRunner>();
  /** Terminal runners kept in memory for fast reads; older ones are evicted
   * once SQLite reads are authoritative for them. */
  private static TERMINAL_RETENTION = 8;

  constructor(
    private readonly db: Db,
    private readonly client: OpenRouterClient | null,
  ) {
    // Runs whose process ended while still marked `running` become explicit,
    // read-only interrupted records; no agent loop is ever resumed.
    const now = new Date().toISOString();
    const stale = this.db.all<{ id: string }>(`SELECT id FROM simulations WHERE status = 'running'`);
    for (const row of stale) {
      this.db.exec(
        `UPDATE simulations SET status = 'interrupted', updated_at = ? WHERE id = ? AND status = 'running'`,
        now,
        row.id,
      );
    }
    // LLM telemetry -> llm_calls table (never contains secrets or raw prompts).
    onLlmCall((audit) => {
      const a = audit as Record<string, unknown>;
      try {
        this.db.exec(
          `INSERT INTO llm_calls (sim_id, turn, role, model, request_id, latency_ms, prompt_tokens, completion_tokens, finish_reason, retries, status, error_status, error_message, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          String(a['simulationId'] ?? ''),
          Number(a['turn'] ?? 0),
          String(a['role'] ?? ''),
          String(a['model'] ?? ''),
          a['requestId'] ? String(a['requestId']) : null,
          Number(a['latencyMs'] ?? 0),
          a['promptTokens'] ? Number(a['promptTokens']) : null,
          a['completionTokens'] ? Number(a['completionTokens']) : null,
          a['finishReason'] ? String(a['finishReason']) : null,
          Number(a['retries'] ?? 0),
          String(a['status'] ?? 'ok'),
          null,
          null,
          new Date().toISOString(),
        );
      } catch {
        // telemetry must never break the run
      }
    });
  }

  private static isTerminal(status: SimulationStatus): boolean {
    return status === 'completed' || status === 'stopped' || status === 'failed';
  }

  /** Evict the oldest terminal runners beyond the bounded retention window.
   * Map iteration order is insertion order, so the earliest created terminal
   * runners are evicted first. */
  private evictTerminal(): void {
    const terminal = [...this.runners.entries()].filter(([, r]) => RunnerManager.isTerminal(r.status));
    if (terminal.length <= RunnerManager.TERMINAL_RETENTION) return;
    for (const [id] of terminal.slice(0, terminal.length - RunnerManager.TERMINAL_RETENTION)) {
      this.runners.delete(id);
    }
  }

  create(config: SimulationConfig): SimRunner {
    const id = `sim_${computeConfigHash(config).slice(0, 8)}_${randomUUID().slice(0, 8)}`;
    if (config.provider === 'openrouter' && (!this.client || !this.client.apiKeyPresent)) {
      throw new OpenRouterError('OpenRouter client unavailable; configure OPENROUTER_API_KEY or use mock mode.');
    }
    const runner = new SimRunner(id, config, this.db, this.client);
    runner.create();
    this.runners.set(id, runner);
    this.evictTerminal();
    return runner;
  }

  get(id: string): SimRunner | undefined {
    this.evictTerminal();
    return this.runners.get(id);
  }

  require(id: string): SimRunner {
    const r = this.get(id);
    if (!r) throw new Error(`Unknown simulation: ${id}`);
    return r;
  }

  list(): SimRunner[] {
    this.evictTerminal();
    return [...this.runners.values()];
  }
}
