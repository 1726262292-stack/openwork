import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, chmod, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform, arch } from "node:os";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 18;
const NODE_VERSION = "v22.19.0";

const CACHE_DIR = join(homedir(), ".openwork", "agent-lab", "node");

function platKey(): { os: string; arch: string; ext: string } {
  const p = platform();
  const a = arch();
  if (p === "darwin" && a === "arm64") return { os: "darwin", arch: "arm64", ext: "tar.gz" };
  if (p === "darwin" && a === "x64") return { os: "darwin", arch: "x64", ext: "tar.gz" };
  if (p === "linux" && a === "x64") return { os: "linux", arch: "x64", ext: "tar.xz" };
  if (p === "linux" && a === "arm64") return { os: "linux", arch: "arm64", ext: "tar.xz" };
  if (p === "win32" && a === "x64") return { os: "win", arch: "x64", ext: "zip" };
  throw new Error(`Unsupported platform: ${p} ${a}`);
}

function nodeUrl(): string {
  const { os: osKey, arch: archKey, ext } = platKey();
  const osName = osKey === "win" ? "win" : osKey;
  return `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${osName}-${archKey}.${ext}`;
}

function binaryName(): string {
  return platform() === "win32" ? "node.exe" : "node";
}

function cachedNodePath(): string {
  const { os: osKey, arch: archKey } = platKey();
  return join(CACHE_DIR, `node-${NODE_VERSION}-${osKey}-${archKey}`, "bin", binaryName());
}

function parseVersion(v: string): { major: number; minor: number } | null {
  const m = /^v?(\d+)\.(\d+)\./.exec(v.trim());
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function meetsRequirement(v: string): boolean {
  const parsed = parseVersion(v);
  if (!parsed) return false;
  if (parsed.major > REQUIRED_NODE_MAJOR) return true;
  if (parsed.major < REQUIRED_NODE_MAJOR) return false;
  return parsed.minor >= REQUIRED_NODE_MINOR;
}

function tryExec(bin: string): string | null {
  try {
    const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  } catch {
    // not available
  }
  return null;
}

async function downloadAndExtract(): Promise<string> {
  const url = nodeUrl();
  const { ext } = platKey();
  const archivePath = join(CACHE_DIR, `node-download.${ext}`);
  const extractDir = join(CACHE_DIR, `node-${NODE_VERSION}-${platKey().os}-${platKey().arch}`);

  await mkdir(CACHE_DIR, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download Node from ${url}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(archivePath, buffer);

  if (ext === "tar.gz" || ext === "tar.xz") {
    const flag = ext === "tar.gz" ? "-xzf" : "-xJf";
    const result = spawnSync("tar", [flag, archivePath, "-C", CACHE_DIR], { stdio: "ignore" });
    if (result.status !== 0) throw new Error("Failed to extract Node tarball");
  } else if (ext === "zip") {
    const result = spawnSync("unzip", ["-o", archivePath, "-d", CACHE_DIR], { stdio: "ignore" });
    if (result.status !== 0) throw new Error("Failed to extract Node zip");
  }

  const binPath = cachedNodePath();
  if (!existsSync(binPath)) {
    const altPath = join(extractDir, binaryName());
    if (existsSync(altPath)) return altPath;
    throw new Error(`Node binary not found after extraction at ${binPath}`);
  }

  await chmod(binPath, 0o755);
  return binPath;
}

let resolvedNode: string | null = null;

export async function resolveNodeBin(): Promise<string> {
  if (resolvedNode) return resolvedNode;

  const candidates = [
    process.env.OPENWORK_NODE_BIN,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    join(homedir(), ".nvm/versions/node", NODE_VERSION, "bin", "node"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    const version = tryExec(candidate);
    if (version && meetsRequirement(version)) {
      resolvedNode = candidate;
      return candidate;
    }
  }

  const cached = cachedNodePath();
  if (existsSync(cached)) {
    const version = tryExec(cached);
    if (version && meetsRequirement(version)) {
      resolvedNode = cached;
      return cached;
    }
  }

  const downloaded = await downloadAndExtract();
  resolvedNode = downloaded;
  return downloaded;
}

export function getNodeVersion(): string | null {
  if (!resolvedNode) return null;
  return tryExec(resolvedNode);
}
