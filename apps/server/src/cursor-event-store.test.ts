import { describe, expect, test } from "bun:test";
import { CursorEventStore, WorkspaceCursorEventStore, type WorkspaceCursorEvent } from "./cursor-event-store.js";

type TestEvent = WorkspaceCursorEvent & {
  label: string;
};

function event(workspaceId: string, label: string) {
  return (seq: number): TestEvent => ({ seq, workspaceId, label });
}

describe("CursorEventStore", () => {
  test("starts at cursor zero and appends monotonic sequence numbers", () => {
    const store = new CursorEventStore<TestEvent>(10);

    expect(store.cursor()).toBe(0);
    expect(store.record(event("ws_1", "first")).seq).toBe(1);
    expect(store.record(event("ws_1", "second")).seq).toBe(2);
    expect(store.cursor()).toBe(2);
  });

  test("filters by workspace and lists events after the cursor exclusively", () => {
    const store = new CursorEventStore<TestEvent>(10);
    const first = store.record(event("ws_1", "first"));
    store.record(event("ws_2", "other"));
    store.record(event("ws_1", "second"));

    expect(store.list("ws_1", first.seq).map((item) => item.label)).toEqual(["second"]);
    expect(store.list("ws_2").map((item) => item.label)).toEqual(["other"]);
  });

  test("evicts old events without resetting the cursor", () => {
    const store = new CursorEventStore<TestEvent>(2);
    store.record(event("ws_1", "first"));
    store.record(event("ws_1", "second"));
    store.record(event("ws_1", "third"));

    expect(store.cursor()).toBe(3);
    expect(store.list("ws_1").map((item) => item.label)).toEqual(["second", "third"]);
    expect(store.list("ws_1", 2).map((item) => item.label)).toEqual(["third"]);
  });

  test("keeps independent cursor sequences per instance", () => {
    const first = new CursorEventStore<TestEvent>(10);
    const second = new CursorEventStore<TestEvent>(10);

    expect(first.record(event("ws_1", "first")).seq).toBe(1);
    expect(second.record(event("ws_1", "first")).seq).toBe(1);
    expect(first.cursor()).toBe(1);
    expect(second.cursor()).toBe(1);
  });
});

describe("WorkspaceCursorEventStore", () => {
  test("keeps independent workspace cursors and buffers", () => {
    const store = new WorkspaceCursorEventStore<TestEvent>(2);

    store.record("quiet", event("quiet", "only"));
    store.record("busy", event("busy", "first"));
    store.record("busy", event("busy", "second"));
    store.record("busy", event("busy", "third"));

    expect(store.cursor("quiet")).toBe(1);
    expect(store.cursor("busy")).toBe(3);
    expect(store.list("quiet").map((item) => item.label)).toEqual(["only"]);
    expect(store.list("busy").map((item) => item.label)).toEqual(["second", "third"]);
  });
});
