import { describe, expect, test } from "bun:test";

import { BUILT_IN_OPENWORK_EXTENSION_MANIFESTS } from "../src/app/extensions";
import { MCP_QUICK_CONNECT, type McpDirectoryInfo } from "../src/app/constants";
import {
  extensionSurface,
  matchesExtensionFilter,
  taxonomyForDirectoryEntry,
} from "../src/react-app/domains/settings/extension-taxonomy";

function builtInEntry(id: string): McpDirectoryInfo {
  const entry = MCP_QUICK_CONNECT.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`missing built-in entry ${id}`);
  return entry;
}

describe("extension taxonomy", () => {
  test("local built-ins are apps", () => {
    for (const id of ["openwork-browser", "computer-use", "ollama", "openwork-voice"]) {
      expect(taxonomyForDirectoryEntry(builtInEntry(id))).toBe("app");
    }
  });

  test("account-backed built-ins are connections", () => {
    expect(taxonomyForDirectoryEntry(builtInEntry("google-workspace"))).toBe("connection");
    expect(extensionSurface(builtInEntry("google-workspace"))).toBe("cloud");
  });

  test("directory entries that are not built-in stay MCPs", () => {
    const notion = MCP_QUICK_CONNECT.find((entry) => entry.name === "Notion");
    expect(notion).toBeDefined();
    if (notion) expect(taxonomyForDirectoryEntry(notion)).toBe("mcp");
  });

  test("only cloud built-ins declare a cloud surface", () => {
    const cloudManifestIds = BUILT_IN_OPENWORK_EXTENSION_MANIFESTS
      .filter((manifest) => manifest.surface === "cloud")
      .map((manifest) => manifest.id);
    expect(cloudManifestIds).toEqual(["google-workspace"]);
  });

  test("the all filter keeps every taxonomy, others match exactly", () => {
    expect(matchesExtensionFilter("all", "plugin")).toBe(true);
    expect(matchesExtensionFilter("connection", "connection")).toBe(true);
    expect(matchesExtensionFilter("connection", "mcp")).toBe(false);
    expect(matchesExtensionFilter("skill", "app")).toBe(false);
  });
});
