import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import { manifestPath, readEnvManifest } from "./env-manifest.ts";
import { main, parseArgs } from "./owt-cli.ts";
import type { Host, SurfaceHandle } from "./hosts/types.ts";

function fakeSurface(name: string, kind: "electron" | "chrome"): SurfaceHandle {
  const handle: SurfaceHandle = {
    name,
    kind,
    hostKind: "local",
    cdpUrl: `http://127.0.0.1/${kind}/${name}`,
    pid: 987654321,
    profileDir: `/tmp/openwork-fake-${name}`,
  };
  if (kind === "electron") handle.meta = { log: `/tmp/openwork-fake-${name}/electron.log` };
  return handle;
}

test("owt arg parsing handles subcommands and rejects unknown input", () => {
  assert.deepEqual(parseArgs([
    "up",
    "--name",
    "dev",
    "--org-mode",
    "multi_org",
    "--seed",
    "none",
    "--electron",
    "app-a,app-b",
    "--chrome",
    "web",
    "--den-base-url",
    "http://web.test",
    "--den-api-base-url",
    "http://api.test",
  ]), {
    command: "up",
    name: "dev",
    den: true,
    orgMode: "multi_org",
    seed: "none",
    electrons: ["app-a", "app-b"],
    chromes: ["web"],
    denBaseUrl: "http://web.test",
    denApiBaseUrl: "http://api.test",
  });
  assert.deepEqual(parseArgs(["share", "--name", "dev"]), { command: "share", name: "dev" });
  assert.deepEqual(parseArgs(["down", "--name", "dev", "--stack"]), { command: "down", name: "dev", stack: true });
  assert.deepEqual(parseArgs(["run", "--name", "dev", "--flow", "x"]), { command: "run", name: "dev", rest: ["--flow", "x"] });
  assert.deepEqual(parseArgs(["proof", "--flow", "x"]), { command: "proof", name: "default", rest: ["--flow", "x"] });
  assert.throws(() => parseArgs(["wat"]), /Unknown owt command/);
  assert.throws(() => parseArgs(["up", "--wat"]), /Unknown up argument/);
});

test("owt delegates run/proof to the eval CLI with the selected env", async () => {
  const delegated: string[][] = [];
  await main(["run", "--name", "dev", "--flow", "alpha"], {
    evalMain: async (argv) => {
      delegated.push(argv);
    },
    print: () => undefined,
  });
  await main(["proof", "--flow", "beta"], {
    evalMain: async (argv) => {
      delegated.push(argv);
    },
    print: () => undefined,
  });

  assert.deepEqual(delegated, [
    ["--mode", "automation", "--env", "dev", "--flow", "alpha"],
    ["--mode", "demo", "--env", "default", "--flow", "beta"],
  ]);
});

test("owt manifest lifecycle writes fake surfaces, shares links, and tolerates ESRCH on down", async () => {
  const name = `owt-test-${Date.now()}`;
  const printed: string[] = [];
  const bootstraps: string[] = [];
  const previousToken = process.env.OPENWORK_EVAL_DEN_TOKEN;
  delete process.env.OPENWORK_EVAL_DEN_TOKEN;
  const host: Host = {
    kind: "fake-local",
    async spawnElectron(surfaceName, opts) {
      bootstraps.push(opts?.bootstrap?.baseUrl ?? "none");
      return fakeSurface(surfaceName, "electron");
    },
    async spawnChrome(surfaceName) {
      return fakeSurface(surfaceName, "chrome");
    },
    async startDen() {
      return { webUrl: "http://den-web.test", apiUrl: "http://den-api.test", orgMode: "multi_org", hostKind: "local" };
    },
    async disposeSurface() {
      return undefined;
    },
  };

  try {
    await main(["up", "--name", name, "--den", "--electron", "desk", "--chrome", "web"], {
      createHost: () => host,
      now: () => new Date("2026-07-28T00:00:00.000Z"),
      print: (line) => printed.push(line),
    });

    const manifest = await readEnvManifest(name);
    assert(manifest);
    assert.equal(manifest.name, name);
    assert.equal(manifest.createdAt, "2026-07-28T00:00:00.000Z");
    assert.equal(manifest.den?.webUrl, "http://den-web.test");
    assert.equal(manifest.surfaces.desk?.kind, "electron");
    assert.equal(manifest.surfaces.web?.kind, "chrome");
    assert.deepEqual(bootstraps, ["http://den-web.test"]);
    assert(printed.some((line) => line.includes("phase den:")));
    assert(printed.some((line) => line.includes("electron desk CDP: http://127.0.0.1/electron/desk")));

    printed.length = 0;
    await main(["share", "--name", name], { print: (line) => printed.push(line) });
    assert(printed.some((line) => line === "Den Web: http://den-web.test"));
    assert(printed.some((line) => line === "electron desk log: /tmp/openwork-fake-desk/electron.log"));

    printed.length = 0;
    await main(["down", "--name", name], { print: (line) => printed.push(line) });
    assert(printed.some((line) => line.includes("pid 987654321 was not running")));
    assert.equal(await readEnvManifest(name), null);
  } finally {
    if (previousToken === undefined) delete process.env.OPENWORK_EVAL_DEN_TOKEN;
    else process.env.OPENWORK_EVAL_DEN_TOKEN = previousToken;
    await rm(manifestPath(name), { force: true });
  }
});
