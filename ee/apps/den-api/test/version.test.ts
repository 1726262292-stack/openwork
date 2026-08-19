import { expect, test } from "bun:test"
import { PUBLISHED_DESKTOP_VERSIONS } from "@openwork-ee/den-core/generated/desktop-versions"

test("static desktop release metadata uses the committed snapshot", async () => {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"

  const { getDesktopReleaseMetadata } = await import("@openwork-ee/den-core/desktop-releases")
  const metadata = await getDesktopReleaseMetadata()
  expect(metadata.latestAppVersion).toBe(PUBLISHED_DESKTOP_VERSIONS[0])
  expect(metadata.publishedDesktopVersions).toEqual([...PUBLISHED_DESKTOP_VERSIONS])
})
