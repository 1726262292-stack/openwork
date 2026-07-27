import { describe, expect, test } from "bun:test";

import { parseSettingsPath } from "../src/react-app/shell/settings-route";

describe("settings route parsing", () => {
  test("redirects Connect settings into Extensions", () => {
    expect(parseSettingsPath("/settings/connect")).toEqual({
      tab: "extensions",
      redirectPath: "extensions",
      extensionsSection: "all",
    });
    expect(parseSettingsPath("/workspace/workspace_1/settings/connect")).toEqual({
      tab: "extensions",
      redirectPath: "extensions",
      extensionsSection: "all",
    });
  });

  test("preserves extension section deep links", () => {
    expect(parseSettingsPath("/settings/extensions/mcp")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "mcp" });
    expect(parseSettingsPath("/settings/extensions/skills")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "skills" });
    expect(parseSettingsPath("/settings/extensions/plugins")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "plugins" });
  });

  test("treats non-section extension tails as detail ids", () => {
    expect(parseSettingsPath("/settings/extensions/notion")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
      extensionDetailId: "notion",
    });
    expect(parseSettingsPath("/settings/extensions/skill%3Abriefing")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
      extensionDetailId: "skill:briefing",
    });
  });
});
