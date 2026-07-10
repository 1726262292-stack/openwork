import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { env } from "../env.js"

/**
 * Resolves a generic installer artifact (openwork-installer-mac-arm64.zip,
 * openwork-installer-mac-x64.zip, and openwork-installer-win-<arch>.zip) so
 * install-link downloads can remain entirely inside an on-prem deployment:
 *
 *   1. OPENWORK_INSTALLER_ARTIFACTS_DIR file, when set and present
 *      (self-hosted/dev override — the pre-#2480 behavior, moved here).
 *   2. Disk cache under OPENWORK_INSTALLER_CACHE_DIR/<releaseTag>/<fileName>.
 *   3. OPENWORK_INSTALLER_RELEASE_BASE_URL/<releaseTag>/<fileName>, when set.
 *   4. GitHub releases only when OPENWORK_INSTALLER_ALLOW_GITHUB_FALLBACK=true.
 *
 * Remote assets are streamed to a temp file then atomically renamed into the
 * cache. With the default configuration, a cache miss performs no network I/O.
 *
 * A missing asset (404) resolves to null so the route can 503. Concurrent
 * requests for the same artifact share one in-flight download.
 */

export type InstallerArtifactFetcher = (url: string, init: { redirect: "follow"; signal: AbortSignal }) => Promise<Response>

type InstallerArtifactOptions = {
  artifactsDir?: string
  cacheDir?: string
  releaseTag?: string
  releaseBaseUrl?: string
  releaseRepo?: string
  allowGitHubFallback?: boolean
  fetcher?: InstallerArtifactFetcher
}

const DOWNLOAD_TIMEOUT_MS = 60_000

const inFlightDownloads = new Map<string, Promise<Buffer | null>>()

async function readFileOrNull(filePath: string) {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

async function streamResponseToFile(response: Response, filePath: string) {
  const body = response.body
  if (!body) {
    throw new Error("release asset response had no body")
  }
  const reader = body.getReader()
  const file = createWriteStream(filePath)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      await new Promise<void>((resolve, reject) => {
        file.write(value, (error) => (error ? reject(error) : resolve()))
      })
    }
  } finally {
    await new Promise<void>((resolve) => file.end(() => resolve()))
  }
}

async function downloadReleaseAsset(input: {
  fileName: string
  cachePath: string
  sourceUrl: string
  sourceLabel: string
  fetcher: InstallerArtifactFetcher
}): Promise<Buffer | null> {
  console.info(`[installer-artifacts] downloading ${input.fileName} from ${input.sourceLabel}`)

  const tempPath = `${input.cachePath}.download-${process.pid}-${randomUUID()}`
  try {
    const response = await input.fetcher(input.sourceUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(`[installer-artifacts] ${input.fileName} unavailable from ${input.sourceLabel} (${response.status})`)
      return null
    }
    await mkdir(path.dirname(input.cachePath), { recursive: true })
    await streamResponseToFile(response, tempPath)
    await rename(tempPath, input.cachePath)
    return await readFileOrNull(input.cachePath)
  } catch (error) {
    console.warn(`[installer-artifacts] download of ${input.fileName} failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

function releaseAssetUrl(baseUrl: string, releaseTag: string, fileName: string) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(releaseTag)}/${encodeURIComponent(fileName)}`
  return url.toString()
}

export async function resolveInstallerArtifact(fileName: string, options: InstallerArtifactOptions = {}): Promise<Buffer | null> {
  const artifactsDir = options.artifactsDir ?? env.installerArtifactsDir
  if (artifactsDir) {
    const local = await readFileOrNull(path.join(artifactsDir, fileName))
    if (local) {
      return local
    }
  }

  const releaseTag = options.releaseTag ?? env.installerReleaseTag
  const cacheDir = options.cacheDir ?? env.installerCacheDir
  const cachePath = path.join(cacheDir, releaseTag, fileName)

  const cached = await readFileOrNull(cachePath)
  if (cached) {
    console.info(`[installer-artifacts] cache hit ${fileName}`)
    return cached
  }

  const releaseBaseUrl = options.releaseBaseUrl ?? env.installerReleaseBaseUrl
  const allowGitHubFallback = options.allowGitHubFallback ?? env.installerAllowGitHubFallback
  if (!releaseBaseUrl && !allowGitHubFallback) {
    console.warn(`[installer-artifacts] ${fileName} is not mounted or cached; remote fallback is disabled`)
    return null
  }

  const releaseRepo = options.releaseRepo ?? env.installerReleaseRepo
  const fetcher = options.fetcher ?? fetch
  const sources = [
    ...(releaseBaseUrl
      ? [{
          url: releaseAssetUrl(releaseBaseUrl, releaseTag, fileName),
          label: `configured private release ${releaseTag}`,
        }]
      : []),
    ...(allowGitHubFallback
      ? [{
          url: `https://github.com/${releaseRepo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(fileName)}`,
          label: `GitHub release ${releaseRepo}@${releaseTag}`,
        }]
      : []),
  ]
  const inFlightKey = `${cachePath}\n${sources.map((source) => source.url).join("\n")}`
  const inFlight = inFlightDownloads.get(inFlightKey)
  if (inFlight) {
    return inFlight
  }
  const download = (async () => {
    for (const source of sources) {
      const artifact = await downloadReleaseAsset({
        fileName,
        cachePath,
        sourceUrl: source.url,
        sourceLabel: source.label,
        fetcher,
      })
      if (artifact) return artifact
    }
    return null
  })().finally(() => inFlightDownloads.delete(inFlightKey))
  inFlightDownloads.set(inFlightKey, download)
  return download
}
