import { describe, expect, test } from "bun:test";

import {
  readCloudMcpRouteWorkspaceId,
  resolveCloudMcpAutoSyncTarget,
  selectCloudMcpWorkspaceId,
} from "../src/react-app/shell/cloud-mcp-auto-sync";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

function workspace(input: {
  id: string;
  workspaceType?: "local" | "remote";
  baseUrl?: string;
  openworkToken?: string;
  openworkWorkspaceId?: string;
}): RouteWorkspace {
  const workspaceType = input.workspaceType ?? "local";
  return {
    id: input.id,
    name: input.id,
    path: `/tmp/${input.id}`,
    preset: "starter",
    workspaceType,
    remoteType: workspaceType === "remote" ? "openwork" : null,
    baseUrl: input.baseUrl ?? null,
    openworkToken: input.openworkToken ?? null,
    openworkWorkspaceId: input.openworkWorkspaceId ?? null,
    displayNameResolved: input.id,
  };
}

describe("cloud MCP auto sync target selection", () => {
  test("reads workspace ids from workspace routes", () => {
    expect(readCloudMcpRouteWorkspaceId("/workspace/rem_worker/session/abc")).toBe("rem_worker");
    expect(readCloudMcpRouteWorkspaceId("/workspace/local%201/settings/extensions")).toBe("local 1");
    expect(readCloudMcpRouteWorkspaceId("/session")).toBe("");
  });

  test("route-selected remote workspace takes precedence and uses remote routing", () => {
    const local = workspace({ id: "local_a" });
    const remote = workspace({
      id: "rem_cloud",
      workspaceType: "remote",
      baseUrl: "https://remote-worker.openwork.test",
      openworkToken: "remote-token",
      openworkWorkspaceId: "worker_workspace",
    });

    const target = resolveCloudMcpAutoSyncTarget({
      workspaces: [local, remote],
      routeWorkspaceId: "rem_cloud",
      persistedActiveWorkspaceId: "local_a",
      desktopSelectedWorkspaceId: "local_a",
      serverActiveWorkspaceId: "local_a",
      localServer: { baseUrl: "https://local.openwork.test", token: "local-token" },
    });

    expect(target?.isRemote).toBe(true);
    expect(target?.baseUrl).toBe("https://remote-worker.openwork.test");
    expect(target?.token).toBe("remote-token");
    expect(target?.workspaceId).toBe("worker_workspace");
  });

  test("falls back through persisted, desktop, server active, then first workspace", () => {
    const first = workspace({ id: "first" });
    const persisted = workspace({ id: "persisted" });
    const desktop = workspace({ id: "desktop" });
    const server = workspace({ id: "server" });
    const workspaces = [first, persisted, desktop, server];

    expect(selectCloudMcpWorkspaceId({
      workspaces,
      routeWorkspaceId: "missing",
      persistedActiveWorkspaceId: "persisted",
      desktopSelectedWorkspaceId: "desktop",
      serverActiveWorkspaceId: "server",
    })).toBe("persisted");
    expect(selectCloudMcpWorkspaceId({
      workspaces,
      routeWorkspaceId: "missing",
      persistedActiveWorkspaceId: "missing",
      desktopSelectedWorkspaceId: "desktop",
      serverActiveWorkspaceId: "server",
    })).toBe("desktop");
    expect(selectCloudMcpWorkspaceId({
      workspaces,
      routeWorkspaceId: "missing",
      persistedActiveWorkspaceId: "missing",
      desktopSelectedWorkspaceId: "missing",
      serverActiveWorkspaceId: "server",
    })).toBe("server");
    expect(selectCloudMcpWorkspaceId({
      workspaces,
      routeWorkspaceId: "missing",
      persistedActiveWorkspaceId: "missing",
      desktopSelectedWorkspaceId: "missing",
      serverActiveWorkspaceId: "missing",
    })).toBe("first");

    const target = resolveCloudMcpAutoSyncTarget({
      workspaces,
      persistedActiveWorkspaceId: "persisted",
      localServer: { baseUrl: "https://local.openwork.test", token: "local-token" },
    });
    expect(target?.isRemote).toBe(false);
    expect(target?.baseUrl).toBe("https://local.openwork.test");
    expect(target?.workspaceId).toBe("persisted");
  });
});
