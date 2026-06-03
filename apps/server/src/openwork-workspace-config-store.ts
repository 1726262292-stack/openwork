import { openRuntimeDb, updateRuntimeJsonRow } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOpenworkWorkspaceConfig(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseOpenworkWorkspaceConfigJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return normalizeOpenworkWorkspaceConfig(JSON.parse(value));
  } catch {
    return {};
  }
}

export async function readOpenworkWorkspaceConfig(config: ServerConfig, workspaceId: string): Promise<Record<string, unknown>> {
  const db = await openRuntimeDb(config);
  const row = db.getJsonRow("openwork_workspace_configs", workspaceId);
  if (!row) return {};
  try {
    return normalizeOpenworkWorkspaceConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }
}

export async function writeOpenworkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const configJson = await updateRuntimeJsonRow(config, "openwork_workspace_configs", workspaceId, (currentJson) => {
    const current = parseOpenworkWorkspaceConfigJson(currentJson);
    return JSON.stringify(normalizeOpenworkWorkspaceConfig(updater(current)));
  });
  return parseOpenworkWorkspaceConfigJson(configJson);
}

export function mergeOpenworkWorkspaceConfigs(
  legacy: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return { ...legacy, ...stored };
}
