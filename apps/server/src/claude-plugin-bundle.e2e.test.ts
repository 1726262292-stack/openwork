import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { startServer } from "./server.js";
import { parseClaudePluginSource } from "./claude-plugin-bundle.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
let previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv = {};
});

function setEnv(key: string, value: string) {
  if (!(key in previousEnv)) previousEnv[key] = process.env[key];
  process.env[key] = value;
}

const PLUGIN_FILES: Record<string, string> = {
  ".claude-plugin/plugin.json": JSON.stringify({
    name: "slack",
    displayName: "Slack",
    description: "Slack integration for searching messages and sending communications",
    version: "1.0.0",
  }),
  ".mcp.json": JSON.stringify({
    mcpServers: {
      slack: { url: "https://mcp.slack.com/mcp" },
      "local-helper": { command: "${CLAUDE_PLUGIN_ROOT}/bin/run" },
    },
  }),
  "skills/slack-search/SKILL.md": [
    "---",
    "name: slack-search",
    "description: Search Slack messages effectively",
    "---",
    "",
    "Use the slack MCP tools to search.",
  ].join("\n"),
  "skills/slack-search/references/tips.md": "Extra reference file.",
  "commands/standup.md": [
    "---",
    "description: Compile a standup update from Slack",
    "---",
    "",
    "Summarize recent messages.",
  ].join("\n"),
  "README.md": "# Slack plugin",
};

function startMockGithub(options?: { branch?: string }) {
  const branch = options?.branch ?? "main";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      // API: repo info
      if (url.pathname === "/repos/slackapi/slack-mcp-plugin") {
        return Response.json({ default_branch: branch });
      }
      // API: recursive tree (ref may arrive %2F-encoded for slash branches)
      const treePrefix = "/repos/slackapi/slack-mcp-plugin/git/trees/";
      if (url.pathname.startsWith(treePrefix)) {
        const ref = decodeURIComponent(url.pathname.slice(treePrefix.length));
        if (ref !== branch) return Response.json({ message: "not found" }, { status: 404 });
        return Response.json({
          tree: Object.keys(PLUGIN_FILES).map((path) => ({ path, type: "blob", sha: `sha-${path}` })),
        });
      }
      // Raw files (slash-branch refs appear as literal path segments)
      const rawPrefix = `/slackapi/slack-mcp-plugin/${branch}/`;
      if (url.pathname.startsWith(rawPrefix)) {
        const path = decodeURIComponent(url.pathname.slice(rawPrefix.length));
        const content = PLUGIN_FILES[path];
        if (content !== undefined) return new Response(content);
      }
      return Response.json({ message: "not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return server;
}

function startMockOpencode() {
  const requests: Array<{ method: string; pathname: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, pathname: url.pathname });
      if (request.method === "POST" && url.pathname === "/mcp") {
        const body = await request.json().catch(() => null) as { name?: unknown } | null;
        const name = typeof body?.name === "string" ? body.name : "";
        return Response.json(name ? { [name]: { status: "connected" } } : {});
      }
      return Response.json({});
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startOpenwork(options?: { branch?: string }) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "openwork-claude-plugin-"));
  roots.push(workspaceRoot);
  setEnv("OPENWORK_RUNTIME_DB", join(workspaceRoot, "runtime.sqlite"));

  const github = startMockGithub(options);
  setEnv("OPENWORK_GITHUB_API_BASE", `http://127.0.0.1:${github.port}`);
  setEnv("OPENWORK_GITHUB_RAW_BASE", `http://127.0.0.1:${github.port}`);

  const engine = startMockOpencode();
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: `http://127.0.0.1:${engine.server.port}`,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return {
    base: `http://127.0.0.1:${server.port}`,
    headers: { Authorization: "Bearer owt_test_token", "Content-Type": "application/json" },
    workspaceRoot,
    engine,
  };
}

async function seedHistoricalMarketplaceImport(workspaceRoot: string) {
  const skillPath = join(workspaceRoot, ".opencode/skills/legacy-marketplace-plugin/legacy-skill/SKILL.md");
  await mkdir(join(workspaceRoot, ".opencode/skills/legacy-marketplace-plugin/legacy-skill"), { recursive: true });
  await writeFile(skillPath, "---\nname: legacy-skill\ndescription: Legacy\n---\n\nLegacy body.\n", "utf8");

  const db = new Database(join(workspaceRoot, "runtime.sqlite"), { create: true });
  try {
    db.run("CREATE TABLE IF NOT EXISTS openwork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS cloud_plugin_install_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    db.run(
      "INSERT INTO openwork_workspace_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
      [
        "ws_1",
        JSON.stringify({
          cloudImports: {
            skills: {},
            providers: {},
            marketplaces: {
              marketplace_legacy: {
                marketplaceId: "marketplace_legacy",
                name: "Legacy Marketplace",
                updatedAt: "2026-06-01T00:00:00.000Z",
                pluginIds: ["plugin_legacy"],
                importedAt: 1,
              },
            },
            plugins: {
              plugin_legacy: {
                pluginId: "plugin_legacy",
                marketplaceId: "marketplace_legacy",
                name: "Legacy Marketplace Plugin",
                description: "Imported before marketplace sync removal.",
                updatedAt: "2026-06-02T00:00:00.000Z",
                importedAt: 1,
                files: [
                  {
                    configObjectId: "config_legacy_skill",
                    denSkillId: "skill_legacy",
                    externalMcpConnectionId: "connection_legacy",
                    versionId: "version_legacy_skill",
                    objectType: "skill",
                    title: "Legacy Skill",
                    path: ".opencode/skills/legacy-marketplace-plugin/legacy-skill/SKILL.md",
                    updatedAt: "2026-06-02T00:00:00.000Z",
                  },
                ],
              },
            },
          },
        }),
        Date.now(),
      ],
    );
    db.run(
      "INSERT INTO cloud_plugin_install_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at",
      [
        "ws_1",
        JSON.stringify({
          skills: {},
          providers: {},
          marketplaces: {
            marketplace_legacy: {
              marketplaceId: "marketplace_legacy",
              name: "Current Marketplace Record",
              updatedAt: "2026-06-03T00:00:00.000Z",
              pluginIds: ["plugin_current"],
              importedAt: 2,
            },
          },
          plugins: {
            plugin_current: {
              pluginId: "plugin_current",
              marketplaceId: "marketplace_legacy",
              name: "Current Local Plugin",
              description: null,
              updatedAt: null,
              importedAt: 2,
              files: [],
            },
          },
        }),
        Date.now(),
      ],
    );
  } finally {
    db.close();
  }
  return skillPath;
}

describe("parseClaudePluginSource", () => {
  test("parses URL variants", () => {
    expect(parseClaudePluginSource("https://github.com/slackapi/slack-mcp-plugin")).toEqual({
      owner: "slackapi",
      repo: "slack-mcp-plugin",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseClaudePluginSource("github.com/slackapi/slack-mcp-plugin.git")).toEqual({
      owner: "slackapi",
      repo: "slack-mcp-plugin",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseClaudePluginSource("https://github.com/a/b/tree/dev/plugins/x")).toEqual({
      owner: "a",
      repo: "b",
      ref: "dev",
      dir: "plugins/x",
      treeSegments: ["dev", "plugins", "x"],
    });
    // Query strings and hash fragments are ignored.
    expect(parseClaudePluginSource("https://github.com/a/b?tab=readme-ov-file#readme")).toEqual({
      owner: "a",
      repo: "b",
      ref: null,
      dir: null,
      treeSegments: null,
    });
    expect(parseClaudePluginSource("https://github.com/a/b/tree/dev/plugins/x?x=1")).toEqual({
      owner: "a",
      repo: "b",
      ref: "dev",
      dir: "plugins/x",
      treeSegments: ["dev", "plugins", "x"],
    });
    expect(() => parseClaudePluginSource("https://gitlab.com/a/b")).toThrow();
    expect(() => parseClaudePluginSource("not a url")).toThrow();
  });
});

describe("claude plugin bundles", () => {
  test("legacy Den cloud-plugin install route is gone", async () => {
    const openwork = await startOpenwork();

    const response = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins`, {
      method: "POST",
      headers: openwork.headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
  });

  test("historical marketplace plugin records still list and uninstall", async () => {
    const openwork = await startOpenwork();
    const skillPath = await seedHistoricalMarketplaceImport(openwork.workspaceRoot);

    const listResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins`, { headers: openwork.headers });
    expect(listResponse.status).toBe(200);
    const listBody: { marketplaces: Record<string, { pluginIds: string[] }>; plugins: Record<string, { marketplaceId: string | null; files: Array<{ denSkillId?: string | null; externalMcpConnectionId?: string | null }> }> } = await listResponse.json();
    expect(listBody.plugins.plugin_legacy?.marketplaceId).toBe("marketplace_legacy");
    expect(listBody.plugins.plugin_legacy?.files[0]).toMatchObject({
      denSkillId: "skill_legacy",
      externalMcpConnectionId: "connection_legacy",
    });
    expect(listBody.plugins.plugin_current?.marketplaceId).toBe("marketplace_legacy");
    expect(listBody.marketplaces.marketplace_legacy?.pluginIds).toEqual(["plugin_current", "plugin_legacy"]);

    const removeResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins/plugin_legacy`, {
      method: "DELETE",
      headers: openwork.headers,
    });
    expect(removeResponse.status).toBe(200);
    expect(existsSync(skillPath)).toBe(false);

    const afterResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins`, { headers: openwork.headers });
    const afterBody: { marketplaces: Record<string, { pluginIds: string[] }>; plugins: Record<string, unknown> } = await afterResponse.json();
    expect(afterBody.plugins.plugin_legacy).toBeUndefined();
    expect(afterBody.plugins.plugin_current).toBeDefined();
    expect(afterBody.marketplaces.marketplace_legacy?.pluginIds).toEqual(["plugin_current"]);
  });

  test("historical marketplace plugin records can uninstall before the first list", async () => {
    const openwork = await startOpenwork();
    const skillPath = await seedHistoricalMarketplaceImport(openwork.workspaceRoot);

    const removeResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins/plugin_legacy`, {
      method: "DELETE",
      headers: openwork.headers,
    });
    expect(removeResponse.status).toBe(200);
    expect(existsSync(skillPath)).toBe(false);

    const afterResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins`, { headers: openwork.headers });
    const afterBody: { plugins: Record<string, unknown> } = await afterResponse.json();
    expect(afterBody.plugins.plugin_legacy).toBeUndefined();
    expect(afterBody.plugins.plugin_current).toBeDefined();
  });

  test("dryRun returns the Will-install preview with warnings", async () => {
    const openwork = await startOpenwork();

    const response = await fetch(`${openwork.base}/workspace/ws_1/claude-plugins`, {
      method: "POST",
      headers: openwork.headers,
      body: JSON.stringify({ url: "https://github.com/slackapi/slack-mcp-plugin", dryRun: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { preview: { name: string; version: string | null; components: Array<{ type: string; name: string }>; warnings: string[] } };

    expect(body.preview.name).toBe("Slack");
    expect(body.preview.version).toBe("1.0.0");
    const byType = (type: string) => body.preview.components.filter((entry) => entry.type === type).map((entry) => entry.name);
    expect(byType("mcp")).toEqual(["slack"]);
    expect(byType("skill")).toEqual(["slack-search"]);
    expect(byType("command")).toEqual(["standup"]);
    // local-helper uses ${CLAUDE_PLUGIN_ROOT} and must be skipped with a warning.
    expect(body.preview.warnings.some((warning) => warning.includes("local-helper"))).toBe(true);
    // Nothing installed on dryRun.
    expect(existsSync(join(openwork.workspaceRoot, ".opencode/skills/slack-plugin"))).toBe(false);
  });

  test("resolves branch names containing slashes in /tree/ URLs", async () => {
    const openwork = await startOpenwork({ branch: "release/v1" });

    const response = await fetch(`${openwork.base}/workspace/ws_1/claude-plugins`, {
      method: "POST",
      headers: openwork.headers,
      body: JSON.stringify({
        url: "https://github.com/slackapi/slack-mcp-plugin/tree/release/v1",
        dryRun: true,
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { preview: { name: string; source: { ref: string; dir: string | null } } };
    // "release" fails as a ref, so the resolver falls through to "release/v1".
    expect(body.preview.source.ref).toBe("release/v1");
    expect(body.preview.source.dir).toBeNull();
    expect(body.preview.name).toBe("Slack");
  });

  test("installs skills, commands, and MCP servers; uninstall cleans up", async () => {
    const openwork = await startOpenwork();
    await seedHistoricalMarketplaceImport(openwork.workspaceRoot);

    const installResponse = await fetch(`${openwork.base}/workspace/ws_1/claude-plugins`, {
      method: "POST",
      headers: openwork.headers,
      body: JSON.stringify({ url: "https://github.com/slackapi/slack-mcp-plugin" }),
    });
    expect(installResponse.status).toBe(200);
    const installBody = await installResponse.json() as { item: { pluginId: string; files: Array<{ objectType: string; path: string }> } };
    expect(installBody.item.pluginId).toBe("github:slackapi/slack-mcp-plugin");

    const cloudPluginsResponse = await fetch(`${openwork.base}/workspace/ws_1/cloud-plugins`, { headers: openwork.headers });
    const cloudPluginsBody: { plugins: Record<string, { marketplaceId: string | null }> } = await cloudPluginsResponse.json();
    expect(cloudPluginsBody.plugins[installBody.item.pluginId]?.marketplaceId).toBeNull();
    expect(cloudPluginsBody.plugins.plugin_legacy?.marketplaceId).toBe("marketplace_legacy");
    expect(cloudPluginsBody.plugins.plugin_current?.marketplaceId).toBe("marketplace_legacy");

    // Skill and command land namespaced under .opencode/.
    const skillPath = join(openwork.workspaceRoot, ".opencode/skills/slack-plugin/slack-search/SKILL.md");
    const commandPath = join(openwork.workspaceRoot, ".opencode/commands/slack-plugin/standup.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(commandPath)).toBe(true);
    expect(await readFile(skillPath, "utf8")).toContain("Search Slack messages effectively");

    // MCP registered in the runtime DB and pushed to the engine.
    const listResponse = await fetch(`${openwork.base}/workspace/ws_1/mcp`, { headers: openwork.headers });
    const listBody = await listResponse.json() as { items: Array<{ name: string; source: string }> };
    const slackEntry = listBody.items.find((entry) => entry.name === "slack");
    expect(slackEntry?.source).toBe("config.remote");
    expect(openwork.engine.requests.some((entry) => entry.method === "POST" && entry.pathname === "/mcp")).toBe(true);

    // Uninstall through the shared cloud-plugins route.
    const removeResponse = await fetch(
      `${openwork.base}/workspace/ws_1/cloud-plugins/${encodeURIComponent(installBody.item.pluginId)}`,
      { method: "DELETE", headers: openwork.headers },
    );
    expect(removeResponse.status).toBe(200);
    expect(existsSync(skillPath)).toBe(false);
    expect(existsSync(commandPath)).toBe(false);
    const afterRemove = await fetch(`${openwork.base}/workspace/ws_1/mcp`, { headers: openwork.headers });
    const afterRemoveBody = await afterRemove.json() as { items: Array<{ name: string }> };
    expect(afterRemoveBody.items.some((entry) => entry.name === "slack")).toBe(false);
  });
});
