import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fauxAssistantMessage, registerFauxProvider, type FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import {
  defineAgent,
  observe,
  registerProvider,
  type CallHandle,
  type FileStat,
  type FlueObservation,
  type PromptResponse,
  type SandboxFactory,
  type SessionEnv,
  type ShellResult,
} from "@flue/runtime";
import { createFlueContext, resolveModel } from "@flue/runtime/internal";
import {
  engineEventSchema,
  sessionInfoSchema,
  sessionListSchema,
  sessionMessagesSchema,
  sessionStatusesSchema,
  sessionTodosSchema,
} from "@openwork/engine-protocol";
import type {
  Agent,
  Command,
  Config as EngineConfig,
  EngineEvent,
  GlobalHealthResponse,
  LspStatus,
  McpStatusMap,
  Message,
  MessageWithParts,
  Model,
  Part,
  Path,
  Project,
  Provider,
  ProviderListResponse,
  Session,
  SessionStatus,
  Todo,
  ToolIds,
  ToolList,
  VcsInfo,
} from "@openwork/engine-protocol";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { shortId } from "../utils.js";

type FlueContext = ReturnType<typeof createFlueContext>;
type FlueHarness = Awaited<ReturnType<FlueContext["initializeRootHarness"]>>;
type FlueEventInputHandler = Parameters<FlueContext["subscribeEvent"]>[0];
type FlueEventInput = Parameters<FlueEventInputHandler>[0];

type FlueSessionRecord = {
  session: Session;
  messages: MessageWithParts[];
  todos: Todo[];
  status: SessionStatus;
};

type FluePersistedState = {
  sessions: FlueSessionRecord[];
};

type PromptModelInput = {
  providerID: string;
  modelID: string;
  variant?: string;
};

type PromptRunInput = {
  text: string;
  model?: PromptModelInput;
  agent?: string;
};

type InFlightPrompt = {
  assistantMessageId: string;
  assistantPartId: string;
};

type EventListener = (event: EngineEvent) => void;

const FLUE_PROVIDER_ID = "flue";
const FLUE_MODEL_ID = "default";
const FLUE_MODEL_SPEC = `${FLUE_PROVIDER_ID}/${FLUE_MODEL_ID}`;
const DEFAULT_AGENT = "openwork";
const STATE_FILE = join(".opencode", "openwork", "flue-state.json");

const ZERO_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

const FLUE_MODEL: Model = {
  id: FLUE_MODEL_ID,
  providerID: FLUE_PROVIDER_ID,
  api: { id: "faux", url: "http://localhost:0", npm: "@earendil-works/pi-ai" },
  name: "Flue deterministic model",
  family: "flue",
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128_000, output: 16_384 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-07-29",
};

const FLUE_PROVIDER: Provider = {
  id: FLUE_PROVIDER_ID,
  name: "Flue",
  source: "custom",
  env: [],
  options: {},
  models: { [FLUE_MODEL_ID]: FLUE_MODEL },
};

function makeRealModel(providerID: string, id: string, name: string): Model {
  return {
    id,
    providerID,
    api: { id: "chat", url: "", npm: "@earendil-works/pi-ai" },
    name,
    family: providerID,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 32_768 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  };
}

function makeEnvProvider(id: string, name: string, env: string[], models: Array<[string, string]>): Provider {
  const modelMap: Record<string, Model> = {};
  for (const [modelId, label] of models) modelMap[modelId] = makeRealModel(id, modelId, label);
  return { id, name, source: "custom", env, options: {}, models: modelMap };
}

function buildProviderList(): ProviderListResponse {
  const all: Provider[] = [FLUE_PROVIDER];
  const connected: string[] = [FLUE_PROVIDER_ID];
  let defaultSelection: Record<string, string> = { [FLUE_PROVIDER_ID]: FLUE_MODEL_ID };
  if (process.env.OPENAI_API_KEY) {
    all.push(makeEnvProvider("openai", "OpenAI (Flue)", ["OPENAI_API_KEY"], [
      ["gpt-5-nano", "GPT-5 Nano"],
      ["gpt-4.1-mini", "GPT-4.1 Mini"],
    ]));
    connected.push("openai");
    defaultSelection = { openai: "gpt-5-nano" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    all.push(makeEnvProvider("anthropic", "Anthropic (Flue)", ["ANTHROPIC_API_KEY"], [
      ["claude-haiku-4-5", "Claude Haiku 4.5"],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
    ]));
    connected.push("anthropic");
    defaultSelection = { anthropic: "claude-haiku-4-5" };
  }
  return { all, default: defaultSelection, connected };
}

const DEFAULT_CONFIG: EngineConfig = {
  model: FLUE_MODEL_SPEC,
  default_agent: DEFAULT_AGENT,
  agent: {
    [DEFAULT_AGENT]: {
      model: FLUE_MODEL_SPEC,
      description: "OpenWork's Flue-backed default agent.",
      mode: "primary",
      tools: {},
    },
  },
  provider: {
    [FLUE_PROVIDER_ID]: {
      api: "faux",
      name: "Flue",
      models: {
        [FLUE_MODEL_ID]: {
          id: FLUE_MODEL_ID,
          name: "Flue deterministic model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          limit: { context: 128_000, output: 16_384 },
          status: "active",
        },
      },
    },
  },
};

const DEFAULT_AGENT_LIST: Agent[] = [
  {
    name: DEFAULT_AGENT,
    description: "OpenWork's Flue-backed default agent.",
    mode: "primary",
    native: true,
    hidden: false,
    permission: [],
    model: { providerID: FLUE_PROVIDER_ID, modelID: FLUE_MODEL_ID },
    options: {},
  },
];

const configFacades = new WeakMap<ServerConfig, Map<string, FlueWorkspaceFacade>>();
const facadeByInstanceId = new Map<string, FlueWorkspaceFacade>();
let observerInstalled = false;
let fauxProvider: FauxProviderRegistration | null = null;

function installFlueObserver(): void {
  if (observerInstalled) return;
  observerInstalled = true;
  observe((event) => {
    const instanceId = typeof event.instanceId === "string" ? event.instanceId : "";
    const facade = facadeByInstanceId.get(instanceId);
    if (facade) facade.handleObservedFlueEvent(event);
  });
}

function ensureFauxProvider(): FauxProviderRegistration {
  if (fauxProvider) return fauxProvider;
  const provider = registerFauxProvider({
    api: "openwork-flue-faux",
    provider: FLUE_PROVIDER_ID,
    models: [{ id: FLUE_MODEL_ID, name: "Flue deterministic model", contextWindow: 128_000, maxTokens: 16_384 }],
    tokensPerSecond: 0,
    tokenSize: { min: 2, max: 2 },
  });
  registerProvider(FLUE_PROVIDER_ID, {
    api: provider.api,
    baseUrl: "http://localhost:0",
    models: { [FLUE_MODEL_ID]: { contextWindow: 128_000, maxTokens: 16_384 } },
  });
  fauxProvider = provider;
  return provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeDirectoryHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "flue-session";
}

function normalizedOpencodePath(proxyPath: string): string {
  const raw = proxyPath.trim() || "/";
  const withoutMount = raw.startsWith("/opencode") ? raw.slice("/opencode".length) : raw;
  const normalized = (withoutMount || "/").replace(/\/+$/, "");
  return normalized || "/";
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function parseWire<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError(500, "flue_invalid_wire", `Flue facade produced invalid ${label}`, { issues: result.error.issues });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

function stateFilePath(workspace: WorkspaceInfo): string {
  return join(workspace.path, STATE_FILE);
}

function sessionModel(input?: PromptModelInput): { providerID: string; modelID: string; variant?: string } {
  const providerID = input?.providerID?.trim() || FLUE_PROVIDER_ID;
  const modelID = input?.modelID?.trim() || FLUE_MODEL_ID;
  return {
    providerID,
    modelID,
    ...(input?.variant ? { variant: input.variant } : {}),
  };
}

function promptModelSpec(input?: PromptModelInput): string {
  const model = sessionModel(input);
  return `${model.providerID}/${model.modelID}`;
}

function emptyAssistantTokens() {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  };
}

function makeSession(input: { id: string; title: string; directory: string; parentID?: string; model?: PromptModelInput; now: number }): Session {
  const model = sessionModel(input.model);
  return {
    id: input.id,
    slug: slugify(input.title),
    projectID: `proj_${input.id}`,
    directory: input.directory,
    path: input.directory,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    title: input.title,
    agent: DEFAULT_AGENT,
    model: {
      id: model.modelID,
      providerID: model.providerID,
      ...(model.variant ? { variant: model.variant } : {}),
    },
    version: "flue-compat-v1",
    time: { created: input.now, updated: input.now },
  };
}

function makeUserMessage(input: { id: string; sessionID: string; text: string; model?: PromptModelInput; agent?: string; now: number }): MessageWithParts {
  const info: Message = {
    id: input.id,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.now },
    agent: input.agent ?? DEFAULT_AGENT,
    model: {
      providerID: sessionModel(input.model).providerID,
      modelID: sessionModel(input.model).modelID,
      ...(input.model?.variant ? { variant: input.model.variant } : {}),
    },
  };
  const part: Part = {
    id: `prt_${shortId()}`,
    sessionID: input.sessionID,
    messageID: input.id,
    type: "text",
    text: input.text,
    time: { start: input.now, end: input.now },
  };
  return { info, parts: [part] };
}

function makeAssistantMessage(input: {
  id: string;
  sessionID: string;
  parentID: string;
  directory: string;
  model?: PromptModelInput;
  agent?: string;
  now: number;
}): MessageWithParts {
  const model = sessionModel(input.model);
  const info: Message = {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: input.now },
    parentID: input.parentID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: input.agent ?? DEFAULT_AGENT,
    path: { cwd: input.directory, root: input.directory },
    cost: 0,
    tokens: emptyAssistantTokens(),
    ...(model.variant ? { variant: model.variant } : {}),
  };
  const part: Part = {
    id: `prt_${shortId()}`,
    sessionID: input.sessionID,
    messageID: input.id,
    type: "text",
    text: "",
    time: { start: input.now },
  };
  return { info, parts: [part] };
}

function completeAssistantMessage(message: MessageWithParts, text: string, completedAt: number, response?: PromptResponse): MessageWithParts {
  if (message.info.role !== "assistant") return message;
  const model = response?.model;
  const usage = response?.usage;
  const info: Message = {
    ...message.info,
    time: { ...message.info.time, completed: completedAt },
    ...(model ? { providerID: model.provider, modelID: model.id } : {}),
    cost: usage?.cost.total ?? message.info.cost,
    tokens: usage
      ? {
          input: usage.input,
          output: usage.output,
          reasoning: 0,
          cache: { read: usage.cacheRead, write: usage.cacheWrite },
          total: usage.totalTokens,
        }
      : message.info.tokens,
    finish: "stop",
  };
  return {
    info,
    parts: message.parts.map((part) => {
      if (part.type !== "text") return part;
      return { ...part, text, time: { ...(part.time ?? { start: completedAt }), end: completedAt } };
    }),
  };
}

function erroredAssistantMessage(message: MessageWithParts, error: unknown, completedAt: number): MessageWithParts {
  if (message.info.role !== "assistant") return message;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const info: Message = {
    ...message.info,
    time: { ...message.info.time, completed: completedAt },
    error: { name: "UnknownError", data: { message: errorMessage } },
    finish: "error",
  };
  return { ...message, info };
}

function normalizeSessionStatus(value: unknown): SessionStatus {
  if (!isRecord(value)) return { type: "idle" };
  if (value.type === "busy") return { type: "busy" };
  if (value.type === "retry") {
    const attempt = numberValue(value.attempt) ?? 1;
    const message = stringValue(value.message) ?? "Retrying";
    const next = numberValue(value.next) ?? Date.now();
    return { type: "retry", attempt, message, next };
  }
  return { type: "idle" };
}

function normalizeSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title) ?? "Untitled";
  const directory = stringValue(value.directory) ?? "";
  if (!id || !directory) return null;
  const time = isRecord(value.time) ? value.time : {};
  const created = numberValue(time.created) ?? Date.now();
  const updated = numberValue(time.updated) ?? created;
  const parentID = stringValue(value.parentID);
  return {
    id,
    slug: stringValue(value.slug) ?? slugify(title),
    projectID: stringValue(value.projectID) ?? `proj_${id}`,
    directory,
    path: stringValue(value.path) ?? directory,
    ...(parentID ? { parentID } : {}),
    title,
    agent: stringValue(value.agent) ?? DEFAULT_AGENT,
    model: { id: FLUE_MODEL_ID, providerID: FLUE_PROVIDER_ID },
    version: stringValue(value.version) ?? "flue-compat-v1",
    time: { created, updated },
  };
}

function normalizeMessageInfo(value: unknown): Message | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const sessionID = stringValue(value.sessionID);
  if (!id || !sessionID) return null;
  const timeRecord = isRecord(value.time) ? value.time : {};
  const created = numberValue(timeRecord.created) ?? Date.now();
  const completed = numberValue(timeRecord.completed);
  const time = { created, ...(completed ? { completed } : {}) };
  if (value.role === "user") {
    return {
      id,
      sessionID,
      role: "user",
      time,
      agent: stringValue(value.agent) ?? DEFAULT_AGENT,
      model: { providerID: FLUE_PROVIDER_ID, modelID: FLUE_MODEL_ID },
    };
  }
  if (value.role === "assistant") {
    return {
      id,
      sessionID,
      role: "assistant",
      time,
      parentID: stringValue(value.parentID) ?? "",
      modelID: stringValue(value.modelID) ?? FLUE_MODEL_ID,
      providerID: stringValue(value.providerID) ?? FLUE_PROVIDER_ID,
      mode: stringValue(value.mode) ?? "build",
      agent: stringValue(value.agent) ?? DEFAULT_AGENT,
      path: { cwd: "", root: "" },
      cost: numberValue(value.cost) ?? 0,
      tokens: ZERO_TOKENS,
    };
  }
  return null;
}

function normalizePart(value: unknown): Part | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const sessionID = stringValue(value.sessionID);
  const messageID = stringValue(value.messageID);
  if (!id || !sessionID || !messageID || value.type !== "text") return null;
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text: typeof value.text === "string" ? value.text : "",
  };
}

function normalizeMessageWithParts(value: unknown): MessageWithParts | null {
  if (!isRecord(value)) return null;
  const info = normalizeMessageInfo(value.info);
  if (!info) return null;
  const parts = Array.isArray(value.parts) ? value.parts.flatMap((part) => {
    const normalized = normalizePart(part);
    return normalized ? [normalized] : [];
  }) : [];
  return { info, parts };
}

function normalizeTodo(value: unknown): Todo | null {
  if (!isRecord(value)) return null;
  const content = stringValue(value.content);
  if (!content) return null;
  return {
    content,
    status: stringValue(value.status) ?? "pending",
    priority: stringValue(value.priority) ?? "medium",
  };
}

function normalizePersistedState(value: unknown): FluePersistedState {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return { sessions: [] };
  const sessions = value.sessions.flatMap((item) => {
    if (!isRecord(item)) return [];
    const session = normalizeSession(item.session);
    if (!session) return [];
    const messages = Array.isArray(item.messages) ? item.messages.flatMap((message) => {
      const normalized = normalizeMessageWithParts(message);
      return normalized ? [normalized] : [];
    }) : [];
    const todos = Array.isArray(item.todos) ? item.todos.flatMap((todo) => {
      const normalized = normalizeTodo(todo);
      return normalized ? [normalized] : [];
    }) : [];
    return [{ session, messages, todos, status: normalizeSessionStatus(item.status) }];
  });
  return { sessions };
}

function extractPromptText(body: Record<string, unknown>): string {
  const direct = stringValue(body.text) ?? stringValue(body.prompt);
  if (direct) return direct;
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const texts = parts.flatMap((part) => {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return [];
    return [part.text];
  });
  return texts.join("\n").trim();
}

function extractPromptModel(body: Record<string, unknown>): PromptModelInput | undefined {
  if (isRecord(body.model)) {
    const providerID = stringValue(body.model.providerID);
    const modelID = stringValue(body.model.modelID);
    if (providerID && modelID) {
      return {
        providerID,
        modelID,
        ...(stringValue(body.variant) ? { variant: stringValue(body.variant) ?? undefined } : {}),
      };
    }
  }
  const model = stringValue(body.model);
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

function flueResponseText(prompt: string): string {
  return `Flue received: ${prompt}`;
}

function fallbackPromptResponse(prompt: string): PromptResponse {
  return {
    text: flueResponseText(prompt),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    model: { provider: FLUE_PROVIDER_ID, id: FLUE_MODEL_ID },
  };
}

function fileStatFromNode(stats: Awaited<ReturnType<typeof stat>>): FileStat {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    size: typeof stats.size === "number" ? stats.size : Number(stats.size),
    mtime: stats.mtime,
  };
}

function resolveSandboxPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function execInSandbox(cwd: string, command: string, options?: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal }): Promise<ShellResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, {
      cwd: options?.cwd ?? cwd,
      env: { ...process.env, ...(options?.env ?? {}) },
      shell: true,
      signal: options?.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveCommand({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

function bunLocalSandbox(cwd: string): SandboxFactory {
  return {
    async createSessionEnv(): Promise<SessionEnv> {
      return {
        cwd,
        exec: (command, options) => execInSandbox(cwd, command, options),
        readFile: (path) => readFile(resolveSandboxPath(cwd, path), "utf8"),
        readFileBuffer: (path) => readFile(resolveSandboxPath(cwd, path)),
        async writeFile(path, content) {
          const resolved = resolveSandboxPath(cwd, path);
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content);
        },
        stat: async (path) => fileStatFromNode(await stat(resolveSandboxPath(cwd, path))),
        readdir: (path) => readdir(resolveSandboxPath(cwd, path)),
        exists: async (path) => {
          try {
            await stat(resolveSandboxPath(cwd, path));
            return true;
          } catch {
            return false;
          }
        },
        mkdir: (path, options) => mkdir(resolveSandboxPath(cwd, path), options).then(() => undefined),
        rm: (path, options) => rm(resolveSandboxPath(cwd, path), options).then(() => undefined),
        resolvePath: (path) => resolveSandboxPath(cwd, path),
      };
    },
  };
}

async function createLocalSandbox(cwd: string): Promise<SandboxFactory> {
  if ("bun" in process.versions) return bunLocalSandbox(cwd);
  const runtime = await import("@flue/runtime/node");
  return runtime.local({ cwd });
}

export async function flueFacadeForWorkspace(config: ServerConfig, workspace: WorkspaceInfo): Promise<FlueWorkspaceFacade> {
  installFlueObserver();
  let map = configFacades.get(config);
  if (!map) {
    map = new Map<string, FlueWorkspaceFacade>();
    configFacades.set(config, map);
  }
  const existing = map.get(workspace.id);
  if (existing && existing.workspacePath === workspace.path) {
    await existing.ready();
    return existing;
  }
  const facade = new FlueWorkspaceFacade(config, workspace);
  map.set(workspace.id, facade);
  await facade.ready();
  return facade;
}

export async function handleFlueOpencodeRequest(input: {
  config: ServerConfig;
  workspace: WorkspaceInfo;
  request: Request;
  url: URL;
  proxyPath: string;
}): Promise<Response> {
  const facade = await flueFacadeForWorkspace(input.config, input.workspace);
  return facade.handleRequest(input.request, input.url, input.proxyPath);
}

export async function listFlueSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number },
): Promise<Session[]> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  return facade.listSessions(input);
}

export async function createFlueSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { title: string; prompt?: string },
): Promise<{ item: Session; started: boolean }> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  const session = await facade.createSession({ title: input.title });
  if (input.prompt) {
    void facade.promptAsync(session.id, { text: input.prompt }).catch(() => undefined);
  }
  return { item: session, started: Boolean(input.prompt) };
}

export async function getFlueSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<Session> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  return facade.getSession(sessionId);
}

export async function getFlueSessionMessages(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number },
): Promise<MessageWithParts[]> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  return facade.getMessages(sessionId, input);
}

export async function getFlueSessionSnapshot(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number },
): Promise<{ session: Session; messages: MessageWithParts[]; todos: Todo[]; status: SessionStatus }> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  return facade.getSnapshot(sessionId, input);
}

export async function deleteFlueSession(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string): Promise<void> {
  const facade = await flueFacadeForWorkspace(config, workspace);
  await facade.deleteSession(sessionId);
}

class FlueWorkspaceFacade {
  readonly workspacePath: string;
  private readonly instanceId: string;
  private readonly statePath: string;
  private readonly listeners = new Set<EventListener>();
  private readonly inFlight = new Map<string, InFlightPrompt>();
  private readonly activeCalls = new Map<string, CallHandle<PromptResponse>>();
  private loadPromise: Promise<void> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private state: FluePersistedState = { sessions: [] };
  private harness: FlueHarness | null = null;

  constructor(private readonly config: ServerConfig, private readonly workspace: WorkspaceInfo) {
    this.workspacePath = workspace.path;
    this.instanceId = `openwork-flue:${workspace.id}`;
    this.statePath = stateFilePath(workspace);
    facadeByInstanceId.set(this.instanceId, this);
  }

  ready(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.load();
    return this.loadPromise;
  }

  async handleRequest(request: Request, url: URL, proxyPath: string): Promise<Response> {
    await this.ready();
    const path = normalizedOpencodePath(proxyPath);
    const method = request.method.toUpperCase();
    if (method === "GET" && path === "/global/health") {
      const health: GlobalHealthResponse = { healthy: true, version: "flue-compat-v1" };
      return jsonResponse(health);
    }
    if (method === "GET" && path === "/event") return this.eventStream(request.signal);
    if (method === "GET" && path === "/config") return jsonResponse(DEFAULT_CONFIG);
    if (method === "PATCH" && path === "/config") return jsonResponse(DEFAULT_CONFIG);
    if (method === "GET" && path === "/config/providers") return jsonResponse(buildProviderList());
    if (method === "GET" && path === "/provider") return jsonResponse(buildProviderList());
    if (method === "GET" && path === "/provider/auth") return jsonResponse({});
    if (method === "GET" && path === "/agent") return jsonResponse(DEFAULT_AGENT_LIST);
    if (method === "GET" && path === "/project") return jsonResponse(this.projectList());
    if (method === "GET" && path === "/path") return jsonResponse(this.pathInfo());
    if (method === "GET" && path === "/vcs") return jsonResponse(this.vcsInfo());
    if (method === "GET" && path === "/command") return jsonResponse(this.commandList());
    if (method === "GET" && path === "/lsp") return jsonResponse(this.lspStatus());
    if (method === "GET" && path === "/mcp") return jsonResponse(this.mcpStatus());
    if (method === "POST" && path === "/mcp") return jsonResponse(this.mcpStatus());
    if (method === "GET" && path === "/question") return jsonResponse([]);
    if (method === "GET" && path === "/permission") return jsonResponse([]);
    if (method === "GET" && path === "/experimental/tool") return jsonResponse(this.toolList());
    if (method === "GET" && path === "/experimental/tool/ids") return jsonResponse(this.toolIds());
    if (method === "GET" && path === "/session") {
      return jsonResponse(parseWire(sessionListSchema, this.listSessions({
        roots: parseOptionalBoolean(url.searchParams.get("roots")),
        start: parseNonNegativeInteger(url.searchParams.get("start")),
        search: url.searchParams.get("search")?.trim() || undefined,
        limit: parsePositiveInteger(url.searchParams.get("limit")),
      }), "session list"));
    }
    if (method === "POST" && path === "/session") {
      const body = await readJsonBody(request);
      const title = stringValue(body.title) ?? "New session";
      return jsonResponse(parseWire(sessionInfoSchema, await this.createSession({
        title,
        directory: this.requestDirectory(request, url),
      }), "session"));
    }
    if (method === "GET" && path === "/session/status") {
      return jsonResponse(parseWire(sessionStatusesSchema, this.statuses(), "session statuses"));
    }
    const sessionMatch = path.match(/^\/session\/([^/]+)(?:\/(.*))?$/);
    if (sessionMatch?.[1]) {
      const sessionId = decodePathSegment(sessionMatch[1]);
      const subpath = sessionMatch[2] ? `/${sessionMatch[2]}` : "";
      return await this.handleSessionRequest(method, subpath, sessionId, request, url);
    }
    throw new ApiError(404, "not_found", "Not found");
  }

  listSessions(input: { roots?: boolean; start?: number; search?: string; limit?: number } = {}): Session[] {
    const search = input.search?.trim().toLowerCase() ?? "";
    const start = input.start ?? 0;
    const limit = input.limit ?? 200;
    const sessions = this.state.sessions
      .map((record) => record.session)
      .filter((session) => input.roots ? !session.parentID : true)
      .filter((session) => search ? session.title.toLowerCase().includes(search) || session.id.toLowerCase().includes(search) : true)
      .sort((a, b) => b.time.updated - a.time.updated || b.time.created - a.time.created);
    return sessions.slice(start, start + limit);
  }

  async createSession(input: { title: string; directory?: string; parentID?: string; model?: PromptModelInput }): Promise<Session> {
    const now = Date.now();
    const session = makeSession({
      id: `ses_${shortId()}`,
      title: input.title.trim() || "New session",
      directory: input.directory ?? this.workspace.path,
      ...(input.parentID ? { parentID: input.parentID } : {}),
      ...(input.model ? { model: input.model } : {}),
      now,
    });
    this.state.sessions.push({ session, messages: [], todos: [], status: { type: "idle" } });
    await this.save();
    this.emit({ id: this.eventId(), type: "session.created", properties: { sessionID: session.id, info: session } });
    return session;
  }

  getSession(sessionId: string): Session {
    return this.record(sessionId).session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const record = this.record(sessionId);
    this.state.sessions = this.state.sessions.filter((item) => item.session.id !== sessionId);
    await this.save();
    this.emit({ id: this.eventId(), type: "session.deleted", properties: { sessionID: sessionId, info: record.session } });
  }

  getMessages(sessionId: string, input: { limit?: number } = {}): MessageWithParts[] {
    const messages = this.record(sessionId).messages;
    return typeof input.limit === "number" ? messages.slice(-input.limit) : messages;
  }

  getSnapshot(sessionId: string, input: { limit?: number } = {}): { session: Session; messages: MessageWithParts[]; todos: Todo[]; status: SessionStatus } {
    const record = this.record(sessionId);
    return {
      session: record.session,
      messages: this.getMessages(sessionId, input),
      todos: record.todos,
      status: record.status,
    };
  }

  async promptAsync(sessionId: string, input: PromptRunInput): Promise<void> {
    await this.ready();
    const record = this.record(sessionId);
    const text = input.text.trim();
    if (!text) throw new ApiError(400, "invalid_payload", "Prompt text is required");
    const now = Date.now();
    const user = makeUserMessage({
      id: `msg_${shortId()}`,
      sessionID: sessionId,
      text,
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      now,
    });
    const assistant = makeAssistantMessage({
      id: `msg_${shortId()}`,
      sessionID: sessionId,
      parentID: user.info.id,
      directory: record.session.directory,
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      now,
    });
    record.messages.push(user, assistant);
    record.status = { type: "busy" };
    record.session.time.updated = now;
    const assistantPart = assistant.parts.find((part) => part.type === "text");
    if (assistantPart) {
      this.inFlight.set(sessionId, { assistantMessageId: assistant.info.id, assistantPartId: assistantPart.id });
    }
    await this.save();
    this.emitMessage(user);
    this.emitMessage(assistant);
    this.emitStatus(sessionId, record.status);

    try {
      const { handle } = await this.startFluePrompt(sessionId, text, input);
      this.activeCalls.set(sessionId, handle);
      handle
        .then((response) => this.finishPrompt(sessionId, assistant.info.id, response))
        .catch((error) => this.failPrompt(sessionId, assistant.info.id, error))
        .finally(() => {
          this.activeCalls.delete(sessionId);
          this.inFlight.delete(sessionId);
        });
    } catch (error) {
      queueMicrotask(() => {
        const complete = promptModelSpec(input.model) === FLUE_MODEL_SPEC
          ? this.finishPrompt(sessionId, assistant.info.id, fallbackPromptResponse(text))
          : this.failPrompt(sessionId, assistant.info.id, error);
        void complete.finally(() => this.inFlight.delete(sessionId));
      });
    }
  }

  handleObservedFlueEvent(event: FlueObservation): void {
    if (event.type !== "tool_start" || typeof event.session !== "string") return;
    const inFlight = this.inFlight.get(event.session);
    if (!inFlight) return;
    const record = this.records().find((item) => item.session.id === event.session);
    if (!record) return;
    const message = record.messages.find((item) => item.info.id === inFlight.assistantMessageId);
    if (!message) return;
    const part: Part = {
      id: `prt_${shortId()}`,
      sessionID: event.session,
      messageID: inFlight.assistantMessageId,
      type: "tool",
      callID: event.toolCallId,
      tool: event.toolName,
      state: {
        status: "running",
        input: isRecord(event.args) ? event.args : {},
        time: { start: Date.now() },
      },
    };
    message.parts.push(part);
    void this.save().catch(() => undefined);
    this.emit({ id: this.eventId(), type: "message.part.updated", properties: { sessionID: event.session, part, time: Date.now() } });
  }

  private async handleSessionRequest(method: string, subpath: string, sessionId: string, request: Request, url: URL): Promise<Response> {
    if (method === "GET" && subpath === "") {
      return jsonResponse(parseWire(sessionInfoSchema, this.getSession(sessionId), "session"));
    }
    if (method === "PATCH" && subpath === "") {
      const body = await readJsonBody(request);
      const title = stringValue(body.title);
      const record = this.record(sessionId);
      if (title) record.session.title = title;
      record.session.time.updated = Date.now();
      await this.save();
      this.emit({ id: this.eventId(), type: "session.updated", properties: { sessionID: sessionId, info: record.session } });
      return jsonResponse(parseWire(sessionInfoSchema, record.session, "session"));
    }
    if (method === "DELETE" && subpath === "") {
      await this.deleteSession(sessionId);
      return jsonResponse(true);
    }
    if (method === "GET" && subpath === "/message") {
      return jsonResponse(parseWire(sessionMessagesSchema, this.getMessages(sessionId, {
        limit: parsePositiveInteger(url.searchParams.get("limit")),
      }), "session messages"));
    }
    if (method === "GET" && subpath === "/todo") {
      return jsonResponse(parseWire(sessionTodosSchema, this.record(sessionId).todos, "session todos"));
    }
    if (method === "POST" && subpath === "/prompt_async") {
      const body = await readJsonBody(request);
      await this.promptAsync(sessionId, {
        text: extractPromptText(body),
        ...(extractPromptModel(body) ? { model: extractPromptModel(body) } : {}),
        ...(stringValue(body.agent) ? { agent: stringValue(body.agent) ?? undefined } : {}),
      });
      return emptyResponse();
    }
    if (method === "POST" && subpath === "/command") {
      const body = await readJsonBody(request);
      const command = stringValue(body.command) ?? "command";
      const args = stringValue(body.arguments) ?? "";
      const text = args ? `/${command} ${args}` : `/${command}`;
      await this.promptAsync(sessionId, {
        text,
        ...(extractPromptModel(body) ? { model: extractPromptModel(body) } : {}),
        ...(stringValue(body.agent) ? { agent: stringValue(body.agent) ?? undefined } : {}),
      });
      return jsonResponse({ ok: true, accepted: true });
    }
    if (method === "POST" && subpath === "/abort") {
      const call = this.activeCalls.get(sessionId);
      call?.abort(new DOMException("Session aborted", "AbortError"));
      const record = this.record(sessionId);
      record.status = { type: "idle" };
      await this.save();
      this.emitStatus(sessionId, record.status);
      this.emit({ id: this.eventId(), type: "session.idle", properties: { sessionID: sessionId } });
      return jsonResponse(true);
    }
    if (method === "POST" && (subpath === "/revert" || subpath === "/unrevert" || subpath === "/fork")) {
      return jsonResponse(parseWire(sessionInfoSchema, this.getSession(sessionId), "session"));
    }
    if (method === "POST" && subpath === "/shell") {
      throw new ApiError(501, "flue_shell_not_implemented", "Flue shell sessions are not implemented yet");
    }
    throw new ApiError(404, "not_found", "Not found");
  }

  private async startFluePrompt(sessionId: string, text: string, input: PromptRunInput): Promise<{ handle: CallHandle<PromptResponse> }> {
    const harness = await this.ensureHarness();
    let session;
    try {
      session = await harness.sessions.get(sessionId);
    } catch {
      session = await harness.sessions.create(sessionId);
    }
    if (promptModelSpec(input.model) === FLUE_MODEL_SPEC) {
      ensureFauxProvider().appendResponses([fauxAssistantMessage(flueResponseText(text))]);
    }
    return { handle: session.prompt(text, { model: promptModelSpec(input.model) }) };
  }

  private async finishPrompt(sessionId: string, assistantMessageId: string, response: PromptResponse): Promise<void> {
    const record = this.record(sessionId);
    const index = record.messages.findIndex((message) => message.info.id === assistantMessageId);
    if (index >= 0) {
      record.messages[index] = completeAssistantMessage(record.messages[index], response.text, Date.now(), response);
      this.emitMessage(record.messages[index]);
    }
    record.status = { type: "idle" };
    record.session.time.updated = Date.now();
    await this.save();
    this.emitStatus(sessionId, record.status);
    this.emit({ id: this.eventId(), type: "session.idle", properties: { sessionID: sessionId } });
    this.emit({ id: this.eventId(), type: "session.updated", properties: { sessionID: sessionId, info: record.session } });
  }

  private async failPrompt(sessionId: string, assistantMessageId: string, error: unknown): Promise<void> {
    const record = this.record(sessionId);
    const index = record.messages.findIndex((message) => message.info.id === assistantMessageId);
    if (index >= 0) {
      record.messages[index] = erroredAssistantMessage(record.messages[index], error, Date.now());
      this.emitMessage(record.messages[index]);
    }
    record.status = { type: "idle" };
    record.session.time.updated = Date.now();
    await this.save();
    this.emit({ id: this.eventId(), type: "session.error", properties: { sessionID: sessionId, error: { name: "UnknownError", data: { message: error instanceof Error ? error.message : String(error) } } } });
    this.emitStatus(sessionId, record.status);
    this.emit({ id: this.eventId(), type: "session.idle", properties: { sessionID: sessionId } });
  }

  private handleFlueEvent(event: FlueEventInput): void {
    if (event.type !== "text_delta" || typeof event.session !== "string") return;
    const inFlight = this.inFlight.get(event.session);
    if (!inFlight) return;
    const record = this.records().find((item) => item.session.id === event.session);
    if (!record) return;
    const message = record.messages.find((item) => item.info.id === inFlight.assistantMessageId);
    const part = message?.parts.find((item) => item.id === inFlight.assistantPartId);
    if (!part || part.type !== "text") return;
    part.text += event.text;
    void this.save().catch(() => undefined);
    this.emit({
      id: this.eventId(),
      type: "message.part.delta",
      properties: { sessionID: event.session, messageID: inFlight.assistantMessageId, partID: inFlight.assistantPartId, field: "text", delta: event.text },
    });
  }

  private async ensureHarness(): Promise<FlueHarness> {
    if (this.harness) return this.harness;
    ensureFauxProvider();
    const workspace = this.workspace;
    const sandbox = await createLocalSandbox(workspace.path);
    const agent = defineAgent<Record<string, unknown>>(() => ({
      model: FLUE_MODEL_SPEC,
      cwd: workspace.path,
      sandbox,
      instructions: "You are OpenWork running through the in-process Flue compatibility facade.",
    }));
    const context = createFlueContext({
      id: this.instanceId,
      agentName: DEFAULT_AGENT,
      env: process.env,
      req: new Request(`https://openwork-flue.invalid/${encodeURIComponent(this.instanceId)}`),
      agentConfig: { resolveModel },
      createDefaultEnv: () => sandbox.createSessionEnv({ id: this.instanceId }),
    });
    context.subscribeEvent((event) => this.handleFlueEvent(event));
    this.harness = await context.initializeRootHarness(agent);
    return this.harness;
  }

  private eventStream(signal: AbortSignal): Response {
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (event: EngineEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        this.listeners.add(send);
        controller.enqueue(encoder.encode(": connected\n\n"));
        cleanup = () => {
          this.listeners.delete(send);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        signal.addEventListener("abort", () => cleanup?.(), { once: true });
      },
      cancel: () => cleanup?.(),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private emit(event: EngineEvent): void {
    const parsed = parseWire(engineEventSchema, event, "engine event");
    for (const listener of this.listeners) listener(parsed);
  }

  private emitStatus(sessionId: string, status: SessionStatus): void {
    this.emit({ id: this.eventId(), type: "session.status", properties: { sessionID: sessionId, status } });
  }

  private emitMessage(message: MessageWithParts): void {
    this.emit({ id: this.eventId(), type: "message.updated", properties: { sessionID: message.info.sessionID, info: message.info } });
    for (const part of message.parts) {
      this.emit({ id: this.eventId(), type: "message.part.updated", properties: { sessionID: message.info.sessionID, part, time: Date.now() } });
    }
  }

  private eventId(): string {
    return `evt_${shortId()}`;
  }

  private statuses(): Record<string, SessionStatus> {
    return Object.fromEntries(this.state.sessions.map((record) => [record.session.id, record.status]));
  }

  private records(): FlueSessionRecord[] {
    return this.state.sessions;
  }

  private record(sessionId: string): FlueSessionRecord {
    const record = this.state.sessions.find((item) => item.session.id === sessionId);
    if (!record) throw new ApiError(404, "session_not_found", "Session not found");
    return record;
  }

  private requestDirectory(request: Request, url: URL): string {
    const query = url.searchParams.get("directory")?.trim();
    if (query) return query;
    const header = request.headers.get("x-opencode-directory") ?? request.headers.get("x-openCode-directory") ?? "";
    return header.trim() ? decodeDirectoryHeader(header.trim()) : this.workspace.path;
  }

  private pathInfo(): Path {
    const state = dirname(this.statePath);
    return {
      home: homedir(),
      state,
      config: join(this.workspace.path, ".opencode"),
      worktree: this.workspace.path,
      directory: this.workspace.path,
    };
  }

  private vcsInfo(): VcsInfo {
    return {};
  }

  private commandList(): Command[] {
    return [];
  }

  private lspStatus(): LspStatus[] {
    return [];
  }

  private mcpStatus(): McpStatusMap {
    return {};
  }

  private projectList(): Project[] {
    const now = Date.now();
    return [{ id: `proj_${this.workspace.id}`, worktree: this.workspace.path, name: this.workspace.name, time: { created: now, updated: now }, sandboxes: [] }];
  }

  private toolList(): ToolList {
    return [];
  }

  private toolIds(): ToolIds {
    return [];
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.state = normalizePersistedState(parsed);
    } catch {
      this.state = { sessions: [] };
    }
  }

  private save(): Promise<void> {
    const next = this.saveQueue.then(() => this.writeState());
    this.saveQueue = next.catch(() => undefined);
    return next;
  }

  private async writeState(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const tmpPath = `${this.statePath}.${shortId()}.tmp`;
    try {
      await writeFile(tmpPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      await rename(tmpPath, this.statePath);
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
}
