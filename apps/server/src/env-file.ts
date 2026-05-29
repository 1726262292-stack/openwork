import { getDb } from "./db.js";
import type { ServerConfig } from "./types.js";
import {
  deleteEnvVar,
  getEnvVar,
  InvalidEnvKeyError,
  isReservedEnvKey,
  isValidEnvKey,
  listEnvVars,
  readEnvForInjection,
  upsertEnvVars,
  type EnvEntry,
  type EnvRecord,
} from "@openwork/desktop-db";
import { openDb } from "@openwork/desktop-db";
import type { DesktopDb } from "@openwork/desktop-db";

export { isValidEnvKey, isReservedEnvKey, InvalidEnvKeyError };
export type { EnvRecord, EnvEntry };

/**
 * DB-backed user environment variables (replaces the env.json file).
 *
 * Same public surface as before so server.ts/routes are unchanged. Scope is
 * user/machine; reserved OPENWORK_/OPENCODE_ keys are refused on write and stripped on
 * read-for-injection. Stored plaintext for now (parity with the prior 0600 env.json).
 */
export class EnvService {
  private readonly dbPathOverride: string | undefined;
  private readonly config: ServerConfig | undefined;

  constructor(options?: { path?: string; config?: ServerConfig }) {
    // `path` (when provided, e.g. in tests) points at a dedicated SQLite DB file.
    // `config` ties the service to the same DB the server uses (<configDir>/openwork.db).
    this.dbPathOverride = options?.path;
    this.config = options?.config;
  }

  private async db(): Promise<DesktopDb> {
    if (this.dbPathOverride) {
      return openDb({ path: this.dbPathOverride });
    }
    return getDb(this.config);
  }

  async list(): Promise<EnvRecord[]> {
    return listEnvVars(await this.db());
  }

  async get(key: string): Promise<EnvRecord | null> {
    return getEnvVar(await this.db(), key);
  }

  async upsertMany(entries: EnvEntry[]): Promise<void> {
    await upsertEnvVars(await this.db(), entries);
  }

  async delete(key: string): Promise<boolean> {
    return deleteEnvVar(await this.db(), key);
  }

  /**
   * Flat key->value map for injecting into spawned children. Reserved keys stripped.
   * Note: the desktop shells inject DB env vars into process.env before the server
   * starts; this remains for server-side callers that want the same view.
   */
  static async readForInjection(): Promise<Record<string, string>> {
    return readEnvForInjection(await getDb());
  }
}

/**
 * Retained for API compatibility. The DB-backed store no longer throws a distinct
 * "invalid store file" error (there is no file to be malformed), but server.ts still
 * imports this type for its 409 mapping. It is effectively unused now.
 */
export class EnvStoreReadError extends Error {
  readonly code = "invalid_env_store";
}
