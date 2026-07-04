import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { listMcp } from "./mcp.js";
import { listSkills } from "./skills.js";
import type { McpItem, ServerConfig, SkillItem } from "./types.js";

export type CapabilitySource = "connection" | "skill" | "cloud";

export type LocalCapabilityMatch = {
  name: string;
  source: CapabilitySource;
  connection?: string;
  routing?: "direct" | "search";
  summary: string;
  score: number;
  inputSchema?: unknown;
  pathParams?: unknown;
  queryParams?: unknown;
  hasBody?: unknown;
  method?: unknown;
  path?: unknown;
};

export type CapabilitySearchResult = {
  query: string;
  matches: LocalCapabilityMatch[];
  unavailable: { connection: string; reason: string }[];
};

export class CapabilityRouterError extends Error {
  readonly code: "unknown_capability" | "capability_unavailable";

  constructor(code: "unknown_capability" | "capability_unavailable", message: string) {
    super(message);
    this.name = "CapabilityRouterError";
    this.code = code;
  }
}

type CapabilityRouterDeps = {
  listMcpImpl?: typeof listMcp;
  listSkillsImpl?: typeof listSkills;
};

type BaseRouterMcpConfig = {
  routing: "direct" | "search";
  headers?: Record<string, string>;
  environment?: Record<string, string>;
};

type LocalRouterMcpConfig = BaseRouterMcpConfig & {
  type: "local";
  command: string[] | null;
};

type RemoteRouterMcpConfig = BaseRouterMcpConfig & {
  type: "remote";
  url: string | null;
};

type RouterMcpConfig = LocalRouterMcpConfig | RemoteRouterMcpConfig;

type CapabilityConnection = {
  name: string;
  config: RouterMcpConfig;
  poolKey: string;
};

type ToolSummary = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ClientPoolEntry = {
  key: string;
  client: Client;
  connectPromise: Promise<Client>;
  toolsCache?: { at: number; tools: ToolSummary[] };
  idleTimer?: ReturnType<typeof setTimeout>;
};

const TOOLS_CACHE_MS = 60_000;
const IDLE_EVICT_MS = 5 * 60_000;
const SEARCH_CONNECTION_TIMEOUT_MS = 5_000;
const CLOUD_SEARCH_TIMEOUT_MS = 8_000;
const EXECUTE_TIMEOUT_MS = 60_000;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

const clientPool = new Map<string, ClientPoolEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readCommand(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return null;
    result.push(item);
  }
  return result;
}

function readMcpConfig(config: Record<string, unknown>): RouterMcpConfig | null {
  const routing = config.routing === "search" ? "search" : "direct";
  const headers = readStringRecord(config.headers);
  const environment = readStringRecord(config.environment);
  if (config.type === "local") {
    return {
      type: "local",
      routing,
      command: readCommand(config.command),
      ...(environment ? { environment } : {}),
      ...(headers ? { headers } : {}),
    };
  }
  if (config.type === "remote") {
    return {
      type: "remote",
      routing,
      url: typeof config.url === "string" ? config.url : null,
      ...(environment ? { environment } : {}),
      ...(headers ? { headers } : {}),
    };
  }
  return null;
}

function normalizeConnection(workspaceId: string, item: McpItem): CapabilityConnection | null {
  if (item.config.enabled === false || item.disabledByTools) return null;
  const config = readMcpConfig(item.config);
  if (!config) return null;
  return {
    name: item.name,
    config,
    poolKey: `${workspaceId}:${item.name}:${JSON.stringify(item.config)}`,
  };
}

function normalizeConnections(workspaceId: string, items: McpItem[]): CapabilityConnection[] {
  const result: CapabilityConnection[] = [];
  for (const item of items) {
    const connection = normalizeConnection(workspaceId, item);
    if (connection) result.push(connection);
  }
  return result;
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function scoreCapability(input: { name: string; summary: string; connection?: string }, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const nameTokens = tokenize(input.name);
  const summaryTokens = tokenize(input.summary);
  const connectionTokens = input.connection ? tokenize(input.connection) : [];
  let score = 0;
  for (const queryToken of queryTokens) {
    if (nameTokens.includes(queryToken)) {
      score += 5;
    } else if (nameTokens.some((token) => token.startsWith(queryToken) || queryToken.startsWith(token))) {
      score += 3;
    }
    if (summaryTokens.includes(queryToken)) score += 2;
    if (connectionTokens.includes(queryToken)) score += 2;
  }
  return score;
}

function boundLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function inheritedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function buildTransport(connection: CapabilityConnection): Transport {
  const config = connection.config;
  if (config.type === "local") {
    const command = config.command?.at(0);
    if (!command) throw new Error(`Local MCP ${connection.name} has no command`);
    return new StdioClientTransport({
      command,
      args: config.command?.slice(1) ?? [],
      env: { ...inheritedEnvironment(), ...(config.environment ?? {}) },
    });
  }
  const url = config.url?.trim();
  if (!url) throw new Error(`Remote MCP ${connection.name} has no url`);
  const headers = config.headers ?? {};
  return new StreamableHTTPClientTransport(
    new URL(url),
    Object.keys(headers).length > 0 ? { requestInit: { headers } } : undefined,
  );
}

async function evictCapabilityClient(key: string): Promise<void> {
  const entry = clientPool.get(key);
  if (!entry) return;
  clientPool.delete(key);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  await entry.client.close().catch(() => undefined);
}

function touchClient(entry: ClientPoolEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    void evictCapabilityClient(entry.key);
  }, IDLE_EVICT_MS);
  entry.idleTimer.unref?.();
}

function getClientEntry(connection: CapabilityConnection): ClientPoolEntry {
  const existing = clientPool.get(connection.poolKey);
  if (existing) return existing;
  const client = new Client({ name: "openwork-capability-router", version: "1.0.0" }, { capabilities: {} });
  const transport = buildTransport(connection);
  transport.onerror = () => {
    void evictCapabilityClient(connection.poolKey);
  };
  const entry: ClientPoolEntry = {
    key: connection.poolKey,
    client,
    connectPromise: client.connect(transport).then(
      () => client,
      async (error: unknown) => {
        await evictCapabilityClient(connection.poolKey);
        throw error;
      },
    ),
  };
  clientPool.set(connection.poolKey, entry);
  return entry;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref?.();
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
    });
  });
}

async function listConnectionTools(connection: CapabilityConnection, timeoutMs: number): Promise<ToolSummary[]> {
  const entry = getClientEntry(connection);
  const cached = entry.toolsCache;
  if (cached && Date.now() - cached.at < TOOLS_CACHE_MS) {
    touchClient(entry);
    return cached.tools;
  }
  try {
    const result = await withTimeout((async () => {
      const client = await entry.connectPromise;
      return client.listTools();
    })(), timeoutMs, `MCP ${connection.name} tools/list`);
    const tools = result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }));
    entry.toolsCache = { at: Date.now(), tools };
    touchClient(entry);
    return tools;
  } catch (error) {
    await evictCapabilityClient(connection.poolKey);
    throw error;
  }
}

async function callConnectionTool(
  connection: CapabilityConnection,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const entry = getClientEntry(connection);
  try {
    const result = await withTimeout((async () => {
      const client = await entry.connectPromise;
      return client.callTool({ name: toolName, arguments: args });
    })(), timeoutMs, `MCP ${connection.name} tools/call`);
    touchClient(entry);
    return result;
  } catch (error) {
    await evictCapabilityClient(connection.poolKey);
    throw error;
  }
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.split("\n").at(0) ?? "unavailable";
  const message = String(error).trim();
  return message ? message.split("\n").at(0) ?? "unavailable" : "unavailable";
}

async function searchConnectionCapabilities(connection: CapabilityConnection, queryTokens: string[]): Promise<LocalCapabilityMatch[]> {
  const tools = await listConnectionTools(connection, SEARCH_CONNECTION_TIMEOUT_MS);
  return tools.map((tool) => {
    const summary = tool.description?.trim() || `${connection.name} MCP tool ${tool.name}`;
    return {
      name: `mcp:${connection.name}:${tool.name}`,
      source: "connection",
      connection: connection.name,
      routing: connection.config.routing,
      summary,
      score: scoreCapability({ name: tool.name, summary, connection: connection.name }, queryTokens),
      ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
    };
  });
}

function searchSkillCapabilities(skills: SkillItem[], queryTokens: string[]): LocalCapabilityMatch[] {
  return skills.map((skill) => ({
    name: `skill:${skill.name}`,
    source: "skill",
    summary: skill.description,
    score: scoreCapability({ name: skill.name, summary: skill.description }, queryTokens),
  }));
}

const CLOUD_HINT_FIELDS: Array<"pathParams" | "queryParams" | "hasBody" | "method" | "path"> = [
  "pathParams",
  "queryParams",
  "hasBody",
  "method",
  "path",
];

function cloudMatchFromUnknown(value: unknown): LocalCapabilityMatch | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const summary = value.summary;
  const score = value.score;
  if (typeof name !== "string" || typeof summary !== "string" || typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }
  const match: LocalCapabilityMatch = { name, source: "cloud", summary, score };
  for (const field of CLOUD_HINT_FIELDS) {
    const fieldValue = value[field];
    if (fieldValue !== undefined) match[field] = fieldValue;
  }
  return match;
}

function cloudMatchesFromArray(matches: unknown[]): LocalCapabilityMatch[] {
  const result: LocalCapabilityMatch[] = [];
  for (const item of matches) {
    const match = cloudMatchFromUnknown(item);
    if (match) result.push(match);
  }
  return result;
}

function parseCloudMatchesFromPayload(payload: unknown): LocalCapabilityMatch[] | null {
  if (!isRecord(payload)) return null;
  const matches = payload.matches;
  if (!Array.isArray(matches)) return null;
  return cloudMatchesFromArray(matches);
}

function parseCloudSearchResult(result: unknown): LocalCapabilityMatch[] | null {
  if (!isRecord(result)) return null;
  const structured = result.structuredContent;
  const structuredMatches = parseCloudMatchesFromPayload(structured);
  if (structuredMatches) return structuredMatches;

  const content = result.content;
  if (!Array.isArray(content)) return null;
  const first = content.at(0);
  if (!isRecord(first) || first.type !== "text" || typeof first.text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(first.text);
    return parseCloudMatchesFromPayload(parsed);
  } catch {
    return null;
  }
}

async function searchCloudCapabilities(
  cloudConnection: CapabilityConnection,
  query: string,
  limit: number,
): Promise<LocalCapabilityMatch[]> {
  const result = await callConnectionTool(cloudConnection, "search_capabilities", { query, limit }, CLOUD_SEARCH_TIMEOUT_MS);
  const matches = parseCloudSearchResult(result);
  if (!matches) throw new Error("Cloud search returned an unreadable result");
  return matches;
}

export async function searchWorkspaceCapabilities(
  input: {
    serverConfig: ServerConfig;
    workspaceId: string;
    workspaceRoot: string;
    query: string;
    limit?: number;
  },
  deps: CapabilityRouterDeps = {},
): Promise<CapabilitySearchResult> {
  const listMcpImpl = deps.listMcpImpl ?? listMcp;
  const listSkillsImpl = deps.listSkillsImpl ?? listSkills;
  const query = input.query.trim();
  const queryTokens = tokenize(query);
  const limit = boundLimit(input.limit);
  const unavailable: { connection: string; reason: string }[] = [];

  const [mcpItems, skills] = await Promise.all([
    listMcpImpl(input.serverConfig, input.workspaceId, input.workspaceRoot),
    listSkillsImpl(input.workspaceRoot, true),
  ]);
  const connections = normalizeConnections(input.workspaceId, mcpItems);
  const localConnections = connections.filter((connection) => connection.name !== "openwork-cloud");
  const cloudConnection = connections.find(
    (connection) => connection.name === "openwork-cloud" && connection.config.type === "remote",
  );
  const cloudResultPromise = cloudConnection
    ? searchCloudCapabilities(cloudConnection, query, limit).then(
        (matches) => ({ matches }),
        (error: unknown) => ({ error }),
      )
    : null;

  const connectionResults = await Promise.allSettled(
    localConnections.map((connection) => searchConnectionCapabilities(connection, queryTokens)),
  );

  const matches: LocalCapabilityMatch[] = [...searchSkillCapabilities(skills, queryTokens)];
  for (const [index, result] of connectionResults.entries()) {
    const connection = localConnections[index];
    if (!connection) continue;
    if (result.status === "fulfilled") matches.push(...result.value);
    else unavailable.push({ connection: connection.name, reason: errorReason(result.reason) });
  }

  if (cloudResultPromise) {
    const cloudResult = await cloudResultPromise;
    if ("matches" in cloudResult) matches.push(...cloudResult.matches);
    else unavailable.push({ connection: "openwork-cloud", reason: errorReason(cloudResult.error) });
  }

  return {
    query,
    matches: matches
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, limit),
    unavailable,
  };
}

function unknownCapability(name: string): CapabilityRouterError {
  return new CapabilityRouterError(
    "unknown_capability",
    `Unknown capability ${name}. Call search_capabilities first, then pass the exact capability name to execute_capability.`,
  );
}

function unavailableCapability(name: string, error: unknown): CapabilityRouterError {
  return new CapabilityRouterError("capability_unavailable", `Capability ${name} is unavailable: ${errorReason(error)}`);
}

export async function executeWorkspaceCapability(
  input: {
    serverConfig: ServerConfig;
    workspaceId: string;
    workspaceRoot: string;
    name: string;
    arguments?: Record<string, unknown>;
  },
  deps: CapabilityRouterDeps = {},
): Promise<{ name: string; source: CapabilitySource; result: unknown }> {
  const listMcpImpl = deps.listMcpImpl ?? listMcp;
  const listSkillsImpl = deps.listSkillsImpl ?? listSkills;
  const args = input.arguments ?? {};

  if (input.name.startsWith("skill:")) {
    const skillName = input.name.slice("skill:".length);
    const skill = (await listSkillsImpl(input.workspaceRoot, true)).find((item) => item.name === skillName);
    if (!skill) throw unknownCapability(input.name);
    return {
      name: input.name,
      source: "skill",
      result: {
        name: skill.name,
        path: skill.path,
        description: skill.description,
        content: await readFile(skill.path, "utf8"),
      },
    };
  }

  const mcpMatch = /^mcp:([^:]+):(.+)$/.exec(input.name);
  const mcpItems = await listMcpImpl(input.serverConfig, input.workspaceId, input.workspaceRoot);
  const connections = normalizeConnections(input.workspaceId, mcpItems);
  const localConnections = connections.filter((connection) => connection.name !== "openwork-cloud");
  const cloudConnection = connections.find(
    (connection) => connection.name === "openwork-cloud" && connection.config.type === "remote",
  );

  const connectionName = mcpMatch?.[1];
  const toolName = mcpMatch?.[2];
  if (connectionName && toolName) {
    const connection = localConnections.find((candidate) => candidate.name === connectionName);
    if (connection) {
      try {
        return {
          name: input.name,
          source: "connection",
          result: await callConnectionTool(connection, toolName, args, EXECUTE_TIMEOUT_MS),
        };
      } catch (error) {
        throw unavailableCapability(input.name, error);
      }
    }
  }

  if (cloudConnection) {
    try {
      return {
        name: input.name,
        source: "cloud",
        result: await callConnectionTool(cloudConnection, "execute_capability", { name: input.name, ...args }, EXECUTE_TIMEOUT_MS),
      };
    } catch (error) {
      throw unavailableCapability(input.name, error);
    }
  }

  throw unknownCapability(input.name);
}

export async function closeCapabilityRouterClients(): Promise<void> {
  await Promise.all([...clientPool.keys()].map((key) => evictCapabilityClient(key)));
}
