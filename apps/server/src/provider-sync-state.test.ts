import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectProviderSyncState,
  readProviderSyncState,
  readProviderSyncStatus,
  updateProviderSyncState,
  writeProviderSyncState,
} from "./provider-sync-state.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
});

async function createConfig(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "openwork-provider-sync-state-"));
  roots.push(root);
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{
      id: "ws_1",
      name: "Workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("provider sync state file", () => {
  test("returns a dormant default when the state file is missing", async () => {
    const config = await createConfig();
    const inspection = await inspectProviderSyncState(config);

    expect(inspection.status).toBe("missing");
    expect(inspection.state).toMatchObject({
      enabled: false,
      token: null,
      applied: { etag: null, providers: {}, inferenceTokenExpiresAt: null },
      lastError: null,
    });
  });

  test("writes credentials while exposing only redacted status", async () => {
    const config = await createConfig();
    await writeProviderSyncState(config, {
      enabled: true,
      token: "provider-sync-secret",
      expiresAt: "2030-01-02T00:00:00.000Z",
      denBaseUrl: "https://app.openworklabs.com/api/den",
      orgId: "org_1",
    });
    await updateProviderSyncState(config, (current) => ({
      ...current,
      applied: {
        etag: "etag-1",
        providers: { lpr_one: { denProviderId: "provider_1", updatedAt: "2030-01-01T00:00:00.000Z" } },
        inferenceTokenExpiresAt: "2030-01-01T00:15:00.000Z",
      },
      lastSyncAt: "2030-01-01T00:00:00.000Z",
    }));

    expect((await readProviderSyncState(config)).token).toBe("provider-sync-secret");
    const status = await readProviderSyncStatus(config);
    expect(status).toEqual({
      enabled: true,
      hasToken: true,
      tokenExpiresAt: "2030-01-02T00:00:00.000Z",
      orgId: "org_1",
      lastSyncAt: "2030-01-01T00:00:00.000Z",
      lastError: null,
      appliedProviderIds: ["lpr_one"],
    });
    expect(JSON.stringify(status)).not.toContain("provider-sync-secret");
  });

  test("preserves applied ownership on disable and rejects malformed files", async () => {
    const config = await createConfig();
    await writeProviderSyncState(config, {
      enabled: true,
      token: "provider-sync-secret",
      expiresAt: "2030-01-02T00:00:00.000Z",
      denBaseUrl: "http://127.0.0.1:4242",
      orgId: "org_1",
    });
    await updateProviderSyncState(config, (current) => ({
      ...current,
      applied: {
        ...current.applied,
        providers: { lpr_one: { denProviderId: "provider_1", updatedAt: "2030-01-01T00:00:00.000Z" } },
      },
    }));
    await writeProviderSyncState(config, {
      enabled: false,
      token: null,
      expiresAt: null,
      denBaseUrl: null,
      orgId: null,
    });
    expect(Object.keys((await readProviderSyncState(config)).applied.providers)).toEqual(["lpr_one"]);

    await writeFile(join(config.configPath ? join(config.configPath, "..") : "", "provider-sync-state.json"), "{oops", "utf8");
    expect((await inspectProviderSyncState(config)).status).toBe("invalid");
  });

  test("validates host state writes and returns redacted diagnostics", async () => {
    const config = await createConfig();
    const server = await startServer(config);
    stops.push(() => server.stop());
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = {
      "content-type": "application/json",
      "x-openwork-host-token": config.hostToken,
    };

    const invalid = await fetch(`${baseUrl}/experimental/provider-sync/state`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        enabled: false,
        token: null,
        expiresAt: null,
        denBaseUrl: null,
        orgId: null,
        unexpected: true,
      }),
    });
    expect(invalid.status).toBe(400);

    const written = await fetch(`${baseUrl}/experimental/provider-sync/state`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        enabled: true,
        token: "provider-sync-secret",
        expiresAt: "2020-01-02T00:00:00.000Z",
        denBaseUrl: "https://app.openworklabs.com/api/den",
        orgId: "org_1",
      }),
    });
    expect(written.status).toBe(200);
    const diagnostics: unknown = await written.json();
    expect(diagnostics).toMatchObject({
      enabled: true,
      hasToken: true,
      orgId: "org_1",
      appliedProviderIds: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain("provider-sync-secret");

    const readback = await fetch(`${baseUrl}/experimental/provider-sync/state`, { headers });
    expect(readback.status).toBe(200);
    expect(JSON.stringify(await readback.json())).not.toContain("provider-sync-secret");
  });
});
