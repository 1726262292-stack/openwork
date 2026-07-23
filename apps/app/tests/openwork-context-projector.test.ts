import { describe, expect, test } from "bun:test";

import {
  buildOpenworkContext,
  screenFromRoute,
} from "../src/react-app/shell/openwork-context-projector";
import type { WorkbenchSnapshot } from "../src/react-app/domains/session/chat/workbench-store";

const splitWorkbench: WorkbenchSnapshot = {
  revision: 5,
  workspaceId: "workspace-a",
  primarySessionId: "session-a",
  tabs: [
    { workspaceId: "workspace-a", sessionId: "session-a", title: "Current plan" },
    { workspaceId: "workspace-a", sessionId: "session-b", title: "Previous research" },
    { workspaceId: "workspace-a", sessionId: "session-c", title: "Draft" },
  ],
  splitSessionId: "session-b",
  focusedPane: "secondary",
};

function contextForRoute(route: string) {
  return buildOpenworkContext({
    route,
    revision: 7,
    capturedAt: "2026-07-23T10:59:00.000Z",
    workbench: splitWorkbench,
    ui: {
      sidebarOpen: false,
      sidePanelState: { "session-a": "panel" },
      applicationMenuVisible: false,
      workspaceRightSidebarExpanded: true,
    },
    panelSessions: {
      "session-a": {
        tabs: [{
          id: "browser-one",
          type: "browser",
          label: "OpenWork docs",
          url: "https://docs.openwork.so",
          favicon: null,
          status: "ready",
          canGoBack: false,
          canGoForward: false,
        }],
        activeTabId: "browser-one",
      },
    },
    availableAffordances: [],
  });
}

describe("OpenWork context projector", () => {
  test("represents all open tabs and both visible split sessions", () => {
    const context = contextForRoute("/workspace/workspace-a/session/session-a");

    expect(context.conversations.tabs.map((tab) => tab.sessionId)).toEqual([
      "session-a",
      "session-b",
      "session-c",
    ]);
    expect(context.conversations.layout).toEqual({
      kind: "split",
      primarySessionId: "session-a",
      secondarySessionId: "session-b",
      focused: "secondary",
    });
    expect(context.resources.find((resource) => resource.ref === "session:session-b")).toMatchObject({
      kind: "session",
      title: "Previous research",
      state: {
        open: true,
        visible: true,
        pane: "secondary",
        focused: true,
      },
    });
    expect(context.chrome.sidebarOpen).toBe(false);
    expect(context.execution).toEqual({
      queries: "parallel",
      commands: "serialized",
      busyCommandId: null,
      busyActor: null,
    });
    expect(context.sidePanel).toMatchObject({
      open: true,
      ownerSessionId: "session-a",
      kind: "panel",
      activeTabId: "browser-one",
    });
  });

  test("retains workbench context while settings is the active screen", () => {
    const context = contextForRoute("/workspace/workspace-a/settings/ai");

    expect(context.screen).toEqual({
      kind: "settings",
      route: "/workspace/workspace-a/settings/ai",
      workspaceId: "workspace-a",
      panel: "ai",
    });
    expect(context.conversations.layout.kind).toBe("split");
    expect(context.conversations.tabs).toHaveLength(3);
  });

  test("parses legacy and workspace-scoped routes without reading the DOM", () => {
    expect(screenFromRoute("/session/session-a")).toMatchObject({
      kind: "conversation",
      sessionId: "session-a",
    });
    expect(screenFromRoute("/settings/extensions")).toMatchObject({
      kind: "settings",
      panel: "extensions",
    });
  });
});
