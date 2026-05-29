import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Resolve the default `server.json` path (mirrors server `config.ts`). */
export function resolveServerJsonPath(): string {
  const override = process.env.OPENWORK_SERVER_CONFIG?.trim();
  if (override) return resolve(override);
  return join(homedir(), ".config", "openwork", "server.json");
}

/** Resolve the default `tokens.json` path (mirrors server `tokens.ts`). */
export function resolveTokensJsonPath(): string {
  const override = process.env.OPENWORK_TOKEN_STORE?.trim();
  if (override) return resolve(override);
  return join(dirname(resolveServerJsonPath()), "tokens.json");
}

/** Resolve the default audit dir (mirrors server `audit.ts`). */
export function resolveAuditDir(): string {
  const override = process.env.OPENWORK_DATA_DIR?.trim();
  const base = override
    ? override.startsWith("~/")
      ? join(homedir(), override.slice(2))
      : resolve(override)
    : join(homedir(), ".openwork", "openwork-server");
  return join(base, "audit");
}

export interface ImportOptions {
  serverJsonPath?: string;
  tokensJsonPath?: string;
  auditDir?: string;
  /** Skip the audit import (can be large). Default false. */
  skipAudit?: boolean;
}
