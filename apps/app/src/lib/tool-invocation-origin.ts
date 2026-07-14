export type ToolInvocationKnownServer = {
  id?: string | null;
  name: string;
  displayName?: string | null;
};

export type ToolInvocationOrigin = {
  connectionName?: string;
  displayTool: string;
};

type DirectToolOrigin = ToolInvocationOrigin & {
  serverName: string;
};

const OPENWORK_CLOUD_SERVER_NAME = "openwork-cloud";
const OPENWORK_CLOUD_LABEL = "OpenWork Cloud";
const EXECUTE_CAPABILITY_TOOL_NAME = "execute_capability";

const builtInToolNames = new Set([
  "apply_patch",
  "bash",
  "edit",
  "env_var_request",
  "glob",
  "grep",
  "lsp",
  "question",
  "read",
  "request_env_var",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
]);

const nonConnectionPrefixes = new Set([
  "create",
  "delete",
  "diagnostic",
  "diagnostics",
  "execute",
  "fetch",
  "get",
  "list",
  "lookup",
  "mutate",
  "read",
  "search",
  "summarize",
  "synthetic",
  "update",
  "write",
]);

const wordLabels: Record<string, string> = {
  api: "API",
  mcp: "MCP",
  oauth: "OAuth",
  openwork: "OpenWork",
  servicenow: "ServiceNow",
  ui: "UI",
};

function formatNameWord(word: string) {
  const lower = word.toLowerCase();
  const special = wordLabels[lower];
  if (special) return special;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatConnectionName(value: string) {
  const words = value.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 ? words.map(formatNameWord).join(" ") : value;
}

function serverCandidates(server: ToolInvocationKnownServer) {
  const candidates: string[] = [];
  const name = server.name.trim();
  const id = server.id?.trim() ?? "";
  if (name) candidates.push(name);
  if (id && id !== name) candidates.push(id);
  return candidates;
}

function candidateLength(server: ToolInvocationKnownServer) {
  return Math.max(...serverCandidates(server).map((candidate) => candidate.length), 0);
}

function displayNameForServer(server: ToolInvocationKnownServer) {
  const explicit = server.displayName?.trim();
  if (explicit) return explicit;
  return formatConnectionName(server.name);
}

function sortedKnownServers(knownServers: readonly ToolInvocationKnownServer[]) {
  return [...knownServers].sort((left, right) => candidateLength(right) - candidateLength(left));
}

function resolveKnownConnectionName(id: string, knownServers: readonly ToolInvocationKnownServer[]) {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const match = knownServers.find((server) => {
    const serverId = server.id?.trim() ?? "";
    return serverId === trimmed || server.name.trim() === trimmed;
  });
  return match ? displayNameForServer(match) : null;
}

function directToolOrigin(toolName: string, knownServers: readonly ToolInvocationKnownServer[]): DirectToolOrigin | null {
  for (const server of sortedKnownServers(knownServers)) {
    for (const candidate of serverCandidates(server)) {
      const prefix = `${candidate}_`;
      if (!toolName.startsWith(prefix)) continue;
      const displayTool = toolName.slice(prefix.length);
      if (!displayTool) continue;
      return {
        connectionName: displayNameForServer(server),
        displayTool,
        serverName: server.name.trim(),
      };
    }
  }

  const openworkPrefix = `${OPENWORK_CLOUD_SERVER_NAME}_`;
  if (toolName.startsWith(openworkPrefix)) {
    const displayTool = toolName.slice(openworkPrefix.length);
    if (displayTool) {
      return {
        connectionName: OPENWORK_CLOUD_LABEL,
        displayTool,
        serverName: OPENWORK_CLOUD_SERVER_NAME,
      };
    }
  }

  return null;
}

function fallbackDirectToolOrigin(toolName: string): DirectToolOrigin | null {
  const separator = toolName.indexOf("_");
  if (separator <= 0 || separator === toolName.length - 1) return null;
  const serverName = toolName.slice(0, separator).trim();
  const displayTool = toolName.slice(separator + 1).trim();
  if (!serverName || !displayTool || nonConnectionPrefixes.has(serverName.toLowerCase())) return null;
  return {
    connectionName: formatConnectionName(serverName),
    displayTool,
    serverName,
  };
}

function namedArgument(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("name" in value)) return null;
  return typeof value.name === "string" ? value.name : null;
}

function mcpCapabilityNameParts(value: string) {
  const match = value.match(/^mcp:([^:]+):(.+)$/);
  const connectionId = match?.[1]?.trim() ?? "";
  const toolName = match?.[2]?.trim() ?? "";
  if (!connectionId || !toolName) return null;
  return { connectionId, toolName };
}

export function toolInvocationOrigin(
  toolName: string,
  args?: unknown,
  knownServers: readonly ToolInvocationKnownServer[] = [],
): ToolInvocationOrigin {
  if (builtInToolNames.has(toolName)) return { displayTool: toolName };

  const direct = directToolOrigin(toolName, knownServers) ?? fallbackDirectToolOrigin(toolName);
  if (!direct) return { displayTool: toolName };

  if (direct.serverName === OPENWORK_CLOUD_SERVER_NAME && direct.displayTool === EXECUTE_CAPABILITY_TOOL_NAME) {
    const parts = mcpCapabilityNameParts(namedArgument(args) ?? "");
    if (parts) {
      const connectionName = resolveKnownConnectionName(parts.connectionId, knownServers) ?? parts.connectionId;
      return {
        connectionName: `${OPENWORK_CLOUD_LABEL} → ${connectionName}`,
        displayTool: parts.toolName,
      };
    }
  }

  return {
    connectionName: direct.connectionName,
    displayTool: direct.displayTool,
  };
}
