import { describe, expect, test } from "bun:test";

import type { McpDirectoryInfo } from "../src/app/constants";
import type { CloudImportedPlugin } from "../src/app/cloud/import-state";
import type { DenExternalMcpConnection, DenOrgMarketplaceResolved } from "../src/app/lib/den";
import type { McpServerEntry } from "../src/app/types";
import { buildExtensionItems } from "../src/react-app/domains/settings/extension-items";

const connectedBuiltIn: McpDirectoryInfo = {
  id: "openwork-browser",
  name: "OpenWork Browser",
  serverName: "openwork-browser",
  description: "Connected by default.",
  oauth: false,
  kind: "extension",
  extensionManifest: {
    schemaVersion: 1,
    id: "openwork-browser",
    name: "OpenWork Browser",
    description: "Connected by default.",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    resources: [],
  },
};

const availableBuiltIn: McpDirectoryInfo = {
  id: "computer-use",
  name: "Computer Use",
  serverName: "computer-use",
  description: "Marketplace-only until installed.",
  oauth: false,
  kind: "extension",
  extensionManifest: {
    schemaVersion: 1,
    id: "computer-use",
    name: "Computer Use",
    description: "Marketplace-only until installed.",
    source: { format: "openwork-builtin", origin: "builtin", trusted: true },
    resources: [],
  },
};

const notionQuickConnect: McpDirectoryInfo = {
  name: "Notion",
  serverName: "notion",
  description: "Pages and databases.",
  url: "https://mcp.notion.com/mcp",
  type: "remote",
  oauth: true,
  kind: "mcp",
};

const directNotionServer: McpServerEntry = {
  name: "notion",
  config: {
    type: "remote",
    url: "https://mcp.notion.com/mcp",
  },
};

const importedMarketplacePlugin: CloudImportedPlugin = {
  pluginId: "plugin_creative_brief",
  marketplaceId: "marketplace_team",
  name: "Creative Brief",
  description: "Local copy from the old marketplace install path.",
  updatedAt: "2026-06-01T00:00:00.000Z",
  importedAt: 1,
  files: [
    {
      configObjectId: "config_skill_brief",
      versionId: "version_skill_brief",
      objectType: "skill",
      title: "Brief Builder",
      path: ".opencode/skills/creative-brief-plugin/brief-builder/SKILL.md",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

const teamMarketplace: DenOrgMarketplaceResolved = {
  marketplace: {
    id: "marketplace_team",
    name: "Team Marketplace",
    description: null,
    status: "active",
    pluginCount: 1,
    updatedAt: "2026-06-03T00:00:00.000Z",
  },
  plugins: [
    {
      id: importedMarketplacePlugin.pluginId,
      name: "Creative Brief",
      description: "Current cloud-delivered version.",
      status: "active",
      memberCount: 99,
      updatedAt: "2026-06-03T00:00:00.000Z",
      componentCounts: { skill: 99 },
    },
  ],
};

function orgMcpConnection(input: Partial<DenExternalMcpConnection> = {}): DenExternalMcpConnection {
  return {
    id: input.id ?? "externalMcpConnection_notion",
    name: input.name ?? "Notion",
    url: input.url ?? "https://mcp.notion.com/mcp",
    authType: input.authType ?? "oauth",
    credentialMode: input.credentialMode ?? "per_member",
    connected: input.connected ?? true,
    connectedAt: input.connectedAt ?? null,
    connectedForMe: input.connectedForMe ?? false,
    ...(input.needsReconnect !== undefined ? { needsReconnect: input.needsReconnect } : {}),
    ...(input.missingFeatures !== undefined ? { missingFeatures: input.missingFeatures } : {}),
  };
}

describe("extension item projection", () => {
  test("keeps unconnected built-ins out of My Extensions quick connect", () => {
    const result = buildExtensionItems({
      quickConnect: [connectedBuiltIn, availableBuiltIn],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      enablementContext: {},
      isBuiltInConnected: (entry) => entry.id === connectedBuiltIn.id,
    });

    expect(result.installedMcpEntries.map((entry) => entry.name)).toEqual(["OpenWork Browser"]);
    expect(result.builtInItems.map((item) => item.name)).toEqual(["OpenWork Browser", "Computer Use"]);
  });

  test("projects per-member org MCP grants as Marketplace items until connected", () => {
    const result = buildExtensionItems({
      quickConnect: [notionQuickConnect],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      orgMcpConnections: [orgMcpConnection()],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.orgMcpConnectionItems.map((item) => ({ name: item.name, state: item.installState, active: item.active }))).toEqual([
      { name: "Notion", state: "available", active: false },
    ]);
    expect(result.quickConnectEntries.map((entry) => entry.name)).toEqual([]);
  });

  test("moves connected per-member org MCP grants into My Extensions", () => {
    const result = buildExtensionItems({
      quickConnect: [notionQuickConnect],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      orgMcpConnections: [orgMcpConnection({ connectedForMe: true })],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.orgMcpConnectionItems.map((item) => ({ name: item.name, state: item.installState, active: item.active }))).toEqual([
      { name: "Notion", state: "installed", active: true },
    ]);
    expect(result.items.some((item) => item.source === "org-connection" && item.installState === "installed")).toBe(true);
  });

  test("keeps a connected grant with missing features out of ready state", () => {
    const result = buildExtensionItems({
      quickConnect: [notionQuickConnect],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      orgMcpConnections: [orgMcpConnection({
        connectedForMe: true,
        needsReconnect: false,
        missingFeatures: ["databaseWrite"],
      })],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.orgMcpConnectionItems.map((item) => ({
      state: item.installState,
      setup: item.setupState,
      active: item.active,
    }))).toEqual([{ state: "available", setup: "needs_setup", active: false }]);
  });

  test("keeps configured direct MCPs even when an org equivalent exists", () => {
    const result = buildExtensionItems({
      quickConnect: [notionQuickConnect],
      mcpServers: [directNotionServer],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      orgMcpConnections: [orgMcpConnection()],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.quickConnectEntries.map((entry) => entry.name)).toEqual(["Notion"]);
    expect(result.installedMcpEntries.map((entry) => entry.name)).toEqual(["Notion"]);
  });

  test("does not dedupe static Quick Connect for unfinished shared org MCPs", () => {
    const result = buildExtensionItems({
      quickConnect: [notionQuickConnect],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: {},
      cloudMarketplaces: [],
      orgMcpConnections: [orgMcpConnection({ credentialMode: "shared", connected: false, connectedForMe: false })],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.orgMcpConnectionItems).toEqual([]);
    expect(result.quickConnectEntries.map((entry) => entry.name)).toEqual(["Notion"]);
  });

  test("keeps installed marketplace copies installed without update state", () => {
    const result = buildExtensionItems({
      quickConnect: [],
      mcpServers: [],
      installedSkills: [],
      importedCloudPlugins: { [importedMarketplacePlugin.pluginId]: importedMarketplacePlugin },
      cloudMarketplaces: [teamMarketplace],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.cloudPluginItems.map((item) => ({ name: item.name, state: item.installState }))).toEqual([
      { name: "Creative Brief", state: "installed" },
    ]);
  });

  test("keeps local copies absent from the current catalog grouped under My Extensions", () => {
    const result = buildExtensionItems({
      quickConnect: [],
      mcpServers: [],
      installedSkills: [
        {
          name: "brief-builder",
          description: "Use for creative briefs",
          path: "/workspace/project/.opencode/skills/creative-brief-plugin/brief-builder/SKILL.md",
        },
      ],
      importedCloudPlugins: { [importedMarketplacePlugin.pluginId]: importedMarketplacePlugin },
      cloudMarketplaces: [],
      enablementContext: {},
      isBuiltInConnected: () => false,
    });

    expect(result.items.map((item) => item.id)).toEqual([`marketplace:installed:${importedMarketplacePlugin.pluginId}`]);
    expect(result.items[0]?.resources.map((resource) => resource.title)).toEqual(["Brief Builder"]);
  });
});
