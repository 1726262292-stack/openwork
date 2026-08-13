import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceArtifactLayout } from "@openwork/types/dynamic-artifacts";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [
      { id: "ws_layout_a", name: "A", path: join(root, "a"), preset: "starter", workspaceType: "local" },
      { id: "ws_layout_b", name: "B", path: join(root, "b"), preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function headers() {
  return {
    authorization: "Bearer token",
    "content-type": "application/json",
  };
}

describe("workspace Artifact layouts", () => {
  test("persists layout configuration and isolates it by workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-artifact-layout-"));
    roots.push(root);
    process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const server = await startServer(serverConfig(root));
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const emptyResponse = await fetch(`${base}/workspace/ws_layout_a/artifact-layout`, { headers: headers() });
      expect(emptyResponse.status).toBe(200);
      expect(await emptyResponse.json()).toMatchObject({
        layout: { version: 1, expanded: false, activeWidgetId: null, widgets: [] },
        updatedAt: null,
      });

      const layout: WorkspaceArtifactLayout = {
        version: 1,
        expanded: true,
        height: "tall",
        visibleWidgets: 2,
        activeWidgetId: "waw_pipeline",
        widgets: [{
          id: "waw_pipeline",
          title: "Pipeline dashboard",
          programId: "configObject_pipeline",
          serverName: "openwork-cloud",
          resourceUri: "ui://openwork/artifacts/arv_pipeline/views/avr_pipeline/index.html",
          input: { maxAgeMs: 3600000 },
        }],
      };
      const savedResponse = await fetch(`${base}/workspace/ws_layout_a/artifact-layout`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ layout }),
      });
      expect(savedResponse.status).toBe(200);
      expect(await savedResponse.json()).toMatchObject({ layout });

      const storedResponse = await fetch(`${base}/workspace/ws_layout_a/artifact-layout`, { headers: headers() });
      expect(await storedResponse.json()).toMatchObject({ layout });

      const otherWorkspace = await fetch(`${base}/workspace/ws_layout_b/artifact-layout`, { headers: headers() });
      expect(await otherWorkspace.json()).toMatchObject({
        layout: { expanded: false, widgets: [] },
        updatedAt: null,
      });
    } finally {
      await server.stop();
    }
  });

  test("rejects invalid or oversized widget collections", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-artifact-layout-invalid-"));
    roots.push(root);
    process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const server = await startServer(serverConfig(root));
    const widgets = Array.from({ length: 13 }, (_, index) => ({
      id: `waw_${index}`,
      title: `Widget ${index}`,
      programId: `configObject_${index}`,
      serverName: "openwork-cloud",
      resourceUri: `ui://openwork/artifacts/arv_${index}/views/avr_${index}/index.html`,
      input: {},
    }));
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_layout_a/artifact-layout`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          layout: {
            version: 1,
            expanded: true,
            height: "standard",
            visibleWidgets: 1,
            activeWidgetId: "waw_0",
            widgets,
          },
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_artifact_layout" });
    } finally {
      await server.stop();
    }
  });
});
