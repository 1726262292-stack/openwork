/**
 * Thin localStorage wrapper for the React shell's "remember what the user had
 * open" behavior. Keys mirror those the Solid app used so users don't lose
 * their spot when switching between shells during the port.
 */

const ACTIVE_WORKSPACE_KEY = "openwork.react.activeWorkspace";
const SESSION_BY_WORKSPACE_KEY = "openwork.react.sessionByWorkspace";
const WORKSPACE_ORDER_KEY = "openwork.react.workspaceOrder";
const PINNED_SESSIONS_KEY = "openwork.react.pinnedSessions";
const SESSION_ORDER_KEY = "openwork.react.sessionOrder";
const SESSION_GROUPS_KEY = "openwork.react.sessionGroups";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (quota, privacy modes, etc.)
  }
}

export function readActiveWorkspaceId(): string | null {
  const value = safeGet(ACTIVE_WORKSPACE_KEY);
  return value?.trim() || null;
}

export function writeActiveWorkspaceId(id: string | null): void {
  safeSet(ACTIVE_WORKSPACE_KEY, id?.trim() || null);
}

export function readWorkspaceOrderIds(): string[] {
  const raw = safeGet(WORKSPACE_ORDER_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed ? [trimmed] : [];
    });
  } catch {
    return [];
  }
}

export function writeWorkspaceOrderIds(ids: string[]): void {
  const normalized = ids.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  });
  safeSet(WORKSPACE_ORDER_KEY, normalized.length ? JSON.stringify(normalized) : null);
}

type SessionByWorkspace = Record<string, string>;

function readSessionByWorkspaceMap(): SessionByWorkspace {
  const raw = safeGet(SESSION_BY_WORKSPACE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: SessionByWorkspace = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key === "string" && typeof value === "string") {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // ignore malformed payload
  }
  return {};
}

export function readLastSessionFor(workspaceId: string): string | null {
  const id = workspaceId?.trim();
  if (!id) return null;
  return readSessionByWorkspaceMap()[id] ?? null;
}

export function writeLastSessionFor(workspaceId: string, sessionId: string | null): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionByWorkspaceMap();
  const normalized = sessionId?.trim() || "";
  if (!normalized) {
    if (!(wsId in map)) return;
    delete map[wsId];
  } else {
    if (map[wsId] === normalized) return;
    map[wsId] = normalized;
  }
  safeSet(SESSION_BY_WORKSPACE_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

export function forgetWorkspaceMemory(workspaceId: string): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionByWorkspaceMap();
  if (wsId in map) {
    delete map[wsId];
    safeSet(SESSION_BY_WORKSPACE_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
  }
  const active = readActiveWorkspaceId();
  if (active === wsId) writeActiveWorkspaceId(null);
  const workspaceOrderIds = readWorkspaceOrderIds();
  if (workspaceOrderIds.includes(wsId)) {
    writeWorkspaceOrderIds(workspaceOrderIds.filter((id) => id !== wsId));
  }
  forgetWorkspaceSessionOrder(wsId);
  forgetWorkspaceSessionGroups(wsId);
}

// ---------------------------------------------------------------------------
// Session management primitives (pin / manual order / custom groups).
//
// Archive is handled server-side via OpenCode's `session.time.archived`; the
// state below is purely a client-side view layer that the OpenWork server has
// no opinion about, mirroring the existing workspace-order behavior.
// ---------------------------------------------------------------------------

function readStringArray(key: string): string[] {
  const raw = safeGet(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed ? [trimmed] : [];
    });
  } catch {
    return [];
  }
}

function writeStringArray(key: string, ids: string[]): void {
  const normalized = ids.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  });
  safeSet(key, normalized.length ? JSON.stringify(normalized) : null);
}

/** Pinned sessions are global (not workspace-scoped) since ids are unique. */
export function readPinnedSessionIds(): string[] {
  return readStringArray(PINNED_SESSIONS_KEY);
}

export function writePinnedSessionIds(ids: string[]): void {
  // De-dupe while preserving order (pin recency).
  const seen = new Set<string>();
  const deduped = ids.filter((id) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
  writeStringArray(PINNED_SESSIONS_KEY, deduped);
}

type SessionOrderMap = Record<string, string[]>;

function readSessionOrderMap(): SessionOrderMap {
  const raw = safeGet(SESSION_ORDER_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: SessionOrderMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== "string" || !Array.isArray(value)) continue;
      const ids = value.flatMap((entry) => {
        const trimmed = typeof entry === "string" ? entry.trim() : "";
        return trimmed ? [trimmed] : [];
      });
      if (ids.length) result[key] = ids;
    }
    return result;
  } catch {
    return {};
  }
}

function writeSessionOrderMap(map: SessionOrderMap): void {
  safeSet(SESSION_ORDER_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

/** Manual session ordering, scoped per workspace. */
export function readSessionOrderIds(workspaceId: string): string[] {
  const wsId = workspaceId?.trim();
  if (!wsId) return [];
  return readSessionOrderMap()[wsId] ?? [];
}

export function writeSessionOrderIds(workspaceId: string, ids: string[]): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionOrderMap();
  const normalized = ids.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  });
  if (normalized.length) {
    map[wsId] = normalized;
  } else {
    delete map[wsId];
  }
  writeSessionOrderMap(map);
}

function forgetWorkspaceSessionOrder(workspaceId: string): void {
  const map = readSessionOrderMap();
  if (workspaceId in map) {
    delete map[workspaceId];
    writeSessionOrderMap(map);
  }
}

export type SessionGroupDefinition = {
  id: string;
  label: string;
};

export type WorkspaceSessionGroups = {
  /** Ordered list of custom separators the user created for this workspace. */
  groups: SessionGroupDefinition[];
  /** sessionId -> groupId assignment. Unassigned sessions render ungrouped. */
  assignments: Record<string, string>;
};

export const DEFAULT_SESSION_GROUP_LABELS = ["Done", "In progress"];

type SessionGroupsMap = Record<string, WorkspaceSessionGroups>;

function sanitizeWorkspaceGroups(value: unknown): WorkspaceSessionGroups | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const groups: SessionGroupDefinition[] = [];
  const seenGroupIds = new Set<string>();
  if (Array.isArray(record.groups)) {
    for (const entry of record.groups) {
      if (!entry || typeof entry !== "object") continue;
      const id = typeof (entry as any).id === "string" ? (entry as any).id.trim() : "";
      const label = typeof (entry as any).label === "string" ? (entry as any).label.trim() : "";
      if (!id || !label || seenGroupIds.has(id)) continue;
      seenGroupIds.add(id);
      groups.push({ id, label });
    }
  }
  const assignments: Record<string, string> = {};
  if (record.assignments && typeof record.assignments === "object" && !Array.isArray(record.assignments)) {
    for (const [sessionId, groupId] of Object.entries(record.assignments as Record<string, unknown>)) {
      const sid = sessionId.trim();
      const gid = typeof groupId === "string" ? groupId.trim() : "";
      if (sid && gid && seenGroupIds.has(gid)) assignments[sid] = gid;
    }
  }
  if (!groups.length && !Object.keys(assignments).length) return null;
  return { groups, assignments };
}

function readSessionGroupsMap(): SessionGroupsMap {
  const raw = safeGet(SESSION_GROUPS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: SessionGroupsMap = {};
    for (const [workspaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const wsId = workspaceId.trim();
      if (!wsId) continue;
      const sanitized = sanitizeWorkspaceGroups(value);
      if (sanitized) result[wsId] = sanitized;
    }
    return result;
  } catch {
    return {};
  }
}

function writeSessionGroupsMap(map: SessionGroupsMap): void {
  safeSet(SESSION_GROUPS_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

export function readWorkspaceSessionGroups(workspaceId: string): WorkspaceSessionGroups {
  const wsId = workspaceId?.trim();
  if (!wsId) return { groups: [], assignments: {} };
  return readSessionGroupsMap()[wsId] ?? { groups: [], assignments: {} };
}

export function writeWorkspaceSessionGroups(workspaceId: string, value: WorkspaceSessionGroups): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionGroupsMap();
  const sanitized = sanitizeWorkspaceGroups(value);
  if (sanitized) {
    map[wsId] = sanitized;
  } else {
    delete map[wsId];
  }
  writeSessionGroupsMap(map);
}

function forgetWorkspaceSessionGroups(workspaceId: string): void {
  const map = readSessionGroupsMap();
  if (workspaceId in map) {
    delete map[workspaceId];
    writeSessionGroupsMap(map);
  }
}
