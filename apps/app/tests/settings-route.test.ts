import { describe, expect, test } from "bun:test";

import { parseSettingsPath } from "../src/react-app/shell/settings-route";

describe("settings route parsing", () => {
  test("recognizes the Connect settings tab", () => {
    expect(parseSettingsPath("/settings/connect")).toEqual({ tab: "connect", redirectPath: null });
    expect(parseSettingsPath("/workspace/workspace_1/settings/connect")).toEqual({
      tab: "connect",
      redirectPath: null,
    });
  });

  test("preserves extension section deep links", () => {
    expect(parseSettingsPath("/settings/extensions/mcp")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "mcp" });
    expect(parseSettingsPath("/settings/extensions/skills")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "skills" });
    expect(parseSettingsPath("/settings/extensions/plugins")).toEqual({ tab: "extensions", redirectPath: null, extensionsSection: "plugins" });
  });
});
