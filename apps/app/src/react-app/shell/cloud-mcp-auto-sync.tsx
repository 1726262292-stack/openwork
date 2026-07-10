/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { CLOUD_SYNC_INTERVAL_MS } from "@/app/cloud/sync/constants";
import { readDenSettings } from "@/app/lib/den";
import {
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  type WorkspaceList,
} from "@/app/lib/desktop";
import {
  createOpenworkServerClient,
  type OpenworkWorkspaceInfo,
} from "@/app/lib/openwork-server";
import {
  resolveWorkspaceEndpoint,
  type LocalServerHandle,
  type ResolvedWorkspaceEndpoint,
} from "@/app/lib/workspace-endpoint";
import { isDesktopRuntime } from "@/app/utils";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { syncCloudControlMcpInBackground } from "@/react-app/domains/connections/use-session-mcp-maintenance";
import { denSessionUpdatedEvent, denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { resolveOpenworkConnection } from "./openwork-connection";
import {
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  orderRouteWorkspaces,
  type RouteWorkspace,
} from "./route-workspaces";
import { readActiveWorkspaceId, readWorkspaceOrderIds } from "./session-memory";

export type CloudMcpAutoSyncTargetInput = {
  workspaces: RouteWorkspace[];
  routeWorkspaceId?: string | null;
  persistedActiveWorkspaceId?: string | null;
  desktopSelectedWorkspaceId?: string | null;
  serverActiveWorkspaceId?: string | null;
  localServer: LocalServerHandle;
};

export function readCloudMcpRouteWorkspaceId(pathname: string): string {
  const match = /^\/workspace\/([^/?#]+)/.exec(pathname);
  const raw = match?.[1]?.trim() ?? "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

export function selectCloudMcpWorkspaceId(input: Omit<CloudMcpAutoSyncTargetInput, "localServer">): string {
  const knownIds = new Set(input.workspaces.map((workspace) => workspace.id));
  const candidates = [
    input.routeWorkspaceId,
    input.persistedActiveWorkspaceId,
    input.desktopSelectedWorkspaceId,
    input.serverActiveWorkspaceId,
  ];
  for (const candidate of candidates) {
    const id = candidate?.trim() ?? "";
    if (id && knownIds.has(id)) return id;
  }
  return input.workspaces[0]?.id ?? "";
}

export function resolveCloudMcpAutoSyncTarget(
  input: CloudMcpAutoSyncTargetInput,
): ResolvedWorkspaceEndpoint | null {
  const workspaceId = selectCloudMcpWorkspaceId(input);
  const workspace = input.workspaces.find((item) => item.id === workspaceId) ?? null;
  return resolveWorkspaceEndpoint(workspace, input.localServer);
}

async function readDesktopWorkspaces(): Promise<{
  desktopList: WorkspaceList | null;
  desktopWorkspaces: RouteWorkspace[];
}> {
  if (!isDesktopRuntime()) {
    return { desktopList: null, desktopWorkspaces: [] };
  }
  try {
    const desktopList = await workspaceBootstrap();
    return {
      desktopList,
      desktopWorkspaces: (desktopList.workspaces ?? []).map(mapDesktopWorkspace),
    };
  } catch {
    return { desktopList: null, desktopWorkspaces: [] };
  }
}

async function resolveCloudMcpAutoSyncTargetForRoute(
  routeWorkspaceId: string,
): Promise<ResolvedWorkspaceEndpoint | null> {
  const { desktopList, desktopWorkspaces } = await readDesktopWorkspaces();
  const connection = await resolveOpenworkConnection();
  let serverWorkspaces: OpenworkWorkspaceInfo[] = [];
  let serverActiveWorkspaceId: string | null = null;

  if (connection.normalizedBaseUrl && connection.resolvedToken) {
    try {
      const client = createOpenworkServerClient({
        baseUrl: connection.normalizedBaseUrl,
        token: connection.resolvedToken,
        hostToken: connection.resolvedHostToken || undefined,
      });
      const list = await client.listWorkspaces();
      serverWorkspaces = list.items;
      serverActiveWorkspaceId = list.activeId?.trim() || null;
    } catch {
      serverWorkspaces = [];
      serverActiveWorkspaceId = null;
    }
  }

  const workspaces = orderRouteWorkspaces(
    mergeRouteWorkspaces(serverWorkspaces, desktopWorkspaces),
    readWorkspaceOrderIds(),
  );

  return resolveCloudMcpAutoSyncTarget({
    workspaces,
    routeWorkspaceId,
    persistedActiveWorkspaceId: readActiveWorkspaceId(),
    desktopSelectedWorkspaceId: resolveWorkspaceListSelectedId(desktopList),
    serverActiveWorkspaceId,
    localServer: {
      baseUrl: connection.normalizedBaseUrl,
      token: connection.resolvedToken,
    },
  });
}

export function CloudMcpAutoSync() {
  const denAuth = useDenAuth();
  const location = useLocation();
  const routeWorkspaceIdRef = useRef(readCloudMcpRouteWorkspaceId(location.pathname));
  const observedPathnameRef = useRef(location.pathname);
  const inFlightRef = useRef(false);
  const rerunAfterFlightRef = useRef(false);
  const runRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!denAuth.isSignedIn || typeof window === "undefined") {
      runRef.current = null;
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (inFlightRef.current) {
        rerunAfterFlightRef.current = true;
        return;
      }

      const settings = readDenSettings();
      if (!settings.authToken?.trim() || !settings.activeOrgId?.trim()) return;

      inFlightRef.current = true;
      try {
        const target = await resolveCloudMcpAutoSyncTargetForRoute(routeWorkspaceIdRef.current);
        if (target) {
          await syncCloudControlMcpInBackground({
            client: target.client,
            workspaceId: target.workspaceId,
            settings,
          });
        }
      } catch {
        // Quiet by design: network, org, worker, and mint failures retry later.
      } finally {
        inFlightRef.current = false;
        const shouldRerun = rerunAfterFlightRef.current;
        rerunAfterFlightRef.current = false;
        if (shouldRerun && !cancelled) {
          void tick();
        } else if (shouldRerun) {
          runRef.current?.();
        }
      }
    };

    runRef.current = () => void tick();
    void tick();

    const run = () => void tick();
    const runWhenVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void tick();
    };
    window.addEventListener(denSettingsChangedEvent, run);
    window.addEventListener(denSessionUpdatedEvent, run);
    window.addEventListener("openwork-server-settings-changed", run);
    window.addEventListener("online", run);
    window.addEventListener("focus", runWhenVisible);
    const interval = window.setInterval(run, CLOUD_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      runRef.current = null;
      window.removeEventListener(denSettingsChangedEvent, run);
      window.removeEventListener(denSessionUpdatedEvent, run);
      window.removeEventListener("openwork-server-settings-changed", run);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", runWhenVisible);
      window.clearInterval(interval);
    };
  }, [denAuth.isSignedIn]);

  useEffect(() => {
    const changed = observedPathnameRef.current !== location.pathname;
    observedPathnameRef.current = location.pathname;
    routeWorkspaceIdRef.current = readCloudMcpRouteWorkspaceId(location.pathname);
    if (changed) runRef.current?.();
  }, [location.pathname]);

  return null;
}
