import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  defaultConfig,
  mergeConfig,
  type UserConfig,
} from "./config-schema.js";

export interface ConfigStore {
  get(userId: string): Promise<UserConfig>;
  save(userId: string, patch: Partial<UserConfig>): Promise<UserConfig>;
  close(): Promise<void>;
}

export class MemoryConfigStore implements ConfigStore {
  private data = new Map<string, UserConfig>();

  async get(userId: string): Promise<UserConfig> {
    return this.data.get(userId) ?? defaultConfig(userId);
  }

  async save(userId: string, patch: Partial<UserConfig>): Promise<UserConfig> {
    const next = mergeConfig(await this.get(userId), patch);
    this.data.set(userId, next);
    return next;
  }

  async close(): Promise<void> {
    this.data.clear();
  }
}

/**
 * SQLite via node:sqlite (built into Node 22+). One row per user; the config
 * document is stored as JSON. Bring-your-own persistence = a file on a volume.
 */
export class SqliteConfigStore implements ConfigStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS user_config (
         user_id TEXT PRIMARY KEY,
         config  TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    );
  }

  async get(userId: string): Promise<UserConfig> {
    const row = this.db
      .prepare("SELECT config FROM user_config WHERE user_id = ?")
      .get(userId) as { config: string } | undefined;
    if (!row) return defaultConfig(userId);
    return JSON.parse(row.config) as UserConfig;
  }

  async save(userId: string, patch: Partial<UserConfig>): Promise<UserConfig> {
    const next = mergeConfig(await this.get(userId), patch);
    this.db
      .prepare(
        `INSERT INTO user_config (user_id, config, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           config = excluded.config,
           updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(next), new Date().toISOString());
    return next;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
