#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { homedir, hostname, networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { once } from "node:events";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { startOpenwrkTui, type TuiHandle } from "./tui/app.js";

type ApprovalMode = "manual" | "auto";

type LogFormat = "pretty" | "json";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogAttributes = Record<string, unknown>;

type LoggerChild = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
  debug: (message: string, attributes?: LogAttributes) => void;
  info: (message: string, attributes?: LogAttributes) => void;
  warn: (message: string, attributes?: LogAttributes) => void;
  error: (message: string, attributes?: LogAttributes) => void;
};

type Logger = {
  format: LogFormat;
  output: "stdout" | "silent";
  log: (level: LogLevel, message: string, attributes?: LogAttributes, component?: string) => void;
  debug: (message: string, attributes?: LogAttributes, component?: string) => void;
  info: (message: string, attributes?: LogAttributes, component?: string) => void;
  warn: (message: string, attributes?: LogAttributes, component?: string) => void;
  error: (message: string, attributes?: LogAttributes, component?: string) => void;
  child: (component: string, attributes?: LogAttributes) => LoggerChild;
};

type LogEvent = {
  time: number;
  level: LogLevel;
  message: string;
  component?: string;
  attributes?: LogAttributes;
};

type OwpenbotHealthSnapshot = {
  ok: boolean;
  opencode: {
    url: string;
    healthy: boolean;
    version?: string;
  };
  channels: {
    telegram: boolean;
    whatsapp: boolean;
  };
  config: {
    groupsEnabled: boolean;
  };
};

const FALLBACK_VERSION = "0.1.0";
const DEFAULT_OPENWORK_PORT = 8787;
const DEFAULT_OWPENBOT_HEALTH_PORT = 3005;
const DEFAULT_APPROVAL_TIMEOUT = 30000;
const DEFAULT_OPENCODE_USERNAME = "opencode";

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | boolean>;
};

type ChildHandle = {
  name: string;
  child: ReturnType<typeof spawn>;
};

type VersionInfo = {
  version: string;
  sha256: string;
};

type SidecarName = "openwork-server" | "owpenbot" | "opencode";

type SidecarTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "windows-x64"
  | "windows-arm64";

type VersionManifest = {
  dir: string;
  entries: Record<string, VersionInfo>;
};

type RemoteSidecarAsset = {
  asset?: string;
  url?: string;
  sha256?: string;
  size?: number;
};

type RemoteSidecarEntry = {
  version: string;
  targets: Record<string, RemoteSidecarAsset>;
};

type RemoteSidecarManifest = {
  version: string;
  generatedAt?: string;
  entries: Record<string, RemoteSidecarEntry>;
};

type SidecarConfig = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
};

type BinarySource = "bundled" | "external" | "downloaded";

type BinarySourcePreference = "auto" | "bundled" | "downloaded" | "external";

type ResolvedBinary = {
  bin: string;
  source: BinarySource;
  expectedVersion?: string;
};

type BinaryDiagnostics = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

type SidecarDiagnostics = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

type RouterWorkspaceType = "local" | "remote";

type RouterWorkspace = {
  id: string;
  name: string;
  path: string;
  workspaceType: RouterWorkspaceType;
  baseUrl?: string;
  directory?: string;
  createdAt: number;
  lastUsedAt?: number;
};

type RouterDaemonState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

type RouterOpencodeState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

type RouterBinaryInfo = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

type RouterBinaryState = {
  opencode?: RouterBinaryInfo;
};

type RouterSidecarState = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

type RouterState = {
  version: number;
  daemon?: RouterDaemonState;
  opencode?: RouterOpencodeState;
  cliVersion?: string;
  sidecar?: RouterSidecarState;
  binaries?: RouterBinaryState;
  activeId: string;
  workspaces: RouterWorkspace[];
};

type FieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-v") {
      flags.set("version", true);
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    if (!trimmed) continue;

    if (trimmed.startsWith("no-")) {
      flags.set(trimmed.slice(3), false);
      continue;
    }

    const [key, inlineValue] = trimmed.split("=");
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { positionals, flags };
}

function parseList(value?: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

function readBool(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: boolean,
  envKey?: string,
): boolean {
  const raw = flags.get(key);
  if (raw !== undefined) {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  const envValue = envKey ? process.env[envKey] : undefined;
  if (envValue) {
    const normalized = envValue.toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  return fallback;
}

function readNumber(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: number | undefined,
  envKey?: string,
): number | undefined {
  const raw = flags.get(key);
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (envKey) {
    const envValue = process.env[envKey];
    if (envValue) {
      const parsed = Number(envValue);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return fallback;
}

function readBinarySource(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: BinarySourcePreference,
  envKey?: string,
): BinarySourcePreference {
  const raw = readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "auto" || normalized === "bundled" || normalized === "downloaded" || normalized === "external") {
    return normalized as BinarySourcePreference;
  }
  throw new Error(`Invalid ${key} value: ${raw}. Use auto|bundled|downloaded|external.`);
}

function readLogFormat(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: LogFormat,
  envKey?: string,
): LogFormat {
  const raw = readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "json") return "json";
  if (normalized === "pretty" || normalized === "text" || normalized === "human") return "pretty";
  throw new Error(`Invalid ${key} value: ${raw}. Use pretty|json.`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCliVersion(): Promise<string> {
  const candidates = [
    join(dirname(process.execPath), "..", "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        // ignore
      }
    }
  }

  return FALLBACK_VERSION;
}

async function readPackageField(field: string): Promise<string | undefined> {
  const candidates = [
    join(dirname(process.execPath), "..", "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const value = parsed[field];
        if (typeof value === "string" && value.trim()) return value.trim();
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureWorkspace(workspace: string): Promise<string> {
  const resolved = resolve(workspace);
  await mkdir(resolved, { recursive: true });

  const configPath = join(resolved, "opencode.json");
  if (!(await fileExists(configPath))) {
    const payload = JSON.stringify({ "$schema": "https://opencode.ai/config.json" }, null, 2);
    await writeFile(configPath, `${payload}\n`, "utf8");
  }

  return resolved;
}

async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", (err) => reject(err));
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function resolvePort(preferred: number | undefined, host: string, fallback?: number): Promise<number> {
  if (preferred && (await canBind(host, preferred))) {
    return preferred;
  }
  if (fallback && fallback !== preferred && (await canBind(host, fallback))) {
    return fallback;
  }
  return findFreePort(host);
}

function resolveLanIp(): string | null {
  const interfaces = networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key];
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      return entry.address;
    }
  }
  return null;
}

function resolveConnectUrl(port: number, overrideHost?: string): { connectUrl?: string; lanUrl?: string; mdnsUrl?: string } {
  if (overrideHost) {
    const trimmed = overrideHost.trim();
    if (trimmed) {
      const url = `http://${trimmed}:${port}`;
      return { connectUrl: url, lanUrl: url };
    }
  }

  const host = hostname().trim();
  const mdnsUrl = host ? `http://${host.replace(/\.local$/, "")}.local:${port}` : undefined;
  const lanIp = resolveLanIp();
  const lanUrl = lanIp ? `http://${lanIp}:${port}` : undefined;
  const connectUrl = lanUrl ?? mdnsUrl;
  return { connectUrl, lanUrl, mdnsUrl };
}

function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

function unwrap<T>(result: FieldsResult<T>): T {
  if (result.data !== undefined) {
    return result.data;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

function prefixStream(
  stream: NodeJS.ReadableStream | null,
  label: string,
  level: "stdout" | "stderr",
  logger: Logger,
  pid?: number,
): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (logger.output === "stdout" && logger.format === "json" && looksLikeOtelLogLine(line)) {
        process.stdout.write(`${line}\n`);
        continue;
      }
      const severity: LogLevel = level === "stderr" ? "error" : "info";
      logger.log(severity, line, { stream: level, pid }, label);
    }
  });
  stream.on("end", () => {
    if (!buffer.trim()) return;
    if (logger.output === "stdout" && logger.format === "json" && looksLikeOtelLogLine(buffer)) {
      process.stdout.write(`${buffer}\n`);
      return;
    }
    const severity: LogLevel = level === "stderr" ? "error" : "info";
    logger.log(severity, buffer, { stream: level, pid }, label);
  });
}

function shouldUseBun(bin: string): boolean {
  if (!bin.endsWith(`${join("dist", "cli.js")}`)) return false;
  if (bin.includes("openwork-server")) return true;
  return bin.includes(`${join("packages", "server")}`);
}

function resolveBinCommand(bin: string): { command: string; prefixArgs: string[] } {
  if (bin.endsWith(".ts")) {
    return { command: "bun", prefixArgs: [bin, "--"] };
  }
  if (bin.endsWith(".js")) {
    if (shouldUseBun(bin)) {
      return { command: "bun", prefixArgs: [bin, "--"] };
    }
    return { command: "node", prefixArgs: [bin, "--"] };
  }
  return { command: bin, prefixArgs: [] };
}

async function readVersionManifest(): Promise<VersionManifest | null> {
  const candidates = [dirname(process.execPath), dirname(fileURLToPath(import.meta.url))];
  for (const dir of candidates) {
    const manifestPath = join(dir, "versions.json");
    if (await fileExists(manifestPath)) {
      try {
        const payload = await readFile(manifestPath, "utf8");
        const entries = JSON.parse(payload) as Record<string, VersionInfo>;
        return { dir, entries };
      } catch {
        return { dir, entries: {} };
      }
    }
  }
  return null;
}

const remoteManifestCache = new Map<string, Promise<RemoteSidecarManifest | null>>();

function resolveSidecarTarget(): SidecarTarget | null {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "darwin-arm64";
    if (process.arch === "x64") return "darwin-x64";
    return null;
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "linux-arm64";
    if (process.arch === "x64") return "linux-x64";
    return null;
  }
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "windows-arm64";
    if (process.arch === "x64") return "windows-x64";
    return null;
  }
  return null;
}

function resolveSidecarDir(flags: Map<string, string | boolean>): string {
  const override =
    readFlag(flags, "sidecar-dir") ??
    process.env.OPENWRK_SIDECAR_DIR ??
    process.env.OPENWORK_SIDECAR_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(resolveRouterDataDir(flags), "sidecars");
}

function resolveSidecarBaseUrl(flags: Map<string, string | boolean>, cliVersion: string): string {
  const override = readFlag(flags, "sidecar-base-url") ?? process.env.OPENWRK_SIDECAR_BASE_URL;
  if (override && override.trim()) return override.trim();
  return `https://github.com/different-ai/openwork/releases/download/openwrk-v${cliVersion}`;
}

function resolveSidecarManifestUrl(flags: Map<string, string | boolean>, baseUrl: string): string {
  const override = readFlag(flags, "sidecar-manifest") ?? process.env.OPENWRK_SIDECAR_MANIFEST_URL;
  if (override && override.trim()) return override.trim();
  return `${baseUrl.replace(/\/$/, "")}/openwrk-sidecars.json`;
}

function resolveSidecarConfig(flags: Map<string, string | boolean>, cliVersion: string): SidecarConfig {
  const baseUrl = resolveSidecarBaseUrl(flags, cliVersion);
  return {
    dir: resolveSidecarDir(flags),
    baseUrl,
    manifestUrl: resolveSidecarManifestUrl(flags, baseUrl),
    target: resolveSidecarTarget(),
  };
}

async function fetchRemoteManifest(url: string): Promise<RemoteSidecarManifest | null> {
  const cached = remoteManifestCache.get(url);
  if (cached) return cached;
  const task = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as RemoteSidecarManifest;
    } catch {
      return null;
    }
  })();
  remoteManifestCache.set(url, task);
  return task;
}

function resolveAssetUrl(baseUrl: string, asset?: string, url?: string): string | null {
  if (url && url.trim()) return url.trim();
  if (asset && asset.trim()) return `${baseUrl.replace(/\/$/, "")}/${asset.trim()}`;
  return null;
}

function resolveAssetName(asset?: string, url?: string): string | null {
  if (asset && asset.trim()) return asset.trim();
  if (url && url.trim()) {
    try {
      return basename(new URL(url).pathname);
    } catch {
      const parts = url.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    }
  }
  return null;
}

async function downloadToPath(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  const tmpPath = `${dest}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, dest);
}

async function ensureExecutable(path: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await chmod(path, 0o755);
  } catch {
    // ignore
  }
}

async function downloadSidecarBinary(options: {
  name: SidecarName;
  sidecar: SidecarConfig;
}): Promise<ResolvedBinary | null> {
  if (!options.sidecar.target) return null;
  const manifest = await fetchRemoteManifest(options.sidecar.manifestUrl);
  if (!manifest) return null;
  const entry = manifest.entries[options.name];
  if (!entry) return null;
  const targetInfo = entry.targets[options.sidecar.target];
  if (!targetInfo) return null;

  const assetName = resolveAssetName(targetInfo.asset, targetInfo.url);
  const assetUrl = resolveAssetUrl(options.sidecar.baseUrl, targetInfo.asset, targetInfo.url);
  if (!assetName || !assetUrl) return null;

  const targetDir = join(options.sidecar.dir, entry.version, options.sidecar.target);
  const targetPath = join(targetDir, assetName);
  if (await fileExists(targetPath)) {
    if (targetInfo.sha256) {
      try {
        await verifyBinary(targetPath, { version: entry.version, sha256: targetInfo.sha256 });
        await ensureExecutable(targetPath);
        return { bin: targetPath, source: "downloaded", expectedVersion: entry.version };
      } catch {
        await rm(targetPath, { force: true });
      }
    } else {
      await ensureExecutable(targetPath);
      return { bin: targetPath, source: "downloaded", expectedVersion: entry.version };
    }
  }

  await downloadToPath(assetUrl, targetPath);
  if (targetInfo.sha256) {
    await verifyBinary(targetPath, { version: entry.version, sha256: targetInfo.sha256 });
  }
  await ensureExecutable(targetPath);
  return { bin: targetPath, source: "downloaded", expectedVersion: entry.version };
}

function resolveOpencodeAsset(target: SidecarTarget): string | null {
  const assets: Record<SidecarTarget, string> = {
    "darwin-arm64": "opencode-darwin-arm64.zip",
    "darwin-x64": "opencode-darwin-x64-baseline.zip",
    "linux-x64": "opencode-linux-x64-baseline.tar.gz",
    "linux-arm64": "opencode-linux-arm64.tar.gz",
    "windows-x64": "opencode-windows-x64-baseline.zip",
    "windows-arm64": "opencode-windows-arm64.zip",
  };
  return assets[target] ?? null;
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  const result = await Promise.race([
    once(child, "exit").then(([code]) => ({ type: "exit" as const, code })),
    once(child, "error").then(([error]) => ({ type: "error" as const, error })),
  ]);
  if (result.type === "error") {
    throw new Error(`Command failed: ${command} ${args.join(" ")}: ${String(result.error)}`);
  }
  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function resolveOpencodeDownload(sidecar: SidecarConfig, expectedVersion?: string): Promise<string | null> {
  if (!expectedVersion) return null;
  if (!sidecar.target) return null;

  const assetOverride = process.env.OPENWRK_OPENCODE_ASSET ?? process.env.OPENCODE_ASSET;
  const asset = assetOverride?.trim() || resolveOpencodeAsset(sidecar.target);
  if (!asset) return null;

  const version = expectedVersion.startsWith("v") ? expectedVersion.slice(1) : expectedVersion;
  const url = `https://github.com/anomalyco/opencode/releases/download/v${version}/${asset}`;
  const targetDir = join(sidecar.dir, "opencode", version, sidecar.target);
  const targetPath = join(targetDir, process.platform === "win32" ? "opencode.exe" : "opencode");

  if (await fileExists(targetPath)) {
    const actual = await readCliVersion(targetPath);
    if (actual === version) {
      await ensureExecutable(targetPath);
      return targetPath;
    }
  }

  await mkdir(targetDir, { recursive: true });
  const stamp = Date.now();
  const archivePath = join(tmpdir(), `openwrk-opencode-${stamp}-${asset}`);
  const extractDir = await mkdtemp(join(tmpdir(), "openwrk-opencode-"));

  try {
    await downloadToPath(url, archivePath);
    if (process.platform === "win32") {
      const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      const psScript = [
        "$ErrorActionPreference = 'Stop'",
        `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
      ].join("; ");
      await runCommand("powershell", ["-NoProfile", "-Command", psScript]);
    } else if (asset.endsWith(".zip")) {
      await runCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    } else if (asset.endsWith(".tar.gz")) {
      await runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    } else {
      throw new Error(`Unsupported opencode asset type: ${asset}`);
    }

    const entries = await readdir(extractDir, { withFileTypes: true });
    const queue = entries.map((entry) => join(extractDir, entry.name));
    let candidate: string | null = null;
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      const statInfo = await stat(current);
      if (statInfo.isDirectory()) {
        const nested = await readdir(current, { withFileTypes: true });
        queue.push(...nested.map((entry) => join(current, entry.name)));
        continue;
      }
      const base = basename(current);
      if (base === "opencode" || base === "opencode.exe") {
        candidate = current;
        break;
      }
    }

    if (!candidate) {
      throw new Error("OpenCode binary not found after extraction.");
    }

    await copyFile(candidate, targetPath);
    await ensureExecutable(targetPath);
    return targetPath;
  } finally {
    await rm(extractDir, { recursive: true, force: true });
    await rm(archivePath, { force: true });
  }
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function verifyBinary(path: string, expected?: VersionInfo): Promise<void> {
  if (!expected) return;
  const hash = await sha256File(path);
  if (hash !== expected.sha256) {
    throw new Error(`Integrity check failed for ${path}`);
  }
}

async function resolveBundledBinary(manifest: VersionManifest | null, name: string): Promise<string | null> {
  if (!manifest) return null;
  const candidates = [join(manifest.dir, name)];
  if (process.platform === "win32") {
    candidates.push(join(manifest.dir, `${name}.exe`));
  }
  for (const bundled of candidates) {
    if (!(await isExecutable(bundled))) continue;
    await verifyBinary(bundled, manifest.entries[name]);
    return bundled;
  }
  return null;
}

async function readPackageVersion(path: string): Promise<string | undefined> {
  try {
    const payload = await readFile(path, "utf8");
    const parsed = JSON.parse(payload) as { version?: string };
    if (typeof parsed.version === "string") return parsed.version;
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveOwpenbotRepoDir(): Promise<string | null> {
  const envPath = process.env.OWPENBOT_DIR?.trim();
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const repoRoot = resolve(root, "..", "..");
  const candidates = [envPath, resolve(repoRoot, "packages", "owpenbot")].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const pkgPath = join(candidate, "package.json");
    if (await fileExists(pkgPath)) return candidate;
  }

  return null;
}

async function resolveExpectedVersion(
  manifest: VersionManifest | null,
  name: SidecarName,
): Promise<string | undefined> {
  const manifestVersion = manifest?.entries[name]?.version;
  if (manifestVersion) return manifestVersion;

  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    if (name === "openwork-server") {
      const localPath = join(root, "..", "server", "package.json");
      const localVersion = await readPackageVersion(localPath);
      if (localVersion) return localVersion;
    }
    if (name === "owpenbot") {
      const repoDir = await resolveOwpenbotRepoDir();
      const localPath = repoDir ? join(repoDir, "package.json") : join(root, "..", "owpenbot", "package.json");
      const localVersion = await readPackageVersion(localPath);
      if (localVersion) return localVersion;
    }
    if (name === "opencode") {
      const envVersion = process.env.OPENCODE_VERSION?.trim();
      if (envVersion) return envVersion.startsWith("v") ? envVersion.slice(1) : envVersion;
      const pkgVersion = await readPackageField("opencodeVersion");
      if (pkgVersion) return pkgVersion.startsWith("v") ? pkgVersion.slice(1) : pkgVersion;
    }
  } catch {
    // ignore
  }

  const require = createRequire(import.meta.url);
  if (name === "openwork-server") {
    try {
      const pkgPath = require.resolve("openwork-server/package.json");
      const version = await readPackageVersion(pkgPath);
      if (version) return version;
    } catch {
      // ignore
    }
  }
  if (name === "owpenbot") {
    try {
      const pkgPath = require.resolve("owpenwork/package.json");
      const version = await readPackageVersion(pkgPath);
      if (version) return version;
    } catch {
      // ignore
    }
  }

  return undefined;
}

function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/);
  return match?.[0];
}

async function readCliVersion(bin: string, timeoutMs = 4000): Promise<string | undefined> {
  const resolved = resolveBinCommand(bin);
  const child = spawn(resolved.command, [...resolved.prefixArgs, "--version"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const result = await Promise.race([
    once(child, "close").then(() => "close"),
    once(child, "error").then(() => "error"),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout")),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    return undefined;
  }

  if (result === "error") {
    return undefined;
  }

  return parseVersion(output.trim());
}

async function captureCommandOutput(
  bin: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
  const resolved = resolveBinCommand(bin);
  const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: options?.env ?? process.env,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const result = await Promise.race([
    once(child, "close").then(() => "close"),
    once(child, "error").then(() => "error"),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout")),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw new Error("Command timed out");
  }

  if (result === "error") {
    throw new Error("Command failed to run");
  }

  return output.trim();
}

function assertVersionMatch(
  name: string,
  expected: string | undefined,
  actual: string | undefined,
  context: string,
): void {
  if (!expected) return;
  if (!actual) {
    throw new Error(`Unable to determine ${name} version from ${context}. Expected ${expected}.`);
  }
  if (expected !== actual) {
    throw new Error(`${name} version mismatch: expected ${expected}, got ${actual}.`);
  }
}

function resolveBinPath(bin: string): string {
  if (bin.includes("/") || bin.startsWith(".")) {
    return resolve(process.cwd(), bin);
  }
  return bin;
}

async function resolveOpenworkServerBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("openwork-server-bin requires --allow-external");
  }
  if (options.explicit && options.source !== "auto" && options.source !== "external") {
    throw new Error("openwork-server-bin requires --sidecar-source external or auto");
  }

  const expectedVersion = await resolveExpectedVersion(options.manifest, "openwork-server");
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External openwork-server requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if ((resolved.includes("/") || resolved.startsWith(".")) && !(await fileExists(resolved))) {
        throw new Error(`openwork-server-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }

    const require = createRequire(import.meta.url);
    try {
      const pkgPath = require.resolve("openwork-server/package.json");
      const pkgDir = dirname(pkgPath);
      const binaryPath = join(pkgDir, "dist", "bin", "openwork-server");
      if (await isExecutable(binaryPath)) {
        return { bin: binaryPath, source: "external", expectedVersion };
      }
      const cliPath = join(pkgDir, "dist", "cli.js");
      if (await isExecutable(cliPath)) {
        return { bin: cliPath, source: "external", expectedVersion };
      }
    } catch {
      // ignore
    }

    return { bin: "openwork-server", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(options.manifest, "openwork-server");
    if (!bundled) {
      throw new Error("Bundled openwork-server binary missing. Build with pnpm --filter openwrk build:bin:bundled.");
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({ name: "openwork-server", sidecar: options.sidecar });
    if (!downloaded) {
      throw new Error("openwork-server download failed. Check sidecar manifest or base URL.");
    }
    return downloaded;
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(options.manifest, "openwork-server");
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({ name: "openwork-server", sidecar: options.sidecar });
  if (downloaded) return downloaded;

  if (!options.allowExternal) {
    throw new Error(
      "Bundled openwork-server binary missing and download failed. Use --allow-external or --sidecar-source external.",
    );
  }

  return resolveExternal();
}

async function resolveOpencodeBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("opencode-bin requires --allow-external");
  }
  if (options.explicit && options.source !== "auto" && options.source !== "external") {
    throw new Error("opencode-bin requires --opencode-source external or auto");
  }

  const expectedVersion = await resolveExpectedVersion(options.manifest, "opencode");
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External opencode requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if ((resolved.includes("/") || resolved.startsWith(".")) && !(await fileExists(resolved))) {
        throw new Error(`opencode-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }
    return { bin: "opencode", source: "external", expectedVersion };
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(options.manifest, "opencode");
    if (!bundled) {
      throw new Error("Bundled opencode binary missing. Build with pnpm --filter openwrk build:bin:bundled.");
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({ name: "opencode", sidecar: options.sidecar });
    if (downloaded) return downloaded;
    const opencodeDownloaded = await resolveOpencodeDownload(options.sidecar, expectedVersion);
    if (opencodeDownloaded) {
      return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
    }
    throw new Error("opencode download failed. Check sidecar manifest or OPENCODE_VERSION.");
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(options.manifest, "opencode");
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({ name: "opencode", sidecar: options.sidecar });
  if (downloaded) return downloaded;

  const opencodeDownloaded = await resolveOpencodeDownload(options.sidecar, expectedVersion);
  if (opencodeDownloaded) {
    return { bin: opencodeDownloaded, source: "downloaded", expectedVersion };
  }

  if (!options.allowExternal) {
    throw new Error(
      "Bundled opencode binary missing and download failed. Use --allow-external or --opencode-source external.",
    );
  }

  return resolveExternal();
}

async function resolveOwpenbotBin(options: {
  explicit?: string;
  manifest: VersionManifest | null;
  allowExternal: boolean;
  sidecar: SidecarConfig;
  source: BinarySourcePreference;
}): Promise<ResolvedBinary> {
  if (options.explicit && !options.allowExternal) {
    throw new Error("owpenbot-bin requires --allow-external");
  }
  if (options.explicit && options.source !== "auto" && options.source !== "external") {
    throw new Error("owpenbot-bin requires --sidecar-source external or auto");
  }

  const expectedVersion = await resolveExpectedVersion(options.manifest, "owpenbot");
  const resolveExternal = async (): Promise<ResolvedBinary> => {
    if (!options.allowExternal) {
      throw new Error("External owpenbot requires --allow-external");
    }
    if (options.explicit) {
      const resolved = resolveBinPath(options.explicit);
      if ((resolved.includes("/") || resolved.startsWith(".")) && !(await fileExists(resolved))) {
        throw new Error(`owpenbot-bin not found: ${resolved}`);
      }
      return { bin: resolved, source: "external", expectedVersion };
    }

    const repoDir = await resolveOwpenbotRepoDir();
    if (repoDir) {
      const binPath = join(repoDir, "dist", "bin", "owpenbot");
      if (await isExecutable(binPath)) {
        return { bin: binPath, source: "external", expectedVersion };
      }
      const cliPath = join(repoDir, "dist", "cli.js");
      if (await fileExists(cliPath)) {
        return { bin: cliPath, source: "external", expectedVersion };
      }
    }

    const require = createRequire(import.meta.url);
    try {
      const pkgPath = require.resolve("owpenwork/package.json");
      const pkgDir = dirname(pkgPath);
      const binaryPath = join(pkgDir, "dist", "bin", "owpenbot");
      if (await isExecutable(binaryPath)) {
        return { bin: binaryPath, source: "external", expectedVersion };
      }
      const cliPath = join(pkgDir, "dist", "cli.js");
      if (await isExecutable(cliPath)) {
        return { bin: cliPath, source: "external", expectedVersion };
      }
    } catch {
      // ignore
    }

    throw new Error(
      "owpenbot binary not found. Install the owpenwork dependency or pass --owpenbot-bin with --allow-external.",
    );
  };

  if (options.source === "bundled") {
    const bundled = await resolveBundledBinary(options.manifest, "owpenbot");
    if (!bundled) {
      throw new Error("Bundled owpenbot binary missing. Build with pnpm --filter openwrk build:bin:bundled.");
    }
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.source === "downloaded") {
    const downloaded = await downloadSidecarBinary({ name: "owpenbot", sidecar: options.sidecar });
    if (!downloaded) {
      throw new Error("owpenbot download failed. Check sidecar manifest or base URL.");
    }
    return downloaded;
  }

  if (options.source === "external") {
    return resolveExternal();
  }

  const bundled = await resolveBundledBinary(options.manifest, "owpenbot");
  if (bundled && !(options.allowExternal && options.explicit)) {
    return { bin: bundled, source: "bundled", expectedVersion };
  }

  if (options.explicit) {
    return resolveExternal();
  }

  const downloaded = await downloadSidecarBinary({ name: "owpenbot", sidecar: options.sidecar });
  if (downloaded) return downloaded;

  if (!options.allowExternal) {
    throw new Error(
      "Bundled owpenbot binary missing and download failed. Use --allow-external or --sidecar-source external.",
    );
  }

  return resolveExternal();
}

function resolveRouterDataDir(flags: Map<string, string | boolean>): string {
  const override = readFlag(flags, "data-dir") ?? process.env.OPENWRK_DATA_DIR ?? process.env.OPENWORK_DATA_DIR;
  if (override && override.trim()) {
    return resolve(override.trim());
  }
  return join(homedir(), ".openwork", "openwrk");
}

function routerStatePath(dataDir: string): string {
  return join(dataDir, "openwrk-state.json");
}

function nowMs(): number {
  return Date.now();
}

async function loadRouterState(path: string): Promise<RouterState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as RouterState;
    if (!parsed.workspaces) parsed.workspaces = [];
    if (!parsed.activeId) parsed.activeId = "";
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return {
      version: 1,
      daemon: undefined,
      opencode: undefined,
      cliVersion: undefined,
      sidecar: undefined,
      binaries: undefined,
      activeId: "",
      workspaces: [],
    };
  }
}

async function saveRouterState(path: string, state: RouterState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify(state, null, 2);
  await writeFile(path, `${payload}\n`, "utf8");
}

function normalizeWorkspacePath(input: string): string {
  return resolve(input).replace(/[\\/]+$/, "");
}

function workspaceIdForLocal(path: string): string {
  return `ws-${createHash("sha1").update(path).digest("hex").slice(0, 12)}`;
}

function workspaceIdForRemote(baseUrl: string, directory?: string | null): string {
  const key = directory ? `${baseUrl}::${directory}` : baseUrl;
  return `ws-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function findWorkspace(state: RouterState, input: string): RouterWorkspace | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const direct = state.workspaces.find((entry) => entry.id === trimmed || entry.name === trimmed);
  if (direct) return direct;
  const normalized = normalizeWorkspacePath(trimmed);
  return state.workspaces.find((entry) => entry.path && normalizeWorkspacePath(entry.path) === normalized);
}

function isProcessAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveSelfCommand(): { command: string; prefixArgs: string[] } {
  const arg1 = process.argv[1];
  if (!arg1) return { command: process.argv[0], prefixArgs: [] };
  if (arg1.endsWith(".js") || arg1.endsWith(".ts")) {
    return { command: process.argv[0], prefixArgs: [arg1] };
  }
  return { command: process.argv[0], prefixArgs: [] };
}

async function waitForHealthy(url: string, timeoutMs = 10_000, pollMs = 250): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for health check");
}

async function fetchOwpenbotHealth(baseUrl: string): Promise<OwpenbotHealthSnapshot> {
  return (await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`)) as OwpenbotHealthSnapshot;
}

async function waitForOwpenbotHealthy(baseUrl: string, timeoutMs = 10_000, pollMs = 500) {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
      if (response.ok) {
        return (await response.json()) as OwpenbotHealthSnapshot;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for owpenbot health");
}

async function waitForOpencodeHealthy(client: ReturnType<typeof createOpencodeClient>, timeoutMs = 10_000, pollMs = 250) {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const health = unwrap(await client.global.health());
      if (health?.healthy) return health;
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for OpenCode health");
}

function printHelp(): void {
  const message = [
    "openwrk",
    "",
    "Usage:",
    "  openwrk start [--workspace <path>] [options]",
    "  openwrk serve [--workspace <path>] [options]",
    "  openwrk daemon [run|start|stop|status] [options]",
    "  openwrk workspace <action> [options]",
    "  openwrk instance dispose <id> [options]",
    "  openwrk approvals list --openwork-url <url> --host-token <token>",
    "  openwrk approvals reply <id> --allow|--deny --openwork-url <url> --host-token <token>",
    "  openwrk status [--openwork-url <url>] [--opencode-url <url>]",
    "",
    "Commands:",
    "  start                   Start OpenCode + OpenWork server + Owpenbot",
    "  serve                   Start services and stream logs (no TUI)",
    "  daemon                  Run openwrk router daemon (multi-workspace)",
    "  workspace               Manage workspaces (add/list/switch/path)",
    "  instance                Manage workspace instances (dispose)",
    "  approvals list           List pending approval requests",
    "  approvals reply <id>     Approve or deny a request",
    "  status                  Check OpenCode/OpenWork health",
    "",
    "Options:",
    "  --workspace <path>        Workspace directory (default: cwd)",
    "  --data-dir <path>         Data dir for openwrk router state",
    "  --daemon-host <host>      Host for openwrk router daemon (default: 127.0.0.1)",
    "  --daemon-port <port>      Port for openwrk router daemon (default: random)",
    "  --opencode-bin <path>     Path to opencode binary (requires --allow-external)",
    "  --opencode-host <host>    Bind host for opencode serve (default: 0.0.0.0)",
    "  --opencode-port <port>    Port for opencode serve (default: random)",
    "  --opencode-workdir <p>    Workdir for router-managed opencode serve",
    "  --opencode-auth           Enable OpenCode basic auth (default: true)",
    "  --no-opencode-auth        Disable OpenCode basic auth",
    "  --opencode-username <u>   OpenCode basic auth username",
    "  --opencode-password <p>   OpenCode basic auth password",
    "  --openwork-host <host>    Bind host for openwork-server (default: 0.0.0.0)",
    "  --openwork-port <port>    Port for openwork-server (default: 8787)",
    "  --openwork-token <token>  Client token for openwork-server",
    "  --openwork-host-token <t> Host token for approvals",
    "  --approval <mode>         manual | auto (default: manual)",
    "  --approval-timeout <ms>   Approval timeout in ms",
    "  --read-only               Start OpenWork server in read-only mode",
    "  --cors <origins>          Comma-separated CORS origins or *",
    "  --connect-host <host>     Override LAN host used for pairing URLs",
    "  --openwork-server-bin <p> Path to openwork-server binary (requires --allow-external)",
    "  --owpenbot-bin <path>     Path to owpenbot binary (requires --allow-external)",
    "  --owpenbot-health-port <p> Health server port for owpenbot (default: 3005)",
    "  --no-owpenbot             Disable owpenbot sidecar",
    "  --owpenbot-required       Exit if owpenbot stops",
    "  --allow-external          Allow external sidecar binaries (dev only, required for custom bins)",
    "  --sidecar-dir <path>      Cache directory for downloaded sidecars",
    "  --sidecar-base-url <url>  Base URL for sidecar downloads",
    "  --sidecar-manifest <url>  Override sidecar manifest URL",
    "  --sidecar-source <mode>   auto | bundled | downloaded | external",
    "  --opencode-source <mode>  auto | bundled | downloaded | external",
    "  --check                   Run health checks then exit",
    "  --check-events            Verify SSE events during check",
    "  --tui                     Force interactive dashboard (TTY only)",
    "  --no-tui                  Disable interactive dashboard",
    "  --detach                  Detach after start and keep services running",
    "  --json                    Output JSON when applicable",
    "  --verbose                 Print additional diagnostics",
    "  --log-format <format>     Log output format: pretty | json",
    "  --color                   Force ANSI color output",
    "  --no-color                Disable ANSI color output",
    "  --run-id <id>             Correlation id for logs (default: random UUID)",
    "  --help                    Show help",
    "  --version                 Show version",
  ].join("\n");
  console.log(message);
}

async function stopChild(child: ReturnType<typeof spawn>, timeoutMs = 2500): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
  if (exited) return;
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
}

async function startOpencode(options: {
  bin: string;
  workspace: string;
  bindHost: string;
  port: number;
  username?: string;
  password?: string;
  corsOrigins: string[];
  logger: Logger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = ["serve", "--hostname", options.bindHost, "--port", String(options.port)];
  for (const origin of options.corsOrigins) {
    args.push("--cors", origin);
  }

  const child = spawn(options.bin, args, {
    cwd: options.workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_CLIENT: "openwrk",
      OPENWORK: "1",
      OPENWRK_RUN_ID: options.runId,
      OPENWRK_LOG_FORMAT: options.logFormat,
      OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
        {
          "service.name": "opencode",
          "service.instance.id": options.runId,
        },
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      ...(options.username ? { OPENCODE_SERVER_USERNAME: options.username } : {}),
      ...(options.password ? { OPENCODE_SERVER_PASSWORD: options.password } : {}),
    },
  });

  prefixStream(child.stdout, "opencode", "stdout", options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, "opencode", "stderr", options.logger, child.pid ?? undefined);

  return child;
}

async function startOpenworkServer(options: {
  bin: string;
  host: string;
  port: number;
  workspace: string;
  token: string;
  hostToken: string;
  approvalMode: ApprovalMode;
  approvalTimeoutMs: number;
  readOnly: boolean;
  corsOrigins: string[];
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  owpenbotHealthPort?: number;
  logger: Logger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = [
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--token",
    options.token,
    "--host-token",
    options.hostToken,
    "--workspace",
    options.workspace,
    "--approval",
    options.approvalMode,
    "--approval-timeout",
    String(options.approvalTimeoutMs),
  ];

  if (options.readOnly) {
    args.push("--read-only");
  }

  if (options.corsOrigins.length) {
    args.push("--cors", options.corsOrigins.join(","));
  }

  if (options.opencodeBaseUrl) {
    args.push("--opencode-base-url", options.opencodeBaseUrl);
  }
  if (options.opencodeDirectory) {
    args.push("--opencode-directory", options.opencodeDirectory);
  }
  if (options.opencodeUsername) {
    args.push("--opencode-username", options.opencodeUsername);
  }
  if (options.opencodePassword) {
    args.push("--opencode-password", options.opencodePassword);
  }
  if (options.logFormat) {
    args.push("--log-format", options.logFormat);
  }

  const resolved = resolveBinCommand(options.bin);
  const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
    cwd: options.workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENWORK_TOKEN: options.token,
      OPENWORK_HOST_TOKEN: options.hostToken,
      OPENWRK_RUN_ID: options.runId,
      OPENWORK_RUN_ID: options.runId,
      OPENWORK_LOG_FORMAT: options.logFormat,
      OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
        {
          "service.name": "openwork-server",
          "service.instance.id": options.runId,
        },
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      ...(options.owpenbotHealthPort ? { OWPENBOT_HEALTH_PORT: String(options.owpenbotHealthPort) } : {}),
      ...(options.opencodeBaseUrl ? { OPENWORK_OPENCODE_BASE_URL: options.opencodeBaseUrl } : {}),
      ...(options.opencodeDirectory ? { OPENWORK_OPENCODE_DIRECTORY: options.opencodeDirectory } : {}),
      ...(options.opencodeUsername ? { OPENWORK_OPENCODE_USERNAME: options.opencodeUsername } : {}),
      ...(options.opencodePassword ? { OPENWORK_OPENCODE_PASSWORD: options.opencodePassword } : {}),
    },
  });

  prefixStream(child.stdout, "openwork-server", "stdout", options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, "openwork-server", "stderr", options.logger, child.pid ?? undefined);

  return child;
}

async function startOwpenbot(options: {
  bin: string;
  workspace: string;
  opencodeUrl?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  owpenbotHealthPort?: number;
  logger: Logger;
  runId: string;
  logFormat: LogFormat;
}) {
  const args = ["start", options.workspace];
  if (options.opencodeUrl) {
    const supports = await owpenbotSupportsOpencodeUrl(options.bin);
    if (supports) {
      args.push("--opencode-url", options.opencodeUrl);
    }
  }

  const resolved = resolveBinCommand(options.bin);
  const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
    cwd: options.workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENWRK_RUN_ID: options.runId,
      OPENWRK_LOG_FORMAT: options.logFormat,
      OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(
        {
          "service.name": "owpenbot",
          "service.instance.id": options.runId,
        },
        process.env.OTEL_RESOURCE_ATTRIBUTES,
      ),
      ...(options.opencodeUrl ? { OPENCODE_URL: options.opencodeUrl } : {}),
      OPENCODE_DIRECTORY: options.workspace,
      ...(options.owpenbotHealthPort ? { OWPENBOT_HEALTH_PORT: String(options.owpenbotHealthPort) } : {}),
      ...(options.opencodeUsername ? { OPENCODE_SERVER_USERNAME: options.opencodeUsername } : {}),
      ...(options.opencodePassword ? { OPENCODE_SERVER_PASSWORD: options.opencodePassword } : {}),
    },
  });

  prefixStream(child.stdout, "owpenbot", "stdout", options.logger, child.pid ?? undefined);
  prefixStream(child.stderr, "owpenbot", "stderr", options.logger, child.pid ?? undefined);

  return child;
}

async function owpenbotSupportsOpencodeUrl(bin: string): Promise<boolean> {
  const resolved = resolveBinCommand(bin);
  return new Promise((resolve) => {
    const child = spawn(resolved.command, [...resolved.prefixArgs, "--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(output.includes("--opencode-url"));
    }, 1500);

    const onChunk = (chunk: unknown) => {
      output += String(chunk ?? "");
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.on("exit", () => {
      clearTimeout(timeout);
      resolve(output.includes("--opencode-url"));
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function verifyOwpenbotVersion(binary: ResolvedBinary): Promise<string | undefined> {
  if (binary.source !== "external") {
    return binary.expectedVersion;
  }
  const actual = await readCliVersion(binary.bin);
  assertVersionMatch("owpenbot", binary.expectedVersion, actual, binary.bin);
  return actual;
}

async function verifyOpencodeVersion(binary: ResolvedBinary): Promise<string | undefined> {
  const actual = await readCliVersion(binary.bin);
  assertVersionMatch("opencode", binary.expectedVersion, actual, binary.bin);
  return actual;
}

async function verifyOpenworkServer(input: {
  baseUrl: string;
  token: string;
  hostToken: string;
  expectedVersion?: string;
  expectedWorkspace: string;
  expectedOpencodeBaseUrl?: string;
  expectedOpencodeDirectory?: string;
  expectedOpencodeUsername?: string;
  expectedOpencodePassword?: string;
}): Promise<string | undefined> {
  const health = await fetchJson(`${input.baseUrl}/health`);
  const actualVersion = typeof health?.version === "string" ? health.version : undefined;
  assertVersionMatch("openwork-server", input.expectedVersion, actualVersion, `${input.baseUrl}/health`);

  const headers = { Authorization: `Bearer ${input.token}` };
  const workspaces = await fetchJson(`${input.baseUrl}/workspaces`, { headers });
  const items = Array.isArray(workspaces?.items) ? (workspaces.items as Array<Record<string, unknown>>) : [];
  if (!items.length) {
    throw new Error("OpenWork server returned no workspaces");
  }

  const expectedPath = normalizeWorkspacePath(input.expectedWorkspace);
  const matched = items.find((item) => {
    const candidate = item as { path?: string };
    const path = typeof candidate.path === "string" ? candidate.path : "";
    return path && normalizeWorkspacePath(path) === expectedPath;
  }) as
    | {
        id?: string;
        path?: string;
        opencode?: { baseUrl?: string; directory?: string; username?: string; password?: string };
      }
    | undefined;

  if (!matched) {
    throw new Error(`OpenWork server workspace mismatch. Expected ${expectedPath}.`);
  }

  const opencode = matched.opencode;
  if (input.expectedOpencodeBaseUrl && opencode?.baseUrl !== input.expectedOpencodeBaseUrl) {
    throw new Error(
      `OpenWork server OpenCode base URL mismatch: expected ${input.expectedOpencodeBaseUrl}, got ${opencode?.baseUrl ?? "<missing>"}.`,
    );
  }
  if (input.expectedOpencodeDirectory && opencode?.directory !== input.expectedOpencodeDirectory) {
    throw new Error(
      `OpenWork server OpenCode directory mismatch: expected ${input.expectedOpencodeDirectory}, got ${opencode?.directory ?? "<missing>"}.`,
    );
  }
  if (input.expectedOpencodeUsername && opencode?.username !== input.expectedOpencodeUsername) {
    throw new Error("OpenWork server OpenCode username mismatch.");
  }
  if (input.expectedOpencodePassword && opencode?.password !== input.expectedOpencodePassword) {
    throw new Error("OpenWork server OpenCode password mismatch.");
  }

  const hostHeaders = { "X-OpenWork-Host-Token": input.hostToken };
  await fetchJson(`${input.baseUrl}/approvals`, { headers: hostHeaders });

  return actualVersion;
}

async function runChecks(input: {
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  openworkUrl: string;
  openworkToken: string;
  checkEvents: boolean;
}) {
  const headers = { Authorization: `Bearer ${input.openworkToken}` };
  const workspaces = await fetchJson(`${input.openworkUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("OpenWork server returned no workspaces");
  }

  const workspaceId = workspaces.items[0].id as string;
  await fetchJson(`${input.openworkUrl}/workspace/${workspaceId}/config`, { headers });

  const created = await input.opencodeClient.session.create({ title: "OpenWork headless check" });
  const createdSession = unwrap(created);
  unwrap(await input.opencodeClient.session.messages({ sessionID: createdSession.id, limit: 10 }));

  if (input.checkEvents) {
    const events: { type: string }[] = [];
    const controller = new AbortController();
    const subscription = await input.opencodeClient.event.subscribe(undefined, { signal: controller.signal });
    const reader = (async () => {
      try {
        for await (const raw of subscription.stream) {
          const normalized = normalizeEvent(raw);
          if (!normalized) continue;
          events.push(normalized);
          if (events.length >= 10) break;
        }
      } catch {
        // ignore
      }
    })();

    unwrap(await input.opencodeClient.session.create({ title: "OpenWork headless check events" }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await Promise.race([reader, new Promise((resolve) => setTimeout(resolve, 500))]);

    if (!events.length) {
      throw new Error("No SSE events observed during check");
    }
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.message ? ` ${payload.message}` : "";
    throw new Error(`HTTP ${response.status}${message}`);
  }
  return payload;
}

function normalizeEvent(raw: unknown): { type: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string") return { type: record.type };
  const payload = record.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.type === "string") return { type: payload.type };
  return null;
}

async function waitForRouterHealthy(baseUrl: string, timeoutMs = 10_000, pollMs = 250): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  const url = baseUrl.replace(/\/$/, "");
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for daemon health");
}

function outputResult(payload: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof payload === "string") {
    console.log(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function outputError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    return;
  }
  console.error(message);
}

function createVerboseLogger(enabled: boolean, logger?: Logger, component = "openwrk") {
  return (message: string) => {
    if (!enabled) return;
    if (logger) {
      logger.debug(message, undefined, component);
      return;
    }
    console.log(`[${component}] ${message}`);
  };
}

const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function colorize(input: string, color: string, enabled: boolean): string {
  if (!enabled) return input;
  return `${color}${input}${ANSI.reset}`;
}

function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function mergeResourceAttributes(additional: Record<string, string>, existing?: string): string {
  const entries = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || rest.length === 0) continue;
      entries.set(key, rest.join("=").replace(/,/g, ";"));
    }
  }
  for (const [key, value] of Object.entries(additional)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    entries.set(key, String(value).replace(/,/g, ";"));
  }
  return Array.from(entries.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function createLogger(options: {
  format: LogFormat;
  runId: string;
  serviceName: string;
  serviceVersion?: string;
  output?: "stdout" | "silent";
  color?: boolean;
  onLog?: (event: LogEvent) => void;
}): Logger {
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": options.serviceName,
    "service.instance.id": options.runId,
  };
  if (options.serviceVersion) {
    resource["service.version"] = options.serviceVersion;
  }
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": options.runId,
    "process.pid": process.pid,
  };
  const output = options.output ?? "stdout";
  const colorEnabled = options.color ?? false;
  const componentColors: Record<string, string> = {
    openwrk: ANSI.gray,
    opencode: ANSI.cyan,
    "openwork-server": ANSI.green,
    owpenbot: ANSI.magenta,
    "openwrk-router": ANSI.cyan,
  };
  const levelColors: Record<LogLevel, string> = {
    debug: ANSI.gray,
    info: ANSI.gray,
    warn: ANSI.yellow,
    error: ANSI.red,
  };

  const emit = (level: LogLevel, message: string, attributes?: LogAttributes, component?: string) => {
    const mergedAttributes: LogAttributes = {
      ...baseAttributes,
      ...(component ? { "service.component": component } : {}),
      ...(attributes ?? {}),
    };
    options.onLog?.({
      time: Date.now(),
      level,
      message,
      component,
      attributes: mergedAttributes,
    });
    if (output === "silent") return;
    if (options.format === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: message,
        attributes: mergedAttributes,
        resource,
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const label = component ?? options.serviceName;
    const tagLabel = label ? `[${label}]` : "";
    const levelTag = level === "info" ? "" : level.toUpperCase();
    const coloredLabel = tagLabel
      ? colorize(tagLabel, componentColors[label] ?? ANSI.gray, colorEnabled)
      : "";
    const coloredLevel = levelTag
      ? colorize(levelTag, levelColors[level] ?? ANSI.gray, colorEnabled)
      : "";
    const tag = [coloredLabel, coloredLevel].filter(Boolean).join(" ");
    const line = tag ? `${tag} ${message}` : message;
    process.stdout.write(`${line}\n`);
  };

  const child = (component: string, attributes?: LogAttributes): LoggerChild => ({
    log: (level, message, attrs) => emit(level, message, { ...(attributes ?? {}), ...(attrs ?? {}) }, component),
    debug: (message, attrs) => emit("debug", message, { ...(attributes ?? {}), ...(attrs ?? {}) }, component),
    info: (message, attrs) => emit("info", message, { ...(attributes ?? {}), ...(attrs ?? {}) }, component),
    warn: (message, attrs) => emit("warn", message, { ...(attributes ?? {}), ...(attrs ?? {}) }, component),
    error: (message, attrs) => emit("error", message, { ...(attributes ?? {}), ...(attrs ?? {}) }, component),
  });

  return {
    format: options.format,
    output,
    log: emit,
    debug: (message, attrs, component) => emit("debug", message, attrs, component),
    info: (message, attrs, component) => emit("info", message, attrs, component),
    warn: (message, attrs, component) => emit("warn", message, attrs, component),
    error: (message, attrs, component) => emit("error", message, attrs, component),
    child,
  };
}

function looksLikeOtelLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return false;
    return typeof parsed.timeUnixNano === "string" && typeof parsed.severityText === "string";
  } catch {
    return false;
  }
}

function buildAttachCommand(input: {
  url: string;
  workspace: string;
  username?: string;
  password?: string;
}): string {
  const parts: string[] = [];
  if (input.username && input.password && input.username !== DEFAULT_OPENCODE_USERNAME) {
    parts.push(`OPENCODE_SERVER_USERNAME=${input.username}`);
  }
  if (input.password) {
    parts.push(`OPENCODE_SERVER_PASSWORD=${input.password}`);
  }
  parts.push("opencode", "attach", input.url, "--dir", input.workspace);
  return parts.join(" ");
}

async function runClipboardCommand(command: string, args: string[], text: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.stdin?.write(text);
    child.stdin?.end();
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function copyToClipboard(text: string): Promise<{ copied: boolean; error?: string }> {
  const platform = process.platform;
  const commands: Array<{ command: string; args: string[] }> = [];
  if (platform === "darwin") {
    commands.push({ command: "pbcopy", args: [] });
  } else if (platform === "win32") {
    commands.push({ command: "clip", args: [] });
  } else {
    commands.push({ command: "wl-copy", args: [] });
    commands.push({ command: "xclip", args: ["-selection", "clipboard"] });
    commands.push({ command: "xsel", args: ["--clipboard", "--input"] });
  }
  for (const entry of commands) {
    try {
      const ok = await runClipboardCommand(entry.command, entry.args, text);
      if (ok) return { copied: true };
    } catch {
      // ignore
    }
  }
  return { copied: false, error: "Clipboard unavailable" };
}

async function spawnRouterDaemon(args: ParsedArgs, dataDir: string, host: string, port: number) {
  const self = resolveSelfCommand();
  const commandArgs = [
    ...self.prefixArgs,
    "daemon",
    "run",
    "--data-dir",
    dataDir,
    "--daemon-host",
    host,
    "--daemon-port",
    String(port),
  ];

  const opencodeBin = readFlag(args.flags, "opencode-bin") ?? process.env.OPENWRK_OPENCODE_BIN;
  const opencodeHost = readFlag(args.flags, "opencode-host") ?? process.env.OPENWRK_OPENCODE_HOST;
  const opencodePort = readFlag(args.flags, "opencode-port") ?? process.env.OPENWRK_OPENCODE_PORT;
  const opencodeWorkdir = readFlag(args.flags, "opencode-workdir") ?? process.env.OPENWRK_OPENCODE_WORKDIR;
  const opencodeUsername = readFlag(args.flags, "opencode-username") ?? process.env.OPENWORK_OPENCODE_USERNAME;
  const opencodePassword = readFlag(args.flags, "opencode-password") ?? process.env.OPENWORK_OPENCODE_PASSWORD;
  const corsValue = readFlag(args.flags, "cors") ?? process.env.OPENWRK_OPENCODE_CORS;
  const allowExternal = readBool(args.flags, "allow-external", false, "OPENWRK_ALLOW_EXTERNAL");
  const sidecarSource = readFlag(args.flags, "sidecar-source") ?? process.env.OPENWRK_SIDECAR_SOURCE;
  const opencodeSource = readFlag(args.flags, "opencode-source") ?? process.env.OPENWRK_OPENCODE_SOURCE;
  const verbose = readBool(args.flags, "verbose", false, "OPENWRK_VERBOSE");
  const logFormat = readFlag(args.flags, "log-format") ?? process.env.OPENWRK_LOG_FORMAT;
  const runId = readFlag(args.flags, "run-id") ?? process.env.OPENWRK_RUN_ID;

  if (opencodeBin) commandArgs.push("--opencode-bin", opencodeBin);
  if (opencodeHost) commandArgs.push("--opencode-host", opencodeHost);
  if (opencodePort) commandArgs.push("--opencode-port", String(opencodePort));
  if (opencodeWorkdir) commandArgs.push("--opencode-workdir", opencodeWorkdir);
  if (opencodeUsername) commandArgs.push("--opencode-username", opencodeUsername);
  if (opencodePassword) commandArgs.push("--opencode-password", opencodePassword);
  if (corsValue) commandArgs.push("--cors", corsValue);
  if (allowExternal) commandArgs.push("--allow-external");
  if (sidecarSource) commandArgs.push("--sidecar-source", sidecarSource);
  if (opencodeSource) commandArgs.push("--opencode-source", opencodeSource);
  if (verbose) commandArgs.push("--verbose");
  if (logFormat) commandArgs.push("--log-format", String(logFormat));
  if (runId) commandArgs.push("--run-id", String(runId));

  const child = spawn(self.command, commandArgs, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
    },
  });
  child.unref();
}

async function ensureRouterDaemon(args: ParsedArgs, autoStart = true): Promise<{ baseUrl: string; dataDir: string }> {
  const dataDir = resolveRouterDataDir(args.flags);
  const statePath = routerStatePath(dataDir);
  const state = await loadRouterState(statePath);
  const existing = state.daemon;
  if (existing && existing.baseUrl && isProcessAlive(existing.pid)) {
    try {
      await waitForRouterHealthy(existing.baseUrl, 1500, 150);
      return { baseUrl: existing.baseUrl, dataDir };
    } catch {
      // fallthrough
    }
  }

  if (!autoStart) {
    throw new Error("openwrk daemon is not running");
  }

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "OPENWRK_DAEMON_PORT"),
    "127.0.0.1",
  );
  const baseUrl = `http://${host}:${port}`;
  await spawnRouterDaemon(args, dataDir, host, port);
  await waitForRouterHealthy(baseUrl, 10_000, 250);
  return { baseUrl, dataDir };
}

async function requestRouter(args: ParsedArgs, method: string, path: string, body?: unknown, autoStart = true) {
  const { baseUrl } = await ensureRouterDaemon(args, autoStart);
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  return fetchJson(url, {
    method,
    headers,
    body: payload,
  });
}

async function runDaemonCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1] ?? "run";

  try {
    if (subcommand === "run" || subcommand === "foreground") {
      await runRouterDaemon(args);
      return;
    }
    if (subcommand === "start") {
      const { baseUrl } = await ensureRouterDaemon(args, true);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "status") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "stop") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      await fetchJson(`${baseUrl.replace(/\/$/, "")}/shutdown`, { method: "POST" });
      outputResult({ ok: true }, outputJson);
      return;
    }
    throw new Error("daemon requires start|stop|status|run");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runWorkspaceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "add") {
      if (!id) throw new Error("workspace path is required");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces", {
        path: id,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "add-remote") {
      if (!id) throw new Error("baseUrl is required");
      const directory = readFlag(args.flags, "directory");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces/remote", {
        baseUrl: id,
        directory: directory ?? null,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "list") {
      const result = await requestRouter(args, "GET", "/workspaces");
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "switch") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(args, "POST", `/workspaces/${encodeURIComponent(id)}/activate`);
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "info") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(args, "GET", `/workspaces/${encodeURIComponent(id)}`);
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "path") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(args, "GET", `/workspaces/${encodeURIComponent(id)}/path`);
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("workspace requires add|add-remote|list|switch|info|path");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runInstanceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "dispose") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(args, "POST", `/instances/${encodeURIComponent(id)}/dispose`);
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("instance requires dispose");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

async function runRouterDaemon(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const verbose = readBool(args.flags, "verbose", false, "OPENWRK_VERBOSE");
  const logFormat = readLogFormat(args.flags, "log-format", "pretty", "OPENWRK_LOG_FORMAT");
  const colorEnabled =
    readBool(args.flags, "color", process.stdout.isTTY, "OPENWRK_COLOR") && !process.env.NO_COLOR;
  const runId = readFlag(args.flags, "run-id") ?? process.env.OPENWRK_RUN_ID ?? randomUUID();
  const cliVersion = await resolveCliVersion();
  const logger = createLogger({
    format: logFormat,
    runId,
    serviceName: "openwrk",
    serviceVersion: cliVersion,
    output: "stdout",
    color: colorEnabled,
  });
  const logVerbose = createVerboseLogger(verbose && !outputJson, logger, "openwrk");
  const sidecarSource = readBinarySource(args.flags, "sidecar-source", "auto", "OPENWRK_SIDECAR_SOURCE");
  const opencodeSource = readBinarySource(args.flags, "opencode-source", "auto", "OPENWRK_OPENCODE_SOURCE");
  const dataDir = resolveRouterDataDir(args.flags);
  const statePath = routerStatePath(dataDir);
  let state = await loadRouterState(statePath);

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "OPENWRK_DAEMON_PORT"),
    "127.0.0.1",
  );

  const opencodeBin = readFlag(args.flags, "opencode-bin") ?? process.env.OPENWRK_OPENCODE_BIN;
  const opencodeHost = readFlag(args.flags, "opencode-host") ?? process.env.OPENWRK_OPENCODE_HOST ?? "127.0.0.1";
  const opencodePassword =
    readFlag(args.flags, "opencode-password") ??
    process.env.OPENWORK_OPENCODE_PASSWORD ??
    process.env.OPENCODE_SERVER_PASSWORD;
  const opencodeUsername =
    readFlag(args.flags, "opencode-username") ??
    process.env.OPENWORK_OPENCODE_USERNAME ??
    process.env.OPENCODE_SERVER_USERNAME ??
    DEFAULT_OPENCODE_USERNAME;
  const authHeaders = opencodePassword
    ? { Authorization: `Basic ${encodeBasicAuth(opencodeUsername, opencodePassword)}` }
    : undefined;
  const opencodePort = await resolvePort(
    readNumber(args.flags, "opencode-port", state.opencode?.port, "OPENWRK_OPENCODE_PORT"),
    "127.0.0.1",
    state.opencode?.port,
  );
  const corsValue = readFlag(args.flags, "cors") ?? process.env.OPENWRK_OPENCODE_CORS ?? "http://localhost:5173,tauri://localhost,http://tauri.localhost";
  const corsOrigins = parseList(corsValue);
  const opencodeWorkdirFlag = readFlag(args.flags, "opencode-workdir") ?? process.env.OPENWRK_OPENCODE_WORKDIR;
  const activeWorkspace = state.workspaces.find((entry) => entry.id === state.activeId && entry.workspaceType === "local");
  const opencodeWorkdir = opencodeWorkdirFlag ?? activeWorkspace?.path ?? process.cwd();
  const resolvedWorkdir = await ensureWorkspace(opencodeWorkdir);
  logger.info(
    "Daemon starting",
    { runId, logFormat, workdir: resolvedWorkdir, host, port },
    "openwrk",
  );

  const sidecar = resolveSidecarConfig(args.flags, cliVersion);
  const allowExternal = readBool(args.flags, "allow-external", false, "OPENWRK_ALLOW_EXTERNAL");
  const manifest = await readVersionManifest();
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  const opencodeBinary = await resolveOpencodeBin({
    explicit: opencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);

  let opencodeChild: ReturnType<typeof spawn> | null = null;

  const updateDiagnostics = (actualVersion?: string) => {
    state.cliVersion = cliVersion;
    state.sidecar = {
      dir: sidecar.dir,
      baseUrl: sidecar.baseUrl,
      manifestUrl: sidecar.manifestUrl,
      target: sidecar.target,
      source: sidecarSource,
      opencodeSource,
      allowExternal,
    };
    state.binaries = {
      opencode: {
        path: opencodeBinary.bin,
        source: opencodeBinary.source,
        expectedVersion: opencodeBinary.expectedVersion,
        actualVersion,
      },
    };
  };

  const ensureOpencode = async () => {
    const existing = state.opencode;
    if (existing && isProcessAlive(existing.pid)) {
      const client = createOpencodeClient({
        baseUrl: existing.baseUrl,
        directory: resolvedWorkdir,
        headers: authHeaders,
      });
      try {
        await waitForOpencodeHealthy(client, 2000, 200);
        if (!state.sidecar || !state.cliVersion || !state.binaries?.opencode) {
          updateDiagnostics(state.binaries?.opencode?.actualVersion);
          await saveRouterState(statePath, state);
        }
        return { baseUrl: existing.baseUrl, client };
      } catch {
        // restart
      }
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
    }

    const opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    logVerbose(`opencode version: ${opencodeActualVersion ?? "unknown"}`);
    const child = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkdir,
      bindHost: opencodeHost,
      port: opencodePort,
      username: opencodePassword ? opencodeUsername : undefined,
      password: opencodePassword,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
    });
    opencodeChild = child;
    logger.info("Process spawned", { pid: child.pid ?? 0 }, "opencode");
    const baseUrl = `http://${opencodeHost}:${opencodePort}`;
    const client = createOpencodeClient({
      baseUrl,
      directory: resolvedWorkdir,
      headers: authHeaders,
    });
    logger.info("Waiting for health", { url: baseUrl }, "opencode");
    await waitForOpencodeHealthy(client);
    logger.info("Healthy", { url: baseUrl }, "opencode");
    state.opencode = {
      pid: child.pid ?? 0,
      port: opencodePort,
      baseUrl,
      startedAt: nowMs(),
    };
    updateDiagnostics(opencodeActualVersion);
    await saveRouterState(statePath, state);
    return { baseUrl, client };
  };

  await ensureOpencode();

  const server = createHttpServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    res.on("finish", () => {
      logger.info(
        "Router request",
        {
          method,
          path: url.pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          activeId: state.activeId,
        },
        "openwrk-router",
      );
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean);

    const send = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (!chunks.length) return null;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    };

    try {
        if (req.method === "GET" && url.pathname === "/health") {
          send(200, {
            ok: true,
            daemon: state.daemon ?? null,
            opencode: state.opencode ?? null,
            activeId: state.activeId,
            workspaceCount: state.workspaces.length,
            cliVersion: state.cliVersion ?? null,
            sidecar: state.sidecar ?? null,
            binaries: state.binaries ?? null,
          });
          return;
        }

      if (req.method === "GET" && url.pathname === "/workspaces") {
        send(200, { activeId: state.activeId, workspaces: state.workspaces });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces") {
        const body = await readBody();
        const pathInput = typeof body?.path === "string" ? body.path.trim() : "";
        if (!pathInput) {
          send(400, { error: "path is required" });
          return;
        }
        const resolved = await ensureWorkspace(pathInput);
        const id = workspaceIdForLocal(resolved);
        const name = typeof body?.name === "string" && body.name.trim()
          ? body.name.trim()
          : resolved.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace";
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: resolved,
          workspaceType: "local",
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces/remote") {
        const body = await readBody();
        const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
        if (!baseUrl || (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://"))) {
          send(400, { error: "baseUrl must start with http:// or https://" });
          return;
        }
        const directory = typeof body?.directory === "string" ? body.directory.trim() : "";
        const id = workspaceIdForRemote(baseUrl, directory || undefined);
        const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : baseUrl;
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: directory,
          workspaceType: "remote",
          baseUrl,
          directory: directory || undefined,
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (parts[0] === "workspaces" && parts.length === 2 && req.method === "GET") {
        const workspace = findWorkspace(state, decodeURIComponent(parts[1] ?? ""));
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        send(200, { workspace });
        return;
      }

      if (parts[0] === "workspaces" && parts.length === 3 && parts[2] === "activate" && req.method === "POST") {
        const workspace = findWorkspace(state, decodeURIComponent(parts[1] ?? ""));
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        state.activeId = workspace.id;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace });
        return;
      }

      if (parts[0] === "workspaces" && parts.length === 3 && parts[2] === "path" && req.method === "GET") {
        const workspace = findWorkspace(state, decodeURIComponent(parts[1] ?? ""));
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote ? workspace.baseUrl ?? "" : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote ? workspace.directory ?? "" : workspace.path;
        const client = createOpencodeClient({
          baseUrl,
          directory: directory ? directory : undefined,
          headers: authHeaders,
        });
        const pathInfo = unwrap(await client.path.get());
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { workspace, path: pathInfo });
        return;
      }

      if (parts[0] === "instances" && parts.length === 3 && parts[2] === "dispose" && req.method === "POST") {
        const workspace = findWorkspace(state, decodeURIComponent(parts[1] ?? ""));
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote ? workspace.baseUrl ?? "" : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote ? workspace.directory ?? "" : workspace.path;
        const response = await fetch(
          `${baseUrl.replace(/\/$/, "")}/instance/dispose?directory=${encodeURIComponent(directory)}`,
          { method: "POST", headers: authHeaders },
        );
        const ok = response.ok ? await response.json() : false;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { disposed: ok });
        return;
      }

      if (req.method === "POST" && url.pathname === "/shutdown") {
        send(200, { ok: true });
        await shutdown();
        return;
      }

      send(404, { error: "not found" });
    } catch (error) {
      send(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const shutdown = async () => {
    logger.info("Daemon shutting down", { host, port }, "openwrk-router");
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {
      // ignore
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
      opencodeChild = null;
    }

    state.daemon = undefined;
    if (state.opencode && !isProcessAlive(state.opencode.pid)) {
      state.opencode = undefined;
    }
    await saveRouterState(statePath, state);
    process.exit(0);
  };

  server.listen(port, host, async () => {
    state.daemon = {
      pid: process.pid,
      port,
      baseUrl: `http://${host}:${port}`,
      startedAt: nowMs(),
    };
    await saveRouterState(statePath, state);
    if (outputJson) {
      outputResult({ ok: true, daemon: state.daemon }, true);
    } else {
      if (logFormat === "json") {
        logger.info("Daemon running", { host, port }, "openwrk-router");
      } else {
        console.log(`openwrk daemon running on ${host}:${port}`);
      }
    }
  });

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
  await new Promise(() => undefined);
}

async function runApprovals(args: ParsedArgs) {
  const subcommand = args.positionals[1];
  if (!subcommand || (subcommand !== "list" && subcommand !== "reply")) {
    throw new Error("approvals requires 'list' or 'reply'");
  }

  const openworkUrl =
    readFlag(args.flags, "openwork-url") ??
    process.env.OPENWORK_URL ??
    process.env.OPENWORK_SERVER_URL ??
    "";
  const hostToken = readFlag(args.flags, "host-token") ?? process.env.OPENWORK_HOST_TOKEN ?? "";

  if (!openworkUrl || !hostToken) {
    throw new Error("openwork-url and host-token are required for approvals");
  }

  const headers = {
    "Content-Type": "application/json",
    "X-OpenWork-Host-Token": hostToken,
  };

  if (subcommand === "list") {
    const response = await fetch(`${openworkUrl.replace(/\/$/, "")}/approvals`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to list approvals: ${response.status}`);
    }
    const body = await response.json();
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const approvalId = args.positionals[2];
  if (!approvalId) {
    throw new Error("approval id is required for approvals reply");
  }

  const allow = readBool(args.flags, "allow", false);
  const deny = readBool(args.flags, "deny", false);
  if (allow === deny) {
    throw new Error("use --allow or --deny");
  }

  const payload = { reply: allow ? "allow" : "deny" };
  const response = await fetch(`${openworkUrl.replace(/\/$/, "")}/approvals/${approvalId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to reply to approval: ${response.status}`);
  }
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
}

async function runStatus(args: ParsedArgs) {
  const openworkUrl = readFlag(args.flags, "openwork-url") ?? process.env.OPENWORK_URL ?? "";
  const opencodeUrl = readFlag(args.flags, "opencode-url") ?? process.env.OPENCODE_URL ?? "";
  const username = readFlag(args.flags, "opencode-username") ?? process.env.OPENCODE_SERVER_USERNAME;
  const password = readFlag(args.flags, "opencode-password") ?? process.env.OPENCODE_SERVER_PASSWORD;
  const outputJson = readBool(args.flags, "json", false);

  const status: Record<string, unknown> = {};

  if (openworkUrl) {
    try {
      await waitForHealthy(openworkUrl, 5000, 400);
      status.openwork = { ok: true, url: openworkUrl };
    } catch (error) {
      status.openwork = { ok: false, url: openworkUrl, error: String(error) };
    }
  }

  if (opencodeUrl) {
    try {
      const headers: Record<string, string> = {};
      if (username && password) {
        headers.Authorization = `Basic ${encodeBasicAuth(username, password)}`;
      }
      const client = createOpencodeClient({
        baseUrl: opencodeUrl,
        headers,
      });
      const health = await waitForOpencodeHealthy(client, 5000, 400);
      status.opencode = { ok: true, url: opencodeUrl, health };
    } catch (error) {
      status.opencode = { ok: false, url: opencodeUrl, error: String(error) };
    }
  }

  if (outputJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    if (status.openwork) {
      const openwork = status.openwork as { ok: boolean; url: string; error?: string };
      console.log(`OpenWork server: ${openwork.ok ? "ok" : "error"} (${openwork.url})`);
      if (openwork.error) console.log(`  ${openwork.error}`);
    }
    if (status.opencode) {
      const opencode = status.opencode as { ok: boolean; url: string; error?: string };
      console.log(`OpenCode server: ${opencode.ok ? "ok" : "error"} (${opencode.url})`);
      if (opencode.error) console.log(`  ${opencode.error}`);
    }
  }
}

async function runStart(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const checkOnly = readBool(args.flags, "check", false);
  const checkEvents = readBool(args.flags, "check-events", false);
  const verbose = readBool(args.flags, "verbose", false, "OPENWRK_VERBOSE");
  const logFormat = readLogFormat(args.flags, "log-format", "pretty", "OPENWRK_LOG_FORMAT");
  const detachRequested = readBool(args.flags, "detach", false, "OPENWRK_DETACH");
  const defaultTui = process.stdout.isTTY && !outputJson && !checkOnly && !checkEvents;
  const tuiRequested = readBool(args.flags, "tui", defaultTui);
  const useTui = tuiRequested && !detachRequested && !outputJson && !checkOnly && !checkEvents && logFormat === "pretty";
  const colorEnabled =
    !useTui && readBool(args.flags, "color", process.stdout.isTTY, "OPENWRK_COLOR") && !process.env.NO_COLOR;
  const runId = readFlag(args.flags, "run-id") ?? process.env.OPENWRK_RUN_ID ?? randomUUID();
  const cliVersion = await resolveCliVersion();
  let tui: TuiHandle | undefined;
  const logger = createLogger({
    format: logFormat,
    runId,
    serviceName: "openwrk",
    serviceVersion: cliVersion,
    output: useTui ? "silent" : "stdout",
    color: colorEnabled,
    onLog: (event) => {
      if (!tui) return;
      const component = event.component ?? "openwrk";
      tui.pushLog({
        time: event.time,
        level: event.level,
        component,
        message: event.message,
      });
    },
  });
  const logVerbose = createVerboseLogger(verbose && !outputJson, logger, "openwrk");
  const sidecarSource = readBinarySource(args.flags, "sidecar-source", "auto", "OPENWRK_SIDECAR_SOURCE");
  const opencodeSource = readBinarySource(args.flags, "opencode-source", "auto", "OPENWRK_OPENCODE_SOURCE");

  const workspace = readFlag(args.flags, "workspace") ?? process.env.OPENWORK_WORKSPACE ?? process.cwd();
  const resolvedWorkspace = await ensureWorkspace(workspace);
  logger.info("Run starting", { workspace: resolvedWorkspace, logFormat, runId }, "openwrk");

  const explicitOpencodeBin = readFlag(args.flags, "opencode-bin") ?? process.env.OPENWORK_OPENCODE_BIN;
  const opencodeBindHost = readFlag(args.flags, "opencode-host") ?? process.env.OPENWORK_OPENCODE_BIND_HOST ?? "0.0.0.0";
  const opencodePort = await resolvePort(
    readNumber(args.flags, "opencode-port", undefined, "OPENWORK_OPENCODE_PORT"),
    "127.0.0.1",
  );
  const opencodeAuth = readBool(args.flags, "opencode-auth", true, "OPENWORK_OPENCODE_AUTH");
  const opencodeUsername = opencodeAuth
    ? readFlag(args.flags, "opencode-username") ?? process.env.OPENWORK_OPENCODE_USERNAME ?? DEFAULT_OPENCODE_USERNAME
    : undefined;
  const opencodePassword = opencodeAuth
    ? readFlag(args.flags, "opencode-password") ?? process.env.OPENWORK_OPENCODE_PASSWORD ?? randomUUID()
    : undefined;

  const openworkHost = readFlag(args.flags, "openwork-host") ?? process.env.OPENWORK_HOST ?? "0.0.0.0";
  const openworkPort = await resolvePort(
    readNumber(args.flags, "openwork-port", undefined, "OPENWORK_PORT"),
    "127.0.0.1",
    DEFAULT_OPENWORK_PORT,
  );
  const owpenbotHealthPort = await resolvePort(
    readNumber(args.flags, "owpenbot-health-port", undefined, "OWPENBOT_HEALTH_PORT"),
    "127.0.0.1",
    DEFAULT_OWPENBOT_HEALTH_PORT,
  );
  const openworkToken = readFlag(args.flags, "openwork-token") ?? process.env.OPENWORK_TOKEN ?? randomUUID();
  const openworkHostToken = readFlag(args.flags, "openwork-host-token") ?? process.env.OPENWORK_HOST_TOKEN ?? randomUUID();
  const approvalMode =
    (readFlag(args.flags, "approval") as ApprovalMode | undefined) ??
    (process.env.OPENWORK_APPROVAL_MODE as ApprovalMode | undefined) ??
    "manual";
  const approvalTimeoutMs = readNumber(
    args.flags,
    "approval-timeout",
    DEFAULT_APPROVAL_TIMEOUT,
    "OPENWORK_APPROVAL_TIMEOUT_MS",
  ) as number;
  const readOnly = readBool(args.flags, "read-only", false, "OPENWORK_READONLY");
  const corsValue = readFlag(args.flags, "cors") ?? process.env.OPENWORK_CORS_ORIGINS ?? "*";
  const corsOrigins = parseList(corsValue);
  const connectHost = readFlag(args.flags, "connect-host");

  const sidecar = resolveSidecarConfig(args.flags, cliVersion);
  const manifest = await readVersionManifest();
  const allowExternal = readBool(args.flags, "allow-external", false, "OPENWRK_ALLOW_EXTERNAL");
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  const opencodeBinary = await resolveOpencodeBin({
    explicit: explicitOpencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });
  const explicitOpenworkServerBin = readFlag(args.flags, "openwork-server-bin") ?? process.env.OPENWORK_SERVER_BIN;
  const explicitOwpenbotBin = readFlag(args.flags, "owpenbot-bin") ?? process.env.OWPENBOT_BIN;
  const owpenbotEnabled = readBool(args.flags, "owpenbot", true);
  const owpenbotRequired = readBool(args.flags, "owpenbot-required", false, "OPENWRK_OWPENBOT_REQUIRED");
  const openworkServerBinary = await resolveOpenworkServerBin({
    explicit: explicitOpenworkServerBin,
    manifest,
    allowExternal,
    sidecar,
    source: sidecarSource,
  });
  const owpenbotBinary = owpenbotEnabled
    ? await resolveOwpenbotBin({
        explicit: explicitOwpenbotBin,
        manifest,
        allowExternal,
        sidecar,
        source: sidecarSource,
      })
    : null;
  let owpenbotActualVersion: string | undefined;
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);
  logVerbose(`openwork-server bin: ${openworkServerBinary.bin} (${openworkServerBinary.source})`);
  if (owpenbotBinary) {
    logVerbose(`owpenbot bin: ${owpenbotBinary.bin} (${owpenbotBinary.source})`);
  }

  const opencodeBaseUrl = `http://127.0.0.1:${opencodePort}`;
  const opencodeConnect = resolveConnectUrl(opencodePort, connectHost);
  const opencodeConnectUrl = opencodeConnect.connectUrl ?? opencodeBaseUrl;

  const openworkBaseUrl = `http://127.0.0.1:${openworkPort}`;
  const openworkConnect = resolveConnectUrl(openworkPort, connectHost);
  const openworkConnectUrl = openworkConnect.connectUrl ?? openworkBaseUrl;

  const attachCommand = buildAttachCommand({
    url: opencodeConnectUrl,
    workspace: resolvedWorkspace,
    username: opencodeUsername,
    password: opencodePassword,
  });

  const owpenbotHealthUrl = `http://127.0.0.1:${owpenbotHealthPort}`;
  const owpenbotEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_DIRECTORY: resolvedWorkspace,
    OPENCODE_URL: opencodeConnectUrl,
    ...(opencodeUsername ? { OPENCODE_SERVER_USERNAME: opencodeUsername } : {}),
    ...(opencodePassword ? { OPENCODE_SERVER_PASSWORD: opencodePassword } : {}),
    ...(owpenbotHealthPort ? { OWPENBOT_HEALTH_PORT: String(owpenbotHealthPort) } : {}),
  };

  const children: ChildHandle[] = [];
  let shuttingDown = false;
  let detached = false;
  const startedAt = Date.now();
  let owpenbotHealthInterval: NodeJS.Timeout | null = null;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (owpenbotHealthInterval) {
      clearInterval(owpenbotHealthInterval);
      owpenbotHealthInterval = null;
    }
    logger.info("Shutting down", { children: children.map((handle) => handle.name) }, "openwrk");
    await Promise.all(children.map((handle) => stopChild(handle.child)));
  };

  const detachChildren = () => {
    detached = true;
    for (const handle of children) {
      try {
        handle.child.unref();
      } catch {
        // ignore
      }
      handle.child.stdout?.removeAllListeners();
      handle.child.stderr?.removeAllListeners();
      handle.child.stdout?.destroy();
      handle.child.stderr?.destroy();
    }
  };

  const handleQuit = async () => {
    tui?.stop();
    await shutdown();
    process.exit(0);
  };

  const handleDetach = async () => {
    if (detached) return;
    if (owpenbotHealthInterval) {
      clearInterval(owpenbotHealthInterval);
      owpenbotHealthInterval = null;
    }
    tui?.stop();
    detachChildren();
    const summary = [
      "Detached. Services still running:",
      ...children.map((handle) => `- ${handle.name} (pid ${handle.child.pid ?? "unknown"})`),
      `OpenWork URL: ${openworkConnectUrl}`,
      `OpenWork Token: ${openworkToken}`,
      `OpenCode URL: ${opencodeConnectUrl}`,
      `Attach: ${attachCommand}`,
    ].join("\n");
    process.stdout.write(`${summary}\n`);
    process.exit(0);
  };

  if (useTui) {
    tui = startOpenwrkTui({
      version: cliVersion,
      connect: {
        runId,
        workspace: resolvedWorkspace,
        openworkUrl: openworkConnectUrl,
        openworkToken,
        hostToken: openworkHostToken,
        opencodeUrl: opencodeConnectUrl,
        opencodePassword: opencodePassword ?? undefined,
        opencodeUsername: opencodeUsername ?? undefined,
        attachCommand,
      },
      services: [
        { name: "opencode", label: "opencode", status: "starting", port: opencodePort },
        { name: "openwork-server", label: "openwork-server", status: "starting", port: openworkPort },
        {
          name: "owpenbot",
          label: "owpenbot",
          status: owpenbotEnabled ? "starting" : "disabled",
          port: owpenbotHealthPort,
        },
      ],
      onQuit: handleQuit,
      onDetach: handleDetach,
      onCopyAttach: async () => {
        const result = await copyToClipboard(attachCommand);
        return { command: attachCommand, ...result };
      },
      onOwpenbotHealth: async () => fetchOwpenbotHealth(owpenbotHealthUrl),
      onOwpenbotQr: async () => {
        if (!owpenbotBinary) {
          throw new Error("Owpenbot binary missing");
        }
        const output = await captureCommandOutput(
          owpenbotBinary.bin,
          ["whatsapp", "qr", "--format", "ascii"],
          { env: owpenbotEnv },
        );
        if (!output) {
          throw new Error("No QR output received");
        }
        return output;
      },
      onOwpenbotSetTelegramToken: async (token) => {
        try {
          await fetchJson(`${owpenbotHealthUrl}/config/telegram-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    tui.setUptimeStart(startedAt);
  }

  const handleExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
    if (shuttingDown || detached) return;
    const reason = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
    tui?.updateService(name, { status: "stopped", message: reason });
    logger.error("Process exited", { reason, code, signal }, name);
    void shutdown().then(() => process.exit(code ?? 1));
  };

  const handleSpawnError = (name: string, error: unknown) => {
    if (shuttingDown || detached) return;
    tui?.updateService(name, { status: "error", message: String(error) });
    logger.error("Process failed to start", { error: String(error) }, name);
    void shutdown().then(() => process.exit(1));
  };

  try {
    const opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    const opencodeChild = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkspace,
      bindHost: opencodeBindHost,
      port: opencodePort,
      username: opencodeUsername,
      password: opencodePassword,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
    });
    children.push({ name: "opencode", child: opencodeChild });
    tui?.updateService("opencode", {
      status: "running",
      pid: opencodeChild.pid ?? undefined,
      port: opencodePort,
    });
    logger.info("Process spawned", { pid: opencodeChild.pid ?? 0 }, "opencode");
    opencodeChild.on("exit", (code, signal) => handleExit("opencode", code, signal));
    opencodeChild.on("error", (error) => handleSpawnError("opencode", error));

    const authHeaders: Record<string, string> = {};
    if (opencodeUsername && opencodePassword) {
      authHeaders.Authorization = `Basic ${encodeBasicAuth(opencodeUsername, opencodePassword)}`;
    }
    const opencodeClient = createOpencodeClient({
      baseUrl: opencodeBaseUrl,
      directory: resolvedWorkspace,
      headers: Object.keys(authHeaders).length ? authHeaders : undefined,
    });

    logger.info("Waiting for health", { url: opencodeBaseUrl }, "opencode");
    await waitForOpencodeHealthy(opencodeClient);
    logger.info("Healthy", { url: opencodeBaseUrl }, "opencode");
    tui?.updateService("opencode", { status: "healthy" });

    const openworkChild = await startOpenworkServer({
      bin: openworkServerBinary.bin,
      host: openworkHost,
      port: openworkPort,
      workspace: resolvedWorkspace,
      token: openworkToken,
      hostToken: openworkHostToken,
      approvalMode: approvalMode === "auto" ? "auto" : "manual",
      approvalTimeoutMs,
      readOnly,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      opencodeBaseUrl: opencodeConnectUrl,
      opencodeDirectory: resolvedWorkspace,
      opencodeUsername,
      opencodePassword,
      owpenbotHealthPort,
      logger,
      runId,
      logFormat,
    });
    children.push({ name: "openwork-server", child: openworkChild });
    tui?.updateService("openwork-server", {
      status: "running",
      pid: openworkChild.pid ?? undefined,
      port: openworkPort,
    });
    logger.info("Process spawned", { pid: openworkChild.pid ?? 0 }, "openwork-server");
    openworkChild.on("exit", (code, signal) => handleExit("openwork-server", code, signal));
    openworkChild.on("error", (error) => handleSpawnError("openwork-server", error));

    logger.info("Waiting for health", { url: openworkBaseUrl }, "openwork-server");
    await waitForHealthy(openworkBaseUrl);
    logger.info("Healthy", { url: openworkBaseUrl }, "openwork-server");
    tui?.updateService("openwork-server", { status: "healthy" });

    const openworkActualVersion = await verifyOpenworkServer({
      baseUrl: openworkBaseUrl,
      token: openworkToken,
      hostToken: openworkHostToken,
      expectedVersion: openworkServerBinary.expectedVersion,
      expectedWorkspace: resolvedWorkspace,
      expectedOpencodeBaseUrl: opencodeConnectUrl,
      expectedOpencodeDirectory: resolvedWorkspace,
      expectedOpencodeUsername: opencodeUsername,
      expectedOpencodePassword: opencodePassword,
    });
    logVerbose(`openwork-server version: ${openworkActualVersion ?? "unknown"}`);

    if (owpenbotEnabled) {
      if (!owpenbotBinary) {
        throw new Error("Owpenbot binary missing.");
      }
      owpenbotActualVersion = await verifyOwpenbotVersion(owpenbotBinary);
      logVerbose(`owpenbot version: ${owpenbotActualVersion ?? "unknown"}`);
      const owpenbotChild = await startOwpenbot({
        bin: owpenbotBinary.bin,
        workspace: resolvedWorkspace,
        opencodeUrl: opencodeConnectUrl,
        opencodeUsername,
        opencodePassword,
        owpenbotHealthPort,
        logger,
        runId,
        logFormat,
      });
      children.push({ name: "owpenbot", child: owpenbotChild });
      tui?.updateService("owpenbot", {
        status: "running",
        pid: owpenbotChild.pid ?? undefined,
        port: owpenbotHealthPort,
      });
      logger.info("Process spawned", { pid: owpenbotChild.pid ?? 0 }, "owpenbot");
      try {
        logger.info("Waiting for health", { url: owpenbotHealthUrl }, "owpenbot");
        const health = await waitForOwpenbotHealthy(owpenbotHealthUrl);
        tui?.setOwpenbotHealth(health);
        tui?.updateService("owpenbot", { status: health.ok ? "healthy" : "running" });
        logger.info("Healthy", { url: owpenbotHealthUrl, ok: health.ok }, "owpenbot");
      } catch (error) {
        logger.warn("Owpenbot health check failed", { error: String(error) }, "owpenbot");
        tui?.updateService("owpenbot", { status: "running", message: String(error) });
      }
      if (!owpenbotHealthInterval) {
        owpenbotHealthInterval = setInterval(() => {
          fetchOwpenbotHealth(owpenbotHealthUrl)
            .then((health) => {
              tui?.setOwpenbotHealth(health);
              if (health.ok) {
                tui?.updateService("owpenbot", { status: "healthy" });
              }
            })
            .catch(() => undefined);
        }, 15_000);
      }
      owpenbotChild.on("exit", (code, signal) => {
        if (owpenbotRequired) {
          handleExit("owpenbot", code, signal);
          return;
        }
        const reason = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
        tui?.updateService("owpenbot", { status: "stopped", message: reason });
        logger.warn("Process exited, continuing without owpenbot", { reason, code, signal }, "owpenbot");
      });
      owpenbotChild.on("error", (error) => handleSpawnError("owpenbot", error));
    }

    const payload = {
      runId,
      workspace: resolvedWorkspace,
      approval: {
        mode: approvalMode,
        timeoutMs: approvalTimeoutMs,
        readOnly,
      },
      opencode: {
        baseUrl: opencodeBaseUrl,
        connectUrl: opencodeConnectUrl,
        username: opencodeUsername,
        password: opencodePassword,
        bindHost: opencodeBindHost,
        port: opencodePort,
        version: opencodeActualVersion,
      },
      openwork: {
        baseUrl: openworkBaseUrl,
        connectUrl: openworkConnectUrl,
        host: openworkHost,
        port: openworkPort,
        token: openworkToken,
        hostToken: openworkHostToken,
        version: openworkActualVersion,
      },
      owpenbot: {
        enabled: owpenbotEnabled,
        version: owpenbotEnabled ? owpenbotActualVersion : undefined,
        healthPort: owpenbotHealthPort,
      },
      diagnostics: {
        cliVersion,
        sidecar: {
          dir: sidecar.dir,
          baseUrl: sidecar.baseUrl,
          manifestUrl: sidecar.manifestUrl,
          target: sidecar.target,
          source: sidecarSource,
          opencodeSource,
          allowExternal,
        } as SidecarDiagnostics,
        binaries: {
          opencode: {
            path: opencodeBinary.bin,
            source: opencodeBinary.source,
            expectedVersion: opencodeBinary.expectedVersion,
            actualVersion: opencodeActualVersion,
          } as BinaryDiagnostics,
          openworkServer: {
            path: openworkServerBinary.bin,
            source: openworkServerBinary.source,
            expectedVersion: openworkServerBinary.expectedVersion,
            actualVersion: openworkActualVersion,
          } as BinaryDiagnostics,
          owpenbot: owpenbotBinary
            ? ({
                path: owpenbotBinary.bin,
                source: owpenbotBinary.source,
                expectedVersion: owpenbotBinary.expectedVersion,
                actualVersion: owpenbotActualVersion,
              } as BinaryDiagnostics)
            : null,
        },
      },
    };

    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (useTui) {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          openwork: payload.openwork,
          owpenbot: payload.owpenbot,
        },
        "openwrk",
      );
    } else if (logFormat === "json") {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          openwork: payload.openwork,
          owpenbot: payload.owpenbot,
        },
        "openwrk",
      );
    } else {
      console.log("Openwrk running");
      console.log(`Run ID: ${runId}`);
      console.log(`Workspace: ${payload.workspace}`);
      console.log(`OpenCode: ${payload.opencode.baseUrl}`);
      console.log(`OpenCode connect URL: ${payload.opencode.connectUrl}`);
      if (payload.opencode.username && payload.opencode.password) {
        console.log(`OpenCode auth: ${payload.opencode.username} / ${payload.opencode.password}`);
      }
      console.log(`OpenWork server: ${payload.openwork.baseUrl}`);
      console.log(`OpenWork connect URL: ${payload.openwork.connectUrl}`);
      console.log(`Client token: ${payload.openwork.token}`);
      console.log(`Host token: ${payload.openwork.hostToken}`);
    }

    if (detachRequested) {
      await handleDetach();
    }

    if (checkOnly) {
      try {
        await runChecks({
          opencodeClient,
          openworkUrl: openworkBaseUrl,
          openworkToken,
          checkEvents,
        });
        logger.info("Checks ok", { checkEvents }, "openwrk");
        if (!outputJson && logFormat === "pretty") {
          console.log("Checks: ok");
        }
      } catch (error) {
        logger.error("Checks failed", { error: String(error) }, "openwrk");
        await shutdown();
        tui?.stop();
        process.exit(1);
      }
      await shutdown();
      tui?.stop();
      process.exit(0);
    }

    process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
    process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
    await new Promise(() => undefined);
  } catch (error) {
    await shutdown();
    tui?.stop();
    logger.error("Run failed", { error: error instanceof Error ? error.message : String(error) }, "openwrk");
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (readBool(args.flags, "help", false) || args.flags.get("help") === true) {
    printHelp();
    return;
  }
  if (readBool(args.flags, "version", false) || args.flags.get("version") === true) {
    console.log(await resolveCliVersion());
    return;
  }

  const command = args.positionals[0] ?? "start";
  if (command === "start") {
    await runStart(args);
    return;
  }
  if (command === "serve") {
    args.flags.set("tui", false);
    await runStart(args);
    return;
  }
  if (command === "daemon") {
    await runDaemonCommand(args);
    return;
  }
  if (command === "workspace" || command === "workspaces") {
    await runWorkspaceCommand(args);
    return;
  }
  if (command === "instance") {
    await runInstanceCommand(args);
    return;
  }
  if (command === "approvals") {
    await runApprovals(args);
    return;
  }
  if (command === "status") {
    await runStatus(args);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
