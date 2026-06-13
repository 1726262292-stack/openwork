import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-session-groups-"));
  roots.push(root);
  process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  return root;
}

async function startOpenworkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, token: config.token };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json(response: Response) {
  expect(response.status).toBe(200);
  return response.json();
}

describe("session group API", () => {
  test("persists groups, assignments, and update events in the runtime db", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startOpenworkServer(root);

    const empty = await json(await fetch(`${base}/workspace/ws_1/session-groups`, { headers: auth(token) }));
    expect(empty).toMatchObject({ state: { groups: [], assignments: {} } });

    const imported = await json(await fetch(`${base}/workspace/ws_1/session-groups`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({
        state: {
          groups: [{ id: "grp_imported", label: "Imported" }],
          assignments: { ses_1: "grp_imported" },
        },
      }),
    }));
    expect(imported).toMatchObject({
      state: {
        groups: [{ id: "grp_imported", label: "Imported" }],
        assignments: { ses_1: "grp_imported" },
      },
    });

    const created = await json(await fetch(`${base}/workspace/ws_1/session-groups`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ id: "grp_next", label: "Next" }),
    }));
    expect(created).toMatchObject({
      state: {
        groups: [
          { id: "grp_imported", label: "Imported" },
          { id: "grp_next", label: "Next" },
        ],
      },
    });

    const assigned = await json(await fetch(`${base}/workspace/ws_1/session-groups/assignments/ses_2`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ groupId: "grp_next" }),
    }));
    expect(assigned).toMatchObject({ state: { assignments: { ses_1: "grp_imported", ses_2: "grp_next" } } });

    const events = await json(await fetch(`${base}/workspace/ws_1/session-groups/events`, { headers: auth(token) }));
    expect(events.items.map((event: { action: string }) => event.action)).toEqual(["imported", "created", "assigned"]);

    const persisted = await json(await fetch(`${base}/workspace/ws_1/session-groups`, { headers: auth(token) }));
    expect(persisted).toMatchObject(assigned);
  });
});
