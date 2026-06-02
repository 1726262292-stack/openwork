import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { openworkConfigPath } from "./workspace-files.js";
import { ensureDir, exists, shortId } from "./utils.js";

export type LogicalOpencodeConfig = {
  plugin?: string[];
  mcp?: Record<string, Record<string, unknown>>;
  permission?: {
    external_directory?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeOpenworkConfigFile(path: string, value: Record<string, unknown>): Promise<void> {
  await ensureDir(dirname(path));
  const tmpPath = `${path}.tmp.${shortId()}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

export async function readOpenworkConfigFile(workspaceRoot: string): Promise<Record<string, unknown>> {
  const path = openworkConfigPath(workspaceRoot);
  if (!(await exists(path))) return {};
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}

export function readLogicalOpencodeConfig(openwork: Record<string, unknown>): LogicalOpencodeConfig {
  const opencode = openwork.opencode;
  return isRecord(opencode) ? opencode : {};
}

export async function readWorkspaceLogicalOpencodeConfig(workspaceRoot: string): Promise<LogicalOpencodeConfig> {
  return readLogicalOpencodeConfig(await readOpenworkConfigFile(workspaceRoot));
}

export async function writeWorkspaceLogicalOpencodeConfig(
  workspaceRoot: string,
  updater: (current: LogicalOpencodeConfig) => LogicalOpencodeConfig,
): Promise<LogicalOpencodeConfig> {
  const path = openworkConfigPath(workspaceRoot);
  const openwork = await readOpenworkConfigFile(workspaceRoot);
  const nextOpencode = updater(readLogicalOpencodeConfig(openwork));
  const next = { ...openwork, opencode: nextOpencode };
  await writeOpenworkConfigFile(path, next);
  return nextOpencode;
}

export function logicalPluginList(config: LogicalOpencodeConfig): string[] {
  return Array.isArray(config.plugin) ? config.plugin.filter((item) => typeof item === "string") : [];
}

export function logicalMcpMap(config: LogicalOpencodeConfig): Record<string, Record<string, unknown>> {
  return isRecord(config.mcp) ? config.mcp as Record<string, Record<string, unknown>> : {};
}

export function logicalExternalDirectory(config: LogicalOpencodeConfig): Record<string, unknown> {
  const permission = isRecord(config.permission) ? config.permission : null;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : null;
  return externalDirectory ?? {};
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  logical: LogicalOpencodeConfig,
): Record<string, unknown> {
  const persistedPermission = isRecord(persisted.permission) ? persisted.permission : {};
  const persistedExternalDirectory = isRecord(persistedPermission.external_directory)
    ? persistedPermission.external_directory
    : {};
  return {
    ...persisted,
    ...logical,
    plugin: [
      ...(Array.isArray(persisted.plugin) ? persisted.plugin.filter((item) => typeof item === "string") : []),
      ...logicalPluginList(logical),
    ],
    mcp: {
      ...(isRecord(persisted.mcp) ? persisted.mcp : {}),
      ...logicalMcpMap(logical),
    },
    permission: {
      ...persistedPermission,
      ...(isRecord(logical.permission) ? logical.permission : {}),
      external_directory: {
        ...persistedExternalDirectory,
        ...logicalExternalDirectory(logical),
      },
    },
  };
}
