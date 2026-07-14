import { describe, expect, test } from "bun:test"
import {
  fetchPublishedDesktopVersions,
  publishedDesktopVersionsFromGitHubPayload,
} from "../src/desktop-release-inventory.js"

const completeAssets = [
  { name: "latest.yml" },
  { name: "latest-mac.yml" },
  { name: "latest-linux.yml" },
  { name: "latest-linux-arm64.yml" },
]

function release(input: {
  version: string
  draft?: boolean
  prerelease?: boolean
  assets?: { name: string }[]
}) {
  return {
    tag_name: input.version,
    draft: input.draft ?? false,
    prerelease: input.prerelease ?? false,
    published_at: "2026-07-13T18:53:10Z",
    assets: input.assets ?? completeAssets,
  }
}

describe("publishedDesktopVersionsFromGitHubPayload", () => {
  test("returns stable v-prefixed releases at or above the minimum", () => {
    const versions = publishedDesktopVersionsFromGitHubPayload({
      payload: [
        release({ version: "v0.17.24" }),
        release({ version: "v0.17.22" }),
        release({ version: "v0.17.23" }),
        release({ version: "v0.17.25" }),
        release({ version: "v0.17.21" }),
        release({ version: "v0.17.23-alpha.1", prerelease: true }),
        release({ version: "v0.17.23-draft", draft: true }),
        release({ version: "v0.17.23", assets: [{ name: "latest.yml" }] }),
        release({ version: "0.17.26" }),
      ],
      minAppVersion: "0.17.22",
      latestAppVersion: "0.17.24",
    })

    expect(versions).toEqual(["0.17.25", "0.17.24", "0.17.23", "0.17.22"])
  })

  test("fails closed for malformed GitHub payloads", () => {
    expect(publishedDesktopVersionsFromGitHubPayload({
      payload: { tag_name: "v0.17.24" },
      minAppVersion: "0.17.22",
      latestAppVersion: "0.17.24",
    })).toEqual([])
  })

  test("paginates newest releases until it reaches the minimum version", async () => {
    const requestedUrls: string[] = []
    const firstPage = [
      release({ version: "v0.17.3" }),
      release({ version: "v0.17.2" }),
      ...Array.from({ length: 98 }, (_, index) => release({ version: `alpha-${index}` })),
    ]
    const secondPage = [
      release({ version: "v0.17.0" }),
      release({ version: "v0.16.9" }),
    ]

    const versions = await fetchPublishedDesktopVersions({
      minAppVersion: "0.17.0",
      latestAppVersion: "0.17.2",
    }, async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      return Response.json(new URL(url).searchParams.get("page") === "1" ? firstPage : secondPage)
    })

    expect(requestedUrls).toHaveLength(2)
    expect(versions).toEqual(["0.17.3", "0.17.2", "0.17.0"])
  })
})
