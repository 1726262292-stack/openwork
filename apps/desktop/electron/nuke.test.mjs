import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildNukeManifest,
  runPendingNukeCleanup,
  sanitizeDesktopBootstrapConfig,
  sanitizeDesktopBootstrapFiles,
} from "./nuke.mjs";

async function exists(targetPath) {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function withTempDir(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "openwork-nuke-test-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function pendingNukeInput(root) {
  return {
    env: { XDG_CONFIG_HOME: path.join(root, "xdg") },
    homedir: path.join(root, "home"),
    platform: "darwin",
    userDataPath: path.join(root, "userData"),
  };
}

function pendingNukePath(root) {
  return path.join(root, "xdg", "openwork", ".nuke-pending.json");
}

async function writePendingNuke(root, pending) {
  const pendingPath = pendingNukePath(root);
  await mkdir(path.dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, "utf8");
  return pendingPath;
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, "utf8"));
}

test("buildNukeManifest includes default macOS state roots and preserves bootstrap", () => {
  const home = "/Users/alice";
  const userDataPath = "/Users/alice/Library/Application Support/com.differentai.openwork";
  const manifest = buildNukeManifest({ env: {}, homedir: home, platform: "darwin", userDataPath });

  assert.equal(manifest.preserveBootstrapPath, "/Users/alice/.config/openwork/desktop-bootstrap.json");
  assert.deepEqual(manifest.partitions, ["default", "persist:openwork-browser"]);
  assert.ok(manifest.deletePaths.includes(userDataPath));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/server.json"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/runtime.sqlite"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/runtime.sqlite-wal"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/runtime.sqlite-shm"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/runtime-opencode-config.json"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/tokens.json"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/openwork/env.json"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.local/share/opencode"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/Library/Application Support/opencode"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.config/opencode"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.cache/opencode"));
  assert.ok(manifest.deletePaths.includes("/Users/alice/.openwork/openwork-orchestrator"));
  assert.ok(!manifest.deletePaths.includes("/Users/alice/.opencode/bin"));
  assert.ok(!manifest.deletePaths.includes("/Users/alice/project/.opencode"));
});

test("buildNukeManifest includes default Linux state roots", () => {
  const manifest = buildNukeManifest({
    env: {},
    homedir: "/home/alice",
    platform: "linux",
    userDataPath: "/home/alice/.config/com.differentai.openwork",
  });

  assert.equal(manifest.preserveBootstrapPath, "/home/alice/.config/openwork/desktop-bootstrap.json");
  assert.ok(manifest.deletePaths.includes("/home/alice/.config/com.differentai.openwork"));
  assert.ok(manifest.deletePaths.includes("/home/alice/.local/share/opencode"));
  assert.ok(manifest.deletePaths.includes("/home/alice/.config/opencode"));
  assert.ok(manifest.deletePaths.includes("/home/alice/.cache/opencode"));
  assert.ok(!manifest.deletePaths.some((targetPath) => targetPath.includes("Library/Application Support/opencode")));
});

test("buildNukeManifest includes Windows path shapes", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
    APPDATA: "C:\\Users\\Alice\\AppData\\Roaming",
  };
  const manifest = buildNukeManifest({
    env,
    homedir: "C:\\Users\\Alice",
    platform: "win32",
    userDataPath: "C:\\Users\\Alice\\AppData\\Roaming\\com.differentai.openwork",
  });

  assert.equal(manifest.preserveBootstrapPath, "C:\\Users\\Alice\\AppData\\Local\\openwork\\desktop-bootstrap.json");
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\com.differentai.openwork"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\openwork\\server.json"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\openwork\\runtime.sqlite"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\openwork\\tokens.json"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\openwork\\env.json"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\opencode"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\AppData\\Roaming\\opencode"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\.cache\\opencode"));
  assert.ok(manifest.deletePaths.includes("C:\\Users\\Alice\\.config\\openwork\\desktop-bootstrap.json"));
});

test("buildNukeManifest honors OPENWORK_ELECTRON_USERDATA override", () => {
  const manifest = buildNukeManifest({
    env: { OPENWORK_ELECTRON_USERDATA: "/tmp/openwork-userdata" },
    homedir: "/Users/alice",
    platform: "darwin",
    userDataPath: "/Users/alice/Library/Application Support/com.differentai.openwork",
  });

  assert.ok(manifest.deletePaths.includes("/tmp/openwork-userdata"));
  assert.ok(!manifest.deletePaths.includes("/Users/alice/Library/Application Support/com.differentai.openwork"));
});

test("buildNukeManifest redirects HOME/XDG paths in dev mode", () => {
  const manifest = buildNukeManifest({
    env: { OPENWORK_DEV_MODE: "1" },
    homedir: "/Users/alice",
    platform: "darwin",
    userDataPath: "/tmp/openwork-dev-userdata",
  });

  assert.equal(
    manifest.preserveBootstrapPath,
    "/tmp/openwork-dev-userdata/openwork-dev-data/home/.config/openwork/desktop-bootstrap.json",
  );
  assert.ok(manifest.deletePaths.includes("/tmp/openwork-dev-userdata"));
  assert.ok(manifest.deletePaths.includes("/tmp/openwork-dev-userdata/openwork-dev-data/xdg/data/opencode"));
  assert.ok(manifest.deletePaths.includes("/tmp/openwork-dev-userdata/openwork-dev-data/config/opencode"));
  assert.ok(manifest.deletePaths.includes("/tmp/openwork-dev-userdata/openwork-dev-data/xdg/cache/opencode"));
  assert.ok(!manifest.deletePaths.some((targetPath) => targetPath.startsWith("/Users/alice/")));
});

test("buildNukeManifest excludes paths that would remove ~/.opencode/bin", () => {
  const manifest = buildNukeManifest({
    env: { OPENCODE_CONFIG_DIR: "/Users/alice/.opencode" },
    homedir: "/Users/alice",
    platform: "darwin",
    userDataPath: "/tmp/openwork-userdata",
  });

  assert.ok(!manifest.deletePaths.includes("/Users/alice/.opencode"));
  assert.ok(!manifest.deletePaths.includes("/Users/alice/.opencode/bin"));
});

test("sanitizeDesktopBootstrapConfig strips secrets and keeps deployment fields", () => {
  const writtenAt = "2026-07-20T00:00:00.000Z";
  const sanitized = sanitizeDesktopBootstrapConfig({
    baseUrl: " https://den.example.com ",
    apiBaseUrl: " https://api.den.example.com ",
    requireSignin: true,
    brandAppName: " Acme OpenWork ",
    brandLogoUrl: " https://cdn.example.com/logo.png ",
    brandIconUrl: " https://cdn.example.com/icon.png ",
    handoff: { grant: "secret", denBaseUrl: "https://den.example.com" },
    claimLinks: [{ id: "claim", role: "admin", token: "secret", url: "https://den.example.com", expiresAt: writtenAt }],
    prepared: { skillPath: "/tmp/skill" },
  }, writtenAt);

  assert.deepEqual(sanitized, {
    baseUrl: "https://den.example.com",
    apiBaseUrl: "https://api.den.example.com",
    requireSignin: true,
    brandAppName: "Acme OpenWork",
    brandLogoUrl: "https://cdn.example.com/logo.png",
    brandIconUrl: "https://cdn.example.com/icon.png",
    writtenAt,
  });
});

test("sanitizeDesktopBootstrapFiles strips a BOM-wrapped valid canonical bootstrap", async () => {
  await withTempDir(async (root) => {
    const canonicalPath = path.join(root, "desktop-bootstrap.json");
    await writeFile(canonicalPath, `\ufeff${JSON.stringify({
      baseUrl: "https://den.example.com",
      requireSignin: true,
      handoff: { grant: "secret-grant" },
      claimLinks: [{ token: "secret-token" }],
      prepared: { skillPath: "/tmp/skill" },
    })}`, "utf8");

    assert.equal(await sanitizeDesktopBootstrapFiles({ canonicalPath, legacyPath: null }), true);
    const raw = await readFile(canonicalPath, "utf8");
    const parsed = JSON.parse(raw);

    assert.notEqual(raw.charCodeAt(0), 0xfeff);
    assert.equal(parsed.baseUrl, "https://den.example.com");
    assert.equal(parsed.requireSignin, true);
    assert.equal(parsed.handoff, undefined);
    assert.equal(parsed.claimLinks, undefined);
    assert.equal(parsed.prepared, undefined);
  });
});

test("sanitizeDesktopBootstrapFiles deletes truly malformed bootstrap files", async () => {
  await withTempDir(async (root) => {
    const canonicalPath = path.join(root, "desktop-bootstrap.json");
    await writeFile(canonicalPath, "{not-json secret-grant secret-token", "utf8");

    assert.equal(await sanitizeDesktopBootstrapFiles({ canonicalPath, legacyPath: null }), false);
    assert.equal(await exists(canonicalPath), false);
  });
});

test("sanitizeDesktopBootstrapFiles falls back from invalid canonical to valid legacy", async () => {
  await withTempDir(async (root) => {
    const canonicalPath = path.join(root, "canonical", "desktop-bootstrap.json");
    const legacyPath = path.join(root, "legacy", "desktop-bootstrap.json");
    await mkdir(path.dirname(canonicalPath), { recursive: true });
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(canonicalPath, "{not-json secret-grant", "utf8");
    await writeFile(legacyPath, JSON.stringify({
      baseUrl: "https://legacy.example.com",
      requireSignin: true,
      brandAppName: "Legacy Org",
      handoff: { grant: "legacy-secret-grant" },
      claimLinks: [{ token: "legacy-secret-token" }],
    }), "utf8");

    assert.equal(await sanitizeDesktopBootstrapFiles({ canonicalPath, legacyPath }), true);
    const raw = await readFile(canonicalPath, "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.baseUrl, "https://legacy.example.com");
    assert.equal(parsed.brandAppName, "Legacy Org");
    assert.equal(parsed.handoff, undefined);
    assert.equal(parsed.claimLinks, undefined);
    assert.equal(raw.includes("legacy-secret"), false);
    assert.equal(await exists(legacyPath), false);
  });
});

test("runPendingNukeCleanup removes the sentinel after all pending paths are gone", async () => {
  await withTempDir(async (root) => {
    const targetPath = path.join(root, "locked-runtime.sqlite");
    await writeFile(targetPath, "delete me", "utf8");
    const pendingPath = await writePendingNuke(root, {
      paths: [targetPath],
      createdAt: "2026-07-20T00:00:00.000Z",
    });

    const result = await runPendingNukeCleanup(pendingNukeInput(root));

    assert.equal(result.ran, true);
    assert.deepEqual(result.pendingRetry, []);
    assert.deepEqual(result.errors, []);
    assert.ok(result.deleted.includes(targetPath));
    assert.equal(await exists(targetPath), false);
    assert.equal(await exists(pendingPath), false);
  });
});

test("runPendingNukeCleanup rewrites only failed paths and removes them on the next boot", async () => {
  await withTempDir(async (root) => {
    const okPath = path.join(root, "ok-runtime.sqlite");
    const failedPath = path.join(root, "locked-runtime.sqlite");
    await writeFile(okPath, "delete me", "utf8");
    await writeFile(failedPath, "locked", "utf8");
    const createdAt = "2026-07-20T00:00:00.000Z";
    const attemptedAt = "2026-07-21T00:00:00.000Z";
    const pendingPath = await writePendingNuke(root, { paths: [okPath, failedPath], createdAt });

    const firstResult = await runPendingNukeCleanup(pendingNukeInput(root), {
      nowIso: attemptedAt,
      removePathWithRetry: async (targetPath) => {
        if (targetPath === failedPath) return new Error("simulated lock");
        await rm(targetPath, { recursive: true, force: true });
        return null;
      },
    });
    const rewritten = await readJson(pendingPath);

    assert.equal(firstResult.ran, true);
    assert.deepEqual(firstResult.pendingRetry, [failedPath]);
    assert.ok(firstResult.deleted.includes(okPath));
    assert.equal(firstResult.errors.length, 1);
    assert.equal(firstResult.errors[0].path, failedPath);
    assert.equal(await exists(okPath), false);
    assert.equal(await exists(failedPath), true);
    assert.deepEqual(rewritten.paths, [failedPath]);
    assert.equal(rewritten.createdAt, createdAt);
    assert.equal(rewritten.attemptedAt, attemptedAt);

    const secondResult = await runPendingNukeCleanup(pendingNukeInput(root));

    assert.equal(secondResult.ran, true);
    assert.deepEqual(secondResult.pendingRetry, []);
    assert.deepEqual(secondResult.errors, []);
    assert.ok(secondResult.deleted.includes(failedPath));
    assert.equal(await exists(failedPath), false);
    assert.equal(await exists(pendingPath), false);
  });
});

test("runPendingNukeCleanup removes invalid or empty sentinels without looping", async () => {
  await withTempDir(async (root) => {
    const invalidPendingPath = pendingNukePath(root);
    await mkdir(path.dirname(invalidPendingPath), { recursive: true });
    await writeFile(invalidPendingPath, "{not-json", "utf8");

    const invalidResult = await runPendingNukeCleanup(pendingNukeInput(root));

    assert.equal(invalidResult.ran, false);
    assert.equal(invalidResult.invalid, true);
    assert.equal(await exists(invalidPendingPath), false);

    const emptyPendingPath = await writePendingNuke(root, { paths: [] });
    const emptyResult = await runPendingNukeCleanup(pendingNukeInput(root));

    assert.equal(emptyResult.ran, false);
    assert.equal(emptyResult.invalid, false);
    assert.equal(await exists(emptyPendingPath), false);
  });
});
