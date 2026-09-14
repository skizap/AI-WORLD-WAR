/**
 * SQLite persistence via node:sqlite (built into Node >= 22.5), behind a
 * repository-style API so a PostgreSQL backend can replace it later.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

// node:sqlite is a Node built-in (>= 22.5); loaded via createRequire so that
// bundler-based test runners do not try to resolve it as a package.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export interface SimulationRow {
  id: string;
  status: string;
  config_json: string;
  scenario_id: string;
  seed: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export class Db {
  private db: import('node:sqlite').DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS simulations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        seed TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        world_json TEXT NOT NULL,
        PRIMARY KEY (sim_id, turn)
      );
      CREATE TABLE IF NOT EXISTS events (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (sim_id, turn, seq)
      );
      CREATE TABLE IF NOT EXISTS actions (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        seq_in_turn INTEGER NOT NULL,
        nation_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        target_id TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        response_json TEXT,
        PRIMARY KEY (sim_id, turn, seq_in_turn)
      );
      CREATE TABLE IF NOT EXISTS decisions (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        nation_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        PRIMARY KEY (sim_id, turn, nation_id)
      );
      CREATE TABLE IF NOT EXISTS narrator (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (sim_id, turn)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        sim_id TEXT NOT NULL,
        key TEXT NOT NULL,
        turn INTEGER NOT NULL,
        nation_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        status TEXT NOT NULL,
        decided_at_turn INTEGER,
        PRIMARY KEY (sim_id, key)
      );
      CREATE TABLE IF NOT EXISTS metrics (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        metrics_json TEXT NOT NULL,
        PRIMARY KEY (sim_id, turn)
      );
      CREATE TABLE IF NOT EXISTS llm_calls (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        request_id TEXT,
        latency_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        finish_reason TEXT,
        retries INTEGER,
        status TEXT NOT NULL,
        error_status INTEGER,
        error_message TEXT,
        ts TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        spec_json TEXT NOT NULL,
        status TEXT NOT NULL,
        code_version TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        records_json TEXT NOT NULL,
        aggregate_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit (
        sim_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload TEXT,
        ts TEXT NOT NULL
      );
    `);
  }

  exec(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...(params as never[]));
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  close(): void {
    this.db.close();
  }
}
