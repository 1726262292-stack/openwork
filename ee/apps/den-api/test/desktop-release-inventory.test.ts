import { describe, expect, test } from "bun:test"
import { publishedDesktopVersionsFromGitHubPayload } from "../src/desktop-release-inventory.js"

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
  test("returns only stable, supported releases with complete platform manifests", () => {
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
      ],
      minAppVersion: "0.17.22",
      latestAppVersion: "0.17.24",
    })

    expect(versions).toEqual(["0.17.22", "0.17.23", "0.17.24"])
  })

  test("fails closed for malformed GitHub payloads", () => {
    expect(publishedDesktopVersionsFromGitHubPayload({
      payload: { tag_name: "v0.17.24" },
      minAppVersion: "0.17.22",
      latestAppVersion: "0.17.24",
    })).toEqual([])
  })
})
