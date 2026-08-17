import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLibraryPayload } from "../app/(den)/dashboard/_components/library-data";

test("keeps stored URL Apps out of Library payloads — Apps live inside their plugin", () => {
  expect(parseLibraryPayload({
    items: [{
      type: "app",
      id: "cob_01kzzzzzzzzzzzzzzzzzzzzzzz",
      pluginId: "plg_01kzzzzzzzzzzzzzzzzzzzzzzz",
      name: "Project Atlas",
      description: "Portable dashboard",
      sourceUrl: "https://example.test/project-atlas.html",
      status: "active",
      activeVersionId: "cov_01kzzzzzzzzzzzzzzzzzzzzzzz",
      state: "ready",
      edges: [{ kind: "org_wide" }],
      role: "viewer",
    }],
  })).toEqual([]);
});

test("has no global Add MCP App entry point outside plugin management", () => {
  const components = join(import.meta.dir, "../app/(den)/dashboard/_components");
  const libraryScreen = readFileSync(join(components, "library-screen.tsx"), "utf8");
  expect(libraryScreen).not.toContain("add-remote-mcp-app");
  expect(libraryScreen).not.toContain("Add remote MCP App");
  expect(libraryScreen).not.toContain("add-plugin-mcp-app");
  expect(libraryScreen).not.toContain("RemoteMcpAppImport");
  expect(libraryScreen).not.toContain("PluginMcpAppInstall");
});

test("installing and managing MCP Apps is a plugin-scoped, capability-gated workflow", () => {
  const components = join(import.meta.dir, "../app/(den)/dashboard/_components");
  const pluginData = readFileSync(join(components, "plugin-data.tsx"), "utf8");
  const pluginDetail = readFileSync(join(components, "plugin-detail-screen.tsx"), "utf8");
  const installScreen = readFileSync(join(components, "plugin-mcp-app-install-screen.tsx"), "utf8");
  const detailScreen = readFileSync(join(components, "plugin-mcp-app-detail-screen.tsx"), "utf8");

  // Plugin data parses installed Apps from plugin membership like other components.
  expect(pluginData).toContain('objectType === "app"');
  expect(pluginData).toContain('normalizedPayload?.kind === "remote_mcp_app"');

  // The plugin detail page hosts the Apps section behind the org capability.
  expect(pluginDetail).toContain("McpAppsSection");
  expect(pluginDetail).toContain("capabilities.pluginMcpApps");
  expect(pluginDetail).toContain("getPluginMcpAppRoute");
  expect(pluginDetail).toContain("getNewPluginMcpAppRoute");
  expect(pluginDetail).toContain("add-plugin-mcp-app");

  // Install requires the owning plugin, previews before committing, and is
  // gated on the org capability.
  expect(installScreen).toContain("useInstallPluginMcpApp(pluginId)");
  expect(installScreen).toContain("capabilities.pluginMcpApps");
  expect(installScreen).toContain("plugin-mcp-app-preview");
  expect(installScreen).toContain("plugin-mcp-app-install");

  // Detail exposes refresh/update review, revision activation, download, and
  // confirmed retirement without deleting revisions.
  expect(detailScreen).toContain("plugin-mcp-app-review-update");
  expect(detailScreen).toContain("plugin-mcp-app-cache-draft");
  expect(detailScreen).toContain("plugin-mcp-app-retire-confirm");
  expect(detailScreen).toContain("plugin-mcp-app-restore");
  expect(detailScreen).toContain("app.pluginId !== pluginId");
});
