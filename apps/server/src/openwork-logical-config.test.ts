import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp, listMcp, setMcpEnabled } from "./mcp.js";
import { buildOpenworkRuntimeConfig } from "./openwork-runtime-config.js";
import { addPlugin, listPlugins, removePlugin } from "./plugins.js";

async function withWorkspace(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "openwork-logical-config-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("OpenWork logical OpenCode config", () => {
  test("stores MCP changes in openwork.json without rewriting opencode.jsonc", async () => {
    await withWorkspace(async (root) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "mcp": {\n    "project": { "type": "remote", "url": "https://project.example/mcp" }\n  }\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      await addMcp(root, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await setMcpEnabled(root, "runtime", false);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      const openwork = JSON.parse(await readFile(join(root, ".opencode", "openwork.json"), "utf8")) as {
        opencode?: { mcp?: Record<string, Record<string, unknown>> };
      };
      expect(openwork.opencode?.mcp?.runtime?.enabled).toBe(false);

      const items = await listMcp(root);
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("project:config.project");
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("runtime:config.remote");
    });
  });

  test("stores plugin changes in openwork.json without rewriting opencode.jsonc", async () => {
    await withWorkspace(async (root) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "plugin": ["project-plugin"]\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      expect(await addPlugin(root, "runtime-plugin")).toBe(true);
      expect(await removePlugin(root, "runtime-plugin")).toBe(true);
      expect(await addPlugin(root, "runtime-plugin")).toBe(true);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      const openwork = JSON.parse(await readFile(join(root, ".opencode", "openwork.json"), "utf8")) as {
        opencode?: { plugin?: string[] };
      };
      expect(openwork.opencode?.plugin).toEqual(["runtime-plugin"]);

      const result = await listPlugins(root, false);
      expect(result.items.map((item) => item.spec)).toEqual(["project-plugin", "runtime-plugin"]);

      await addMcp(root, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      const runtimeConfig = JSON.parse(await buildOpenworkRuntimeConfig(root)) as {
        plugin?: string[];
        mcp?: Record<string, Record<string, unknown>>;
      };
      expect(runtimeConfig.plugin).toContain("runtime-plugin");
      expect(runtimeConfig.mcp?.runtime?.url).toBe("https://runtime.example/mcp");
    });
  });

  test("malformed user opencode config does not block logical config reads", async () => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, "opencode.jsonc"), '{ "mcp": {\n}\n}\n}\n', "utf8");
      await addMcp(root, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await addPlugin(root, "runtime-plugin");

      const mcpItems = await listMcp(root);
      const pluginItems = await listPlugins(root, false);

      expect(mcpItems.map((item) => item.name)).toEqual(["runtime"]);
      expect(pluginItems.items.map((item) => item.spec)).toEqual(["runtime-plugin"]);
    });
  });
});
