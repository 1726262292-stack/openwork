import path from "node:path"
import { lstat, readFile } from "node:fs/promises"

export const requiredDesktopReleasePlatforms = ["mac-arm64", "mac-x64", "win-x64"] as const
export const desktopReleasePlatforms = [...requiredDesktopReleasePlatforms, "win-arm64"] as const

export type DesktopReleasePlatform = (typeof desktopReleasePlatforms)[number]
export type RequiredDesktopReleasePlatform = (typeof requiredDesktopReleasePlatforms)[number]

export type DesktopReleaseDownloads = Record<RequiredDesktopReleasePlatform, string>
  & Partial<Record<"win-arm64", string>>

export type DesktopReleaseMetadata = {
  source: "mounted" | "external"
  version: string
  updateFeedUrl: string
  alphaUpdateFeedUrl?: string
  downloads: DesktopReleaseDownloads
}

export function desktopReleaseDownloadFileName(version: string, platform: DesktopReleasePlatform) {
  return platform.startsWith("mac-")
    ? `openwork-${platform}-${version}.dmg`
    : `openwork-${platform}-${version}.exe`
}

function releaseUrl(baseUrl: string, fileName: string) {
  return new URL(encodeURIComponent(fileName), `${baseUrl.replace(/\/+$/, "")}/`).toString()
}

export function buildDesktopReleaseMetadata(input: {
  source: DesktopReleaseMetadata["source"]
  version: string
  baseUrl: string
  alphaUpdateFeedUrl?: string
  includeWindowsArm64?: boolean
}): DesktopReleaseMetadata {
  const downloads: DesktopReleaseDownloads = {
    "mac-arm64": releaseUrl(input.baseUrl, desktopReleaseDownloadFileName(input.version, "mac-arm64")),
    "mac-x64": releaseUrl(input.baseUrl, desktopReleaseDownloadFileName(input.version, "mac-x64")),
    "win-x64": releaseUrl(input.baseUrl, desktopReleaseDownloadFileName(input.version, "win-x64")),
  }
  if (input.includeWindowsArm64) {
    downloads["win-arm64"] = releaseUrl(input.baseUrl, desktopReleaseDownloadFileName(input.version, "win-arm64"))
  }
  return {
    source: input.source,
    version: input.version,
    updateFeedUrl: input.baseUrl.replace(/\/+$/, ""),
    ...(input.alphaUpdateFeedUrl ? { alphaUpdateFeedUrl: input.alphaUpdateFeedUrl.replace(/\/+$/, "") } : {}),
    downloads,
  }
}

export function expandDesktopReleaseBaseUrl(template: string, version: string) {
  return template.replaceAll("{version}", encodeURIComponent(version)).replace(/\/+$/, "")
}

export function isAllowedDesktopReleaseFile(fileName: string, version: string) {
  if (fileName === "latest-mac.yml" || fileName === "latest.yml") {
    return true
  }

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^openwork-(?:mac-(?:arm64|x64)-${escapedVersion}\\.(?:dmg|zip)|win-(?:arm64|x64)-${escapedVersion}\\.exe)(?:\\.blockmap)?$`,
  ).test(fileName)
}

export function desktopReleaseFilePath(input: {
  rootDir: string
  supportedVersion: string
  requestedVersion: string
  fileName: string
}) {
  if (input.requestedVersion !== input.supportedVersion) return null
  if (path.basename(input.fileName) !== input.fileName) return null
  if (!isAllowedDesktopReleaseFile(input.fileName, input.supportedVersion)) return null
  return path.join(input.rootDir, input.supportedVersion, input.fileName)
}

function unquoteYamlScalar(value: string) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function updaterManifest(input: { raw: string; version: string; fileName: "latest-mac.yml" | "latest.yml" }) {
  const versionMatch = input.raw.match(/^version:\s*(.+?)\s*$/m)
  if (!versionMatch || unquoteYamlScalar(versionMatch[1]) !== input.version) return null

  const references = [...input.raw.matchAll(/^\s*(?:-\s+)?(?:url|path):\s*(.+?)\s*$/gm)]
    .map((match) => unquoteYamlScalar(match[1]))
  if (references.length === 0) return null
  if (references.some((reference) => path.basename(reference) !== reference || !isAllowedDesktopReleaseFile(reference, input.version))) {
    return null
  }

  const requiredArchitectures = input.fileName === "latest-mac.yml"
    ? ["mac-arm64", "mac-x64"]
    : ["win-x64"]
  if (requiredArchitectures.some((architecture) => !references.some((reference) => reference.includes(architecture)))) {
    return null
  }
  return [...new Set(references)]
}

async function isRegularMountedFile(filePath: string) {
  const fileStat = await lstat(filePath).catch(() => null)
  return Boolean(fileStat?.isFile() && !fileStat.isSymbolicLink())
}

/**
 * Validate the complete private release before advertising it. In particular,
 * updater manifests must contain only relative, allow-listed file names so a
 * copied pointer manifest can never send a private desktop back to a public
 * host.
 */
export async function mountedDesktopReleaseIsReady(input: {
  rootDir: string
  version: string
}) {
  return (await mountedDesktopReleaseAvailability(input)) !== null
}

export async function mountedDesktopReleaseAvailability(input: {
  rootDir: string
  version: string
}) {
  const versionDir = path.join(input.rootDir, input.version)
  const requiredDownloads = requiredDesktopReleasePlatforms
    .map((platform) => desktopReleaseDownloadFileName(input.version, platform))
  for (const fileName of requiredDownloads) {
    if (!await isRegularMountedFile(path.join(versionDir, fileName))) return null
  }

  let windowsReferences: string[] = []
  for (const fileName of ["latest-mac.yml", "latest.yml"] as const) {
    const manifestPath = path.join(versionDir, fileName)
    if (!await isRegularMountedFile(manifestPath)) return null
    const raw = await readFile(manifestPath, "utf8").catch(() => null)
    if (raw === null) return null
    const references = updaterManifest({ raw, version: input.version, fileName })
    if (!references) return null
    if (fileName === "latest.yml") windowsReferences = references
    for (const reference of references) {
      if (!await isRegularMountedFile(path.join(versionDir, reference))) return null
    }
  }

  const windowsArm64FileName = desktopReleaseDownloadFileName(input.version, "win-arm64")
  const windowsArm64 = windowsReferences.some((reference) => reference.includes("win-arm64"))
    && await isRegularMountedFile(path.join(versionDir, windowsArm64FileName))
  return { windowsArm64 }
}

export function desktopReleaseContentType(fileName: string) {
  if (fileName.endsWith(".yml")) return "text/yaml; charset=utf-8"
  if (fileName.endsWith(".zip")) return "application/zip"
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable"
  return "application/octet-stream"
}
