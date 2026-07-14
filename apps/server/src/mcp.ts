import { minimatch } from "minimatch";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpItem, ServerConfig } from "./types.js";
import { sanitizeDiagnosticString } from "./diagnostic-sanitizer.js";
import { readJsoncFile } from "./jsonc.js";
import { opencodeConfigPath } from "./workspace-files.js";
import { validateMcpConfig, validateMcpName } from "./validators.js";
import { readRuntimeOpencodeConfig, runtimeMcpMap, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";

export type McpToolDenySource = "config.project" | "config.global";

export type McpToolDeny = {
  source: McpToolDenySource;
  style: "tools.deny" | "tools" | "permission" | "permissions";
  pattern: string;
  matched: string;
};

type McpToolAllow = McpToolDeny;

const OPENWORK_CLOUD_DIAGNOSTIC_TOOL_IDS = [
  "openwork-cloud_search_capabilities",
  "openwork-cloud_execute_capability",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function globalOpenCodeConfigPath(): string {
  const base = join(homedir(), ".config", "opencode");
  const jsonc = join(base, "opencode.jsonc");
  const json = join(base, "opencode.json");
  if (existsSync(jsonc)) return jsonc;
  if (existsSync(json)) return json;
  return jsonc; // fall back to jsonc (readJsoncFile handles missing files gracefully)
}

function getMcpConfig(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const mcp = config.mcp;
  if (!isRecord(mcp)) return {};
  const output: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(mcp)) {
    if (isRecord(value)) output[name] = value;
  }
  return output;
}

function getDeniedToolPatterns(config: Record<string, unknown>): string[] {
  const tools = config.tools;
  if (!isRecord(tools)) return [];
  const deny = tools.deny;
  if (!Array.isArray(deny)) return [];
  return deny.filter((item): item is string => typeof item === "string");
}

function getToolIdsForDiagnostics(name: string, toolIds: string[]): string[] {
  if (toolIds.length > 0) return toolIds;
  return [name];
}

function diagnosticToolIdsForMcp(name: string): string[] {
  return name === "openwork-cloud" ? OPENWORK_CLOUD_DIAGNOSTIC_TOOL_IDS : [];
}

function permissionCandidates(name: string, toolId: string): string[] {
  const candidates = new Set([toolId, `tool.${toolId}`, `tool:${toolId}`, `mcp.${name}`, `mcp.${name}.*`, `mcp:${name}`, `mcp:${name}:*`, "mcp.*", "mcp:*"]);
  const prefix = `${name}_`;
  if (toolId.startsWith(prefix)) {
    const suffix = toolId.slice(prefix.length);
    candidates.add(`mcp.${name}.${suffix}`);
    candidates.add(`mcp:${name}:${suffix}`);
  }
  return Array.from(candidates);
}

function matchesToolPattern(name: string, toolId: string, pattern: string): boolean {
  for (const candidate of permissionCandidates(name, toolId)) {
    if (candidate === pattern || minimatch(candidate, pattern)) return true;
  }
  return false;
}

function deniesValue(value: unknown): boolean {
  if (value === false || value === "deny") return true;
  if (!isRecord(value)) return false;
  return value.enabled === false || value.action === "deny" || value.effect === "deny" || value.permission === "deny";
}

function allowsValue(value: unknown): boolean {
  if (value === true || value === "allow") return true;
  if (!isRecord(value)) return false;
  return value.enabled === true || value.action === "allow" || value.effect === "allow" || value.permission === "allow";
}

function pushDeny(
  denies: McpToolDeny[],
  source: McpToolDenySource,
  style: McpToolDeny["style"],
  pattern: string,
  matched: string,
): void {
  denies.push({
    source,
    style,
    pattern: sanitizeDiagnosticString(pattern),
    matched: sanitizeDiagnosticString(matched),
  });
}

function collectToolsDenyArray(
  config: Record<string, unknown>,
  source: McpToolDenySource,
  name: string,
  toolIds: string[],
): McpToolDeny[] {
  const denies: McpToolDeny[] = [];
  for (const pattern of getDeniedToolPatterns(config)) {
    for (const toolId of toolIds) {
      if (matchesToolPattern(name, toolId, pattern)) pushDeny(denies, source, "tools.deny", pattern, toolId);
    }
  }
  return denies;
}

function collectToolsRecordDenies(
  config: Record<string, unknown>,
  source: McpToolDenySource,
  name: string,
  toolIds: string[],
  mode: "deny" | "allow",
): McpToolDeny[] {
  const tools = config.tools;
  if (!isRecord(tools)) return [];
  const denies: McpToolDeny[] = [];
  for (const [pattern, value] of Object.entries(tools)) {
    if (pattern === "deny") continue;
    const matchesMode = mode === "deny" ? deniesValue(value) : allowsValue(value);
    if (!matchesMode) continue;
    for (const toolId of toolIds) {
      if (matchesToolPattern(name, toolId, pattern)) pushDeny(denies, source, "tools", pattern, toolId);
    }
  }
  return denies;
}

function collectPermissionRulesetDenies(
  value: unknown,
  source: McpToolDenySource,
  style: "permission" | "permissions",
  name: string,
  toolIds: string[],
  mode: "deny" | "allow",
): McpToolDeny[] {
  if (!Array.isArray(value)) return [];
  const denies: McpToolDeny[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const action = typeof entry.action === "string" ? entry.action : typeof entry.effect === "string" ? entry.effect : "";
    if (action !== mode) continue;
    const pattern = typeof entry.pattern === "string"
      ? entry.pattern
      : typeof entry.permission === "string"
        ? entry.permission
        : "";
    if (!pattern) continue;
    for (const toolId of toolIds) {
      if (matchesToolPattern(name, toolId, pattern)) pushDeny(denies, source, style, pattern, toolId);
    }
  }
  return denies;
}

function collectPermissionScalarDeny(
  value: unknown,
  source: McpToolDenySource,
  style: "permission" | "permissions",
  toolIds: string[],
  mode: "deny" | "allow",
): McpToolDeny[] {
  const matchesMode = mode === "deny" ? deniesValue(value) : allowsValue(value);
  if (!matchesMode) return [];
  const denies: McpToolDeny[] = [];
  for (const toolId of toolIds) pushDeny(denies, source, style, "*", toolId);
  return denies;
}

function collectPermissionObjectDenies(
  value: unknown,
  source: McpToolDenySource,
  style: "permission" | "permissions",
  name: string,
  toolIds: string[],
  mode: "deny" | "allow",
): McpToolDeny[] {
  if (!isRecord(value)) return [];
  const denies: McpToolDeny[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const matchesMode = mode === "deny" ? deniesValue(nested) : allowsValue(nested);
    if (matchesMode) {
      for (const toolId of toolIds) {
        if (matchesToolPattern(name, toolId, key)) pushDeny(denies, source, style, key, toolId);
      }
      continue;
    }
    if (key === "tool" || key === "tools") {
      const nestedMatchesMode = mode === "deny" ? deniesValue(nested) : allowsValue(nested);
      if (nestedMatchesMode) {
        for (const toolId of toolIds) pushDeny(denies, source, style, key, toolId);
        continue;
      }
      for (const [pattern, permission] of Object.entries(isRecord(nested) ? nested : {})) {
        const nestedPermissionMatchesMode = mode === "deny" ? deniesValue(permission) : allowsValue(permission);
        if (!nestedPermissionMatchesMode) continue;
        for (const toolId of toolIds) {
          if (matchesToolPattern(name, toolId, pattern)) pushDeny(denies, source, style, pattern, toolId);
        }
      }
    }
  }
  return denies;
}

function uniqueDenies(denies: McpToolDeny[]): McpToolDeny[] {
  const seen = new Set<string>();
  const unique: McpToolDeny[] = [];
  for (const deny of denies) {
    const key = `${deny.source}\0${deny.style}\0${deny.pattern}\0${deny.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deny);
  }
  return unique;
}

function collectMcpToolMatchesFromConfig(
  config: Record<string, unknown>,
  source: McpToolDenySource,
  name: string,
  toolIds: string[],
  mode: "deny" | "allow",
): McpToolDeny[] {
  const diagnosticToolIds = getToolIdsForDiagnostics(name, toolIds);
  return uniqueDenies([
    ...(mode === "deny" ? collectToolsDenyArray(config, source, name, diagnosticToolIds) : []),
    ...collectToolsRecordDenies(config, source, name, diagnosticToolIds, mode),
    ...collectPermissionScalarDeny(config.permission, source, "permission", diagnosticToolIds, mode),
    ...collectPermissionRulesetDenies(config.permission, source, "permission", name, diagnosticToolIds, mode),
    ...collectPermissionObjectDenies(config.permission, source, "permission", name, diagnosticToolIds, mode),
    ...collectPermissionScalarDeny(config.permissions, source, "permissions", diagnosticToolIds, mode),
    ...collectPermissionRulesetDenies(config.permissions, source, "permissions", name, diagnosticToolIds, mode),
    ...collectPermissionObjectDenies(config.permissions, source, "permissions", name, diagnosticToolIds, mode),
  ]);
}

function diagnoseMcpToolDeniesFromConfig(
  config: Record<string, unknown>,
  source: McpToolDenySource,
  name: string,
  toolIds: string[],
): McpToolDeny[] {
  return collectMcpToolMatchesFromConfig(config, source, name, toolIds, "deny");
}

function collectProjectAllows(
  config: Record<string, unknown>,
  name: string,
  toolIds: string[],
): McpToolAllow[] {
  return collectMcpToolMatchesFromConfig(config, "config.project", name, toolIds, "allow");
}

function projectAllowOverridesGlobalDeny(allow: McpToolAllow, deny: McpToolDeny): boolean {
  return allow.matched === deny.matched || minimatch(deny.matched, allow.pattern);
}

function filterGlobalDeniesOverriddenByProjectAllows(globalDenies: McpToolDeny[], projectAllows: McpToolAllow[]): McpToolDeny[] {
  return globalDenies.filter((deny) => !projectAllows.some((allow) => projectAllowOverridesGlobalDeny(allow, deny)));
}

export function diagnoseMcpToolDeniesFromConfigs(input: {
  projectConfig: Record<string, unknown>;
  globalConfig: Record<string, unknown>;
  name: string;
  toolIds?: string[];
}): McpToolDeny[] {
  const toolIds = input.toolIds ?? diagnosticToolIdsForMcp(input.name);
  const projectAllows = collectProjectAllows(input.projectConfig, input.name, toolIds);
  const projectDenies = diagnoseMcpToolDeniesFromConfig(input.projectConfig, "config.project", input.name, toolIds);
  const globalDenies = diagnoseMcpToolDeniesFromConfig(input.globalConfig, "config.global", input.name, toolIds);
  return uniqueDenies([
    ...projectDenies,
    ...filterGlobalDeniesOverriddenByProjectAllows(globalDenies, projectAllows),
  ]);
}

export async function diagnoseMcpToolDenies(
  workspaceRoot: string,
  name: string,
  toolIds?: string[],
): Promise<McpToolDeny[]> {
  const { data: config } = await readJsoncFile(opencodeConfigPath(workspaceRoot), {} as Record<string, unknown>, { allowInvalid: true });
  const { data: globalConfig } = await readJsoncFile(globalOpenCodeConfigPath(), {} as Record<string, unknown>, { allowInvalid: true });
  return diagnoseMcpToolDeniesFromConfigs({ projectConfig: config, globalConfig, name, toolIds });
}

export async function listMcp(serverConfig: ServerConfig, workspaceId: string, workspaceRoot: string): Promise<McpItem[]> {
  const { data: config } = await readJsoncFile(opencodeConfigPath(workspaceRoot), {} as Record<string, unknown>, { allowInvalid: true });
  const { data: globalConfig } = await readJsoncFile(globalOpenCodeConfigPath(), {} as Record<string, unknown>, { allowInvalid: true });

  const projectMcpMap = getMcpConfig(config);
  const globalMcpMap = getMcpConfig(globalConfig);
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const runtimeMap = runtimeMcpMap(runtimeConfig);

  const items: McpItem[] = [];

  // Global MCPs first; project-level entries override global ones with the same name.
  for (const [name, entry] of Object.entries(globalMcpMap)) {
    if (Object.prototype.hasOwnProperty.call(projectMcpMap, name)) continue;
    const toolDenies = diagnoseMcpToolDeniesFromConfigs({ projectConfig: config, globalConfig, name });
    items.push({
      name,
      config: entry,
      source: "config.global",
      disabledByTools: toolDenies.length > 0 || undefined,
      ...(toolDenies.length ? { toolDenies } : {}),
    });
  }

  // Project MCPs (highest priority).
  for (const [name, entry] of Object.entries(projectMcpMap)) {
    if (Object.prototype.hasOwnProperty.call(runtimeMap, name)) continue;
    const toolDenies = diagnoseMcpToolDeniesFromConfigs({ projectConfig: config, globalConfig, name });
    items.push({
      name,
      config: entry,
      source: "config.project",
      disabledByTools: toolDenies.length > 0 || undefined,
      ...(toolDenies.length ? { toolDenies } : {}),
    });
  }

  // OpenWork-owned MCPs are stored by the server and injected at runtime.
  for (const [name, entry] of Object.entries(runtimeMap)) {
    const toolDenies = diagnoseMcpToolDeniesFromConfigs({ projectConfig: config, globalConfig, name });
    items.push({
      name,
      config: entry,
      source: "config.remote",
      disabledByTools: toolDenies.length > 0 || undefined,
      ...(toolDenies.length ? { toolDenies } : {}),
    });
  }

  return items;
}

export async function addMcp(
  serverConfig: ServerConfig,
  workspaceId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<{ action: "added" | "updated" }> {
  validateMcpName(name);
  validateMcpConfig(config);
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const mcpMap = { ...runtimeMcpMap(runtimeConfig) };
  const existed = Object.prototype.hasOwnProperty.call(mcpMap, name);
  mcpMap[name] = config;
  await writeRuntimeOpencodeConfig(serverConfig, workspaceId, (current) => ({ ...current, mcp: mcpMap }));
  return { action: existed ? "updated" : "added" };
}

export async function removeMcp(serverConfig: ServerConfig, workspaceId: string, name: string): Promise<boolean> {
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const mcpMap = { ...runtimeMcpMap(runtimeConfig) };
  if (!Object.prototype.hasOwnProperty.call(mcpMap, name)) return false;
  delete mcpMap[name];
  await writeRuntimeOpencodeConfig(serverConfig, workspaceId, (current) => ({ ...current, mcp: mcpMap }));
  return true;
}

// Flips `enabled` on a workspace MCP entry. Returns false for "toggle does
// not apply": missing, non-object, or malformed enough that OpenCode would
// fail to load it. The HTTP layer maps false to 404. Globals are out of
// scope by design — only workspace-level entries.
//
// `updateJsoncPath` (vs `updateJsoncTopLevel`) preserves inline comments
// inside the MCP entry — see the regression that motivated #1444.
export async function setMcpEnabled(
  serverConfig: ServerConfig,
  workspaceId: string,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  validateMcpName(name);
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const mcpMap = { ...runtimeMcpMap(runtimeConfig) };
  if (!Object.prototype.hasOwnProperty.call(mcpMap, name)) return false;
  const current = mcpMap[name];
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  try {
    validateMcpConfig({ ...(current as Record<string, unknown>), enabled });
  } catch {
    return false;
  }
  mcpMap[name] = { ...(current as Record<string, unknown>), enabled };
  await writeRuntimeOpencodeConfig(serverConfig, workspaceId, (currentConfig) => ({ ...currentConfig, mcp: mcpMap }));
  return true;
}
