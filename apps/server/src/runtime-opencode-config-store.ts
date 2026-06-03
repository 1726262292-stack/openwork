import { openRuntimeDb, updateRuntimeJsonRow } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";

export type RuntimeOpencodeConfig = {
  default_agent?: string;
  plugin?: string[];
  disabled_providers?: string[];
  mcp?: Record<string, Record<string, unknown>>;
  permission?: {
    external_directory?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRuntimeOpencodeConfig(value: unknown): RuntimeOpencodeConfig {
  if (!isRecord(value)) return {};
  const defaultAgent = typeof value.default_agent === "string" ? value.default_agent : undefined;
  const plugin = Array.isArray(value.plugin) ? value.plugin.filter((item) => typeof item === "string") : undefined;
  const disabledProviders = Array.isArray(value.disabled_providers)
    ? value.disabled_providers.filter((item) => typeof item === "string")
    : undefined;
  const mcp = isRecord(value.mcp) ? value.mcp as Record<string, Record<string, unknown>> : undefined;
  const permission = isRecord(value.permission) ? value.permission : undefined;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : undefined;
  const provider = isRecord(value.provider) ? value.provider : undefined;
  return {
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),
    ...(plugin ? { plugin } : {}),
    ...(disabledProviders ? { disabled_providers: disabledProviders } : {}),
    ...(mcp ? { mcp } : {}),
    ...(externalDirectory ? { permission: { external_directory: externalDirectory } } : {}),
    ...(provider ? { provider } : {}),
  };
}

function parseRuntimeOpencodeConfigJson(value: string | undefined): RuntimeOpencodeConfig {
  if (!value) return {};
  try {
    return normalizeRuntimeOpencodeConfig(JSON.parse(value));
  } catch {
    return {};
  }
}

export function runtimePluginList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.plugin) ? config.plugin.filter((item) => typeof item === "string") : [];
}

export function runtimeDisabledProviderList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.disabled_providers)
    ? config.disabled_providers.filter((item) => typeof item === "string")
    : [];
}

export function runtimeMcpMap(config: RuntimeOpencodeConfig): Record<string, Record<string, unknown>> {
  return isRecord(config.mcp) ? config.mcp as Record<string, Record<string, unknown>> : {};
}

export function runtimeExternalDirectory(config: RuntimeOpencodeConfig): Record<string, unknown> {
  const permission = isRecord(config.permission) ? config.permission : null;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : null;
  return externalDirectory ?? {};
}

export async function readRuntimeOpencodeConfig(config: ServerConfig, workspaceId: string): Promise<RuntimeOpencodeConfig> {
  const db = await openRuntimeDb(config);
  const row = db.getJsonRow("runtime_opencode_configs", workspaceId);
  if (!row) return {};
  try {
    return normalizeRuntimeOpencodeConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }
}

export async function writeRuntimeOpencodeConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig,
): Promise<RuntimeOpencodeConfig> {
  const configJson = await updateRuntimeJsonRow(config, "runtime_opencode_configs", workspaceId, (currentJson) => {
    const current = parseRuntimeOpencodeConfigJson(currentJson);
    return JSON.stringify(normalizeRuntimeOpencodeConfig(updater(current)));
  });
  return parseRuntimeOpencodeConfigJson(configJson);
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  runtime: RuntimeOpencodeConfig,
): Record<string, unknown> {
  const persistedPermission = isRecord(persisted.permission) ? persisted.permission : {};
  const persistedExternalDirectory = isRecord(persistedPermission.external_directory)
    ? persistedPermission.external_directory
    : {};
  return {
    ...persisted,
    plugin: [
      ...(Array.isArray(persisted.plugin) ? persisted.plugin.filter((item) => typeof item === "string") : []),
      ...runtimePluginList(runtime),
    ],
    disabled_providers: [
      ...(Array.isArray(persisted.disabled_providers) ? persisted.disabled_providers.filter((item) => typeof item === "string") : []),
      ...runtimeDisabledProviderList(runtime),
    ].filter((item, index, list) => list.indexOf(item) === index),
    mcp: {
      ...(isRecord(persisted.mcp) ? persisted.mcp : {}),
      ...runtimeMcpMap(runtime),
    },
    permission: {
      ...persistedPermission,
      external_directory: {
        ...persistedExternalDirectory,
        ...runtimeExternalDirectory(runtime),
      },
    },
    ...(runtime.provider ? { provider: { ...(isRecord(persisted.provider) ? persisted.provider : {}), ...runtime.provider } } : {}),
    ...(runtime.default_agent ? { default_agent: runtime.default_agent } : {}),
  };
}
