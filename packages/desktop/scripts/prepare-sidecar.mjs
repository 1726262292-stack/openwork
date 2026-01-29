import { spawnSync } from "child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const DOWNLOAD_URL =
  "https://github.com/anomalyco/opencode/releases/latest/download/opencode-windows-x64.zip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, "..", "src-tauri", "sidecars");

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

const owpenbotDir = resolve(__dirname, "..", "..", "owpenbot");
const targetSidecarPath = join(sidecarDir, `opencode-${TARGET_TRIPLE}.exe`);
const devSidecarPath = join(sidecarDir, "opencode.exe");

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

if (process.platform !== "win32") {
  console.log("Skipping Windows sidecar download (non-Windows host).");
  process.exit(0);
}

if (existsSync(targetSidecarPath)) {
  console.log(`OpenCode sidecar already present: ${targetSidecarPath}`);
  process.exit(0);
}

mkdirSync(sidecarDir, { recursive: true });

const stamp = Date.now();
const zipPath = join(tmpdir(), `opencode-windows-x64-${stamp}.zip`);
const extractDir = join(tmpdir(), `opencode-windows-x64-${stamp}`);
const extractedExe = join(extractDir, "opencode.exe");

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const psScript = [
  "$ErrorActionPreference = 'Stop'",
  `Invoke-WebRequest -Uri ${psQuote(DOWNLOAD_URL)} -OutFile ${psQuote(zipPath)}`,
  `Expand-Archive -Path ${psQuote(zipPath)} -DestinationPath ${psQuote(extractDir)} -Force`,
  `if (!(Test-Path ${psQuote(extractedExe)})) { throw 'opencode.exe missing in archive' }`,
  `Copy-Item -Path ${psQuote(extractedExe)} -Destination ${psQuote(targetSidecarPath)} -Force`,
  `Copy-Item -Path ${psQuote(extractedExe)} -Destination ${psQuote(devSidecarPath)} -Force`,
].join("; ");

const result = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
