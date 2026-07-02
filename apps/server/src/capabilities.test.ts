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
    const exportHits = searchCapabilities("export mcp for marketplace");
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
          { query: "export mcp for marketplace" },
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
