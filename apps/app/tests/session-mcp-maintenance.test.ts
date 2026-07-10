import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import type { DenMcpToken, DenSettings } from "../src/app/lib/den";
import {
  __setCloudMcpUserStateStorageForTest,
  readCloudMcpSyncMarker,
  writeCloudMcpUserState,
} from "../src/react-app/domains/connections/cloud-mcp-user-state";
import {
  getSessionMcpMaintenanceTargetKey,
  runSessionMcpMaintenanceTask,
  syncCloudControlMcpInBackground,
} from "../src/react-app/domains/connections/use-session-mcp-maintenance";

const NOW = Date.parse("2026-07-09T12:00:00.000Z");
const WORKSPACE_ID = "workspace_1";
const SETTINGS: DenSettings = {
  baseUrl: "https://app.openwork.test",
  authToken: "session-token",
  activeOrgId: "organization_1",
};
const MINTED: DenMcpToken = {
  token: "mcp-token",
  expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString(),
  organizationId: "organization_1",
  scopes: ["mcp:read", "mcp:write"],
  resource: "https://api.openwork.test/mcp",
};

function installStorageStub() {
  const values = new Map<string, string>();
  __setCloudMcpUserStateStorageForTest({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
}

afterAll(() => {
  __setCloudMcpUserStateStorageForTest(null);
});

describe("session MCP maintenance", () => {
  beforeEach(() => installStorageStub());

  test("mints and hot-updates the Cloud MCP without opening Settings", async () => {
    const writes: Array<{ workspaceId: string; payload: { name: string; config: Record<string, unknown> } }> = [];
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({ items: [] }),
      addMcp: async (workspaceId: string, payload: { name: string; config: Record<string, unknown> }) => {
        writes.push({ workspaceId, payload });
        return { items: [] };
      },
    };

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW,
      mintToken: async () => MINTED,
    })).resolves.toBe("synced");

    expect(writes).toEqual([{
      workspaceId: WORKSPACE_ID,
      payload: {
        name: "openwork-cloud",
        config: {
          type: "remote",
          enabled: true,
          url: "https://api.openwork.test/mcp/agent",
          headers: { Authorization: "Bearer mcp-token" },
          oauth: false,
        },
      },
    }]);
    expect(readCloudMcpSyncMarker({
      denBaseUrl: SETTINGS.baseUrl,
      serverBaseUrl: client.baseUrl,
      orgId: SETTINGS.activeOrgId ?? "",
      workspaceId: WORKSPACE_ID,
    })).toEqual({
      denBaseUrl: SETTINGS.baseUrl,
      serverBaseUrl: client.baseUrl,
      orgId: "organization_1",
      workspaceId: WORKSPACE_ID,
      expiresAt: MINTED.expiresAt,
    });
  });

  test("a fresh per-workspace marker prevents repeated token and config writes", async () => {
    let mintCount = 0;
    let writeCount = 0;
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({
        items: [{
          name: "openwork-cloud",
          config: { type: "remote", enabled: true, url: "https://api.openwork.test/mcp/agent" },
        }],
      }),
      addMcp: async () => {
        writeCount += 1;
        return { items: [] };
      },
    };

    await syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW,
      mintToken: async () => MINTED,
    });
    mintCount = 0;
    writeCount = 0;

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW + 1_000,
      mintToken: async () => {
        mintCount += 1;
        return MINTED;
      },
    })).resolves.toBe("unchanged");
    expect(mintCount).toBe(0);
    expect(writeCount).toBe(0);
  });

  test("keeps independent markers when switching between workspaces", async () => {
    let mintCount = 0;
    const writes: string[] = [];
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({
        items: [{
          name: "openwork-cloud",
          config: { type: "remote", enabled: true, url: "https://api.openwork.test/mcp/agent" },
        }],
      }),
      addMcp: async (workspaceId: string) => {
        writes.push(workspaceId);
        return { items: [] };
      },
    };
    const mintToken = async () => {
      mintCount += 1;
      return MINTED;
    };

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: "workspace_a",
      settings: SETTINGS,
      now: NOW,
      mintToken,
    })).resolves.toBe("synced");
    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: "workspace_b",
      settings: SETTINGS,
      now: NOW,
      mintToken,
    })).resolves.toBe("synced");
    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: "workspace_a",
      settings: SETTINGS,
      now: NOW + 1_000,
      mintToken,
    })).resolves.toBe("unchanged");

    expect(mintCount).toBe(2);
    expect(writes).toEqual(["workspace_a", "workspace_b"]);
  });

  test("keeps same-named remote workspaces separate across workers", async () => {
    let mintCount = 0;
    const writes: string[] = [];
    const makeClient = (baseUrl: string) => ({
      baseUrl,
      listMcp: async () => ({
        items: [{
          name: "openwork-cloud",
          config: { type: "remote", enabled: true, url: "https://api.openwork.test/mcp/agent" },
        }],
      }),
      addMcp: async () => {
        writes.push(baseUrl);
        return { items: [] };
      },
    });
    const workerA = makeClient("https://worker-a.openwork.test");
    const workerB = makeClient("https://worker-b.openwork.test");
    const mintToken = async () => {
      mintCount += 1;
      return MINTED;
    };

    for (const client of [workerA, workerB, workerA]) {
      await syncCloudControlMcpInBackground({
        client,
        workspaceId: "workspace_shared_id",
        settings: SETTINGS,
        now: NOW,
        mintToken,
      });
    }

    expect(mintCount).toBe(2);
    expect(writes).toEqual([workerA.baseUrl, workerB.baseUrl]);
  });

  test("explicit removal keeps background maintenance disabled", async () => {
    writeCloudMcpUserState("removed");
    let listed = false;

    await expect(syncCloudControlMcpInBackground({
      client: {
        baseUrl: "https://worker.openwork.test",
        listMcp: async () => {
          listed = true;
          return { items: [] };
        },
        addMcp: async () => ({ items: [] }),
      },
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      force: true,
      mintToken: async () => MINTED,
    })).resolves.toBe("skipped");
    expect(listed).toBe(false);
  });

  test("explicit disabled intent skips before list, mint, or write", async () => {
    writeCloudMcpUserState("disabled");
    let listCount = 0;
    let mintCount = 0;
    let writeCount = 0;

    await expect(syncCloudControlMcpInBackground({
      client: {
        baseUrl: "https://worker.openwork.test",
        listMcp: async () => {
          listCount += 1;
          return { items: [] };
        },
        addMcp: async () => {
          writeCount += 1;
          return { items: [] };
        },
      },
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      force: true,
      mintToken: async () => {
        mintCount += 1;
        return MINTED;
      },
    })).resolves.toBe("skipped");

    expect(listCount).toBe(0);
    expect(mintCount).toBe(0);
    expect(writeCount).toBe(0);
  });

  test("configured enabled:false skips mint and write even when forced", async () => {
    let mintCount = 0;
    let writeCount = 0;

    await expect(syncCloudControlMcpInBackground({
      client: {
        baseUrl: "https://worker.openwork.test",
        listMcp: async () => ({
          items: [{
            name: "openwork-cloud",
            config: { type: "remote", enabled: false, url: "https://api.openwork.test/mcp/agent" },
          }],
        }),
        addMcp: async () => {
          writeCount += 1;
          return { items: [] };
        },
      },
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      force: true,
      mintToken: async () => {
        mintCount += 1;
        return MINTED;
      },
    })).resolves.toBe("skipped");

    expect(mintCount).toBe(0);
    expect(writeCount).toBe(0);
  });

  test("force bypasses a fresh marker and rewrites the Cloud MCP", async () => {
    let mintCount = 0;
    let writeCount = 0;
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({
        items: [{
          name: "openwork-cloud",
          config: { type: "remote", enabled: true, url: "https://api.openwork.test/mcp/agent" },
        }],
      }),
      addMcp: async () => {
        writeCount += 1;
        return { items: [] };
      },
    };
    const mintToken = async () => {
      mintCount += 1;
      return MINTED;
    };

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW,
      mintToken,
    })).resolves.toBe("synced");
    mintCount = 0;
    writeCount = 0;

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW + 1_000,
      force: true,
      mintToken,
    })).resolves.toBe("synced");

    expect(mintCount).toBe(1);
    expect(writeCount).toBe(1);
  });

  test("legacy bare web-app MCP URL bypasses a fresh marker and rewrites healed URL", async () => {
    const healedMinted: DenMcpToken = {
      ...MINTED,
      token: "healed-token",
      resource: "https://app.openworklabs.com/mcp",
    };
    const writes: Array<{ config: Record<string, unknown> }> = [];
    let mintCount = 0;
    let listLegacyUrl = false;
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({
        items: listLegacyUrl
          ? [{
              name: "openwork-cloud",
              config: {
                type: "remote",
                enabled: true,
                url: "https://app.openworklabs.com/mcp",
              },
            }]
          : [],
      }),
      addMcp: async (_workspaceId: string, payload: { config: Record<string, unknown> }) => {
        writes.push({ config: payload.config });
        return { items: [] };
      },
    };
    const mintToken = async () => {
      mintCount += 1;
      return healedMinted;
    };

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW,
      mintToken,
    })).resolves.toBe("synced");
    mintCount = 0;
    writes.length = 0;
    listLegacyUrl = true;

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      now: NOW + 1_000,
      mintToken,
    })).resolves.toBe("synced");

    expect(mintCount).toBe(1);
    expect(writes).toEqual([{
      config: {
        type: "remote",
        enabled: true,
        url: "https://app.openworklabs.com/api/den/mcp/agent",
        headers: { Authorization: "Bearer healed-token" },
        oauth: false,
      },
    }]);
  });

  test("null or failed mint skips without writing", async () => {
    let writeCount = 0;
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({ items: [] }),
      addMcp: async () => {
        writeCount += 1;
        return { items: [] };
      },
    };

    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      mintToken: async () => null,
    })).resolves.toBe("skipped");
    await expect(syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      mintToken: async () => {
        throw new Error("mint failed");
      },
    })).resolves.toBe("skipped");

    expect(writeCount).toBe(0);
  });

  test("deduplicates overlapping Cloud MCP reconciliation for the same target", async () => {
    let mintCount = 0;
    let writeCount = 0;
    let releaseMint: (value: DenMcpToken | null) => void = () => {};
    const mintBlocked = new Promise<DenMcpToken | null>((resolve) => {
      releaseMint = resolve;
    });
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({ items: [] }),
      addMcp: async () => {
        writeCount += 1;
        return { items: [] };
      },
    };

    const first = syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      mintToken: async () => {
        mintCount += 1;
        return mintBlocked;
      },
    });
    const second = syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      mintToken: async () => {
        mintCount += 1;
        return MINTED;
      },
    });

    await expect(second).resolves.toBe("skipped");
    releaseMint(MINTED);
    await expect(first).resolves.toBe("synced");
    expect(mintCount).toBe(1);
    expect(writeCount).toBe(1);
  });

  test("forced overlapping Cloud MCP reconciliation waits and rewrites after the current sync", async () => {
    const writes: string[] = [];
    let mintCount = 0;
    let releaseMint: (value: DenMcpToken | null) => void = () => {};
    const mintBlocked = new Promise<DenMcpToken | null>((resolve) => {
      releaseMint = resolve;
    });
    const client = {
      baseUrl: "https://worker.openwork.test",
      listMcp: async () => ({ items: [] }),
      addMcp: async (_workspaceId: string, payload: { config: Record<string, unknown> }) => {
        const headers = payload.config.headers;
        const authorization = headers &&
          typeof headers === "object" &&
          "Authorization" in headers &&
          typeof headers.Authorization === "string"
          ? headers.Authorization
          : "";
        writes.push(authorization);
        return { items: [] };
      },
    };

    const first = syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      mintToken: async () => {
        mintCount += 1;
        return mintBlocked;
      },
    });
    const forced = syncCloudControlMcpInBackground({
      client,
      workspaceId: WORKSPACE_ID,
      settings: SETTINGS,
      force: true,
      mintToken: async () => {
        mintCount += 1;
        return { ...MINTED, token: "forced-token" };
      },
    });

    releaseMint({ ...MINTED, token: "normal-token" });
    await expect(first).resolves.toBe("synced");
    await expect(forced).resolves.toBe("synced");
    expect(mintCount).toBe(2);
    expect(writes).toEqual(["Bearer normal-token", "Bearer forced-token"]);
  });

  test("deduplicates the same target without blocking another workspace", async () => {
    const firstClient = { baseUrl: "https://worker.openwork.test", token: "worker-token" };
    const recreatedClient = { baseUrl: "https://worker.openwork.test/", token: "worker-token" };
    const targetA = getSessionMcpMaintenanceTargetKey({
      client: firstClient,
      workspaceId: "workspace_a",
      directory: "/workspace/a",
    });
    const recreatedTargetA = getSessionMcpMaintenanceTargetKey({
      client: recreatedClient,
      workspaceId: "workspace_a",
      directory: "/workspace/a",
    });
    const targetB = getSessionMcpMaintenanceTargetKey({
      client: recreatedClient,
      workspaceId: "workspace_b",
      directory: "/workspace/b",
    });
    let releaseTargetA = () => {};
    let targetARuns = 0;
    let targetBRuns = 0;
    const targetABlocked = new Promise<void>((resolve) => {
      releaseTargetA = resolve;
    });

    const firstTargetA = runSessionMcpMaintenanceTask({
      targetKey: targetA,
      task: async () => {
        targetARuns += 1;
        await targetABlocked;
      },
    });
    await Promise.resolve();

    await expect(runSessionMcpMaintenanceTask({
      targetKey: recreatedTargetA,
      task: async () => {
        targetARuns += 1;
      },
    })).resolves.toBe(false);
    await expect(runSessionMcpMaintenanceTask({
      targetKey: targetB,
      task: async () => {
        targetBRuns += 1;
      },
    })).resolves.toBe(true);

    releaseTargetA();
    await expect(firstTargetA).resolves.toBe(true);
    expect(targetARuns).toBe(1);
    expect(targetBRuns).toBe(1);
  });
});
