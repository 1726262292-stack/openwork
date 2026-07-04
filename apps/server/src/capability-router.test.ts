import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CapabilityRouterError,
  closeCapabilityRouterClients,
  executeWorkspaceCapability,
  searchWorkspaceCapabilities,
} from "./capability-router.js";
import type { McpItem, ServerConfig, SkillItem } from "./types.js";

const roots: string[] = [];
const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

afterEach(async () => {
  await closeCapabilityRouterClients();
});

afterAll(async () => {
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(SERVER_ROOT, ".tmp-capability-router-"));
  roots.push(root);
  return root;
}

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: "ws_1", name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function writeSkill(root: string, name: string, description: string, body: string): Promise<SkillItem> {
  const skillDir = join(root, "skills", name);
  await mkdir(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`, "utf8");
  return { name, description, path, scope: "project" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringProperty(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const property = value[key];
  return typeof property === "string" ? property : "";
}

function textFromCallResult(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return "";
  return value.content
    .map((block) => stringProperty(block, "text"))
    .filter((text) => text.length > 0)
    .join("\n");
}

describe("capability router", () => {
  test("scores skills and slices sorted matches", async () => {
    const root = await createRoot();
    const release = await writeSkill(root, "release-runbook", "Release runbook deploy checklist", "Ship safely.");
    const glossary = await writeSkill(root, "glossary-helper", "Lookup glossary entries including blue forty", "Find terms.");
    const calendar = await writeSkill(root, "calendar-helper", "Calendar event planning", "Plan meetings.");
    const skills = [calendar, glossary, release];

    const result = await searchWorkspaceCapabilities({
      serverConfig: serverConfig(root),
      workspaceId: "ws_1",
      workspaceRoot: root,
      query: "release runbook blue glossary",
      limit: 2,
    }, {
      listMcpImpl: async () => [],
      listSkillsImpl: async () => skills,
    });

    expect(result.unavailable).toEqual([]);
    expect(result.matches.map((match) => match.name)).toEqual(["skill:release-runbook", "skill:glossary-helper"]);
    expect(result.matches.every((match) => match.score > 0)).toBe(true);
  });

  test("executes skills before cloud fallback and reports unknown capability names", async () => {
    const root = await createRoot();
    const skill = await writeSkill(root, "release-runbook", "Release runbook deploy checklist", "Follow the release checklist.");
    const cloud: McpItem = {
      name: "openwork-cloud",
      source: "config.remote",
      config: { type: "remote", url: "http://127.0.0.1:9/mcp", enabled: true },
    };

    const result = await executeWorkspaceCapability({
      serverConfig: serverConfig(root),
      workspaceId: "ws_1",
      workspaceRoot: root,
      name: "skill:release-runbook",
    }, {
      listMcpImpl: async () => [cloud],
      listSkillsImpl: async () => [skill],
    });

    expect(result.source).toBe("skill");
    expect(stringProperty(result.result, "content")).toContain("Follow the release checklist.");

    try {
      await executeWorkspaceCapability({
        serverConfig: serverConfig(root),
        workspaceId: "ws_1",
        workspaceRoot: root,
        name: "mcp:missing:lookup",
      }, {
        listMcpImpl: async () => [],
        listSkillsImpl: async () => [],
      });
      throw new Error("Expected unknown capability");
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityRouterError);
      if (error instanceof CapabilityRouterError) {
        expect(error.code).toBe("unknown_capability");
        expect(error.message).toContain("Call search_capabilities first");
      }
    }
  });

  test("searches and executes a real stdio MCP server", async () => {
    const root = await createRoot();
    const fixturePath = join(root, "glossary-fixture.mjs");
    await writeFile(fixturePath, `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "glossary-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "lookup_glossary",
    description: "Lookup glossary definitions for terms like blue-forty",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string" } },
      required: ["term"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  const term = typeof args.term === "string" ? args.term : "";
  return {
    content: [{
      type: "text",
      text: term === "blue-forty" ? "Blue-forty is the team glossary code for a priority launch." : "Unknown glossary term."
    }]
  };
});

await server.connect(new StdioServerTransport());
`, "utf8");

    const glossary: McpItem = {
      name: "glossary",
      source: "config.remote",
      config: { type: "local", command: ["node", fixturePath], routing: "search" },
    };
    const deps = {
      listMcpImpl: async () => [glossary],
      listSkillsImpl: async () => [],
    };

    const search = await searchWorkspaceCapabilities({
      serverConfig: serverConfig(root),
      workspaceId: "ws_1",
      workspaceRoot: root,
      query: "blue-forty glossary definition",
    }, deps);

    expect(search.unavailable).toEqual([]);
    expect(search.matches.map((match) => match.name)).toContain("mcp:glossary:lookup_glossary");
    const match = search.matches.find((item) => item.name === "mcp:glossary:lookup_glossary");
    expect(match?.routing).toBe("search");
    expect(match?.inputSchema).toBeDefined();

    const execution = await executeWorkspaceCapability({
      serverConfig: serverConfig(root),
      workspaceId: "ws_1",
      workspaceRoot: root,
      name: "mcp:glossary:lookup_glossary",
      arguments: { term: "blue-forty" },
    }, deps);

    expect(execution.source).toBe("connection");
    expect(textFromCallResult(execution.result)).toContain("Blue-forty is the team glossary code");
  });
});
