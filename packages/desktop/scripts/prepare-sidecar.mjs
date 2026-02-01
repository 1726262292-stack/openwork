import { spawnSync } from "child_process";
import { createHash } from "crypto";
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
const owpenbotVersion = (() => {
  if (process.env.OWPENBOT_VERSION?.trim()) return process.env.OWPENBOT_VERSION.trim();
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.owpenbotVersion) return String(pkg.owpenbotVersion).trim();
  } catch {
    // ignore
  }
  return null;
})();
const owpenbotAssetOverride = process.env.OWPENBOT_ASSET?.trim() || null;

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

const resolveBuildScript = (dir) => {
  const scriptPath = resolve(dir, "script", "build.ts");
  if (existsSync(scriptPath)) return scriptPath;
  const scriptsPath = resolve(dir, "scripts", "build.ts");
  if (existsSync(scriptsPath)) return scriptsPath;
  return scriptPath;
};

// owpenbot paths
const owpenbotBaseName = "owpenbot";
const owpenbotName = process.platform === "win32" ? `${owpenbotBaseName}.exe` : owpenbotBaseName;
const owpenbotPath = join(sidecarDir, owpenbotName);
const owpenbotTargetTriple = resolvedTargetTriple;
const owpenbotTargetName = owpenbotTargetTriple
  ? `${owpenbotBaseName}-${owpenbotTargetTriple}${owpenbotTargetTriple.includes("windows") ? ".exe" : ""}`
  : null;
const owpenbotTargetPath = owpenbotTargetName ? join(sidecarDir, owpenbotTargetName) : null;
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

const findOwpenbotBinary = (dir) => {
  const candidates = readDirectory(dir);
  return (
    candidates.find((file) => file.endsWith(`/${owpenbotName}`) || file.endsWith(`\\${owpenbotName}`)) ??
    candidates.find((file) => file.endsWith("/owpenbot") || file.endsWith("\\owpenbot")) ??
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

const sha256File = (filePath) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
};

const parseChecksum = (content, assetName) => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/);
    if (name === assetName) return hash.toLowerCase();
    if (trimmed.endsWith(` ${assetName}`)) {
      return trimmed.split(/\s+/)[0]?.toLowerCase() ?? null;
    }
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
  const openworkServerScript = resolveBuildScript(openworkServerDir);
  if (!existsSync(openworkServerScript)) {
    console.error(`OpenWork server build script not found at ${openworkServerScript}`);
    process.exit(1);
  }
  const openworkServerArgs = [openworkServerScript, "--outdir", sidecarDir, "--filename", "openwork-server"];
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

const normalizedOpencodeVersion = opencodeVersion?.startsWith("v")
  ? opencodeVersion.slice(1)
  : opencodeVersion;

if (!normalizedOpencodeVersion) {
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
  ? `https://github.com/anomalyco/opencode/releases/download/v${normalizedOpencodeVersion}/${opencodeAsset}`
  : null;

const opencodeCandidatePath = opencodeTargetPath ?? opencodePath;
const existingOpencodeVersion =
  opencodeCandidatePath && existsSync(opencodeCandidatePath)
    ? readBinaryVersion(opencodeCandidatePath)
    : null;

const shouldDownloadOpencode =
  !opencodeCandidatePath ||
  !existsSync(opencodeCandidatePath) ||
  isStubBinary(opencodeCandidatePath) ||
  !existingOpencodeVersion ||
  existingOpencodeVersion !== normalizedOpencodeVersion;

if (!shouldDownloadOpencode) {
  console.log(`OpenCode sidecar already present (${existingOpencodeVersion}).`);
}

if (shouldDownloadOpencode) {
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

  console.log(`OpenCode sidecar updated to ${normalizedOpencodeVersion}.`);
}

const normalizedOwpenbotVersion = owpenbotVersion?.startsWith("v")
  ? owpenbotVersion.slice(1)
  : owpenbotVersion;

if (!normalizedOwpenbotVersion) {
  console.error(
    "Owpenbot version is not configured. Set OWPENBOT_VERSION or add owpenbotVersion to packages/desktop/package.json."
  );
  process.exit(1);
}

const owpenbotAssetByTarget = {
  "aarch64-apple-darwin": "owpenbot-darwin-arm64.zip",
  "x86_64-apple-darwin": "owpenbot-darwin-x64.zip",
  "x86_64-unknown-linux-gnu": "owpenbot-linux-x64.tar.gz",
  "aarch64-unknown-linux-gnu": "owpenbot-linux-arm64.tar.gz",
  "x86_64-pc-windows-msvc": "owpenbot-windows-x64.zip",
  "aarch64-pc-windows-msvc": "owpenbot-windows-x64.zip",
};

const owpenbotAsset =
  owpenbotAssetOverride ?? (resolvedTargetTriple ? owpenbotAssetByTarget[resolvedTargetTriple] : null);

const owpenbotUrl = owpenbotAsset
  ? `https://github.com/different-ai/owpenbot/releases/download/v${normalizedOwpenbotVersion}/${owpenbotAsset}`
  : null;

const owpenbotCandidatePath = owpenbotTargetPath ?? owpenbotPath;
const existingOwpenbotVersion =
  owpenbotCandidatePath && existsSync(owpenbotCandidatePath)
    ? readBinaryVersion(owpenbotCandidatePath)
    : null;

const shouldDownloadOwpenbot =
  !owpenbotCandidatePath ||
  !existsSync(owpenbotCandidatePath) ||
  isStubBinary(owpenbotCandidatePath) ||
  !existingOwpenbotVersion ||
  existingOwpenbotVersion !== normalizedOwpenbotVersion;

if (!shouldDownloadOwpenbot) {
  console.log(`Owpenbot sidecar already present (${existingOwpenbotVersion}).`);
}

if (shouldDownloadOwpenbot) {
  if (!owpenbotAsset || !owpenbotUrl) {
    console.error(
      `No owpenbot asset configured for target ${resolvedTargetTriple ?? "unknown"}. Set OWPENBOT_ASSET to override.`
    );
    process.exit(1);
  }

  mkdirSync(sidecarDir, { recursive: true });

  const stamp = Date.now();
  const archivePath = join(tmpdir(), `owpenbot-${stamp}-${owpenbotAsset}`);
  const extractDir = join(tmpdir(), `owpenbot-${stamp}`);
  const checksumUrl = `https://github.com/different-ai/owpenbot/releases/download/v${normalizedOwpenbotVersion}/SHA256SUMS`;
  const checksumPath = join(tmpdir(), `owpenbot-${stamp}-SHA256SUMS`);

  mkdirSync(extractDir, { recursive: true });

  if (process.platform === "win32") {
    const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
    const downloadScript = [
      "$ErrorActionPreference = 'Stop'",
      `Invoke-WebRequest -Uri ${psQuote(owpenbotUrl)} -OutFile ${psQuote(archivePath)}`,
    ].join("; ");
    const checksumScript = [
      "$ErrorActionPreference = 'Stop'",
      `Invoke-WebRequest -Uri ${psQuote(checksumUrl)} -OutFile ${psQuote(checksumPath)}`,
    ].join("; ");

    const downloadResult = spawnSync("powershell", ["-NoProfile", "-Command", downloadScript], {
      stdio: "inherit",
    });
    if (downloadResult.status !== 0) {
      process.exit(downloadResult.status ?? 1);
    }

    const checksumResult = spawnSync("powershell", ["-NoProfile", "-Command", checksumScript], {
      stdio: "inherit",
    });
    if (checksumResult.status !== 0) {
      process.exit(checksumResult.status ?? 1);
    }
  } else {
    const downloadResult = spawnSync("curl", ["-fsSL", "-o", archivePath, owpenbotUrl], {
      stdio: "inherit",
    });
    if (downloadResult.status !== 0) {
      process.exit(downloadResult.status ?? 1);
    }

    const checksumResult = spawnSync("curl", ["-fsSL", "-o", checksumPath, checksumUrl], {
      stdio: "inherit",
    });
    if (checksumResult.status !== 0) {
      process.exit(checksumResult.status ?? 1);
    }
  }

  const checksumContent = readFileSync(checksumPath, "utf8");
  const expectedHash = parseChecksum(checksumContent, owpenbotAsset);
  if (!expectedHash) {
    console.error(`Owpenbot checksum missing for ${owpenbotAsset}.`);
    process.exit(1);
  }
  const actualHash = sha256File(archivePath);
  if (actualHash !== expectedHash) {
    console.error(`Owpenbot checksum mismatch for ${owpenbotAsset}.`);
    process.exit(1);
  }

  if (process.platform === "win32") {
    const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
    const extractScript = [
      "$ErrorActionPreference = 'Stop'",
      `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(extractDir)} -Force`,
    ].join("; ");
    const extractResult = spawnSync("powershell", ["-NoProfile", "-Command", extractScript], {
      stdio: "inherit",
    });
    if (extractResult.status !== 0) {
      process.exit(extractResult.status ?? 1);
    }
  } else if (owpenbotAsset.endsWith(".zip")) {
    const unzipResult = spawnSync("unzip", ["-q", archivePath, "-d", extractDir], {
      stdio: "inherit",
    });
    if (unzipResult.status !== 0) {
      process.exit(unzipResult.status ?? 1);
    }
  } else if (owpenbotAsset.endsWith(".tar.gz")) {
    const tarResult = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
      stdio: "inherit",
    });
    if (tarResult.status !== 0) {
      process.exit(tarResult.status ?? 1);
    }
  } else {
    console.error(`Unknown owpenbot archive type: ${owpenbotAsset}`);
    process.exit(1);
  }

  const extractedBinary = findOwpenbotBinary(extractDir);
  if (!extractedBinary) {
    console.error("Owpenbot binary not found after extraction.");
    process.exit(1);
  }

  const owpenbotTargets = [owpenbotTargetPath, owpenbotPath].filter(Boolean);
  for (const target of owpenbotTargets) {
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

  console.log(`Owpenbot sidecar updated to ${normalizedOwpenbotVersion}.`);
}
