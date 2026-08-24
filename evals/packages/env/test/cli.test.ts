import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/world.ts";
import { parseWorldArgs, main } from "../src/cli.ts";
import { supportOrg } from "../src/presets.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const DEMO_SNAPSHOT_PATH = join(REPO_ROOT, "evals", "results", ".worlds", "demo.json");

test("parseWorldArgs parses every world command", () => {
  assert.deepEqual(parseWorldArgs([]), { kind: "help" });
  assert.deepEqual(parseWorldArgs(["help"]), { kind: "help" });
  assert.deepEqual(parseWorldArgs(["up", "solo"]), { kind: "up", preset: "solo" });
  assert.deepEqual(parseWorldArgs(["up", "support-org", "--name", "demo"]), {
    kind: "up",
    preset: "support-org",
    name: "demo",
  });
  assert.deepEqual(parseWorldArgs(["up", "acme-demo", "--keep"]), {
    kind: "up",
    preset: "acme-demo",
    keep: true,
  });
  assert.deepEqual(parseWorldArgs(["up", "acme-demo", "--keep", "--name", "demo"]), {
    kind: "up",
    preset: "acme-demo",
    name: "demo",
    keep: true,
  });
  assert.deepEqual(parseWorldArgs(["rebuild", "saved.json"]), {
    kind: "rebuild",
    snapshotPath: "saved.json",
  });
  assert.deepEqual(parseWorldArgs(["list"]), { kind: "list" });
  assert.deepEqual(parseWorldArgs(["resume", "demo"]), {
    kind: "resume",
    nameOrSnapshotPath: "demo",
  });
  assert.deepEqual(parseWorldArgs(["resume", "saved.json", "--teardown"]), {
    kind: "resume",
    nameOrSnapshotPath: "saved.json",
    teardown: true,
  });
  assert.deepEqual(parseWorldArgs(["forget", "demo"]), { kind: "forget", name: "demo" });
});

test("parseWorldArgs turns invalid input into help with an error", () => {
  for (const argv of [
    ["unknown"],
    ["up"],
    ["up", "unknown"],
    ["up", "solo", "--name"],
    ["up", "solo", "--keep", "--keep"],
    ["rebuild"],
    ["rebuild", "one", "two"],
    ["resume"],
    ["resume", "demo", "--unknown"],
    ["resume", "demo", "--teardown", "extra"],
    ["list", "extra"],
    ["forget"],
    ["forget", "one", "two"],
    ["help", "extra"],
  ]) {
    const parsed = parseWorldArgs(argv);
    assert.equal(parsed.kind, "help");
    assert.ok(parsed.kind === "help" && parsed.error);
  }
  assert.deepEqual(parseWorldArgs(["down", "demo"]), {
    kind: "help",
    error: 'Unknown command "down"; use `world resume <name> --teardown` to stop a detached world.',
  });
});

test("main starts, describes, and tears down a world", async () => {
  const lines: string[] = [];
  let disposed = false;
  const exitCode = await main(["up", "support-org", "--name", "demo"], {
    print: (line) => lines.push(line),
    startWorld: async (definition, options) => ({
      name: options?.name ?? "generated",
      topology: "topology" in definition ? definition.topology : definition,
      den: { ref: { webUrl: "http://den-web.test", apiUrl: "http://den-api.test" } },
      apps: {
        alice: { handle: { cdpUrl: "http://cdp.test" } },
      },
      snapshotPath: DEMO_SNAPSHOT_PATH,
      async [Symbol.asyncDispose]() {
        disposed = true;
      },
    }),
    onExit: async () => {},
  });

  assert.equal(exitCode, 0);
  assert.equal(disposed, true);
  assert.ok(lines.includes('World "demo" is up (preset support-org, local).'));
  assert.ok(lines.includes("den web  http://den-web.test"));
  assert.ok(lines.includes("den api  http://den-api.test"));
  assert.ok(lines.includes("app alice  CDP http://cdp.test (signed in to acme as admin)"));
  assert.ok(lines.includes("snapshot  evals/results/.worlds/demo.json"));
  assert.equal(lines.at(-1), 'World "demo" torn down.');
});

test("main lists valid snapshots from an injected directory", async () => {
  const lines: string[] = [];
  const snapshot = buildSnapshot({
    name: "support-demo",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "daytona",
    topology: supportOrg.topology,
    resolved: {
      den: { apiUrl: "http://api.test", webUrl: "http://web.test", origin: "launched" },
      apps: {},
    },
  });
  const exitCode = await main(["list"], {
    print: (line) => lines.push(line),
    readDir: async () => ["support-demo.json", "notes.txt"],
    readFile: async () => JSON.stringify(snapshot),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(lines, [
    "support-demo  2026-08-22T12:00:00.000Z  daytona  orgs acme,globex  apps alice,bob",
  ]);
});

test("main lists attached snapshots without consuming their attach behavior", async () => {
  const lines: string[] = [];
  const snapshot = buildSnapshot({
    name: "attached-demo",
    createdAt: "2026-08-23T12:00:00.000Z",
    place: "local",
    topology: {
      den: {
        attach: { apiUrl: "https://den.example.test", tier: "staging" },
        orgs: {
          acme: { admin: { secretRef: "OPENWORK_EVAL_SECRET_LIST_ADMIN" } },
        },
      },
    },
    resolved: {
      den: {
        apiUrl: "https://den.example.test",
        webUrl: "https://den.example.test",
        origin: "attached",
      },
      apps: {},
    },
  });
  const exitCode = await main(["list"], {
    print: (line) => lines.push(line),
    readDir: async () => ["attached-demo.json"],
    readFile: async () => JSON.stringify(snapshot),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(lines, [
    "attached-demo  2026-08-23T12:00:00.000Z  local  orgs acme  apps (none)",
  ]);
});

test("main reports a missing snapshot when forgetting a world", async () => {
  const lines: string[] = [];
  const exitCode = await main(["forget", "missing"], {
    print: (line) => lines.push(line),
    deleteFile: async () => {
      const error = new Error("missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(lines, ["Snapshot evals/results/.worlds/missing.json does not exist."]);
});

test("main forgets a snapshot without pretending to stop a daemon", async () => {
  const lines: string[] = [];
  const removed: string[] = [];
  const exitCode = await main(["forget", "demo"], {
    print: (line) => lines.push(line),
    deleteFile: async (path) => { removed.push(path); },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(removed, [DEMO_SNAPSHOT_PATH]);
  assert.deepEqual(lines, [
    "Removed snapshot evals/results/.worlds/demo.json. This only removes snapshot metadata; it does not stop detached services.",
  ]);
});
