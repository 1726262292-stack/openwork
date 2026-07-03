import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { z } from "zod";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

type ExtensionActionPayload = {
  extensionId: string;
  action: string;
  args: Record<string, unknown>;
  context: ReturnType<typeof contextPayload>;
};

const listActionsArgsSchema = z.object({
  extensionId: z.string().optional().describe("Optional extension id to filter by, such as google-workspace."),
});

const callArgsSchema = z.object({
  extensionId: z.string().describe("Extension id, such as google-workspace."),
  action: z.string().describe("Action id from openwork_extension_list_actions."),
  args: z.record(z.string(), z.unknown()).optional().describe("JSON arguments for the action."),
});

const uiExecuteArgsSchema = z.object({
  actionId: z.string().describe("The action id from openwork_ui_list_actions, e.g. 'settings.panel.open' or 'composer.set_text'."),
  args: z.record(z.string(), z.unknown()).optional().describe("JSON arguments for the action, if required."),
});

const browserOpenUrlArgsSchema = z.object({
  url: z.string().describe("The website URL to open in the OpenWork built-in browser."),
  provider: z.enum(["auto", "builtin", "external"]).optional().describe("Browser provider. Use builtin or auto; external is reserved for future support."),
});

const browserSetProxyArgsSchema = z.object({
  proxy: z.string().describe("Proxy URL like http://user:pass@host:8080 or socks5://host:1080. Prefer env:NAME (resolves the OPENWORK_BROWSER_PROXY_NAME environment variable on the user's machine) so credentials never enter the conversation."),
});

const sessionSearchArgsSchema = z.object({
  query: z.string().trim().min(1).describe("Text to search for across OpenWork session titles and message transcripts."),
  workspaceId: z.string().trim().optional().describe("Optional OpenWork workspace id/name to limit the search."),
  limit: z.number().int().positive().max(20).optional().describe("Maximum matching sessions to return. Defaults to 10, max 20."),
  scanLimit: z.number().int().positive().max(500).optional().describe("Maximum newest sessions to scan across matching workspaces. Defaults to 100, max 500."),
  messageLimit: z.number().int().positive().max(1000).optional().describe("Maximum recent messages to load per scanned session. Defaults to 400, max 1000."),
});

const sessionReadArgsSchema = z.object({
  sessionId: z.string().trim().min(1).describe("OpenWork/OpenCode session ID returned by openwork_session_search."),
  workspaceId: z.string().trim().optional().describe("Optional OpenWork workspace id/name. Omit to resolve the session across all workspaces."),
  count: z.number().int().positive().max(100).optional().describe("Number of recent transcript messages to return. Defaults to 30, max 100."),
});

const extensionsExportArgsSchema = z.object({
  skills: z.array(z.string().trim().min(1)).optional().describe("Names of installed skills to export, as shown in Settings > Skills or .opencode/skills/**."),
  mcps: z.array(z.string().trim().min(1)).optional().describe("Names of installed MCP servers to export, including OpenWork-managed runtime MCPs."),
  workspaceId: z.string().trim().optional().describe("Optional OpenWork workspace id/name. Defaults to the workspace containing the current directory."),
});

const capabilitySearchArgsSchema = z.object({
  query: z.string().trim().describe("What you want to do, in plain words — e.g. 'export mcp for marketplace' or 'save this as a skill'. Empty string lists everything."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum capability cards to return (default 8)."),
  workspaceId: z.string().trim().optional().describe("Optional OpenWork workspace id/name. Defaults to the workspace containing the current directory."),
});

const capabilityExecuteArgsSchema = z.object({
  id: z.string().trim().min(1).describe("Capability id from openwork_search, e.g. 'extensions.export'."),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments matching the capability's argsSchema."),
  workspaceId: z.string().trim().optional().describe("Optional OpenWork workspace id/name. Defaults to the workspace containing the current directory."),
});

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  path: z.string().optional(),
  displayName: z.string().optional(),
}).passthrough();

const workspaceListEnvelopeSchema = z.object({
  items: z.array(workspaceSchema),
}).passthrough();

const sessionTimeSchema = z.object({
  created: z.number().optional(),
  updated: z.number().optional(),
}).passthrough();

const sessionInfoSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  time: sessionTimeSchema.optional(),
}).passthrough();

const sessionListEnvelopeSchema = z.object({
  items: z.array(sessionInfoSchema),
}).passthrough();

const sessionEnvelopeSchema = z.object({
  item: sessionInfoSchema,
}).passthrough();

const sessionPartSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
}).passthrough();

const sessionMessageSchema = z.object({
  info: z.object({
    id: z.string(),
    role: z.string(),
    time: sessionTimeSchema.optional(),
  }).passthrough(),
  parts: z.array(sessionPartSchema),
}).passthrough();

const sessionMessagesEnvelopeSchema = z.object({
  items: z.array(sessionMessageSchema),
}).passthrough();

const OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION =
  "If the user asks for something you cannot do with obvious built-in tools, check OpenWork extensions before saying the capability is unavailable. Use openwork_extension_list_actions to inspect available extension actions, then call the matching action with openwork_extension_call.";

const OPENWORK_CAPABILITY_INSTRUCTION =
  "OpenWork exposes workspace capabilities through search + execute: call openwork_search with what you want to do in plain words (e.g. 'export mcp for marketplace', 'save this as a skill'), then run the matching card with openwork_execute using its id and argsSchema. Capability cards state when to use them and what they touch (effects); write capabilities go through OpenWork's approval flow automatically. Prefer this over guessing at file layouts or internal config for skills, MCP connections, and portable exports.";

const OPENWORK_UI_CONTROL_INSTRUCTION =
  `IMPORTANT: You are running inside the OpenWork desktop app. When the user asks you to open settings, navigate the app, add providers, or control the OpenWork UI in any way, ALWAYS use the openwork_ui_* tools — NOT the browser_* tools. The browser tools are for external websites only. The openwork_ui_* tools control the app directly and are instant (one tool call).

To open settings: openwork_ui_execute_action with actionId "settings.panel.open" and args {panel:"general"} (or "ai", "extensions", "permissions", "skills", "appearance", etc.)
To add a provider: openwork_ui_execute_action with actionId "settings.provider.add" and optional args {providerId:"anthropic"}
To see what the user sees: openwork_ui_snapshot
To list all available actions: openwork_ui_list_actions
To ask what OpenWork can do: openwork_ui_execute_action with actionId "help.capabilities"

## Cross-session memory
When the user asks what they said, what happened, or what was decided in another OpenWork chat/session, treat it as a session-history lookup, not hidden model memory.
Use openwork_session_search first to search session titles and message transcripts across workspaces. If there is one clear match, use openwork_session_read with the returned sessionId/workspaceId to retrieve transcript context without navigating the UI.
Answer only from the returned search/read results. If multiple sessions match, ask a short clarifying question. If the returned transcript is limited or missing the older context needed, say so instead of guessing.

Do NOT use browser_navigate, browser_click, or browser_snapshot to interact with the OpenWork app itself. Those are for browsing external websites.

## Built-in Browser (external websites)
For web browsing tasks, ALWAYS start with openwork_browser_open_url. It creates/selects a built-in OpenWork browser tab and returns browser_url plus target_id. Use that exact browser_url and target_id for every later browser_snapshot, browser_click, browser_fill, browser_eval, and browser_screenshot call.
Do not call browser_navigate without a target_id returned by openwork_browser_open_url. Do not use browser_* tools on the OpenWork app target (avoid targets with title "OpenWork" or URLs containing ":5173/#/").`;

// ── UI control bridge discovery ──

type UiBridge = { baseUrl: string; token: string };
let cachedBridge: UiBridge | null = null;
let cachedBridgeAt = 0;
const BRIDGE_CACHE_MS = 2_000;
const BRIDGE_TIMEOUT_MS = 5_000;

type OpenWorkWorkspace = z.infer<typeof workspaceSchema>;
type SessionInfo = z.infer<typeof sessionInfoSchema>;
type SessionMessage = z.infer<typeof sessionMessageSchema>;
type SessionSearchSnippet = { before: string; match: string; after: string };
type SessionSearchResult = {
  workspaceId: string;
  workspace: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  kind: "title" | "message";
  snippet: SessionSearchSnippet;
  role?: string;
  messageId?: string;
  messageIndex?: number;
};

const SESSION_SEARCH_DEFAULT_LIMIT = 10;
const SESSION_SEARCH_DEFAULT_SCAN_LIMIT = 100;
const SESSION_SEARCH_DEFAULT_MESSAGE_LIMIT = 400;
const SESSION_SEARCH_CONCURRENCY = 6;
const SESSION_SNIPPET_BEFORE = 36;
const SESSION_SNIPPET_AFTER = 72;

function userAppDataDir(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  if (platform() === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function uiControlDiscoveryPaths(): string[] {
  return [
    process.env.OPENWORK_UI_CONTROL_DISCOVERY?.trim(),
    join(userAppDataDir(), "com.differentai.openwork", "openwork-ui-control.json"),
    join(userAppDataDir(), "com.differentai.openwork.dev", "openwork-ui-control.json"),
  ].filter((p): p is string => Boolean(p));
}

async function discoverUiBridge(): Promise<UiBridge | null> {
  if (cachedBridge && Date.now() - cachedBridgeAt < BRIDGE_CACHE_MS) return cachedBridge;
  for (const candidate of uiControlDiscoveryPaths()) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.baseUrl === "string" && typeof parsed.token === "string") {
        cachedBridge = { baseUrl: parsed.baseUrl, token: parsed.token };
        cachedBridgeAt = Date.now();
        return cachedBridge;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

async function uiBridgeRequest(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const bridge = await discoverUiBridge();
  if (!bridge) return { ok: false, error: "OpenWork UI bridge not available. The desktop app may not be running." };
  try {
    const response = await fetch(`${bridge.baseUrl}${path}`, {
      method: options.method || "GET",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { ok: false, error: text || `HTTP ${response.status}` }; }
  } catch (error) {
    cachedBridge = null;
    cachedBridgeAt = 0;
    return { ok: false, error: `UI bridge unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function serverGet(path: string): Promise<unknown> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, "OpenWork server request failed"));
  return payload;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function buildSessionSnippet(text: string, index: number, length: number): SessionSearchSnippet {
  const start = Math.max(0, index - SESSION_SNIPPET_BEFORE);
  const end = Math.min(text.length, index + length + SESSION_SNIPPET_AFTER);
  const before = `${start > 0 ? "..." : ""}${collapseWhitespace(text.slice(start, index)).trimStart()}`;
  const after = `${collapseWhitespace(text.slice(index + length, end)).trimEnd()}${end < text.length ? "..." : ""}`;
  return { before, match: text.slice(index, index + length), after };
}

function workspaceLabel(workspace: OpenWorkWorkspace): string {
  return workspace.displayName?.trim() || workspace.name?.trim() || workspace.path?.trim() || workspace.id;
}

function sessionTitle(session: SessionInfo): string {
  return session.title?.trim() || session.id;
}

function sessionUpdatedAt(session: SessionInfo): number {
  return session.time?.updated ?? session.time?.created ?? 0;
}

function messageText(message: SessionMessage): string {
  const parts: string[] = [];
  for (const part of message.parts) {
    if (part.type !== "text") continue;
    if (part.synthetic || part.ignored) continue;
    const text = part.text?.trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function findTextMatch(text: string, queryLower: string): { index: number; length: number } | null {
  const lower = text.toLowerCase();
  const exact = lower.indexOf(queryLower);
  if (exact >= 0) return { index: exact, length: queryLower.length };

  const terms = queryLower.split(/\s+/).filter((term) => term.length > 1);
  if (terms.length < 2) return null;

  let firstIndex = Number.POSITIVE_INFINITY;
  let firstLength = 0;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index < 0) return null;
    if (index < firstIndex) {
      firstIndex = index;
      firstLength = term.length;
    }
  }
  return Number.isFinite(firstIndex) ? { index: firstIndex, length: firstLength } : null;
}

function titleSearchResult(workspace: OpenWorkWorkspace, session: SessionInfo, queryLower: string): SessionSearchResult | null {
  const title = sessionTitle(session);
  const text = `${title} ${workspaceLabel(workspace)}`;
  const match = findTextMatch(text, queryLower);
  if (!match) return null;
  return {
    workspaceId: workspace.id,
    workspace: workspaceLabel(workspace),
    sessionId: session.id,
    title,
    updatedAt: sessionUpdatedAt(session),
    kind: "title",
    snippet: buildSessionSnippet(text, match.index, match.length),
  };
}

function messageSearchResult(workspace: OpenWorkWorkspace, session: SessionInfo, messages: SessionMessage[], queryLower: string): SessionSearchResult | null {
  let fallback: SessionSearchResult | null = null;
  for (const [index, message] of messages.entries()) {
    const role = message.info.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = messageText(message);
    if (!text) continue;
    const match = findTextMatch(text, queryLower);
    if (!match) continue;
    const result: SessionSearchResult = {
      workspaceId: workspace.id,
      workspace: workspaceLabel(workspace),
      sessionId: session.id,
      title: sessionTitle(session),
      updatedAt: sessionUpdatedAt(session),
      kind: "message",
      role,
      messageId: message.info.id,
      messageIndex: index,
      snippet: buildSessionSnippet(text, match.index, match.length),
    };
    if (role === "user") return result;
    if (!fallback) fallback = result;
  }
  return fallback;
}

async function listOpenWorkWorkspaces(): Promise<OpenWorkWorkspace[]> {
  return workspaceListEnvelopeSchema.parse(await serverGet("/workspaces")).items;
}

function filterWorkspaces(workspaces: OpenWorkWorkspace[], workspaceId?: string): OpenWorkWorkspace[] {
  const query = workspaceId?.trim().toLowerCase();
  if (!query) return workspaces;
  return workspaces.filter((workspace) => {
    const labels = [workspace.id, workspace.name, workspace.displayName, workspace.path]
      .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
      .map((label) => label.trim().toLowerCase());
    return labels.includes(query);
  });
}

async function listWorkspaceSessions(workspace: OpenWorkWorkspace, limit: number): Promise<SessionInfo[]> {
  const query = new URLSearchParams({ roots: "true", limit: String(limit) });
  return sessionListEnvelopeSchema.parse(
    await serverGet(`/workspace/${encodeURIComponent(workspace.id)}/sessions?${query.toString()}`),
  ).items;
}

async function readWorkspaceSession(workspace: OpenWorkWorkspace, sessionId: string): Promise<SessionInfo> {
  return sessionEnvelopeSchema.parse(
    await serverGet(`/workspace/${encodeURIComponent(workspace.id)}/sessions/${encodeURIComponent(sessionId)}`),
  ).item;
}

async function readSessionMessages(workspace: OpenWorkWorkspace, sessionId: string, limit: number): Promise<SessionMessage[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return sessionMessagesEnvelopeSchema.parse(
    await serverGet(`/workspace/${encodeURIComponent(workspace.id)}/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`),
  ).items;
}

async function forEachWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => worker()));
}

async function searchOpenWorkSessions(rawArgs: unknown): Promise<object> {
  const args = sessionSearchArgsSchema.parse(rawArgs);
  const resultLimit = args.limit ?? SESSION_SEARCH_DEFAULT_LIMIT;
  const scanLimit = args.scanLimit ?? SESSION_SEARCH_DEFAULT_SCAN_LIMIT;
  const messageLimit = args.messageLimit ?? SESSION_SEARCH_DEFAULT_MESSAGE_LIMIT;
  const queryLower = args.query.trim().toLowerCase();
  const workspaces = filterWorkspaces(await listOpenWorkWorkspaces(), args.workspaceId);
  if (!workspaces.length) {
    return { ok: false, error: args.workspaceId ? `No workspace matched ${args.workspaceId}` : "No OpenWork workspaces are available" };
  }

  const sessions: Array<{ workspace: OpenWorkWorkspace; session: SessionInfo }> = [];
  const workspaceErrors: Array<{ workspaceId: string; workspace: string; error: string }> = [];
  await Promise.all(workspaces.map(async (workspace) => {
    try {
      const items = await listWorkspaceSessions(workspace, scanLimit);
      for (const session of items) sessions.push({ workspace, session });
    } catch (error) {
      workspaceErrors.push({ workspaceId: workspace.id, workspace: workspaceLabel(workspace), error: unknownErrorMessage(error) });
    }
  }));

  const sessionsToScan = sessions
    .sort((left, right) => sessionUpdatedAt(right.session) - sessionUpdatedAt(left.session))
    .slice(0, scanLimit);
  const matches: SessionSearchResult[] = [];

  await forEachWithConcurrency(sessionsToScan, SESSION_SEARCH_CONCURRENCY, async ({ workspace, session }) => {
    const titleMatch = titleSearchResult(workspace, session, queryLower);
    try {
      const messages = await readSessionMessages(workspace, session.id, messageLimit);
      const messageMatch = messageSearchResult(workspace, session, messages, queryLower);
      if (messageMatch) matches.push(messageMatch);
      else if (titleMatch) matches.push(titleMatch);
    } catch {
      if (titleMatch) matches.push(titleMatch);
    }
  });

  const results = matches
    .filter((match) => match !== undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    ok: true,
    query: args.query,
    workspaceCount: workspaces.length,
    totalCandidateSessions: sessions.length,
    scannedSessions: sessionsToScan.length,
    scanLimit,
    messageLimit,
    resultLimit,
    workspaceErrors,
    truncated: sessions.length > sessionsToScan.length || results.length > resultLimit,
    results: results.slice(0, resultLimit),
  };
}

async function readOpenWorkSession(rawArgs: unknown): Promise<object> {
  const args = sessionReadArgsSchema.parse(rawArgs);
  const count = args.count ?? 30;
  const workspaces = filterWorkspaces(await listOpenWorkWorkspaces(), args.workspaceId);
  if (!workspaces.length) {
    return { ok: false, error: args.workspaceId ? `No workspace matched ${args.workspaceId}` : "No OpenWork workspaces are available" };
  }

  for (const workspace of workspaces) {
    try {
      const session = await readWorkspaceSession(workspace, args.sessionId);
      const messages = await readSessionMessages(workspace, args.sessionId, count);
      const readable = messages
        .map((message, index) => ({
          index,
          id: message.info.id,
          role: message.info.role,
          text: messageText(message),
        }))
        .filter((message) => message.text.trim().length > 0);
      return {
        ok: true,
        workspaceId: workspace.id,
        workspace: workspaceLabel(workspace),
        sessionId: session.id,
        title: sessionTitle(session),
        updatedAt: sessionUpdatedAt(session),
        returned: readable.length,
        requested: count,
        messages: readable,
      };
    } catch {
      if (args.workspaceId) break;
    }
  }

  return { ok: false, error: `Session ${args.sessionId} was not found in matching OpenWork workspaces` };
}

function serverUrl(): string {
  return String(process.env.OPENWORK_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.OPENWORK_SERVER_TOKEN || "");
}

function requireOpenWorkServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("OpenWork extension tools are only available when OpenCode is launched by OpenWork.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function addContext(payload: unknown, context: OpenCodeContext): object {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.assign({}, payload, { context: contextPayload(context) });
  }
  return { payload, context: contextPayload(context) };
}

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDirPath(path: string): string {
  return path.replace(/\/+$/, "");
}

async function resolveContextWorkspace(workspaceId: string | undefined, context: OpenCodeContext): Promise<OpenWorkWorkspace> {
  const workspaces = await listOpenWorkWorkspaces();
  if (!workspaces.length) throw new Error("No OpenWork workspaces are available");
  if (workspaceId) {
    const match = filterWorkspaces(workspaces, workspaceId).at(0);
    if (!match) throw new Error(`No workspace matched ${workspaceId}`);
    return match;
  }
  const directory = context.worktree?.trim() || context.directory?.trim();
  if (directory) {
    const dir = normalizeDirPath(directory);
    const match = workspaces
      .filter((workspace) => {
        const path = workspace.path?.trim();
        if (!path) return false;
        const root = normalizeDirPath(path);
        return dir === root || dir.startsWith(`${root}/`);
      })
      .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))
      .at(0);
    if (match) return match;
  }
  const only = workspaces.at(0);
  if (workspaces.length === 1 && only) return only;
  throw new Error(`Multiple OpenWork workspaces match; pass workspaceId. Available: ${workspaces.map((workspace) => workspaceLabel(workspace)).join(", ")}`);
}

async function exportOpenWorkExtensions(rawArgs: unknown, context: OpenCodeContext): Promise<object> {
  const args = extensionsExportArgsSchema.parse(rawArgs);
  const skills = args.skills ?? [];
  const mcps = args.mcps ?? [];
  if (skills.length === 0 && mcps.length === 0) {
    return { ok: false, error: "Provide at least one skill or mcp name to export." };
  }
  const workspace = await resolveContextWorkspace(args.workspaceId, context);
  const payload = await postJson(`/workspace/${encodeURIComponent(workspace.id)}/extensions/export`, { skills, mcps });
  const base = { ok: true, workspaceId: workspace.id, workspace: workspaceLabel(workspace) };
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.assign(base, payload);
  }
  return Object.assign(base, { result: payload });
}

// ── Capability federation ──
//
// openwork_search / openwork_execute are the facade over the capability
// index. The index is federated: each shard is owned by the boundary that
// holds its data and credentials, and this plugin only routes.
//   server shard -> /workspace/:id/capabilities/*  (skills, runtime MCPs)
//   ui shard     -> the desktop UI control bridge  (navigation, settings)
//   mcp shard    -> connected MCP servers          (native tools, pointers)
// Cloud-origin cards federate in a follow-up.

type FederatedCard = {
  id: string;
  title: string;
  description: string;
  when: string;
  origin: "server" | "ui" | "mcp";
  effects: string;
  argsSchema?: unknown;
  related?: string[];
  disabled?: boolean;
};

function scoreFederatedCard(card: FederatedCard, terms: string[]): number {
  const id = card.id.toLowerCase();
  const title = card.title.toLowerCase();
  const when = card.when.toLowerCase();
  const description = card.description.toLowerCase();
  return terms.reduce((score, term) => {
    if (id.includes(term)) score += 8;
    if (title.includes(term)) score += 6;
    if (when.includes(term)) score += 4;
    if (description.includes(term)) score += 2;
    return score;
  }, 0);
}

const federatedCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  when: z.string(),
  effects: z.string(),
  argsSchema: z.unknown().optional(),
  related: z.array(z.string()).optional(),
}).passthrough();

const serverCardsEnvelopeSchema = z.object({
  items: z.array(federatedCardSchema),
}).passthrough();

async function collectServerCards(workspaceId: string): Promise<FederatedCard[]> {
  try {
    const payload = await serverGet(`/workspace/${encodeURIComponent(workspaceId)}/capabilities/search?q=&limit=20`);
    return serverCardsEnvelopeSchema.parse(payload).items.map((item) => ({ ...item, origin: "server" as const }));
  } catch {
    return [];
  }
}

const uiActionSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  sideEffect: z.string().optional(),
  args: z.array(z.object({ name: z.string().optional(), description: z.string().optional() }).passthrough()).optional(),
  disabled: z.boolean().optional(),
}).passthrough();

const uiActionsEnvelopeSchema = z.object({
  actions: z.array(uiActionSchema),
}).passthrough();

async function collectUiCards(): Promise<FederatedCard[]> {
  const payload = await uiBridgeRequest("/actions");
  const parsed = uiActionsEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.actions.map((action) => ({
    id: `ui.${action.id}`,
    title: action.label ?? action.id,
    description: action.description ?? `OpenWork app UI action ${action.id}.`,
    when: `Use to ${(action.label ?? action.id).toLowerCase()} in the OpenWork desktop app UI.`,
    origin: "ui" as const,
    effects: action.sideEffect && action.sideEffect !== "none" ? `write:ui` : "read",
    argsSchema: action.args && action.args.length > 0
      ? {
          type: "object",
          properties: Object.fromEntries(action.args.map((arg, index) => [
            arg.name ?? `arg${index}`,
            { description: arg.description ?? "" },
          ])),
        }
      : { type: "object", properties: {} },
    disabled: action.disabled === true,
  }));
}

const mcpItemSchema = z.object({
  name: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
}).passthrough();

const mcpEnvelopeSchema = z.object({
  items: z.array(mcpItemSchema),
}).passthrough();

async function collectMcpCards(workspaceId: string): Promise<FederatedCard[]> {
  try {
    const payload = await serverGet(`/workspace/${encodeURIComponent(workspaceId)}/mcp`);
    const parsed = mcpEnvelopeSchema.safeParse(payload);
    if (!parsed.success) return [];
    return parsed.data.items.map((item) => {
      const config = item.config ?? {};
      const target = typeof config.url === "string" ? config.url : "local command";
      const paused = config.enabled === false;
      return {
        id: `mcp:${item.name}`,
        title: `Connected app ${item.name}`,
        description: `MCP server ${item.name} (${target})${paused ? " — currently paused" : ""}. Its tools are exposed natively in your toolbox.`,
        when: `Use the native ${item.name} tools directly for tasks involving this connected app; execute this card to see its connection details and auth state.`,
        origin: "mcp" as const,
        effects: "read",
        argsSchema: { type: "object", properties: {} },
        related: ["extensions.export"],
        disabled: paused,
      };
    });
  } catch {
    return [];
  }
}

async function searchOpenWorkCapabilities(rawArgs: unknown, context: OpenCodeContext): Promise<object> {
  const args = capabilitySearchArgsSchema.parse(rawArgs);
  const workspace = await resolveContextWorkspace(args.workspaceId, context);
  const limit = args.limit ?? 8;
  const [serverCards, uiCards, mcpCards] = await Promise.all([
    collectServerCards(workspace.id),
    collectUiCards(),
    collectMcpCards(workspace.id),
  ]);
  const cards = [...serverCards, ...uiCards.filter((card) => !card.disabled), ...mcpCards];
  const terms = args.query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = terms.length === 0
    ? cards.slice(0, limit)
    : cards
        .map((card) => ({ card, score: scoreFederatedCard(card, terms) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
        .slice(0, limit)
        .map((entry) => entry.card);
  return {
    ok: true,
    workspaceId: workspace.id,
    workspace: workspaceLabel(workspace),
    origins: { server: serverCards.length, ui: uiCards.length, mcp: mcpCards.length },
    items,
  };
}

async function executeOpenWorkCapability(rawArgs: unknown, context: OpenCodeContext): Promise<object> {
  const args = capabilityExecuteArgsSchema.parse(rawArgs);
  const workspace = await resolveContextWorkspace(args.workspaceId, context);
  const base = { ok: true, workspaceId: workspace.id, workspace: workspaceLabel(workspace) };

  // ui shard: dispatch through the desktop UI control bridge.
  if (args.id.startsWith("ui.")) {
    const result = await uiBridgeRequest("/execute", {
      method: "POST",
      body: { actionId: args.id.slice(3), args: args.args ?? {} },
    });
    return Object.assign(base, { id: args.id, origin: "ui", result });
  }

  // mcp shard: pointer cards — the tools already exist natively.
  if (args.id.startsWith("mcp:")) {
    const name = args.id.slice(4);
    const cards = await collectMcpCards(workspace.id);
    const card = cards.find((entry) => entry.id === args.id);
    if (!card) {
      return { ok: false, error: `No connected MCP named ${name}.` };
    }
    return Object.assign(base, {
      id: args.id,
      origin: "mcp",
      result: {
        pointer: true,
        message: `${card.description} Call its native tools directly instead of this card. To package or share it, execute extensions.export with mcps ["${name}"].`,
      },
    });
  }

  // server shard: the approval-gated execute gateway.
  const payload = await postJson(`/workspace/${encodeURIComponent(workspace.id)}/capabilities/execute`, {
    id: args.id,
    args: args.args ?? {},
  });
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.assign(base, { origin: "server" }, payload);
  }
  return Object.assign(base, { origin: "server", result: payload });
}

async function postJson(path: string, body: ExtensionActionPayload | Record<string, unknown>): Promise<unknown> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetch(url + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "OpenWork extension call failed"));
  }
  return payload;
}

function contextPayload(context: OpenCodeContext) {
  return {
    agent: context.agent,
    sessionId: context.sessionID,
    messageId: context.messageID,
    directory: context.directory,
    worktree: context.worktree,
  };
}

export const OpenWorkExtensionsPreview = async () => ({
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    output.system.push(OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION);
    output.system.push(OPENWORK_CAPABILITY_INSTRUCTION);
    output.system.push(OPENWORK_UI_CONTROL_INSTRUCTION);
  },
  tool: {
    openwork_extension_list_actions: {
      description: `List extension actions currently exposed by OpenWork. ${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION}`,
      args: listActionsArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = listActionsArgsSchema.parse(rawArgs);
        const query = args.extensionId ? `?extensionId=${encodeURIComponent(args.extensionId)}` : "";
        const { url, token } = requireOpenWorkServer();
        const response = await fetch(`${url}/experimental/extensions/actions${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await parseResponse(response);
        if (!response.ok) throw new Error(errorMessage(payload, "OpenWork extension action listing failed"));
        return JSON.stringify(addContext(payload, context), null, 2);
      },
    },
    openwork_extension_call: {
      description: `Call an OpenWork extension action. Use openwork_extension_list_actions first to inspect available actions and schemas. ${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION}`,
      args: callArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = callArgsSchema.parse(rawArgs);
        const payload = await postJson("/experimental/extensions/call", {
          extensionId: args.extensionId,
          action: args.action,
          args: args.args ?? {},
          context: contextPayload(context),
        });
        return JSON.stringify(payload, null, 2);
      },
    },
    openwork_ui_snapshot: {
      description: "Get a snapshot of the current OpenWork UI state: active route, narration, visible actions, and status. Use this to understand what the user sees before taking action.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/snapshot");
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_ui_list_actions: {
      description: `List all UI control actions currently available in OpenWork. Each action has an id you can pass to openwork_ui_execute_action. ${OPENWORK_UI_CONTROL_INSTRUCTION}`,
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/actions");
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_ui_execute_action: {
      description: `Execute an OpenWork UI action by its id. Use openwork_ui_list_actions first to see available actions. ${OPENWORK_UI_CONTROL_INSTRUCTION}`,
      args: uiExecuteArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const { actionId, args } = uiExecuteArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: { actionId, args: args ?? {} },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_session_search: {
      description: "Search OpenWork past chat sessions by title and full message transcript text without navigating the UI. Use this when the user refers to another/past chat or asks what was said, decided, or done previously.",
      args: sessionSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const result = await searchOpenWorkSessions(rawArgs);
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_session_read: {
      description: "Read recent transcript messages from a specific OpenWork session without opening it. Use sessionId/workspaceId from openwork_session_search, then answer only from the returned transcript.",
      args: sessionReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const result = await readOpenWorkSession(rawArgs);
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_search: {
      description: `Search OpenWork's capability index by intent and get back capability cards (id, when to use, argsSchema, effects). ${OPENWORK_CAPABILITY_INSTRUCTION}`,
      args: capabilitySearchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          return JSON.stringify(await searchOpenWorkCapabilities(rawArgs, context), null, 2);
        } catch (error) {
          return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2);
        }
      },
    },
    openwork_execute: {
      description: `Execute an OpenWork capability by id with args matching its argsSchema. Use openwork_search first to find the right capability card. Write capabilities are approval-gated and audited by the server. ${OPENWORK_CAPABILITY_INSTRUCTION}`,
      args: capabilityExecuteArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          return JSON.stringify(await executeOpenWorkCapability(rawArgs, context), null, 2);
        } catch (error) {
          return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2);
        }
      },
    },
    openwork_extensions_export: {
      description: "DEPRECATED: prefer openwork_search + openwork_execute with capability id 'extensions.export'. Export portable definitions of installed skills and MCP servers from OpenWork, including OpenWork-managed runtime MCPs that are not visible as workspace files. Returns full SKILL.md content and MCP configs with secret header/environment values redacted (listed in redactedKeys). Declare redacted keys as required inputs instead of inlining values.",
      args: extensionsExportArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const result = await exportOpenWorkExtensions(rawArgs, context);
          return JSON.stringify(result, null, 2);
        } catch (error) {
          return JSON.stringify({ ok: false, error: unknownErrorMessage(error) }, null, 2);
        }
      },
    },
    openwork_browser_open_url: {
      description: "Open a URL in the OpenWork built-in browser and return the exact CDP browser_url and target_id to use for browser_* automation tools. Always use this before browser_snapshot/click/fill/eval for web browsing tasks.",
      args: browserOpenUrlArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = browserOpenUrlArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: {
            actionId: "browser.open_url",
            args: { url: args.url, provider: args.provider ?? "builtin" },
          },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_browser_set_proxy: {
      description: "Route all OpenWork built-in browser traffic through an HTTP/SOCKS proxy — for example to fetch search results or pages as seen from another location. Applies to every built-in browser tab (including browser_* automation) until cleared with openwork_browser_clear_proxy. If the user has named proxies configured as OPENWORK_BROWSER_PROXY_<NAME> environment variables, pass env:NAME instead of a raw URL.",
      args: browserSetProxyArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = browserSetProxyArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: { actionId: "browser.set_proxy", args: { proxy: args.proxy } },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_browser_clear_proxy: {
      description: "Clear the OpenWork built-in browser proxy and restore the system network settings.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: { actionId: "browser.set_proxy", args: { proxy: "" } },
        });
        return JSON.stringify(result, null, 2);
      },
    },
  },
});
