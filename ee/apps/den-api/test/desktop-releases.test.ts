import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  buildDesktopReleaseMetadata,
  desktopReleaseFilePath,
  expandDesktopReleaseBaseUrl,
  isAllowedDesktopReleaseFile,
  mountedDesktopReleaseAvailability,
  mountedDesktopReleaseIsReady,
} from "../src/utils/desktop-releases"

const VERSION = "0.17.19"

function mountedReleaseFixture(options: { latestMacUrl?: string; windowsArm64?: boolean } = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "openwork-desktop-releases-"))
  const versionDir = path.join(rootDir, VERSION)
  mkdirSync(versionDir, { recursive: true })
  const files: Record<string, string> = {
    [`openwork-mac-arm64-${VERSION}.dmg`]: "mac-arm64",
    [`openwork-mac-x64-${VERSION}.dmg`]: "mac-x64",
    [`openwork-win-x64-${VERSION}.exe`]: "win-x64",
    [`openwork-mac-arm64-${VERSION}.zip`]: "mac-update-arm64",
    [`openwork-mac-x64-${VERSION}.zip`]: "mac-update-x64",
    "latest-mac.yml": `version: ${VERSION}\nfiles:\n  - url: ${options.latestMacUrl ?? `openwork-mac-arm64-${VERSION}.zip`}\n  - url: openwork-mac-x64-${VERSION}.zip\n`,
    "latest.yml": `version: ${VERSION}\nfiles:\n  - url: openwork-win-x64-${VERSION}.exe\n${options.windowsArm64 ? `  - url: openwork-win-arm64-${VERSION}.exe\n` : ""}`,
  }
  if (options.windowsArm64) files[`openwork-win-arm64-${VERSION}.exe`] = "win-arm64"
  for (const [fileName, contents] of Object.entries(files)) {
    writeFileSync(path.join(versionDir, fileName), contents)
  }
  return { rootDir, versionDir }
}

describe("desktop release repository", () => {
  test("builds Den-internal download and update URLs for the supported version", () => {
    const metadata = buildDesktopReleaseMetadata({
      source: "mounted",
      version: "0.17.19",
      baseUrl: "https://den.examplecorp.test/v1/desktop-releases/0.17.19",
      includeWindowsArm64: true,
    })

    expect(metadata.updateFeedUrl).toBe("https://den.examplecorp.test/v1/desktop-releases/0.17.19")
    expect(metadata.downloads["mac-arm64"]).toEndWith("/openwork-mac-arm64-0.17.19.dmg")
    expect(metadata.downloads["mac-x64"]).toEndWith("/openwork-mac-x64-0.17.19.dmg")
    expect(metadata.downloads["win-x64"]).toEndWith("/openwork-win-x64-0.17.19.exe")
    expect(metadata.downloads["win-arm64"]).toEndWith("/openwork-win-arm64-0.17.19.exe")
    expect(buildDesktopReleaseMetadata({
      source: "mounted",
      version: "0.17.19",
      baseUrl: "https://den.examplecorp.test/v1/desktop-releases/0.17.19",
    }).downloads["win-arm64"]).toBeUndefined()
  })

  test("expands an explicitly configured public fallback without hardcoding a host", () => {
    expect(expandDesktopReleaseBaseUrl("https://mirror.example.test/releases/v{version}/", "0.17.19")).toBe(
      "https://mirror.example.test/releases/v0.17.19",
    )
  })

  test("serves only Mac and Windows release files for the exact supported version", () => {
    expect(isAllowedDesktopReleaseFile("latest-mac.yml", "0.17.19")).toBe(true)
    expect(isAllowedDesktopReleaseFile("latest.yml", "0.17.19")).toBe(true)
    expect(isAllowedDesktopReleaseFile("openwork-mac-arm64-0.17.19.zip", "0.17.19")).toBe(true)
    expect(isAllowedDesktopReleaseFile("openwork-win-x64-0.17.19.exe.blockmap", "0.17.19")).toBe(true)
    expect(isAllowedDesktopReleaseFile("openwork-win-arm64-0.17.19.exe", "0.17.19")).toBe(true)
    expect(isAllowedDesktopReleaseFile("openwork-linux-x86_64-0.17.19.AppImage", "0.17.19")).toBe(false)
    expect(desktopReleaseFilePath({
      rootDir: "/releases",
      supportedVersion: "0.17.19",
      requestedVersion: "0.17.18",
      fileName: "latest.yml",
    })).toBeNull()
    expect(desktopReleaseFilePath({
      rootDir: "/releases",
      supportedVersion: "0.17.19",
      requestedVersion: "0.17.19",
      fileName: "openwork-win-x64-0.17.19.exe",
    })).toBe(path.join("/releases", "0.17.19", "openwork-win-x64-0.17.19.exe"))
  })

  test("accepts a complete private release whose updater manifests stay on the mount", async () => {
    const fixture = mountedReleaseFixture()
    try {
      expect(await mountedDesktopReleaseIsReady({ rootDir: fixture.rootDir, version: VERSION })).toBe(true)
      expect((await mountedDesktopReleaseAvailability({ rootDir: fixture.rootDir, version: VERSION }))?.windowsArm64).toBe(false)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  test("advertises Windows ARM64 only when both its executable and updater entry are mounted", async () => {
    const fileOnlyFixture = mountedReleaseFixture()
    writeFileSync(path.join(fileOnlyFixture.versionDir, `openwork-win-arm64-${VERSION}.exe`), "win-arm64")
    try {
      expect((await mountedDesktopReleaseAvailability({
        rootDir: fileOnlyFixture.rootDir,
        version: VERSION,
      }))?.windowsArm64).toBe(false)
    } finally {
      rmSync(fileOnlyFixture.rootDir, { recursive: true, force: true })
    }

    const fixture = mountedReleaseFixture({ windowsArm64: true })
    try {
      expect((await mountedDesktopReleaseAvailability({ rootDir: fixture.rootDir, version: VERSION }))?.windowsArm64).toBe(true)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  test("rejects a copied updater pointer that would send the desktop to a public host", async () => {
    const fixture = mountedReleaseFixture({
      latestMacUrl: `https://github.com/different-ai/openwork/releases/download/v${VERSION}/openwork-mac-arm64-${VERSION}.zip`,
    })
    try {
      expect(await mountedDesktopReleaseIsReady({ rootDir: fixture.rootDir, version: VERSION })).toBe(false)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  test("rejects an incomplete private release instead of advertising broken URLs", async () => {
    const fixture = mountedReleaseFixture()
    rmSync(path.join(fixture.versionDir, `openwork-win-x64-${VERSION}.exe`))
    try {
      expect(await mountedDesktopReleaseIsReady({ rootDir: fixture.rootDir, version: VERSION })).toBe(false)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })
})
