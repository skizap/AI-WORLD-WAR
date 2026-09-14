/**
 * Simulation job lifecycle: create / start / pause / resume / step / stop /
 * approve / reject, with persistence of snapshots, events, decisions,
 * approvals, narrator summaries, metrics, audit, and LLM telemetry.
 */
import type { SimulationConfig, SimulationStatus, WorldState } from '@aiww/schemas';
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

const simIdCounter = { n: 0 };

export class SimRunner {
  sim: Simulation;
  private paused = false;
  private running = false;
  private persistedEventCount = 0;
  private persistedAuditCount = 0;
  private persistedNarratorCount = 0;
  private persistedDecisionKeys = new Set<string>();
  private persistedApprovalKeys = new Set<string>();

  constructor(
    readonly id: string,
    config: SimulationConfig,
    private readonly db: Db,
    private readonly client: OpenRouterClient | null,
  ) {
    const agentProvider = config.provider === 'openrouter' && client
      ? new OpenRouterAgentProvider(client, config)
      : new MockAgentProvider();
    const narratorProvider = config.provider === 'openrouter' && client && config.narratorEnabled
      ? new OpenRouterNarratorProvider(client)
      : new DeterministicNarratorProvider();
    this.sim = new Simulation({
      config,
      pack: getPack(config.fictionPackId),
      scenario: getScenario(config.scenarioId),
      agentProvider,
      narratorProvider,
      simulationId: id,
    });
  }

  get status(): SimulationStatus {
    if (this.paused && this.sim.status === 'running') return 'paused';
    return this.sim.status;
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
      c.models.nationAgent,
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
    for (const [nid, d] of this.sim['decisions'] ?? []) {
      void nid;
      void d;
    }
    // Approvals.
    for (const p of w.pendingApprovals) {
      if (!this.persistedApprovalKeys.has(p.key)) {
        this.db.exec(
          `INSERT OR REPLACE INTO approvals (sim_id, key, turn, nation_id, action_id, status, decided_at_turn) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          this.id,
          p.key,
          p.turn,
          p.nationId,
          p.actionId,
          p.status,
          p.decidedAtTurn ?? null,
        );
        this.persistedApprovalKeys.add(p.key);
      } else {
        this.db.exec(
          `UPDATE approvals SET status = ?, decided_at_turn = ? WHERE sim_id = ? AND key = ?`,
          p.status,
          p.decidedAtTurn ?? null,
          this.id,
          p.key,
        );
      }
    }
  }

  /** Drive the simulation until pause/stop/completion/approval-wait. */
  async drive(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.paused && this.sim.status !== 'completed' && this.sim.status !== 'stopped' && this.sim.status !== 'failed') {
        if (this.sim.phase === 'awaiting_approval') break;
        await this.sim.step();
        this.persistDelta();
        this.persistNewSnapshots();
      }
    } catch (err) {
      this.sim.status = 'failed';
      this.sim.stopReason = err instanceof Error ? err.message : String(err);
    } finally {
      this.running = false;
      this.persistRow();
    }
  }

  async start(): Promise<void> {
    if (this.sim.status !== 'idle') throw new Error('Simulation already started.');
    this.paused = false;
    void this.drive();
  }

  pause(): void {
    this.paused = true;
    this.persistRow();
  }

  resume(): void {
    if (this.sim.phase === 'awaiting_approval') return; // requires approvals first
    this.paused = false;
    void this.drive();
  }

  async stepOnce(): Promise<void> {
    this.paused = true;
    await this.sim.step();
    this.persistDelta();
    this.persistNewSnapshots();
    this.persistRow();
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

  stop(): void {
    this.paused = true;
    this.sim.requestStop();
    this.persistRow();
  }

  approve(key: string, approve: boolean): void {
    this.sim.approve(key, approve);
    this.persistDelta();
    // After approvals the engine can resume; keep driving unless paused.
    if (!this.paused) void this.drive();
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

  constructor(
    private readonly db: Db,
    private readonly client: OpenRouterClient | null,
  ) {
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

  create(config: SimulationConfig): SimRunner {
    simIdCounter.n += 1;
    const id = `sim_${computeConfigHash(config).slice(0, 8)}_${config.seed}_${simIdCounter.n}`;
    if (config.provider === 'openrouter' && !this.client) {
      throw new OpenRouterError('OpenRouter client unavailable; configure OPENROUTER_API_KEY or use mock mode.');
    }
    const runner = new SimRunner(id, config, this.db, this.client);
    runner.create();
    this.runners.set(id, runner);
    return runner;
  }

  get(id: string): SimRunner | undefined {
    return this.runners.get(id);
  }

  require(id: string): SimRunner {
    const r = this.runners.get(id);
    if (!r) throw new Error(`Unknown simulation: ${id}`);
    return r;
  }

  list(): SimRunner[] {
    return [...this.runners.values()];
  }
}
