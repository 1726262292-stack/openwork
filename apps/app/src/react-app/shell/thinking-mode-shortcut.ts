export type ThinkingModeShortcutOs = "macos" | "other";

type ThinkingModeShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export function resolveThinkingModeShortcutOs(
  os: "macos" | "windows" | "linux" | undefined,
  navigatorPlatform: string,
): ThinkingModeShortcutOs {
  if (os === "macos" || (os === undefined && /Mac/i.test(navigatorPlatform))) return "macos";
  return "other";
}

export function thinkingModeShortcutLabel(os: ThinkingModeShortcutOs) {
  return os === "macos" ? "⌃T" : "Ctrl+Alt+T";
}

export function isThinkingModeShortcut(event: ThinkingModeShortcutEvent, os: ThinkingModeShortcutOs) {
  if (event.key.toLowerCase() !== "t" || event.shiftKey || event.metaKey) return false;
  return os === "macos"
    ? event.ctrlKey && !event.altKey
    : event.ctrlKey && event.altKey;
}
