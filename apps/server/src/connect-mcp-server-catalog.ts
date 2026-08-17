import { createHash } from "node:crypto";
import { z } from "zod";

import { readMcpResourceText, type McpFetch } from "./connect-mcp-transport.js";
import { runtimeMcpMap, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { externalFetch } from "./server-fetch.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { createWorkspaceKvStore } from "./workspace-kv-store.js";

export const CONNECT_MCP_SERVER_INDEX_URI = "openwork://connect/mcp-servers/index.json";
export const CONNECT_MCP_SERVER_INDEX_SCHEMA_VERSION = "openwork.connect/mcp-servers/1";
export const CONNECT_MCP_APP_HOST_NAME_PREFIX = "openwork-app-host-connect-";
export const CONNECT_MCP_SERVER_NAME_PREFIX = "openwork-connect-";
export const CONNECT_MCP_APP_HOST_CAPABILITY_HEADER = "x-openwork-mcp-client-capabilities";
export const CONNECT_MCP_APP_HOST_CAPABILITY = "mcp-app-host-v1";

const indexSchema = z.object({
  schemaVersion: z.literal(CONNECT_MCP_SERVER_INDEX_SCHEMA_VERSION),
  servers: z.array(z.object({
    connectionId: z.string().min(1).max(160),
    name: z.string().min(1).max(255),
    description: z.string().max(1_024).nullable(),
    url: z.string().url().refine((value) => /^https?:\/\//.test(value), "MCP server URL must use HTTP(S)"),
  })).max(100),
});

export type OpenWorkConnectMcpServerIndex = z.infer<typeof indexSchema>;

const emptyIndex = (): OpenWorkConnectMcpServerIndex => ({
  schemaVersion: CONNECT_MCP_SERVER_INDEX_SCHEMA_VERSION,
  servers: [],
});

const appHostCatalogStore = createWorkspaceKvStore<OpenWorkConnectMcpServerIndex>({
  tableName: "connect_mcp_app_host_catalogs",
  valueColumn: "catalog_json",
  parse: (json) => {
    try {
      const parsed = indexSchema.safeParse(JSON.parse(json));
      return parsed.success ? parsed.data : emptyIndex();
    } catch {
      return emptyIndex();
    }
  },
  serialize: (value) => JSON.stringify(value),
});

const appHostAuthorizationStore = createWorkspaceKvStore<string>({
  tableName: "connect_mcp_app_host_authorizations",
  valueColumn: "authorization_json",
  parse: (json) => {
    try {
      const value: unknown = JSON.parse(json);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  },
  serialize: (value) => JSON.stringify(value),
});

function privateAppHostAuthorization(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= 8_192 && /^Bearer\s+[^\s,]+$/i.test(normalized) ? normalized : null;
}

/** Stable private App-host identifier. This must never become an OpenCode MCP key. */
export function connectMcpAppHostName(connectionId: string): string {
  const digest = createHash("sha256").update(connectionId).digest("hex").slice(0, 12);
  return `${CONNECT_MCP_APP_HOST_NAME_PREFIX}${digest}`;
}

export async function readOpenWorkConnectMcpAppHostCatalog(
  config: ServerConfig,
  workspaceId: string,
): Promise<OpenWorkConnectMcpServerIndex> {
  return await appHostCatalogStore.get(config, workspaceId) ?? emptyIndex();
}

export async function writeOpenWorkConnectMcpAppHostCatalog(
  config: ServerConfig,
  workspaceId: string,
  catalog: OpenWorkConnectMcpServerIndex,
): Promise<void> {
  const parsed = indexSchema.safeParse(catalog);
  await appHostCatalogStore.set(config, workspaceId, parsed.success ? parsed.data : emptyIndex());
}

export async function readOpenWorkConnectMcpAppHostAuthorization(
  config: ServerConfig,
  workspaceId: string,
): Promise<string | null> {
  return privateAppHostAuthorization(await appHostAuthorizationStore.get(config, workspaceId));
}

export async function writeOpenWorkConnectMcpAppHostAuthorization(
  config: ServerConfig,
  workspaceId: string,
  value: string,
): Promise<void> {
  await appHostAuthorizationStore.set(config, workspaceId, privateAppHostAuthorization(value) ?? "");
}

export async function findOpenWorkConnectMcpAppHostServer(
  config: ServerConfig,
  workspaceId: string,
  reference: { connectionId?: string; serverName?: string },
): Promise<OpenWorkConnectMcpServerIndex["servers"][number] | null> {
  const catalog = await readOpenWorkConnectMcpAppHostCatalog(config, workspaceId);
  return catalog.servers.find((server) => (
    (reference.connectionId !== undefined && server.connectionId === reference.connectionId)
    || (reference.serverName !== undefined && connectMcpAppHostName(server.connectionId) === reference.serverName)
  )) ?? null;
}

export async function readOpenWorkConnectMcpServerIndex(
  cloudMcp: Record<string, unknown>,
  appHostAuthorization: string,
  fetcher: McpFetch = externalFetch,
): Promise<OpenWorkConnectMcpServerIndex | null> {
  const text = await readMcpResourceText({
    config: {
      ...cloudMcp,
      headers: {
        Authorization: appHostAuthorization,
        [CONNECT_MCP_APP_HOST_CAPABILITY_HEADER]: CONNECT_MCP_APP_HOST_CAPABILITY,
      },
    },
    uri: CONNECT_MCP_SERVER_INDEX_URI,
    fetcher,
    clientName: "openwork-server-connect-mcp-catalog",
  });
  if (text === null) return null;
  const parsed = indexSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

/**
 * Keeps provider descriptors private to the Desktop App host and removes any
 * legacy OpenWork-owned provider endpoints from the model-facing runtime.
 * User-authored MCP configurations and durable provider records are untouched.
 */
export async function reconcileOpenWorkConnectMcpServers(input: {
  config: ServerConfig;
  workspace: WorkspaceInfo;
  cloudMcp: Record<string, unknown>;
  appHostAuthorization?: string;
  fetcher?: McpFetch;
}): Promise<{ status: "synced" | "unavailable"; appHostNames: string[]; removedNames: string[] }> {
  if (input.appHostAuthorization !== undefined) {
    await writeOpenWorkConnectMcpAppHostAuthorization(
      input.config,
      input.workspace.id,
      input.appHostAuthorization,
    );
  }
  const appHostAuthorization = await readOpenWorkConnectMcpAppHostAuthorization(input.config, input.workspace.id);
  const index = appHostAuthorization
    ? await readOpenWorkConnectMcpServerIndex(input.cloudMcp, appHostAuthorization, input.fetcher).catch(() => null)
    : null;
  const privateCatalog = index ?? emptyIndex();
  await writeOpenWorkConnectMcpAppHostCatalog(input.config, input.workspace.id, privateCatalog);

  let removedNames: string[] = [];
  await writeRuntimeOpencodeConfig(input.config, input.workspace.id, (current) => {
    const currentMcp = runtimeMcpMap(current);
    removedNames = Object.keys(currentMcp)
      .filter((name) => name.startsWith(CONNECT_MCP_SERVER_NAME_PREFIX))
      .sort();
    return {
      ...current,
      mcp: Object.fromEntries(Object.entries(currentMcp)
        .filter(([name]) => !name.startsWith(CONNECT_MCP_SERVER_NAME_PREFIX))),
    };
  });
  return {
    status: index ? "synced" : "unavailable",
    appHostNames: privateCatalog.servers.map((server) => connectMcpAppHostName(server.connectionId)).sort(),
    removedNames,
  };
}
