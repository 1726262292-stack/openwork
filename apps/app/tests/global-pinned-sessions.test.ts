import { describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "../src/app/lib/desktop";
import type { WorkspaceSessionGroup } from "../src/app/types";
import { getPinnedSessionStorageId } from "../src/react-app/domains/session/sidebar/session-management-store";
import { getGlobalPinnedSessionEntries } from "../src/react-app/domains/session/sidebar/utils";

function workspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    preset: "starter",
    workspaceType: "local",
  };
}

const groups: WorkspaceSessionGroup[] = [
  {
    workspace: workspace("workspace-alpha", "Alpha Workspace"),
    status: "ready",
    sessions: [
      { id: "session-alpha", title: "Duplicate title", time: { created: 1, updated: 1 } },
    ],
  },
  {
    workspace: workspace("workspace-beta", "Beta Workspace"),
    status: "ready",
    sessions: [
      { id: "session-beta", title: "Duplicate title", time: { created: 2, updated: 2 } },
    ],
  },
];

describe("global pinned sessions", () => {
  test("derives pinned entries in pin order with owning workspace labels", () => {
    const entries = getGlobalPinnedSessionEntries(groups, ["session-beta", "missing", "session-alpha", "session-beta"]);

    expect(entries.map((entry) => entry.session.id)).toEqual(["session-beta", "session-alpha"]);
    expect(entries.map((entry) => entry.workspace.id)).toEqual(["workspace-beta", "workspace-alpha"]);
    expect(entries.map((entry) => entry.workspaceLabel)).toEqual(["Beta Workspace", "Alpha Workspace"]);
  });

  test("returns no global entries when no listed sessions are pinned", () => {
    expect(getGlobalPinnedSessionEntries(groups, [])).toEqual([]);
    expect(getGlobalPinnedSessionEntries(groups, ["missing"])).toEqual([]);
  });

  test("requires scoped pin identity when the same session ID exists in multiple workspaces", () => {
    const duplicateGroups: WorkspaceSessionGroup[] = [
      {
        workspace: workspace("workspace-one", "One Workspace"),
        status: "ready",
        sessions: [{ id: "same-session", title: "Shared ID", time: { created: 1, updated: 1 } }],
      },
      {
        workspace: workspace("workspace-two", "Two Workspace"),
        status: "ready",
        sessions: [{ id: "same-session", title: "Shared ID", time: { created: 2, updated: 2 } }],
      },
    ];

    expect(getGlobalPinnedSessionEntries(duplicateGroups, ["same-session"])).toEqual([]);

    const entries = getGlobalPinnedSessionEntries(duplicateGroups, [
      getPinnedSessionStorageId("workspace-two", "same-session"),
      getPinnedSessionStorageId("workspace-one", "same-session"),
    ]);

    expect(entries.map((entry) => entry.workspace.id)).toEqual(["workspace-two", "workspace-one"]);
    expect(entries.map((entry) => entry.workspaceLabel)).toEqual(["Two Workspace", "One Workspace"]);
  });
});
