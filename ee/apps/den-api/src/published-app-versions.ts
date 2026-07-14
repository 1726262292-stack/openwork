const GITHUB_RELEASES_URL = "https://api.github.com/repos/different-ai/openwork/releases"
const RELEASES_PER_PAGE = 100
const CACHE_TTL_MS = 15 * 60 * 1000

type FetchReleases = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

let cachedVersions: { minVersion: string; versions: string[]; expiresAt: number } | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function normalizePublishedAppVersion(tagName: unknown) {
  if (typeof tagName !== "string" || !tagName.startsWith("v")) {
    return null
  }

  const version = tagName.slice(1)
  return /^\d+\.\d+\.\d+$/.test(version) ? version : null
}

export function comparePublishedAppVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

function readPublishedVersions(payload: unknown) {
  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response was not an array.")
  }

  return payload
    .map((release) => isRecord(release) ? normalizePublishedAppVersion(release.tag_name) : null)
    .filter((version): version is string => version !== null)
}

export async function fetchPublishedAppVersions(
  minVersion: string,
  fetchReleases: FetchReleases = fetch,
) {
  const versions = new Set<string>()

  for (let page = 1; ; page += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    let response: Response
    try {
      response = await fetchReleases(
        `${GITHUB_RELEASES_URL}?per_page=${RELEASES_PER_PAGE}&page=${page}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "openwork-den-api",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: controller.signal,
        },
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new Error(`GitHub releases request failed with status ${response.status}.`)
    }

    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) {
      throw new Error("GitHub releases response was not an array.")
    }

    const pageVersions = readPublishedVersions(payload)
    for (const version of pageVersions) {
      if (comparePublishedAppVersions(version, minVersion) >= 0) {
        versions.add(version)
      }
    }

    if (pageVersions.includes(minVersion) || payload.length < RELEASES_PER_PAGE) {
      break
    }
  }

  versions.add(minVersion)
  return [...versions].sort((left, right) => comparePublishedAppVersions(right, left))
}

export async function getPublishedAppVersions(minVersion: string) {
  const now = Date.now()
  if (
    cachedVersions &&
    cachedVersions.minVersion === minVersion &&
    cachedVersions.expiresAt > now
  ) {
    return cachedVersions.versions
  }

  const versions = await fetchPublishedAppVersions(minVersion)
  cachedVersions = {
    minVersion,
    versions,
    expiresAt: now + CACHE_TTL_MS,
  }
  return versions
}
