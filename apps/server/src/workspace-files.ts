import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export function opencodeConfigPath(workspaceRoot: string): string {
  const jsoncPath = join(workspaceRoot, "opencode.jsonc");
  const jsonPath = join(workspaceRoot, "opencode.json");
  const hiddenJsoncPath = join(workspaceRoot, ".opencode", "opencode.jsonc");
  const hiddenJsonPath = join(workspaceRoot, ".opencode", "opencode.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  if (existsSync(jsonPath)) return jsonPath;
  if (existsSync(hiddenJsoncPath)) return hiddenJsoncPath;
  if (existsSync(hiddenJsonPath)) return hiddenJsonPath;
  return jsoncPath;
}

export function openworkConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "openwork.json");
}

export function projectSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "skills");
}

export function projectCommandsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "commands");
}

export function projectPluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "plugins");
}

/**
 * Shape of the per-workspace `openwork.json` metadata file. This is the single
 * source of truth for the schema; the desktop Electron main process imports
 * these helpers from the compiled server bundle rather than redefining them.
 */
export type WorkspaceOpenworkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

export function defaultWorkspaceOpenworkConfig(
  workspaceRoot: string,
  preset: string | null = null,
): WorkspaceOpenworkConfig {
  return {
    version: 1,
    workspace: workspaceRoot
      ? {
          name: basename(workspaceRoot) || "Workspace",
          createdAt: Date.now(),
          preset: preset || null,
        }
      : null,
    authorizedRoots: workspaceRoot ? [workspaceRoot] : [],
    reload: null,
  };
}

export async function readWorkspaceOpenworkConfig(
  workspaceRoot: string,
): Promise<WorkspaceOpenworkConfig> {
  const configPath = openworkConfigPath(workspaceRoot);
  if (!existsSync(configPath)) {
    return defaultWorkspaceOpenworkConfig(workspaceRoot);
  }
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as WorkspaceOpenworkConfig;
}

export async function writeWorkspaceOpenworkConfig(
  workspaceRoot: string,
  config: WorkspaceOpenworkConfig,
): Promise<string> {
  const configPath = openworkConfigPath(workspaceRoot);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
