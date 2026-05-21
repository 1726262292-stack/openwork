import { getMcpServerName, type McpDirectoryInfo } from "../../../app/constants";

const EXTENSION_DISABLED_KEY_PREFIX = "openwork.extension.disabled.";
export const OPENWORK_EXTENSION_STATE_CHANGED = "openwork:extension-state-changed";

export function getExtensionId(entry: McpDirectoryInfo): string {
  return entry.id ?? entry.serverName ?? getMcpServerName(entry);
}

export function isOpenWorkExtensionEnabled(entry: McpDirectoryInfo): boolean {
  if (!entry.defaultEnabled) return false;
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(`${EXTENSION_DISABLED_KEY_PREFIX}${getExtensionId(entry)}`) !== "1";
}

export function setOpenWorkExtensionEnabled(entry: McpDirectoryInfo, enabled: boolean) {
  if (typeof window === "undefined") return;
  const key = `${EXTENSION_DISABLED_KEY_PREFIX}${getExtensionId(entry)}`;
  if (enabled) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, "1");
  }
  window.dispatchEvent(new CustomEvent(OPENWORK_EXTENSION_STATE_CHANGED, {
    detail: { id: getExtensionId(entry), enabled },
  }));
}
