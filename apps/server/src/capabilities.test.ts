import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp } from "./mcp.js";
import { getCapability, listCapabilities, searchCapabilities } from "./capabilities.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { exists } from "./utils.js";

const WORKSPACE_ID = "ws_capabilities_test";
const SECRET = "Bearer capability-secret-555";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function withWorkspace(fn: (input: { root: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-capabilities-"));
  const previousDb = process.env.OPENWORK_RUNTIME_DB;
  process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  try {
    await mkdir(join(root, ".git"), { recursive: true });
    await fn({ root, config: serverConfig(root) });
  } finally {
    if (previousDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
    else process.env.OPENWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSkill(root: string, name: string) {
  const dir = join(root, ".opencode", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\nBody\n`, "utf8");
}

describe("capability index", () => {
  test("cards carry intent metadata and effects", () => {
    const cards = listCapabilities();
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const card of cards) {
      expect(card.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(card.when.length).toBeGreaterThan(10);
      expect(card.origin).toBe("server");
      expect(["read", "write:workspace"]).toContain(card.effects);
    }
  });

  test("search ranks by intent terms", () => {
    const exportHits = searchCapabilities("portable export of an mcp");
    expect(exportHits.at(0)?.id).toBe("extensions.export");
    const skillHits = searchCapabilities("save repeatable work as a skill");
    expect(skillHits.map((card) => card.id)).toContain("skills.upsert");
    expect(searchCapabilities("quantum blockchain karaoke")).toEqual([]);
  });

  test("empty query lists everything up to the limit", () => {
    expect(searchCapabilities("", 2).length).toBe(2);
  });

  test("unknown capability id resolves to null", () => {
    expect(getCapability("nope.nothing")).toBeNull();
  });
});

describe("capability execution over HTTP", () => {
  test("read capability: mcp.list redacts secrets", async () => {
    await withWorkspace(async ({ root, config }) => {
      await addMcp(config, WORKSPACE_ID, "cap-mcp", {
        type: "remote",
        url: "https://mcp.example.com/cap",
        headers: { Authorization: SECRET },
        enabled: false,
      });
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ id: "mcp.list" }),
        });
        expect(response.status).toBe(200);
        const raw = await response.text();
        expect(raw).not.toContain(SECRET);
        const payload = JSON.parse(raw) as { result: { items: Array<{ name: string; redactedKeys: string[] }> } };
        const item = payload.result.items.find((entry) => entry.name === "cap-mcp");
        expect(item?.redactedKeys).toEqual(["headers.Authorization"]);
      } finally {
        await server.stop(true);
      }
    });
  });

  test("search endpoint returns ranked cards", async () => {
    await withWorkspace(async ({ config }) => {
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/search?q=${encodeURIComponent("portable export")}`,
          { headers: { authorization: `Bearer ${config.token}` } },
        );
        expect(response.status).toBe(200);
        const payload = await response.json() as { items: Array<{ id: string; argsSchema: unknown }> };
        expect(payload.items.at(0)?.id).toBe("extensions.export");
        expect(payload.items.at(0)?.argsSchema).toBeDefined();
      } finally {
        await server.stop(true);
      }
    });
  });

  test("write capability creates the skill and unknown ids 404", async () => {
    await withWorkspace(async ({ root, config }) => {
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            id: "skills.upsert",
            args: { name: "cap-made-skill", content: "Do the thing.", description: "Made through execute." },
          }),
        });
        expect(response.status).toBe(200);
        expect(await exists(join(root, ".opencode", "skills", "cap-made-skill", "SKILL.md"))).toBe(true);

        const missing = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ id: "nope.nothing" }),
        });
        expect(missing.status).toBe(404);
      } finally {
        await server.stop(true);
      }
    });
  });

  test("write capability is denied for viewer-scope tokens", async () => {
    await withWorkspace(async ({ root, config }) => {
      const server = await startServer(config) as Served;
      try {
        const tokenResponse = await fetch(`http://127.0.0.1:${server.port}/tokens`, {
          method: "POST",
          headers: { "x-openwork-host-token": config.hostToken, "content-type": "application/json" },
          body: JSON.stringify({ scope: "viewer", label: "cap viewer" }),
        });
        expect(tokenResponse.status).toBe(201);
        const viewerToken = (await tokenResponse.json() as { token: string }).token;

        const denied = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ id: "skills.upsert", args: { name: "viewer-skill", content: "x", description: "d" } }),
        });
        expect(denied.status).toBe(403);
        expect(await exists(join(root, ".opencode", "skills", "viewer-skill"))).toBe(false);

        // Read capabilities remain available to viewers.
        const allowed = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" },
          body: JSON.stringify({ id: "skills.list" }),
        });
        expect(allowed.status).toBe(200);
      } finally {
        await server.stop(true);
      }
    });
  });
});

describe("marketplace.share_plan", () => {
  test("compiles a secret-free publish plan with required inputs and fingerprint", async () => {
    await withWorkspace(async ({ root, config }) => {
      await writeSkill(root, "plan-skill");
      await addMcp(config, WORKSPACE_ID, "plan-mcp", {
        type: "remote",
        url: "https://mcp.example.com/plan",
        enabled: false,
        headers: { Authorization: SECRET },
        oauth: { clientId: "plan-client", clientSecret: "plan-oauth-secret-999", scope: "plan.read" },
      });

      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            id: "marketplace.share_plan",
            args: { skills: ["plan-skill"], mcps: ["plan-mcp"], marketplace: "BY IT Marketplace" },
          }),
        });
        expect(response.status).toBe(200);
        const raw = await response.text();
        // Secrets are dropped, not placeholdered: neither the values nor
        // the <redacted> marker may appear in a publishable plan.
        expect(raw).not.toContain(SECRET);
        expect(raw).not.toContain("plan-oauth-secret-999");
        expect(raw).not.toContain("<redacted>");

        const payload = JSON.parse(raw) as {
          result: {
            plan: {
              pluginName: string;
              stepCount: number;
              secretsExcluded: string[];
              planFingerprint: string;
              steps: Array<{ method: string; path: string; body?: Record<string, unknown> }>;
            };
          };
        };
        const plan = payload.result.plan;
        expect(plan.pluginName).toBe("Plan Skill");
        expect(plan.secretsExcluded.sort()).toEqual(["headers.Authorization", "oauth.clientSecret"]);
        expect(plan.planFingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(plan.steps.at(0)?.path).toContain("/v1/marketplaces");
        expect(plan.steps.at(-1)?.body?.pluginId).toBe("{pluginId}");
        const mcpStep = plan.steps.find((step) => JSON.stringify(step).includes("mcpServers"));
        const mcpJson = JSON.stringify(mcpStep);
        expect(mcpJson).toContain("plan-client");
        expect(mcpJson).toContain("plan.read");
        expect(mcpJson).not.toContain("clientSecret");
        // Skill content travels verbatim in its config object.
        const skillStep = plan.steps.find((step) => JSON.stringify(step).includes("rawSourceText"));
        expect(JSON.stringify(skillStep)).toContain("Test skill plan-skill");

        // Same args -> same fingerprint (plan is deterministic).
        const again = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            id: "marketplace.share_plan",
            args: { skills: ["plan-skill"], mcps: ["plan-mcp"], marketplace: "BY IT Marketplace" },
          }),
        });
        const againPlan = (await again.json() as typeof payload).result.plan;
        expect(againPlan.planFingerprint).toBe(plan.planFingerprint);
      } finally {
        await server.stop(true);
      }
    });
  });

  test("404s with the missing component names", async () => {
    await withWorkspace(async ({ config }) => {
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/capabilities/execute`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ id: "marketplace.share_plan", args: { skills: ["ghost"], marketplace: "M" } }),
        });
        expect(response.status).toBe(404);
        expect(await response.text()).toContain("ghost");
      } finally {
        await server.stop(true);
      }
    });
  });

  test("search finds the plan capability for share intent", () => {
    const hits = searchCapabilities("share this skill with my team marketplace");
    expect(hits.at(0)?.id).toBe("marketplace.share_plan");
  });
});

describe("federated search across server + ui + mcp shards", () => {
  test("merges ui bridge actions and mcp pointer cards; execute dispatches by origin", async () => {
    await withWorkspace(async ({ root, config }) => {
      await addMcp(config, WORKSPACE_ID, "fed-mcp", {
        type: "remote",
        url: "https://mcp.example.com/fed",
        enabled: false,
      });

      // Mock UI control bridge: /actions catalog + /execute echo.
      const executed: Array<{ actionId: string; args: unknown }> = [];
      const bridge = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/actions") {
            return Response.json({
              ok: true,
              actions: [
                {
                  id: "settings.panel.open",
                  label: "Open settings panel",
                  description: "Open a settings panel in the OpenWork app.",
                  sideEffect: "navigation",
                  args: [{ name: "panel", description: "Panel id, e.g. extensions." }],
                  disabled: false,
                },
                { id: "hidden.action", label: "Hidden", sideEffect: "none", disabled: true },
              ],
            });
          }
          if (url.pathname === "/execute") {
            const body = await request.json() as { actionId: string; args: unknown };
            executed.push(body);
            return Response.json({ ok: true, result: { route: "/settings/extensions" } });
          }
          return Response.json({ ok: false }, { status: 404 });
        },
      });
      const discoveryPath = join(root, "ui-bridge.json");
      await writeFile(discoveryPath, JSON.stringify({ baseUrl: `http://127.0.0.1:${bridge.port}`, token: "bridge-token" }), "utf8");

      const server = await startServer(config) as Served;
      const previous = {
        url: process.env.OPENWORK_SERVER_URL,
        token: process.env.OPENWORK_SERVER_TOKEN,
        discovery: process.env.OPENWORK_UI_CONTROL_DISCOVERY,
      };
      process.env.OPENWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
      process.env.OPENWORK_SERVER_TOKEN = config.token;
      process.env.OPENWORK_UI_CONTROL_DISCOVERY = discoveryPath;
      try {
        const { OpenWorkExtensionsPreview } = await import("./opencode-plugins/openwork-extensions-preview.js");
        const plugin = await OpenWorkExtensionsPreview();

        const searchOutput = await plugin.tool.openwork_search.execute(
          { query: "open the settings panel" },
          { directory: root },
        );
        const search = JSON.parse(searchOutput) as {
          ok: boolean;
          origins: { server: number; ui: number; mcp: number };
          items: Array<{ id: string; origin: string }>;
        };
        expect(search.ok).toBe(true);
        expect(search.origins.ui).toBeGreaterThanOrEqual(2);
        expect(search.origins.mcp).toBe(1);
        expect(search.items.at(0)?.id).toBe("ui.settings.panel.open");
        // Disabled UI actions never surface.
        expect(search.items.some((item) => item.id === "ui.hidden.action")).toBe(false);

        const mcpSearch = JSON.parse(await plugin.tool.openwork_search.execute(
          { query: "fed-mcp connected app" },
          { directory: root },
        )) as { items: Array<{ id: string }> };
        expect(mcpSearch.items.at(0)?.id).toBe("mcp:fed-mcp");

        const uiExec = JSON.parse(await plugin.tool.openwork_execute.execute(
          { id: "ui.settings.panel.open", args: { panel: "extensions" } },
          { directory: root },
        )) as { ok: boolean; origin: string };
        expect(uiExec.ok).toBe(true);
        expect(uiExec.origin).toBe("ui");
        expect(executed).toEqual([{ actionId: "settings.panel.open", args: { panel: "extensions" } }]);

        const pointer = JSON.parse(await plugin.tool.openwork_execute.execute(
          { id: "mcp:fed-mcp" },
          { directory: root },
        )) as { ok: boolean; origin: string; result: { pointer: boolean; message: string } };
        expect(pointer.ok).toBe(true);
        expect(pointer.origin).toBe("mcp");
        expect(pointer.result.pointer).toBe(true);
        expect(pointer.result.message).toContain('extensions.export');
      } finally {
        if (previous.url === undefined) delete process.env.OPENWORK_SERVER_URL;
        else process.env.OPENWORK_SERVER_URL = previous.url;
        if (previous.token === undefined) delete process.env.OPENWORK_SERVER_TOKEN;
        else process.env.OPENWORK_SERVER_TOKEN = previous.token;
        if (previous.discovery === undefined) delete process.env.OPENWORK_UI_CONTROL_DISCOVERY;
        else process.env.OPENWORK_UI_CONTROL_DISCOVERY = previous.discovery;
        bridge.stop(true);
        await server.stop(true);
      }
    });
  });
});

describe("openwork_search + openwork_execute plugin tools", () => {
  test("agent finds extensions.export by intent and executes it", async () => {
    await withWorkspace(async ({ root, config }) => {
      await writeSkill(root, "cap-skill");
      await addMcp(config, WORKSPACE_ID, "cap-oauth-mcp", {
        type: "remote",
        url: "https://mcp.example.com/oauth",
        enabled: false,
        oauth: { clientId: "cap-client", clientSecret: "cap-oauth-secret-777" },
      });

      const server = await startServer(config) as Served;
      const previousUrl = process.env.OPENWORK_SERVER_URL;
      const previousToken = process.env.OPENWORK_SERVER_TOKEN;
      process.env.OPENWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
      process.env.OPENWORK_SERVER_TOKEN = config.token;
      try {
        const { OpenWorkExtensionsPreview } = await import("./opencode-plugins/openwork-extensions-preview.js");
        const plugin = await OpenWorkExtensionsPreview();

        const searchOutput = await plugin.tool.openwork_search.execute(
          { query: "portable export of an mcp" },
          { directory: root },
        );
        const search = JSON.parse(searchOutput) as { ok: boolean; items: Array<{ id: string }> };
        expect(search.ok).toBe(true);
        expect(search.items.at(0)?.id).toBe("extensions.export");

        const executeOutput = await plugin.tool.openwork_execute.execute(
          { id: "extensions.export", args: { skills: ["cap-skill"], mcps: ["cap-oauth-mcp"] } },
          { directory: root },
        );
        expect(executeOutput).not.toContain("cap-oauth-secret-777");
        const executed = JSON.parse(executeOutput) as {
          ok: boolean;
          result: { components: Array<{ kind: string; name: string; config?: { oauth?: Record<string, unknown> } }> };
        };
        expect(executed.ok).toBe(true);
        const mcp = executed.result.components.find((item) => item.kind === "mcp");
        expect(mcp?.config?.oauth?.clientSecret).toBe("<redacted>");
        expect(mcp?.config?.oauth?.clientId).toBe("cap-client");
      } finally {
        if (previousUrl === undefined) delete process.env.OPENWORK_SERVER_URL;
        else process.env.OPENWORK_SERVER_URL = previousUrl;
        if (previousToken === undefined) delete process.env.OPENWORK_SERVER_TOKEN;
        else process.env.OPENWORK_SERVER_TOKEN = previousToken;
        await server.stop(true);
      }
    });
  });
});
