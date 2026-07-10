import { useEffect } from "react";

import { getMcpServerName, MCP_QUICK_CONNECT } from "../../../app/constants";
import {
  isLegacyWebAppMcpUrl,
  mintCloudControlMcpToken,
  readDenSettings,
  resolveCloudMcpResourceUrl,
  type DenMcpToken,
  type DenSettings,
} from "../../../app/lib/den";
import type { OpenworkServerClient } from "../../../app/lib/openwork-server";
import { unwrap } from "../../../app/lib/opencode";
import type { Client, McpServerEntry, McpStatusMap } from "../../../app/types";
import { attemptSilentMcpReauth } from "./mcp-silent-reauth";
import {
  CLOUD_MCP_SERVER_NAME,
  isCloudMcpSyncMarkerFresh,
  readCloudMcpSyncMarker,
  readCloudMcpUserState,
  writeCloudMcpSyncMarker,
} from "./cloud-mcp-user-state";

export const SESSION_MCP_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
export const CLOUD_MCP_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

type CloudMcpMaintenanceClient = Pick<OpenworkServerClient, "baseUrl" | "listMcp" | "addMcp">;

const maintenanceInFlight = new Set<string>();
const cloudMcpSyncInFlight = new Map<string, Promise<void>>();

export function getSessionMcpMaintenanceTargetKey(input: {
  client: Pick<OpenworkServerClient, "baseUrl" | "token">;
  workspaceId: string;
  directory: string;
}): string {
  return JSON.stringify([
    input.client.baseUrl.trim().replace(/\/+$/, ""),
    input.client.token?.trim() ?? "",
    input.workspaceId.trim(),
    input.directory.trim(),
  ]);
}

export function getCloudControlMcpSyncTargetKey(input: {
  denBaseUrl: string;
  serverBaseUrl: string;
  orgId: string;
  workspaceId: string;
}): string {
  return JSON.stringify([
    input.denBaseUrl.trim().replace(/\/+$/, ""),
    input.serverBaseUrl.trim().replace(/\/+$/, ""),
    input.orgId.trim(),
    input.workspaceId.trim(),
  ]);
}

export async function runSessionMcpMaintenanceTask(input: {
  targetKey: string;
  task: () => Promise<void>;
}): Promise<boolean> {
  if (maintenanceInFlight.has(input.targetKey)) return false;
  maintenanceInFlight.add(input.targetKey);
  try {
    await input.task();
    return true;
  } finally {
    maintenanceInFlight.delete(input.targetKey);
  }
}

export async function syncCloudControlMcpInBackground(input: {
  client: CloudMcpMaintenanceClient;
  workspaceId: string;
  force?: boolean;
  now?: number;
  settings?: DenSettings;
  mintToken?: () => Promise<DenMcpToken | null>;
}): Promise<"synced" | "unchanged" | "skipped"> {
  const workspaceId = input.workspaceId.trim();
  const settings = input.settings ?? readDenSettings();
  const orgId = settings.activeOrgId?.trim() ?? "";
  if (!workspaceId || !orgId || !settings.authToken?.trim()) return "skipped";
  const targetKey = getCloudControlMcpSyncTargetKey({
    denBaseUrl: settings.baseUrl,
    serverBaseUrl: input.client.baseUrl,
    orgId,
    workspaceId,
  });
  while (cloudMcpSyncInFlight.has(targetKey)) {
    const current = cloudMcpSyncInFlight.get(targetKey);
    if (!current) break;
    if (!input.force) return "skipped";
    await current;
  }

  let resolveInFlight = () => {};
  const currentInFlight = new Promise<void>((resolve) => {
    resolveInFlight = resolve;
  });
  cloudMcpSyncInFlight.set(targetKey, currentInFlight);
  try {
    if (readCloudMcpUserState() !== null) return "skipped";

    const cloudEntry = MCP_QUICK_CONNECT.find((entry) => entry.serverName === CLOUD_MCP_SERVER_NAME);
    if (!cloudEntry) return "skipped";
    const slug = cloudEntry.id ?? getMcpServerName(cloudEntry);
    const listed = await input.client.listMcp(workspaceId);
    const configured = listed.items.find((entry) => entry.name === slug);
    if (configured?.config.enabled === false) return "skipped";
    const configuredUrl = configured?.config.type === "remote" && typeof configured.config.url === "string"
      ? configured.config.url
      : null;
    const hasLegacyUrl = isLegacyWebAppMcpUrl(configuredUrl);

    const marker = readCloudMcpSyncMarker({
      denBaseUrl: settings.baseUrl,
      serverBaseUrl: input.client.baseUrl,
      orgId,
      workspaceId,
    });
    const markerFresh =
      marker !== null &&
      marker.orgId === orgId &&
      marker.workspaceId === workspaceId &&
      isCloudMcpSyncMarkerFresh({
        expiresAt: marker.expiresAt,
        now: input.now ?? Date.now(),
        refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
      });
    if (!input.force && configured && markerFresh && !hasLegacyUrl) return "unchanged";

    let minted: DenMcpToken | null = null;
    try {
      minted = await (input.mintToken ?? mintCloudControlMcpToken)();
    } catch {
      return "skipped";
    }
    if (!minted) return "skipped";
    const healedResource = resolveCloudMcpResourceUrl(minted.resource);
    const url = healedResource ? `${healedResource}/agent` : cloudEntry.url;
    if (!url) return "skipped";

    await input.client.addMcp(workspaceId, {
      name: slug,
      config: {
        type: "remote",
        enabled: true,
        url,
        headers: { Authorization: `Bearer ${minted.token}` },
        oauth: false,
      },
    });
    writeCloudMcpSyncMarker({
      denBaseUrl: settings.baseUrl,
      serverBaseUrl: input.client.baseUrl,
      orgId,
      workspaceId,
      expiresAt: minted.expiresAt,
    });
    return "synced";
  } finally {
    if (cloudMcpSyncInFlight.get(targetKey) === currentInFlight) {
      cloudMcpSyncInFlight.delete(targetKey);
    }
    resolveInFlight();
  }
}

export async function healWorkspaceMcpInBackground(input: {
  client: CloudMcpMaintenanceClient;
  workspaceId: string;
  opencodeClient: Client;
  directory: string;
}): Promise<boolean> {
  const workspaceId = input.workspaceId.trim();
  const directory = input.directory.trim();
  if (!workspaceId || !directory) return false;

  const listed = await input.client.listMcp(workspaceId);
  const servers = listed.items.map((entry) => ({
    name: entry.name,
    config: entry.config as McpServerEntry["config"],
  }));
  if (servers.length === 0) return false;

  const statuses = unwrap(await input.opencodeClient.mcp.status({ directory })) as McpStatusMap;
  return attemptSilentMcpReauth({
    client: input.opencodeClient,
    directory,
    servers,
    statuses,
  });
}

export function useSessionMcpMaintenance(input: {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  opencodeClient: Client | null;
  directory: string;
}) {
  useEffect(() => {
    const workspaceId = input.workspaceId?.trim() ?? "";
    const directory = input.directory.trim();
    const client = input.client;
    const opencodeClient = input.opencodeClient;
    if (!client || !opencodeClient || !workspaceId || !directory) return;
    const targetKey = getSessionMcpMaintenanceTargetKey({
      client,
      workspaceId,
      directory,
    });

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await runSessionMcpMaintenanceTask({
        targetKey,
        task: async () => {
          await healWorkspaceMcpInBackground({
            client,
            workspaceId,
            opencodeClient,
            directory,
          }).catch(() => false);
        },
      });
    };

    void tick();
    const handleOnline = () => void tick();
    const handleFocus = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    const interval = window.setInterval(() => void tick(), SESSION_MCP_MAINTENANCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.clearInterval(interval);
    };
  }, [input.client, input.directory, input.opencodeClient, input.workspaceId]);
}
