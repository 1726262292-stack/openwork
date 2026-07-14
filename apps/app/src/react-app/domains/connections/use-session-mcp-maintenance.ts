import { useEffect } from "react";

import {
  mintCloudControlMcpToken,
  readDenSettings,
  type DenMcpToken,
  type DenSettings,
} from "../../../app/lib/den";
import type { OpenworkServerClient } from "../../../app/lib/openwork-server";
import { unwrap } from "../../../app/lib/opencode";
import type { Client, McpServerEntry, McpStatusMap } from "../../../app/types";
import { attemptSilentMcpReauth } from "./mcp-silent-reauth";
import {
  CLOUD_MCP_SERVER_NAME,
  readCloudMcpUserState,
} from "./cloud-mcp-user-state";
import {
  runOpenworkCloudMcpReconciler,
  type CloudMcpClient,
} from "./cloud-mcp-reconciler";

export const SESSION_MCP_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
export const CLOUD_MCP_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

type CloudMcpMaintenanceClient = CloudMcpClient & Pick<OpenworkServerClient, "listMcp">;

const maintenanceInFlight = new Set<string>();

export function getSessionMcpMaintenanceTargetKey(input: {
  client: Pick<OpenworkServerClient, "baseUrl">;
  cloudSignedIn: boolean;
  denBaseUrl?: string | null;
  orgId?: string | null;
  workspaceId: string;
}): string {
  return JSON.stringify([
    input.denBaseUrl?.trim().replace(/\/+$/, "") ?? "",
    input.client.baseUrl.trim().replace(/\/+$/, ""),
    input.workspaceId.trim(),
    input.cloudSignedIn ? input.orgId?.trim() ?? "" : "local-only",
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
  const scope = {
    denBaseUrl: settings.baseUrl,
    serverBaseUrl: input.client.baseUrl,
    orgId,
    workspaceId,
  };
  if (readCloudMcpUserState(scope) !== null) return "skipped";

  const listed = await input.client.listMcp(workspaceId);
  const configured = listed.items.find((entry) => entry.name === CLOUD_MCP_SERVER_NAME);
  if (configured?.config.enabled === false) return "skipped";
  const configuredUrl = typeof configured?.config.url === "string" ? configured.config.url : null;

  const result = await runOpenworkCloudMcpReconciler({
    mode: "repair",
    client: input.client,
    context: {
      ...scope,
      denAuthToken: settings.authToken,
      orgSlug: settings.activeOrgSlug,
      orgName: settings.activeOrgName,
      fallbackUrl: configured?.config.type === "remote" ? configuredUrl : null,
      trigger: input.force ? "desktop-background-forced" : "desktop-background",
    },
    mintToken: input.mintToken
      ? async () => input.mintToken?.() ?? null
      : mintCloudControlMcpToken,
    force: input.force,
    refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
    now: input.now,
    configuredEnabled: typeof configured?.config.enabled === "boolean" ? configured.config.enabled : null,
  });
  if (result.status === "unchanged" || result.status === "ready") return "unchanged";
  if (result.health?.usable) return "synced";
  return "skipped";
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
  cloudSignedIn: boolean;
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
    const settings = readDenSettings();
    const targetKey = getSessionMcpMaintenanceTargetKey({
      client,
      cloudSignedIn: input.cloudSignedIn,
      denBaseUrl: settings.baseUrl,
      orgId: settings.activeOrgId,
      workspaceId,
    });

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await runSessionMcpMaintenanceTask({
        targetKey,
        task: async () => {
        if (input.cloudSignedIn) {
          await syncCloudControlMcpInBackground({
            client,
            workspaceId,
          }).catch(() => "skipped");
        }
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
  }, [input.client, input.cloudSignedIn, input.directory, input.opencodeClient, input.workspaceId]);
}
