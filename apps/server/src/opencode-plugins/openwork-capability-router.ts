import { z } from "zod";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

const searchCapabilitiesArgsSchema = z.object({
  query: z.string().trim().min(1).describe("What the user is trying to do, e.g. 'look up glossary term blue-forty' or 'create a Linear issue'."),
  limit: z.number().int().min(1).max(25).optional().describe("Maximum matches to return. Defaults to 8, max 25."),
  workspaceId: z.string().trim().min(1).optional().describe("OpenWork workspace id (ws_...). Only needed when the workspace cannot be resolved from context."),
});

const executeCapabilityArgsSchema = z.object({
  name: z.string().trim().min(1).describe("Exact capability name returned by search_capabilities, such as mcp:glossary:lookup or skill:release-runbook."),
  arguments: z.record(z.string(), z.unknown()).optional().describe("Arguments for the capability. For MCP tools, pass the tool arguments. For cloud capabilities, follow the pathParams/queryParams/hasBody hints from search_capabilities."),
  workspaceId: z.string().trim().min(1).optional().describe("OpenWork workspace id (ws_...). Only needed when the workspace cannot be resolved from context."),
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

type OpenWorkWorkspace = z.infer<typeof workspaceSchema>;

const OPENWORK_CAPABILITY_ROUTER_INSTRUCTION = `OpenWork capability router: connections (MCP servers), skills, and — when signed in — OpenWork Cloud capabilities are discoverable with search_capabilities and runnable with execute_capability. Some connections are routed on-demand: their tools do NOT appear in your tool list. ALWAYS call search_capabilities before saying an integration or capability doesn't exist. Capability names look like mcp:<connection>:<tool> (arguments = the tool's arguments), skill:<name> (execute returns the skill content to follow), or cloud capability names (arguments follow the match's pathParams/queryParams/hasBody hints, e.g. { body: {...} }).`;

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

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
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

async function postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, "OpenWork capability call failed"));
  return payload;
}

async function listOpenWorkWorkspaces(): Promise<OpenWorkWorkspace[]> {
  return workspaceListEnvelopeSchema.parse(await serverGet("/workspaces")).items;
}

// Canonicalize before comparing: trim trailing slashes, collapse the macOS
// /private/var vs /var symlink split, and lowercase (engine-reported session
// directories can arrive lowercased on case-insensitive filesystems). Used
// only to pick a workspace id, never to touch the filesystem.
function normalizeDirPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.replace(/^\/private(\/|$)/, "/").toLowerCase();
}

function workspaceLabel(workspace: OpenWorkWorkspace): string {
  return workspace.displayName?.trim() || workspace.name?.trim() || workspace.path?.trim() || workspace.id;
}

// Session -> workspace resolution cache: tool contexts reliably carry a
// sessionID even when they carry no directory, and a session's workspace
// never changes mid-run.
const sessionWorkspaceCache = new Map<string, string>();

async function workspaceForSession(workspaces: OpenWorkWorkspace[], sessionId: string): Promise<OpenWorkWorkspace | null> {
  const cached = sessionWorkspaceCache.get(sessionId);
  if (cached) {
    const match = workspaces.find((workspace) => workspace.id === cached);
    if (match) return match;
  }
  for (const workspace of workspaces) {
    try {
      await serverGet(`/workspace/${encodeURIComponent(workspace.id)}/sessions/${encodeURIComponent(sessionId)}`);
      sessionWorkspaceCache.set(sessionId, workspace.id);
      return workspace;
    } catch {
      // Session does not live in this workspace; try the next one.
    }
  }
  return null;
}

async function resolveContextWorkspace(context: OpenCodeContext, workspaceId?: string): Promise<OpenWorkWorkspace> {
  const workspaces = await listOpenWorkWorkspaces();
  if (!workspaces.length) throw new Error("No OpenWork workspaces are available");
  if (workspaceId) {
    const match = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!match) throw new Error(`No workspace matched workspaceId ${workspaceId}. Valid ids: ${workspaces.map((workspace) => workspace.id).join(", ")}`);
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
  const sessionId = context.sessionID?.trim();
  if (sessionId) {
    const match = await workspaceForSession(workspaces, sessionId);
    if (match) return match;
  }
  const only = workspaces.at(0);
  if (workspaces.length === 1 && only) return only;
  throw new Error(`Could not resolve the OpenWork workspace; retry with workspaceId set to one of: ${workspaces.map((workspace) => `${workspace.id} (${workspaceLabel(workspace)})`).join(", ")}`);
}

export const OpenWorkCapabilityRouter = async () => ({
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
    output.system.push(OPENWORK_CAPABILITY_ROUTER_INSTRUCTION);
  },
  tool: {
    search_capabilities: {
      description: `Search OpenWork capabilities before claiming an integration, skill, tool, or cloud capability is unavailable. ${OPENWORK_CAPABILITY_ROUTER_INSTRUCTION}`,
      args: searchCapabilitiesArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = searchCapabilitiesArgsSchema.parse(rawArgs);
        const workspace = await resolveContextWorkspace(context, args.workspaceId);
        const params = new URLSearchParams({ q: args.query });
        if (args.limit !== undefined) params.set("limit", String(args.limit));
        const payload = await serverGet(`/workspace/${encodeURIComponent(workspace.id)}/capabilities/search?${params.toString()}`);
        return JSON.stringify(payload, null, 2);
      },
    },
    execute_capability: {
      description: "Execute an exact capability name returned by search_capabilities. Always search first so you know the exact name and argument shape.",
      args: executeCapabilityArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = executeCapabilityArgsSchema.parse(rawArgs);
        const workspace = await resolveContextWorkspace(context, args.workspaceId);
        const body: Record<string, unknown> = { name: args.name };
        if (args.arguments !== undefined) body.arguments = args.arguments;
        const payload = await postJson(`/workspace/${encodeURIComponent(workspace.id)}/capabilities/execute`, body);
        return JSON.stringify(payload, null, 2);
      },
    },
  },
});
