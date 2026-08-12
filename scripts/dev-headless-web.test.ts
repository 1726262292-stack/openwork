import path from "node:path";
import { describe, expect, test } from "bun:test";

import {
  buildDetachedRespawnArgs,
  buildHeadlessRuntimeManifest,
  buildHeadlessServerConfig,
  buildOpenworkServerArgs,
  isHeadlessStackCommand,
  normalizeDenTarget,
  resolveHeadlessRuntimeManifestPath,
  resolveHeadlessServerConfigPath,
} from "./dev-headless-web-lib";

describe("dev-headless-web helpers", () => {
  test("isolates server config under tmp by default", () => {
    const cwd = "/repo/openwork";
    expect(resolveHeadlessServerConfigPath(cwd)).toBe(
      path.join(cwd, "tmp", "headless-server.json"),
    );
    expect(resolveHeadlessRuntimeManifestPath(cwd)).toBe(
      path.join(cwd, "tmp", "dev-headless-web.json"),
    );
    expect(
      resolveHeadlessServerConfigPath(cwd, "tmp/custom-server.json"),
    ).toBe(path.join(cwd, "tmp", "custom-server.json"));
  });

  test("authorizes the absolute workspace root in the isolated config", () => {
    expect(buildHeadlessServerConfig("/Users/me/project")).toEqual({
      authorizedRoots: ["/Users/me/project"],
    });
  });

  test("passes --config before workspace args so ~/.config is never used", () => {
    const args = buildOpenworkServerArgs({
      workspace: "/Users/me/project",
      host: "127.0.0.1",
      port: 8787,
      token: "client-token",
      hostToken: "host-token",
      configPath: "/repo/tmp/headless-server.json",
    });
    expect(args.slice(0, 4)).toEqual([
      "--config",
      "/repo/tmp/headless-server.json",
      "--workspace",
      "/Users/me/project",
    ]);
    expect(args).toContain("--token");
    expect(args).toContain("client-token");
  });

  test("runtime manifest carries agent-facing local-server fields", () => {
    const manifest = buildHeadlessRuntimeManifest({
      webUrl: "http://127.0.0.1:5178",
      openworkUrl: "http://127.0.0.1:8778",
      workspace: "/Users/me/project",
      token: "client-token",
      hostToken: "host-token",
      serverConfigPath: "/repo/tmp/headless-server.json",
      runtimeManifestPath: "/repo/tmp/dev-headless-web.json",
      webLogPath: "/repo/tmp/dev-web.log",
      headlessLogPath: "/repo/tmp/dev-headless.log",
      denTarget: "https://app.openworklabs.com",
      pid: 42,
      webPid: 43,
      openworkServerPid: 44,
      startedAt: "2026-08-12T00:00:00.000Z",
    });

    expect(manifest.mode).toBe("local-server");
    expect(manifest.healthUrl).toBe("http://127.0.0.1:8778/health");
    expect(manifest.denTarget).toBe("https://app.openworklabs.com");
    expect(manifest.denApiUrl).toBe("http://127.0.0.1:5178/api/den");
    expect(manifest.token).toBe("client-token");
    expect(manifest.notes).toContain("same-origin");
    expect(manifest.pid).toBe(42);
    expect(manifest.pids).toEqual({ launcher: 42, web: 43, openworkServer: 44 });
  });

  test("manifest omits Den fields when the Den wiring is disabled", () => {
    const manifest = buildHeadlessRuntimeManifest({
      webUrl: "http://127.0.0.1:5178",
      openworkUrl: "http://127.0.0.1:8778",
      workspace: "/Users/me/project",
      token: "t",
      hostToken: "h",
      serverConfigPath: "/repo/tmp/headless-server.json",
      runtimeManifestPath: "/repo/tmp/dev-headless-web.json",
      webLogPath: "/repo/tmp/dev-web.log",
      headlessLogPath: "/repo/tmp/dev-headless.log",
      denTarget: null,
    });
    expect(manifest.denTarget).toBeNull();
    expect(manifest.denApiUrl).toBeNull();
  });

  test("normalizes Den targets to origins", () => {
    expect(normalizeDenTarget("https://app.openworklabs.com/api/den")).toBe(
      "https://app.openworklabs.com",
    );
    expect(normalizeDenTarget("http://127.0.0.1:3005")).toBe(
      "http://127.0.0.1:3005",
    );
    expect(normalizeDenTarget(undefined)).toBe("https://app.openworklabs.com");
  });

  test("detached respawn forwards args except --detach", () => {
    expect(buildDetachedRespawnArgs(["--detach", "--replace", "--silent"])).toEqual([
      "--replace",
      "--silent",
    ]);
    expect(buildDetachedRespawnArgs(["--detach"])).toEqual([]);
  });

  test("stale-pid cleanup only targets processes from this stack", () => {
    expect(isHeadlessStackCommand("bun scripts/dev-headless-web.ts")).toBe(true);
    expect(
      isHeadlessStackCommand("/repo/apps/server/dist/bin/openwork-server --config tmp/headless-server.json"),
    ).toBe(true);
    expect(isHeadlessStackCommand("node vite --host 127.0.0.1 --port 5178")).toBe(true);
    expect(isHeadlessStackCommand("/usr/bin/some-unrelated-daemon")).toBe(false);
    expect(isHeadlessStackCommand("ssh user@host")).toBe(false);
  });
});
