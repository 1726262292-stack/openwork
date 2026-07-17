import { afterEach, describe, expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";

import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { ReloadEventStore } from "../events.js";
import { TokenService } from "../tokens.js";
import type { ServerConfig, TokenScope } from "../types.js";
import { matchRoute, type Route } from "./registry.js";
import { registerSessionRoutes } from "./sessions.js";

type OpencodeResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

const createdSessionResponseSchema = z.object({
  item: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    extra: z.string(),
  }).passthrough(),
}).passthrough();

const stops: Array<() => void> = [];

afterEach(() => {
  while (stops.length) stops.pop()?.();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}

function unwrapOpencodeResult<T, E>(result: OpencodeResult<T, E>, path: string): NonNullable<T> {
  if (result.data != null) return result.data;
  throw new ApiError(502, "opencode_request_failed", "OpenCode request failed", { path });
}

function startFakeOpencode() {
  const requests: Array<{ method: string; pathname: string; body?: unknown }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const text = request.method === "POST" ? await request.text() : "";
      const body: unknown = text ? JSON.parse(text) : undefined;
      requests.push(body === undefined
        ? { method: request.method, pathname: url.pathname }
        : { method: request.method, pathname: url.pathname, body });

      if (request.method === "POST" && url.pathname === "/session") {
        const title = stringProperty(body, "title") ?? "Untitled";
        return Response.json({
          id: "ses_created",
          title,
          slug: "created",
          time: { created: 1, updated: 2 },
          extra: "kept",
        });
      }

      return Response.json({ message: "Not found" }, { status: 404 });
    },
  });
  stops.push(() => server.stop(true));
  return { baseUrl: `http://127.0.0.1:${server.port}`, requests };
}

function createConfig(opencodeBaseUrl: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{
      id: "ws_1",
      name: "Workspace",
      path: "/tmp/openwork-session-create",
      preset: "starter",
      workspaceType: "local",
      baseUrl: opencodeBaseUrl,
    }],
    authorizedRoots: ["/tmp/openwork-session-create"],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

function registerForTest(config: ServerConfig) {
  const routes: Route[] = [];
  const state: { ensureWritableCalls: number; requiredScopes: TokenScope[] } = {
    ensureWritableCalls: 0,
    requiredScopes: [],
  };
  registerSessionRoutes({
    routes,
    config,
    jsonResponse: (data, status = 200) => Response.json(data, { status }),
    parseOptionalBoolean: () => undefined,
    parseOptionalPositiveInteger: () => undefined,
    parseOptionalNonNegativeInteger: () => undefined,
    readJsonBody: async (request) => {
      const body: unknown = await request.json();
      return isRecord(body) ? body : {};
    },
    ensureWritable: () => {
      state.ensureWritableCalls += 1;
    },
    requireClientScope: (_ctx, required) => {
      state.requiredScopes.push(required);
    },
    resolveWorkspace: async (_config, id) => {
      const workspace = config.workspaces.find((item) => item.id === id);
      if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found");
      return workspace;
    },
    createWorkspaceOpencodeClient: (_config, workspace) => createOpencodeClient({ baseUrl: workspace.baseUrl }),
    unwrapOpencodeResult,
  });
  const route = matchRoute(routes, "POST", "/workspace/ws_1/sessions");
  if (!route) throw new Error("POST /workspace/:id/sessions was not registered");
  return { route, state };
}

async function invoke(route: Route, config: ServerConfig, body: Record<string, unknown>): Promise<Response> {
  const url = new URL("http://openwork.test/workspace/ws_1/sessions");
  return route.handler({
    request: new Request(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    url,
    params: { id: "ws_1" },
    config,
    approvals: new ApprovalService(config.approval),
    reloadEvents: new ReloadEventStore(),
    tokens: new TokenService(config),
    actor: { type: "remote", scope: "collaborator" },
  });
}

async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return body;
}

describe("POST /workspace/:id/sessions route", () => {
  test("creates a session with a trimmed, capped title", async () => {
    const opencode = startFakeOpencode();
    const config = createConfig(opencode.baseUrl);
    const harness = registerForTest(config);
    const expectedTitle = "x".repeat(200);

    const response = await invoke(harness.route, config, { title: `  ${"x".repeat(205)}  ` });
    const parsed = createdSessionResponseSchema.parse(await responseJson(response));

    expect(response.status).toBe(201);
    expect(parsed.item).toMatchObject({
      id: "ses_created",
      title: expectedTitle,
      slug: "created",
      extra: "kept",
    });
    expect(opencode.requests[0]?.body).toEqual({ title: expectedTitle });
    expect(harness.state.ensureWritableCalls).toBe(1);
    expect(harness.state.requiredScopes).toEqual(["collaborator"]);
  });

  test("rejects a non-string title", async () => {
    const opencode = startFakeOpencode();
    const config = createConfig(opencode.baseUrl);
    const harness = registerForTest(config);

    await expect(invoke(harness.route, config, { title: 42 })).rejects.toMatchObject({
      status: 400,
      code: "invalid_payload",
    });
    expect(opencode.requests).toHaveLength(0);
  });
});
