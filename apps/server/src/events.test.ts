import { describe, expect, test } from "bun:test";
import { ReloadEventStore } from "./events.js";

describe("ReloadEventStore", () => {
  test("keeps a global cursor while filtering reads by workspace", () => {
    const store = new ReloadEventStore(2);
    const quiet = store.record("quiet", "config", { type: "config", name: "quiet.json" });
    store.record("busy", "config", { type: "config", name: "first.json" });
    store.record("busy", "skills", { type: "skill", name: "second.md" });

    expect(quiet.seq).toBe(1);
    expect(store.cursor()).toBe(3);
    expect(store.list("quiet")).toEqual([]);
    expect(store.list("busy", 1).map((event) => event.trigger?.name)).toEqual(["first.json", "second.md"]);
  });

  test("keeps reload payload shape and debounce semantics outside the cursor buffer", () => {
    const store = new ReloadEventStore();
    const first = store.recordDebounced("ws_1", "mcp", { type: "mcp", name: "server.json" }, 1_000);
    const second = store.recordDebounced("ws_1", "mcp", { type: "mcp", name: "server.json" }, 1_000);

    expect(second).toBeNull();
    expect(first).toMatchObject({
      seq: 1,
      workspaceId: "ws_1",
      reason: "mcp",
      trigger: { type: "mcp", name: "server.json" },
    });
    expect(typeof first?.id).toBe("string");
    expect(typeof first?.timestamp).toBe("number");
  });
});
