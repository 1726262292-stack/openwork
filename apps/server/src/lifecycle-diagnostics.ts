import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

export type ReloadOpencodeEngineInput = {
  reason?: string;
  source?: string;
  trigger?: unknown;
};

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

export function browserDiagnosticLogPath(config: ServerConfig): string | null {
  const override = (process.env.OPENWORK_DEV_LOG_FILE ?? "").trim();
  if (override) return override;
  if (envFlagEnabled("OPENWORK_DISABLE_DEV_LOG_FILE") || envFlagEnabled("OPENWORK_DISABLE_DIAGNOSTIC_LOGS")) return null;
  return join(runtimeStorageDir(config), "openwork-browser-diagnostics.jsonl");
}

export function lifecycleDiagnosticLogPath(config: ServerConfig): string | null {
  const override = (process.env.OPENWORK_LIFECYCLE_LOG_FILE ?? "").trim();
  if (override) return override;
  if (envFlagEnabled("OPENWORK_DISABLE_LIFECYCLE_LOG_FILE") || envFlagEnabled("OPENWORK_DISABLE_DIAGNOSTIC_LOGS")) return null;
  return join(runtimeStorageDir(config), "openwork-lifecycle-diagnostics.jsonl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeDiagnosticValue(input: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (input === null || input === undefined) return input;
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return input;
  if (typeof input === "bigint" || typeof input === "symbol" || typeof input === "function") return String(input);
  if (input instanceof Error) {
    return { name: input.name, message: input.message, stack: input.stack };
  }
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (!isRecord(input)) return String(input);

  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count > 50) {
      output.__truncated = true;
      break;
    }
    count += 1;
    output[key] = sanitizeDiagnosticValue(value, depth + 1);
  }
  return output;
}

export function sanitizeDiagnosticUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return input.trim() ? "[invalid-url]" : "";
  }
}

export function workspaceDiagnosticSummary(workspace: WorkspaceInfo): Record<string, unknown> {
  return {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name ?? null,
    workspaceType: workspace.workspaceType ?? null,
    preset: workspace.preset ?? null,
    hasBaseUrl: Boolean(workspace.baseUrl?.trim()),
    hasDirectory: Boolean(workspace.directory?.trim()),
  };
}

export async function recordLifecycleDiagnostic(
  config: ServerConfig,
  event: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const target = lifecycleDiagnosticLogPath(config);
  if (!target) return;

  const entry = {
    at: new Date().toISOString(),
    event,
    pid: process.pid,
    uptimeMs: Date.now() - config.startedAt,
    ...details,
  };

  try {
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(sanitizeDiagnosticValue(entry))}\n`, "utf8");
  } catch (error) {
    console.warn("[openwork-lifecycle] failed to write diagnostic log", error);
  }
}
