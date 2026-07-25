#!/usr/bin/env node
// Single source of truth for the version stamped into the installer artifacts.
// CI resolves it from the release tag; local builds fall back to package.json so
// a developer build never claims to be a release.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export function versionFromReleaseTag(releaseTag) {
  const candidate = (releaseTag ?? "").trim().replace(/^v/, "")
  return versionPattern.test(candidate) ? candidate : ""
}

export function readPackageVersion() {
  return JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version
}

// Precedence: an explicit --version/env value, then the release tag, then the
// committed package.json version.
export function resolveInstallerVersion({ explicit, releaseTag, packageVersion } = {}) {
  const explicitVersion = (explicit ?? "").trim()
  if (explicitVersion) return explicitVersion
  const tagVersion = versionFromReleaseTag(releaseTag)
  if (tagVersion) return tagVersion
  return (packageVersion ?? "").trim()
}

// Windows version resources are four numeric fields, so a semver prerelease
// suffix has no representation there and only the numeric core is used.
export function windowsFileVersion(version) {
  const core = (version ?? "").trim().split(/[-+]/)[0]
  return /^\d+\.\d+\.\d+$/.test(core) ? `${core}.0` : ""
}

function argValue(name) {
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1).trim()
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1]?.trim() ?? "" : ""
}

export function installerVersionFromEnvironment() {
  return resolveInstallerVersion({
    explicit: argValue("--version") || process.env.OPENWORK_INSTALLER_VERSION,
    releaseTag: argValue("--release-tag") || process.env.OPENWORK_INSTALLER_RELEASE_TAG,
    packageVersion: readPackageVersion(),
  })
}

// `node scripts/installer-version.mjs --release-tag v0.18.1` prints the version
// the release workflow stamps into every installer artifact.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = installerVersionFromEnvironment()
  if (!version) {
    console.error("[installer-version] Could not resolve an installer version.")
    process.exit(1)
  }
  console.log(process.argv.includes("--windows") ? windowsFileVersion(version) : version)
}
