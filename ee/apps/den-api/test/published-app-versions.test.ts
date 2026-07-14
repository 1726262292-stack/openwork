import { describe, expect, test } from "bun:test"
import {
  fetchPublishedAppVersions,
  normalizePublishedAppVersion,
} from "../src/published-app-versions.js"

describe("published desktop app versions", () => {
  test("accepts only stable release tags beginning with v", () => {
    expect(normalizePublishedAppVersion("v0.17.22")).toBe("0.17.22")
    expect(normalizePublishedAppVersion("0.17.22")).toBeNull()
    expect(normalizePublishedAppVersion("alpha-macos-v0.17.22")).toBeNull()
    expect(normalizePublishedAppVersion("v0.17.23-alpha.1")).toBeNull()
    expect(normalizePublishedAppVersion("vffe6fee-dev")).toBeNull()
  })

  test("paginates newest releases until the minimum version is reached", async () => {
    const requestedUrls: string[] = []
    const firstPage = [
      { tag_name: "v0.17.3" },
      { tag_name: "v0.17.2" },
      ...Array.from({ length: 98 }, (_, index) => ({ tag_name: `alpha-${index}` })),
    ]
    const secondPage = [
      { tag_name: "v0.17.0" },
      { tag_name: "v0.16.9" },
    ]

    const versions = await fetchPublishedAppVersions("0.17.0", async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      return Response.json(new URL(url).searchParams.get("page") === "1" ? firstPage : secondPage)
    })

    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls[0]).toContain("per_page=100&page=1")
    expect(requestedUrls[1]).toContain("per_page=100&page=2")
    expect(versions).toEqual(["0.17.3", "0.17.2", "0.17.0"])
  })
})
