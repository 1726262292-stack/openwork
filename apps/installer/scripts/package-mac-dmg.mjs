#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const appName = "OpenWork Installer.app"
const executableName = "openwork-installer"

function fail(message) {
  console.error(`[package-mac-dmg] ${message}`)
  process.exit(1)
}

function argValue(name) {
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1]?.trim() ?? "" : ""
}

function normalizeArch(value) {
  const arch = value.trim()
  if (!arch) fail("Missing arch. Pass --arch arm64 or --arch x64.")
  if (arch === "aarch64") return "arm64"
  if (arch === "amd64" || arch === "x86_64") return "x64"
  return arch
}

function defaultInputPath() {
  const appPath = path.resolve("dist", appName)
  if (existsSync(appPath)) return appPath
  return path.resolve("dist", executableName)
}

function writeInfoPlist(appPath) {
  writeFileSync(path.join(appPath, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>OpenWork Installer</string>
  <key>CFBundleDisplayName</key><string>OpenWork Installer</string>
  <key>CFBundleIdentifier</key><string>com.differentai.openwork.installer</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`)
}

function stageInput(inputPath, stagedAppPath) {
  if (!existsSync(inputPath)) fail(`Input not found: ${inputPath}`)
  const inputStat = statSync(inputPath)
  if (inputStat.isDirectory()) {
    if (path.extname(inputPath) !== ".app") fail(`Directory input must be a .app bundle: ${inputPath}`)
    execFileSync("ditto", [inputPath, stagedAppPath], { stdio: "inherit" })
    const stagedBinary = path.join(stagedAppPath, "Contents", "MacOS", executableName)
    if (!existsSync(stagedBinary)) fail(`App bundle is missing Contents/MacOS/${executableName}`)
    return
  }

  if (!inputStat.isFile()) fail(`Input must be a compiled binary or .app bundle: ${inputPath}`)
  const macOsDir = path.join(stagedAppPath, "Contents", "MacOS")
  mkdirSync(macOsDir, { recursive: true })
  cpSync(inputPath, path.join(macOsDir, executableName))
  chmodSync(path.join(macOsDir, executableName), 0o755)
  writeInfoPlist(stagedAppPath)
}

if (process.platform !== "darwin") fail("hdiutil packaging requires macOS.")

const arch = normalizeArch(argValue("--arch") || process.env.OPENWORK_INSTALLER_ARCH || process.env.TARGET_ARCH || process.arch)
const inputPath = path.resolve(argValue("--input") || defaultInputPath())
const outDir = path.resolve(argValue("--out-dir") || "dist")
const outputPath = path.resolve(argValue("--output") || path.join(outDir, `OpenWork-Installer-${arch}.dmg`))
const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "openwork-installer-dmg-"))

try {
  mkdirSync(path.dirname(outputPath), { recursive: true })
  stageInput(inputPath, path.join(stagingRoot, appName))
  execFileSync("hdiutil", ["create", "-volname", "OpenWork Installer", "-srcfolder", stagingRoot, "-ov", "-format", "UDZO", outputPath], { stdio: "inherit" })
  console.log(`[package-mac-dmg] Wrote ${outputPath}`)
} finally {
  rmSync(stagingRoot, { recursive: true, force: true })
}
