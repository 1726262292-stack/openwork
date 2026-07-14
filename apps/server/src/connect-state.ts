import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import {
  readOpenworkCloudMcpHealth,
  type CloudMcpHealth,
  type CloudMcpProviderModelContext,
  type CloudMcpServerMetadata,
} from "./cloud-mcp-health.js";
import { googleWorkspaceLegacyConfigured } from "./extensions/google-workspace.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir } from "./utils.js";

const CONNECT_STATE_FILE = "connect-state.json";
type WorkspaceOpencodeClient = ReturnType<typeof createOpencodeClient>;

type PersistedConnectState = {
  connectEnabled: boolean;
  updatedAt: number;
};

export type ConnectSnapshot = {
  connectEnabled: boolean;
  connectCatalogEnabled: boolean;
  cloudMcpPresent: boolean;
  cloudHealth: CloudMcpHealth | null;
  workspace: {
    resolution: "resolved" | "unknown" | "ambiguous";
    id: string | null;
    directory: string | null;
    reason?: string;
  };
  googleWorkspace: {
    legacyConfigured: boolean;
  };
};

export type ConnectSnapshotOptions = {
  workspaceId?: string;
  directory?: string;
  providerModel?: CloudMcpProviderModelContext;
  serverMetadata?: CloudMcpServerMetadata;
  resolveOpencodeDirectory?: (workspace: WorkspaceInfo) => string | null;
  createWorkspaceOpencodeClient?: (config: ServerConfig, workspace: WorkspaceInfo) => WorkspaceOpencodeClient;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectStatePath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), CONNECT_STATE_FILE);
}

function normalizeConnectState(value: unknown): PersistedConnectState {
  if (!isRecord(value) || typeof value.connectEnabled !== "boolean") {
    return { connectEnabled: false, updatedAt: 0 };
  }
  return {
    connectEnabled: value.connectEnabled,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

export function googleWorkspaceConnectGuidance(cloudHealthOrReady: CloudMcpHealth | boolean | null): string {
  const usable = typeof cloudHealthOrReady === "boolean" ? cloudHealthOrReady : cloudHealthOrReady?.usable === true;
  if (usable) {
    return "Google Workspace is available through the OpenWork Cloud connection: call search_capabilities to find the capability, then execute_capability to run it. Do not tell the user to reconfigure extensions; the relevant settings surface is Settings > Connect.";
  }
  if (cloudHealthOrReady && typeof cloudHealthOrReady !== "boolean" && cloudHealthOrReady.desired.present) {
    const failure = cloudHealthOrReady.firstFailure;
    const suffix = failure ? ` Current health check: ${failure.code}; ${failure.recommendedAction}.` : "";
    return `Google Workspace is connected through OpenWork Connect, but agent access is not ready for this exact workspace. Direct the user to Settings > Connect > Repair and test. Do not substitute docs, browser tools, or Settings > Extensions for the connected-service action.${suffix}`;
  }
  return "Google Workspace is not connected on this device. Direct the user to Settings > Connect to connect their account. Do not direct them to Settings > Extensions.";
}

export async function readConnectState(config: ServerConfig): Promise<PersistedConnectState> {
  try {
    const raw = await readFile(connectStatePath(config), "utf8");
    return normalizeConnectState(JSON.parse(raw));
  } catch {
    return { connectEnabled: false, updatedAt: 0 };
  }
}

export async function writeConnectState(config: ServerConfig, state: { connectEnabled: boolean }): Promise<PersistedConnectState> {
  const next = { connectEnabled: state.connectEnabled, updatedAt: Date.now() };
  const target = connectStatePath(config);
  await ensureDir(runtimeStorageDir(config));
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function normalizeDirectory(directory: string): string {
  return directory.trim().replace(/[\/]+$/, "");
}

function workspaceDirectory(workspace: WorkspaceInfo, resolveOpencodeDirectory?: (workspace: WorkspaceInfo) => string | null): string | null {
  return resolveOpencodeDirectory?.(workspace) ?? (workspace.workspaceType === "local" ? workspace.path : workspace.directory ?? null);
}

function resolveConnectWorkspace(config: ServerConfig, options: ConnectSnapshotOptions): { workspace: WorkspaceInfo; directory: string | null } | { resolution: "unknown" | "ambiguous"; directory: string | null; reason: string } {
  const workspaceId = options.workspaceId?.trim();
  const requestedDirectory = options.directory?.trim();
  if (workspaceId) {
    const workspace = config.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) {
      return { resolution: "unknown", directory: requestedDirectory ? normalizeDirectory(requestedDirectory) : null, reason: `Workspace ${workspaceId} was not found` };
    }
    return { workspace, directory: workspaceDirectory(workspace, options.resolveOpencodeDirectory) };
  }

  if (requestedDirectory) {
    const normalizedRequested = normalizeDirectory(requestedDirectory);
    const matches = config.workspaces.filter((workspace) => {
      const directory = workspaceDirectory(workspace, options.resolveOpencodeDirectory);
      return directory !== null && normalizeDirectory(directory) === normalizedRequested;
    });
    if (matches.length === 1) {
      const workspace = matches[0];
      if (workspace) return { workspace, directory: workspaceDirectory(workspace, options.resolveOpencodeDirectory) };
    }
    if (matches.length > 1) {
      return { resolution: "ambiguous", directory: normalizedRequested, reason: "Multiple workspaces have this exact OpenCode directory" };
    }
    return { resolution: "unknown", directory: normalizedRequested, reason: "No workspace has this exact OpenCode directory" };
  }

  const only = config.workspaces[0];
  if (config.workspaces.length === 1 && only) {
    return { workspace: only, directory: workspaceDirectory(only, options.resolveOpencodeDirectory) };
  }
  return { resolution: "unknown", directory: null, reason: "Workspace id or exact directory is required when multiple workspaces are configured" };
}

async function resolveCloudHealth(config: ServerConfig, options: ConnectSnapshotOptions): Promise<{ cloudHealth: CloudMcpHealth | null; workspace: ConnectSnapshot["workspace"] }> {
  const resolved = resolveConnectWorkspace(config, options);
  if (!("workspace" in resolved)) {
    return {
      cloudHealth: null,
      workspace: {
        resolution: resolved.resolution,
        id: null,
        directory: resolved.directory,
        reason: resolved.reason,
      },
    };
  }
  if (!options.createWorkspaceOpencodeClient) {
    return {
      cloudHealth: null,
      workspace: {
        resolution: "resolved",
        id: resolved.workspace.id,
        directory: resolved.directory,
        reason: "OpenCode health probe is not available in this route",
      },
    };
  }
  const cloudHealth = await readOpenworkCloudMcpHealth({
    config,
    workspace: resolved.workspace,
    directory: resolved.directory,
    providerModel: options.providerModel,
    serverMetadata: options.serverMetadata,
    createWorkspaceOpencodeClient: options.createWorkspaceOpencodeClient,
  });
  return {
    cloudHealth,
    workspace: {
      resolution: "resolved",
      id: resolved.workspace.id,
      directory: resolved.directory,
    },
  };
}

export async function getConnectSnapshot(config: ServerConfig, options: ConnectSnapshotOptions = {}): Promise<ConnectSnapshot> {
  const state = await readConnectState(config);
  const { cloudHealth, workspace } = await resolveCloudHealth(config, options);

  return {
    connectEnabled: state.connectEnabled,
    connectCatalogEnabled: state.connectEnabled,
    cloudMcpPresent: cloudHealth?.usable === true,
    cloudHealth,
    workspace,
    googleWorkspace: {
      legacyConfigured: googleWorkspaceLegacyConfigured(),
    },
  };
}

export function shouldGateLegacyGoogleWorkspace(snapshot: ConnectSnapshot): boolean {
  return snapshot.connectCatalogEnabled && !snapshot.googleWorkspace.legacyConfigured;
}

export function googleWorkspaceStatusConnectExtra(snapshot: ConnectSnapshot): Record<string, unknown> {
  if (!shouldGateLegacyGoogleWorkspace(snapshot)) return {};
  return {
    connect: {
      enabled: true,
      cloudMcpPresent: snapshot.cloudMcpPresent,
      guidance: googleWorkspaceConnectGuidance(snapshot.cloudHealth),
    },
  };
}
