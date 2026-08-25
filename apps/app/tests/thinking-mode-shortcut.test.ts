import { describe, expect, test } from "bun:test";

import {
  isThinkingModeShortcut,
  resolveThinkingModeShortcutOs,
  thinkingModeShortcutLabel,
} from "../src/react-app/shell/thinking-mode-shortcut";

const event = (overrides: Partial<KeyboardEvent> = {}) => ({
  altKey: false,
  ctrlKey: false,
  key: "t",
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

describe("thinking mode shortcut", () => {
  test("uses Control+T on macOS without colliding with Command+T", () => {
    expect(resolveThinkingModeShortcutOs("macos", "")).toBe("macos");
    expect(thinkingModeShortcutLabel("macos")).toBe("⌃T");
    expect(isThinkingModeShortcut(event({ ctrlKey: true }), "macos")).toBe(true);
    expect(isThinkingModeShortcut(event({ metaKey: true }), "macos")).toBe(false);
  });

  test("uses Control+Alt+T where Control+T owns session tab cycling", () => {
    expect(thinkingModeShortcutLabel("other")).toBe("Ctrl+Alt+T");
    expect(isThinkingModeShortcut(event({ ctrlKey: true, altKey: true }), "other")).toBe(true);
    expect(isThinkingModeShortcut(event({ ctrlKey: true }), "other")).toBe(false);
  });

  test("falls back to navigator platform for web builds", () => {
    expect(resolveThinkingModeShortcutOs(undefined, "MacIntel")).toBe("macos");
    expect(resolveThinkingModeShortcutOs(undefined, "Win32")).toBe("other");
  });
});
