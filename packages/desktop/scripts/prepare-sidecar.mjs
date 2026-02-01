import { spawnSync } from "child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const sidecarDir = join(__dirname, "..", "src-tauri", "sidecars");
const packageJsonPath = resolve(__dirname, "..", "package.json");
const opencodeVersion = (() => {
  if (process.env.OPENCODE_VERSION?.trim()) return process.env.OPENCODE_VERSION.trim();
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.opencodeVersion) return String(pkg.opencodeVersion).trim();
  } catch {
    // ignore
  }
  return null;
})();
const opencodeAssetOverride = process.env.OPENCODE_ASSET?.trim() || null;

// Target triple for native platform binaries
const resolvedTargetTriple = (() => {
  const envTarget =
    process.env.TAURI_ENV_TARGET_TRIPLE ??
    process.env.CARGO_CFG_TARGET_TRIPLE ??
    process.env.TARGET;
  if (envTarget) return envTarget;
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  return null;
})();

const bunTarget = (() => {
  switch (resolvedTargetTriple) {
    case "aarch64-apple-darwin":
      return "bun-darwin-arm64";
    case "x86_64-apple-darwin":
      return "bun-darwin-x64";
    case "aarch64-unknown-linux-gnu":
      return "bun-linux-arm64";
    case "x86_64-unknown-linux-gnu":
      return "bun-linux-x64";
    case "x86_64-pc-windows-msvc":
      return "bun-windows-x64";
    default:
      return null;
  }
})();

const opencodeBaseName = process.platform === "win32" ? "opencode.exe" : "opencode";
const opencodePath = join(sidecarDir, opencodeBaseName);
const opencodeTargetName = resolvedTargetTriple
  ? `opencode-${resolvedTargetTriple}${process.platform === "win32" ? ".exe" : ""}`
  : null;
const opencodeTargetPath = opencodeTargetName ? join(sidecarDir, opencodeTargetName) : null;

// openwork-server paths
const openworkServerBaseName = "openwork-server";
const openworkServerName = process.platform === "win32" ? `${openworkServerBaseName}.exe` : openworkServerBaseName;
const openworkServerPath = join(sidecarDir, openworkServerName);
const openworkServerBuildName = bunTarget
  ? `${openworkServerBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : openworkServerName;
const openworkServerBuildPath = join(sidecarDir, openworkServerBuildName);
const openworkServerTargetTriple = resolvedTargetTriple;
const openworkServerTargetName = openworkServerTargetTriple
  ? `${openworkServerBaseName}-${openworkServerTargetTriple}${openworkServerTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const openworkServerTargetPath = openworkServerTargetName ? join(sidecarDir, openworkServerTargetName) : null;

const openworkServerDir = resolve(__dirname, "..", "..", "server");

const resolveOwpenbotDir = () => {
  const envPath = process.env.OWPENBOT_REPO?.trim() || process.env.OWPENBOT_DIR?.trim();
  const candidates = [envPath, resolve(repoRoot, "..", "owpenbot"), resolve(repoRoot, "vendor", "owpenbot")].filter(
    Boolean,
  );

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
  }

  const cloneTarget = envPath ?? resolve(repoRoot, "..", "owpenbot");
  const repoUrl = process.env.OWPENBOT_REPO_URL?.trim() || "https://github.com/different-ai/owpenbot.git";
  const repoRef = process.env.OWPENBOT_REF?.trim() || "dev";

  if (!cloneTarget) {
    throw new Error("OWPENBOT_REPO not found and no clone target available.");
  }

  const result = spawnSync("git", ["clone", "--depth", "1", "--branch", repoRef, repoUrl, cloneTarget], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to clone owpenbot from ${repoUrl}`);
  }

  if (!existsSync(join(cloneTarget, "package.json"))) {
    throw new Error(`Owpenbot package.json not found in ${cloneTarget}`);
  }

  return cloneTarget;
};

// owpenbot paths
const owpenbotBaseName = "owpenbot";
const owpenbotName = process.platform === "win32" ? `${owpenbotBaseName}.exe` : owpenbotBaseName;
const owpenbotPath = join(sidecarDir, owpenbotName);
const owpenbotBuildName = bunTarget
  ? `${owpenbotBaseName}-${bunTarget}${bunTarget.includes("windows") ? ".exe" : ""}`
  : owpenbotName;
const owpenbotBuildPath = join(sidecarDir, owpenbotBuildName);
const owpenbotTargetTriple = resolvedTargetTriple;
const owpenbotTargetName = owpenbotTargetTriple
  ? `${owpenbotBaseName}-${owpenbotTargetTriple}${owpenbotTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const owpenbotTargetPath = owpenbotTargetName ? join(sidecarDir, owpenbotTargetName) : null;

const owpenbotDir = resolveOwpenbotDir();
const readHeader = (filePath, length = 256) => {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
};

const isStubBinary = (filePath) => {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return true;
    if (stat.size < 1024) return true;
    const header = readHeader(filePath);
    if (header.startsWith("#!")) return true;
    if (header.includes("Sidecar missing") || header.includes("Bun is required")) return true;
  } catch {
    return true;
  }
  return false;
};

const readDirectory = (dir) => {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      return readDirectory(next);
    }
    if (entry.isFile()) {
      return [next];
    }
    return [];
  });
};

const findOpencodeBinary = (dir) => {
  const candidates = readDirectory(dir);
  return (
    candidates.find((file) => file.endsWith(`/${opencodeBaseName}`) || file.endsWith(`\\${opencodeBaseName}`)) ??
    candidates.find((file) => file.endsWith("/opencode") || file.endsWith("\\opencode")) ??
    null
  );
};

const readBinaryVersion = (filePath) => {
  try {
    const result = spawnSync(filePath, ["--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout) return result.stdout.trim();
  } catch {
    // ignore
  }
  return null;
};

const shouldBuildOpenworkServer =
  !existsSync(openworkServerBuildPath) || isStubBinary(openworkServerBuildPath);

if (shouldBuildOpenworkServer) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(openworkServerBuildPath)) {
    try {
      unlinkSync(openworkServerBuildPath);
    } catch {
      // ignore
    }
  }
  const openworkServerArgs = ["./script/build.ts", "--outdir", sidecarDir, "--filename", "openwork-server"];
  if (bunTarget) {
    openworkServerArgs.push("--target", bunTarget);
  }
  const buildResult = spawnSync("bun", openworkServerArgs, {
    cwd: openworkServerDir,
    stdio: "inherit",
  });

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
}

if (existsSync(openworkServerBuildPath)) {
  const shouldCopyCanonical = !existsSync(openworkServerPath) || isStubBinary(openworkServerPath);
  if (shouldCopyCanonical && openworkServerBuildPath !== openworkServerPath) {
    try {
      if (existsSync(openworkServerPath)) {
        unlinkSync(openworkServerPath);
      }
    } catch {
      // ignore
    }
    copyFileSync(openworkServerBuildPath, openworkServerPath);
  }

  if (openworkServerTargetPath) {
    const shouldCopyTarget = !existsSync(openworkServerTargetPath) || isStubBinary(openworkServerTargetPath);
    if (shouldCopyTarget && openworkServerBuildPath !== openworkServerTargetPath) {
      try {
        if (existsSync(openworkServerTargetPath)) {
          unlinkSync(openworkServerTargetPath);
        }
      } catch {
        // ignore
      }
      copyFileSync(openworkServerBuildPath, openworkServerTargetPath);
    }
  }
}

// Build owpenbot
const shouldBuildOwpenbot = !existsSync(owpenbotBuildPath) || isStubBinary(owpenbotBuildPath);

if (shouldBuildOwpenbot) {
  mkdirSync(sidecarDir, { recursive: true });
  if (existsSync(owpenbotBuildPath)) {
    try {
      unlinkSync(owpenbotBuildPath);
    } catch {
      // ignore
    }
  }
  const owpenbotArgs = ["./script/build.ts", "--outdir", sidecarDir, "--filename", "owpenbot"];
  if (bunTarget) {
    owpenbotArgs.push("--target", bunTarget);
  }
  const owpenbotBuildResult = spawnSync("bun", owpenbotArgs, {
    cwd: owpenbotDir,
    stdio: "inherit",
  });

  if (owpenbotBuildResult.status !== 0) {
    process.exit(owpenbotBuildResult.status ?? 1);
  }
}

if (existsSync(owpenbotBuildPath)) {
  const shouldCopyCanonical = !existsSync(owpenbotPath) || isStubBinary(owpenbotPath);
  if (shouldCopyCanonical && owpenbotBuildPath !== owpenbotPath) {
    try {
      if (existsSync(owpenbotPath)) {
        unlinkSync(owpenbotPath);
      }
    } catch {
      // ignore
    }
    copyFileSync(owpenbotBuildPath, owpenbotPath);
  }

  if (owpenbotTargetPath) {
    const shouldCopyOwpenbotTarget = !existsSync(owpenbotTargetPath) || isStubBinary(owpenbotTargetPath);
    if (shouldCopyOwpenbotTarget && owpenbotBuildPath !== owpenbotTargetPath) {
      try {
        if (existsSync(owpenbotTargetPath)) {
          unlinkSync(owpenbotTargetPath);
        }
      } catch {
        // ignore
      }
      copyFileSync(owpenbotBuildPath, owpenbotTargetPath);
    }
  }
}

const normalizedVersion = opencodeVersion?.startsWith("v")
  ? opencodeVersion.slice(1)
  : opencodeVersion;

if (!normalizedVersion) {
  console.error(
    "OpenCode version is not configured. Set OPENCODE_VERSION or add opencodeVersion to packages/desktop/package.json."
  );
  process.exit(1);
}

const opencodeAssetByTarget = {
  "aarch64-apple-darwin": "opencode-darwin-arm64.zip",
  "x86_64-apple-darwin": "opencode-darwin-x64-baseline.zip",
  "x86_64-unknown-linux-gnu": "opencode-linux-x64-baseline.tar.gz",
  "aarch64-unknown-linux-gnu": "opencode-linux-arm64.tar.gz",
  "x86_64-pc-windows-msvc": "opencode-windows-x64-baseline.zip",
  "aarch64-pc-windows-msvc": "opencode-windows-arm64.zip",
};

const opencodeAsset =
  opencodeAssetOverride ?? (resolvedTargetTriple ? opencodeAssetByTarget[resolvedTargetTriple] : null);

const opencodeUrl = opencodeAsset
  ? `https://github.com/anomalyco/opencode/releases/download/v${normalizedVersion}/${opencodeAsset}`
  : null;

const opencodeCandidatePath = opencodeTargetPath ?? opencodePath;
const existingVersion =
  opencodeCandidatePath && existsSync(opencodeCandidatePath)
    ? readBinaryVersion(opencodeCandidatePath)
    : null;

const shouldDownloadOpencode =
  !opencodeCandidatePath ||
  !existsSync(opencodeCandidatePath) ||
  isStubBinary(opencodeCandidatePath) ||
  !existingVersion ||
  existingVersion !== normalizedVersion;

if (!shouldDownloadOpencode) {
  console.log(`OpenCode sidecar already present (${existingVersion}).`);
  process.exit(0);
}

if (!opencodeAsset || !opencodeUrl) {
  console.error(
    `No OpenCode asset configured for target ${resolvedTargetTriple ?? "unknown"}. Set OPENCODE_ASSET to override.`
  );
  process.exit(1);
}

mkdirSync(sidecarDir, { recursive: true });

const stamp = Date.now();
const archivePath = join(tmpdir(), `opencode-${stamp}-${opencodeAsset}`);
const extractDir = join(tmpdir(), `opencode-${stamp}`);

mkdirSync(extractDir, { recursive: true });

if (process.platform === "win32") {
  const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    `Invoke-WebRequest -Uri ${psQuote(opencodeUrl)} -OutFile ${psQuote(archivePath)}`,
    `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
  ].join("; ");

  const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} else {
  const downloadResult = spawnSync("curl", ["-fsSL", "-o", archivePath, opencodeUrl], {
    stdio: "inherit",
  });
  if (downloadResult.status !== 0) {
    process.exit(downloadResult.status ?? 1);
  }

  mkdirSync(extractDir, { recursive: true });

  if (opencodeAsset.endsWith(".zip")) {
    const unzipResult = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], {
      stdio: "inherit",
    });
    if (unzipResult.status !== 0) {
      process.exit(unzipResult.status ?? 1);
    }
  } else if (opencodeAsset.endsWith(".tar.gz")) {
    const tarResult = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
      stdio: "inherit",
    });
    if (tarResult.status !== 0) {
      process.exit(tarResult.status ?? 1);
    }
  } else {
    console.error(`Unknown OpenCode archive type: ${opencodeAsset}`);
    process.exit(1);
  }
}

const extractedBinary = findOpencodeBinary(extractDir);
if (!extractedBinary) {
  console.error("OpenCode binary not found after extraction.");
  process.exit(1);
}

const opencodeTargets = [opencodeTargetPath, opencodePath].filter(Boolean);
for (const target of opencodeTargets) {
  try {
    if (existsSync(target)) {
      unlinkSync(target);
    }
  } catch {
    // ignore
  }
  copyFileSync(extractedBinary, target);
  try {
    chmodSync(target, 0o755);
  } catch {
    // ignore
  }
}

console.log(`OpenCode sidecar updated to ${normalizedVersion}.`);
