import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNukeManifest,
  sanitizeDesktopBootstrapConfig,
} from "./nuke.mjs";

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
