import { describe, expect, test } from "bun:test";
import type { WorkspaceArtifactWidget } from "@openwork/types/dynamic-artifacts";

import {
  emptyWorkspaceArtifactLayout,
  pinWorkspaceArtifact,
  reorderWorkspaceArtifact,
  selectWorkspaceArtifactOffset,
  unpinWorkspaceArtifact,
  visibleWorkspaceArtifacts,
} from "../src/react-app/domains/session/artifacts/workspace-artifact-layout";

function widget(id: string): WorkspaceArtifactWidget {
  return {
    id,
    title: `Widget ${id}`,
    programId: `configObject_${id}`,
    serverName: "openwork-cloud",
    resourceUri: `ui://openwork/artifacts/arv_${id}/views/avr_${id}/index.html`,
    input: { receiptId: id },
  };
}

describe("workspace Artifact layout", () => {
  test("pins into one workspace layout and preserves the selected widget while collapsed", () => {
    const first = pinWorkspaceArtifact(emptyWorkspaceArtifactLayout(), widget("one"));
    const second = pinWorkspaceArtifact(first, widget("two"));
    const collapsed = { ...second, expanded: false };
    const reopened = { ...collapsed, expanded: true };

    expect(reopened.activeWidgetId).toBe("two");
    expect(reopened.widgets.map((entry) => entry.id)).toEqual(["one", "two"]);
  });

  test("navigates cyclically and renders the configured number of widgets", () => {
    const pinned = ["one", "two", "three"].reduce(
      (layout, id) => pinWorkspaceArtifact(layout, widget(id)),
      emptyWorkspaceArtifactLayout(),
    );
    const selected = selectWorkspaceArtifactOffset({ ...pinned, visibleWidgets: 2 }, 1);

    expect(selected.activeWidgetId).toBe("one");
    expect(visibleWorkspaceArtifacts(selected).map((entry) => entry.id)).toEqual(["one", "two"]);
  });

  test("reorders and unpins without losing a valid active widget", () => {
    const pinned = ["one", "two", "three"].reduce(
      (layout, id) => pinWorkspaceArtifact(layout, widget(id)),
      emptyWorkspaceArtifactLayout(),
    );
    const reordered = reorderWorkspaceArtifact(pinned, "three", -1);
    const unpinned = unpinWorkspaceArtifact(reordered, "three");

    expect(reordered.widgets.map((entry) => entry.id)).toEqual(["one", "three", "two"]);
    expect(unpinned.widgets.map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(unpinned.activeWidgetId).toBe("two");
  });

  test("deduplicates the same exact Artifact resource and input instead of storing Artifact results", () => {
    const initial = pinWorkspaceArtifact(emptyWorkspaceArtifactLayout(), widget("one"));
    const duplicate = pinWorkspaceArtifact(initial, {
      ...widget("replacement"),
      programId: "configObject_one",
      resourceUri: "ui://openwork/artifacts/arv_one/views/avr_one/index.html",
      input: { receiptId: "one" },
    });

    expect(duplicate.widgets).toHaveLength(1);
    expect(duplicate.widgets[0]?.title).toBe("Widget replacement");
    expect(duplicate.widgets[0]).not.toHaveProperty("result");
  });

  test("keeps two selected-tool results distinct by stable Program identity", () => {
    const first = pinWorkspaceArtifact(emptyWorkspaceArtifactLayout(), widget("one"));
    const second = pinWorkspaceArtifact(first, {
      ...widget("two"),
      resourceUri: widget("one").resourceUri,
      input: {},
    });

    expect(second.widgets).toHaveLength(2);
    expect(second.widgets.map((entry) => entry.programId)).toEqual(["configObject_one", "configObject_two"]);
  });
});
