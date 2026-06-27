import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

export async function prepareManagedOpencodeEnvironment(config: ServerConfig): Promise<Record<string, string>> {
  const root = join(runtimeStorageDir(config), "managed-opencode");
  const home = join(root, "home");
  const xdgConfigHome = join(root, "xdg", "config");
  const xdgDataHome = join(root, "xdg", "data");
  const xdgCacheHome = join(root, "xdg", "cache");
  const xdgStateHome = join(root, "xdg", "state");
  const appData = join(root, "appdata", "roaming");
  const localAppData = join(root, "appdata", "local");
  const opencodeConfigDir = join(xdgConfigHome, "opencode");

  for (const dir of [
    home,
    xdgConfigHome,
    xdgDataHome,
    xdgCacheHome,
    xdgStateHome,
    appData,
    localAppData,
    opencodeConfigDir,
  ]) {
    await mkdir(dir, { recursive: true });
  }

  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_CACHE_HOME: xdgCacheHome,
    XDG_STATE_HOME: xdgStateHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    OPENCODE_CONFIG_DIR: opencodeConfigDir,
  };
}
