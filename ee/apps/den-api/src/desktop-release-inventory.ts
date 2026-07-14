import { z } from "zod"

const GITHUB_RELEASES_URL = "https://api.github.com/repos/different-ai/openwork/releases?per_page=100"
const INVENTORY_CACHE_MS = 5 * 60 * 1000
const INVENTORY_STALE_MS = 24 * 60 * 60 * 1000
const REQUIRED_STABLE_MANIFESTS = new Set([
  "latest.yml",
  "latest-mac.yml",
  "latest-linux.yml",
  "latest-linux-arm64.yml",
])

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  assets: z.array(z.object({ name: z.string() })),
})

const githubReleasesSchema = z.array(githubReleaseSchema)

type StableVersion = {
  major: number
  minor: number
  patch: number
}

type CachedInventory = {
  fetchedAt: number
  versions: string[]
}

let cachedInventory: CachedInventory | null = null
let inventoryRequest: Promise<string[]> | null = null

function parseStableVersion(value: string): StableVersion | null {
  const normalized = value.trim().replace(/^v/i, "")
  const parts = normalized.split(".")
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null

  const major = Number(parts[0])
  const minor = Number(parts[1])
  const patch = Number(parts[2])
  if (![major, minor, patch].every(Number.isSafeInteger)) return null

  return { major, minor, patch }
}

function compareStableVersions(left: string, right: string): number | null {
  const parsedLeft = parseStableVersion(left)
  const parsedRight = parseStableVersion(right)
  if (!parsedLeft || !parsedRight) return null

  if (parsedLeft.major !== parsedRight.major) return parsedLeft.major < parsedRight.major ? -1 : 1
  if (parsedLeft.minor !== parsedRight.minor) return parsedLeft.minor < parsedRight.minor ? -1 : 1
  if (parsedLeft.patch !== parsedRight.patch) return parsedLeft.patch < parsedRight.patch ? -1 : 1
  return 0
}

export function publishedDesktopVersionsFromGitHubPayload(input: {
  payload: unknown
  minAppVersion: string
  latestAppVersion: string
}): string[] {
  const parsed = githubReleasesSchema.safeParse(input.payload)
  if (!parsed.success) return []

  const versions = parsed.data.flatMap((release) => {
    if (release.draft || release.prerelease || !release.published_at) return []

    const version = release.tag_name.trim().replace(/^v/i, "")
    if (!parseStableVersion(version)) return []

    const aboveMinimum = compareStableVersions(version, input.minAppVersion)
    const atOrBelowLatest = compareStableVersions(version, input.latestAppVersion)
    if (aboveMinimum === null || aboveMinimum < 0 || atOrBelowLatest === null || atOrBelowLatest > 0) {
      return []
    }

    const assetNames = new Set(release.assets.map((asset) => asset.name))
    if ([...REQUIRED_STABLE_MANIFESTS].some((manifest) => !assetNames.has(manifest))) return []

    return [version]
  })

  return [...new Set(versions)].sort((left, right) => compareStableVersions(left, right) ?? 0)
}

async function fetchPublishedDesktopVersions(input: {
  minAppVersion: string
  latestAppVersion: string
}): Promise<string[]> {
  const githubToken = process.env.GITHUB_TOKEN?.trim()
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "openwork-den-api",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    throw new Error(`GitHub releases request failed (${response.status})`)
  }

  const versions = publishedDesktopVersionsFromGitHubPayload({
    payload: await response.json(),
    minAppVersion: input.minAppVersion,
    latestAppVersion: input.latestAppVersion,
  })
  if (versions.length === 0) {
    throw new Error("GitHub releases response did not include usable stable desktop releases")
  }
  return versions
}

export async function getPublishedDesktopVersions(input: {
  minAppVersion: string
  latestAppVersion: string
}): Promise<string[]> {
  const now = Date.now()
  if (cachedInventory && now - cachedInventory.fetchedAt < INVENTORY_CACHE_MS) {
    return cachedInventory.versions
  }

  if (!inventoryRequest) {
    inventoryRequest = fetchPublishedDesktopVersions(input)
      .then((versions) => {
        cachedInventory = { fetchedAt: Date.now(), versions }
        return versions
      })
      .finally(() => {
        inventoryRequest = null
      })
  }

  try {
    return await inventoryRequest
  } catch (error) {
    if (cachedInventory && now - cachedInventory.fetchedAt < INVENTORY_STALE_MS) {
      console.warn("[desktop-releases] using stale release inventory", error)
      return cachedInventory.versions
    }

    console.warn("[desktop-releases] using Den build version as release inventory fallback", error)
    return [input.latestAppVersion]
  }
}
