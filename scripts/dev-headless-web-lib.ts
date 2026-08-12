import path from "node:path";

export type HeadlessServerConfig = {
  authorizedRoots: string[];
};

export type HeadlessRuntimePids = {
  launcher: number;
  web: number | null;
  openworkServer: number | null;
};

export type HeadlessRuntimeManifest = {
  mode: "local-server";
  webUrl: string;
  openworkUrl: string;
  healthUrl: string;
  workspace: string;
  token: string;
  hostToken: string;
  serverConfigPath: string;
  runtimeManifestPath: string;
  webLogPath: string;
  headlessLogPath: string;
  denTarget: string | null;
  denApiUrl: string | null;
  notes: string;
  startedAt: string;
  pid: number;
  pids: HeadlessRuntimePids;
};

/** Args forwarded to the detached re-spawn of the launcher itself. */
export function buildDetachedRespawnArgs(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--detach");
}

/** Normalizes a Den control-plane target to a bare origin. */
export function normalizeDenTarget(value: string | undefined): string {
  const raw = (value ?? "https://app.openworklabs.com").trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProtocol).origin;
}

/**
 * Matches only processes this launcher may have spawned, so stale-manifest
 * cleanup can never kill an unrelated process that reused a pid.
 */
export function isHeadlessStackCommand(command: string): boolean {
  return (
    command.includes("dev-headless-web") ||
    command.includes("openwork-server") ||
    command.includes("vite")
  );
}

export function resolveHeadlessServerConfigPath(
  cwd: string,
  override?: string | null,
): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  }
  return path.join(cwd, "tmp", "headless-server.json");
}

export function resolveHeadlessRuntimeManifestPath(cwd: string): string {
  return path.join(cwd, "tmp", "dev-headless-web.json");
}

export function buildHeadlessServerConfig(workspace: string): HeadlessServerConfig {
  return {
    authorizedRoots: [path.resolve(workspace)],
  };
}

export function buildOpenworkServerArgs(input: {
  workspace: string;
  host: string;
  port: number;
  token: string;
  hostToken: string;
  configPath: string;
}): string[] {
  return [
    "--config",
    input.configPath,
    "--workspace",
    input.workspace,
    "--host",
    input.host,
    "--port",
    String(input.port),
    "--token",
    input.token,
    "--host-token",
    input.hostToken,
    "--approval",
    "auto",
    "--cors",
    "*",
    "--verbose",
  ];
}

export function buildHeadlessRuntimeManifest(input: {
  webUrl: string;
  openworkUrl: string;
  workspace: string;
  token: string;
  hostToken: string;
  serverConfigPath: string;
  runtimeManifestPath: string;
  webLogPath: string;
  headlessLogPath: string;
  denTarget?: string | null;
  pid?: number;
  webPid?: number | null;
  openworkServerPid?: number | null;
  startedAt?: string;
}): HeadlessRuntimeManifest {
  const denTarget = input.denTarget ?? null;
  const launcherPid = input.pid ?? process.pid;
  return {
    mode: "local-server",
    webUrl: input.webUrl,
    openworkUrl: input.openworkUrl,
    healthUrl: `${input.openworkUrl.replace(/\/+$/, "")}/health`,
    workspace: path.resolve(input.workspace),
    token: input.token,
    hostToken: input.hostToken,
    serverConfigPath: input.serverConfigPath,
    runtimeManifestPath: input.runtimeManifestPath,
    webLogPath: input.webLogPath,
    headlessLogPath: input.headlessLogPath,
    denTarget,
    denApiUrl: denTarget ? `${input.webUrl.replace(/\/+$/, "")}/api/den` : null,
    notes:
      "Local openwork-server session. Workspace auth uses token/hostToken. The web UI runs gateway-style: Den/Cloud calls go same-origin through denApiUrl (Vite proxies them to denTarget), so stale localStorage base URLs are ignored. Sign-in uses the Den web flow in the browser.",
    startedAt: input.startedAt ?? new Date().toISOString(),
    pid: launcherPid,
    pids: {
      launcher: launcherPid,
      web: input.webPid ?? null,
      openworkServer: input.openworkServerPid ?? null,
    },
  };
}
