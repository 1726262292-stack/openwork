import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import type { SessionGroupDefinition } from "../../../shell/session-memory";
import { isSandboxWorkspace } from "../../../../app/utils";
import { t } from "../../../../i18n";

export const MAX_SESSIONS_PREVIEW = 6;

export type SessionListItem = WorkspaceSessionGroup["sessions"][number];
export type FlattenedSessionRow =
  | { kind: "session"; session: SessionListItem; depth: number }
  | { kind: "separator"; groupId: string; label: string };
export type SessionTreeState = {
  childrenByParent: Map<string, SessionListItem[]>;
  ancestorIdsBySessionId: Map<string, string[]>;
  descendantCountBySessionId: Map<string, number>;
  activeIds: Set<string>;
  streamingIds: Set<string>;
};

/**
 * Client-side view state for the new session-management primitives. Kept in a
 * single object so the sidebar can thread it through `flattenSessionRows`
 * without growing a long positional argument list.
 */
export type SessionViewState = {
  pinnedIds: Set<string>;
  /** Manual order (root session ids), workspace-scoped. */
  orderIds: string[];
  groups: SessionGroupDefinition[];
  /** sessionId -> groupId */
  assignments: Record<string, string>;
};

export const EMPTY_SESSION_VIEW_STATE: SessionViewState = {
  pinnedIds: new Set<string>(),
  orderIds: [],
  groups: [],
  assignments: {},
};

export const isSessionArchived = (session: SessionListItem): boolean =>
  typeof session.time?.archived === "number" && session.time.archived > 0;

export const isStreamingSessionStatus = (status: string | undefined) =>
  status === "running" ||
  status === "busy" ||
  status === "retry" ||
  status === "streaming" ||
  status === "thinking" ||
  status === "responding" ||
  status === "waiting";

const normalizeSessionParentID = (session: SessionListItem) => {
  const parentID = session.parentID?.trim();
  return parentID || "";
};

export const getRootSessions = (sessions: WorkspaceSessionGroup["sessions"]) => {
  const byID = new Set(sessions.map((session) => session.id));
  return sessions.filter((session) => {
    const parentID = normalizeSessionParentID(session);
    return !parentID || !byID.has(parentID);
  });
};

/** Split sessions into active vs. archived. Archived sessions live in their own section. */
export const partitionArchivedSessions = (sessions: WorkspaceSessionGroup["sessions"]) => {
  const active: SessionListItem[] = [];
  const archived: SessionListItem[] = [];
  for (const session of sessions) {
    (isSessionArchived(session) ? archived : active).push(session);
  }
  return { active, archived };
};

/**
 * Order root sessions: pinned first (in manual/server order), then the rest.
 * Manual order ids win; anything not yet in the manual order keeps its incoming
 * (server recency) order appended at the end.
 */
export const orderRootSessions = (
  roots: SessionListItem[],
  view: SessionViewState,
): SessionListItem[] => {
  const byId = new Map(roots.map((root) => [root.id, root]));
  const ordered: SessionListItem[] = [];
  const used = new Set<string>();

  for (const id of view.orderIds) {
    const root = byId.get(id);
    if (!root || used.has(id)) continue;
    ordered.push(root);
    used.add(id);
  }
  for (const root of roots) {
    if (used.has(root.id)) continue;
    ordered.push(root);
    used.add(root.id);
  }

  // Stable partition: pinned roots float to the top, preserving relative order.
  const pinned = ordered.filter((root) => view.pinnedIds.has(root.id));
  const rest = ordered.filter((root) => !view.pinnedIds.has(root.id));
  return [...pinned, ...rest];
};

export const buildSessionTreeState = (
  sessions: WorkspaceSessionGroup["sessions"],
  sessionStatusById: Record<string, string> | undefined,
): SessionTreeState => {
  const childrenByParent = new Map<string, SessionListItem[]>();
  const ancestorIdsBySessionId = new Map<string, string[]>();
  const descendantCountBySessionId = new Map<string, number>();
  const activeIds = new Set<string>();
  const streamingIds = new Set<string>();
  // Archived sessions render in their own flat section, so they never join the
  // active tree (neither as roots nor as children of active sessions).
  const visibleSessions = sessions.filter((session) => !isSessionArchived(session));
  const sessionIds = new Set(visibleSessions.map((session) => session.id));

  visibleSessions.forEach((session) => {
    const parentID = normalizeSessionParentID(session);
    if (!parentID || !sessionIds.has(parentID)) return;
    const siblings = childrenByParent.get(parentID) ?? [];
    siblings.push(session);
    childrenByParent.set(parentID, siblings);
  });

  const walk = (session: SessionListItem, ancestors: string[]) => {
    ancestorIdsBySessionId.set(session.id, ancestors);
    const children = childrenByParent.get(session.id) ?? [];
    let descendantCount = 0;
    const ownStatus = sessionStatusById?.[session.id] ?? "idle";
    let subtreeActive = ownStatus !== "idle";
    let subtreeStreaming = isStreamingSessionStatus(ownStatus);

    children.forEach((child) => {
      const childState = walk(child, [...ancestors, session.id]);
      descendantCount += 1 + childState.descendantCount;
      subtreeActive = subtreeActive || childState.subtreeActive;
      subtreeStreaming = subtreeStreaming || childState.subtreeStreaming;
    });

    descendantCountBySessionId.set(session.id, descendantCount);
    if (subtreeActive) activeIds.add(session.id);
    if (subtreeStreaming) streamingIds.add(session.id);
    return { descendantCount, subtreeActive, subtreeStreaming };
  };

  getRootSessions(visibleSessions).forEach((session) => {
    walk(session, []);
  });

  return {
    childrenByParent,
    ancestorIdsBySessionId,
    descendantCountBySessionId,
    activeIds,
    streamingIds,
  };
};

export const flattenSessionRows = (
  sessions: WorkspaceSessionGroup["sessions"],
  rootLimit: number,
  tree: SessionTreeState,
  expandedSessionIds: Set<string>,
  forcedExpandedSessionIds: Set<string>,
  view: SessionViewState = EMPTY_SESSION_VIEW_STATE,
) => {
  // Archived sessions never appear in the main list; they get their own section.
  const { active } = partitionArchivedSessions(sessions);
  const orderedRoots = orderRootSessions(getRootSessions(active), view).slice(0, rootLimit);
  const rows: FlattenedSessionRow[] = [];
  const visited = new Set<string>();

  const walk = (session: SessionListItem, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    rows.push({ kind: "session", session, depth });
    const children = tree.childrenByParent.get(session.id) ?? [];
    if (!children.length) return;
    const expanded = expandedSessionIds.has(session.id) || forcedExpandedSessionIds.has(session.id);
    if (!expanded) return;
    children.forEach((child) => walk(child, depth + 1));
  };

  if (view.groups.length === 0) {
    orderedRoots.forEach((root) => walk(root, 0));
    return rows;
  }

  // With custom separators, render each group's roots under its header in the
  // group order the user defined, then any ungrouped roots at the end.
  const groupOrder = view.groups.map((group) => group.id);
  const rootsByGroup = new Map<string, SessionListItem[]>();
  const ungrouped: SessionListItem[] = [];
  for (const root of orderedRoots) {
    const groupId = view.assignments[root.id];
    if (groupId && groupOrder.includes(groupId)) {
      const bucket = rootsByGroup.get(groupId) ?? [];
      bucket.push(root);
      rootsByGroup.set(groupId, bucket);
    } else {
      ungrouped.push(root);
    }
  }

  for (const group of view.groups) {
    const groupRoots = rootsByGroup.get(group.id) ?? [];
    rows.push({ kind: "separator", groupId: group.id, label: group.label });
    groupRoots.forEach((root) => walk(root, 0));
  }
  ungrouped.forEach((root) => walk(root, 0));
  return rows;
};

export const workspaceLabel = (workspace: WorkspaceInfo) =>
  workspace.displayName?.trim() ||
  workspace.openworkWorkspaceName?.trim() ||
  workspace.name?.trim() ||
  workspace.path?.trim() ||
  t("workspace_list.workspace_fallback");

export const workspaceKindLabel = (workspace: WorkspaceInfo) =>
  workspace.workspaceType === "remote"
    ? isSandboxWorkspace(workspace)
      ? t("workspace.sandbox_badge")
      : t("workspace.remote_badge")
    : t("workspace.local_badge");

const WORKSPACE_SWATCHES = ["#2563eb", "#5a67d8", "#f97316", "#10b981"];

export const workspaceSwatchColor = (seed: string) => {
  const value = seed.trim() || "workspace";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return WORKSPACE_SWATCHES[Math.abs(hash) % WORKSPACE_SWATCHES.length];
};
