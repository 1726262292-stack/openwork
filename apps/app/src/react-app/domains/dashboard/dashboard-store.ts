/** Per-user, thread-independent MCP Apps dashboard entries persisted locally. */

export type DashboardMcpAppEntry = {
  kind: "mcp";
  id: string;
  serverName: string;
  /** Present for Connect app-host apps: launch them through this connection reference. */
  connectionId?: string;
  toolName: string;
  projectedToolName: string;
  resourceUri: string;
  title: string;
  /** Optional launch arguments captured when the app was added; every (re)launch reuses them. */
  launchArguments?: Record<string, unknown>;
  /**
   * True only when the user added this app through the picker, consenting to
   * automatic launches. Entries without it (tampered or imported storage)
   * stay run-on-request.
   */
  autoLaunch?: boolean;
  /** True when the launch tool modifies data: the tile only runs on request, never on mount. */
  requiresApproval?: boolean;
  /** True once the user approved this tile's write-tool launch; removing the tile revokes it. */
  launchApproved?: boolean;
};

export type DashboardBuiltinEntry = {
  kind: "builtin-hello";
  id: string;
  title: string;
};

export type DashboardEntry = DashboardMcpAppEntry | DashboardBuiltinEntry;

export const BUILTIN_HELLO_ENTRY_ID = "builtin:hello";

const STORAGE_PREFIX = "openwork.react.dashboardApps.v1";

/**
 * The dashboard is scoped to the signed-in Den user and organization so
 * switching accounts or orgs swaps the whole board. Signed-out desktops share
 * one local scope.
 */
export function dashboardScopeKey(userId: string | null, organizationId: string | null): string {
  return `${STORAGE_PREFIX}.${userId?.trim() || "local"}.${organizationId?.trim() || "none"}`;
}

export function builtinHelloEntry(): DashboardBuiltinEntry {
  return { kind: "builtin-hello", id: BUILTIN_HELLO_ENTRY_ID, title: "Hello World" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): DashboardEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return null;
  if (value.kind === "builtin-hello") return { kind: "builtin-hello", id: value.id, title: value.title };
  if (value.kind !== "mcp") return null;
  if (
    typeof value.serverName !== "string"
    || typeof value.toolName !== "string"
    || typeof value.projectedToolName !== "string"
    || typeof value.resourceUri !== "string"
  ) return null;
  return {
    kind: "mcp",
    id: value.id,
    serverName: value.serverName,
    ...(typeof value.connectionId === "string" ? { connectionId: value.connectionId } : {}),
    toolName: value.toolName,
    projectedToolName: value.projectedToolName,
    resourceUri: value.resourceUri,
    title: value.title,
    ...(isRecord(value.launchArguments) ? { launchArguments: value.launchArguments } : {}),
    ...(value.autoLaunch === true ? { autoLaunch: true } : {}),
    ...(value.requiresApproval === true ? { requiresApproval: true } : {}),
    ...(value.launchApproved === true ? { launchApproved: true } : {}),
  };
}

/** First open seeds the built-in tile so the dashboard is never empty. */
export function readDashboardEntries(scopeKey: string): DashboardEntry[] {
  if (typeof window === "undefined") return [builtinHelloEntry()];
  const raw = window.localStorage.getItem(scopeKey);
  if (raw === null) return [builtinHelloEntry()];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [builtinHelloEntry()];
    const entries: DashboardEntry[] = [];
    for (const value of parsed) {
      const entry = parseEntry(value);
      if (entry && !entries.some((existing) => existing.id === entry.id)) entries.push(entry);
    }
    return entries;
  } catch {
    return [builtinHelloEntry()];
  }
}

export function writeDashboardEntries(scopeKey: string, entries: DashboardEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopeKey, JSON.stringify(entries));
  } catch {
    // Persistence is best-effort; the in-memory dashboard still works.
  }
}
