import { describe, expect, test } from "bun:test"

import { installConfigUrlFor, parseInstallerFilenameTag } from "../src/index"

describe("installer filename tags", () => {
  test("parses canonical host and token tags", () => {
    expect(parseInstallerFilenameTag("OpenWork-Installer--127.0.0.1_8790--abcDEF12.exe")).toEqual({
      host: "127.0.0.1:8790",
      token: "abcDEF12",
    })
    expect(parseInstallerFilenameTag("OpenWork-Installer--api.example.com--abcD--EF12")).toEqual({
      host: "api.example.com",
      token: "abcD--EF12",
    })
  })

  test("rejects an ambiguous dash-heavy filename", () => {
    expect(parseInstallerFilenameTag(`a--${"----".repeat(25_000)}`)).toBeNull()
  })

  test("normalizes a slash-heavy install host", () => {
    expect(installConfigUrlFor(`https://api.example.com${"/".repeat(100_000)}`, "abcDEF12")).toBe(
      "https://api.example.com/v1/install-config?token=abcDEF12",
    )
  })
})
