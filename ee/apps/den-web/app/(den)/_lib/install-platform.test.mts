import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installPlatformsForOs, recommendedInstallPlatform } from "./install-platform";

describe("recommendedInstallPlatform", () => {
  it("recommends Intel for a detected Intel Mac", () => {
    assert.equal(
      recommendedInstallPlatform({ os: "macos", arch: "x64", osVersion: null, source: "ua-ch" }),
      "mac-x64",
    );
  });

  it("does not guess when a Mac architecture is uncertain", () => {
    assert.equal(
      recommendedInstallPlatform({ os: "macos", arch: null, osVersion: null, source: "webgl" }),
      null,
    );
    assert.deepEqual(
      installPlatformsForOs("macos").map((option) => option.value),
      ["mac-arm64", "mac-x64"],
    );
  });

  it("supports both Windows architectures", () => {
    assert.equal(
      recommendedInstallPlatform({ os: "windows", arch: "x64", osVersion: "Windows 11", source: "ua-ch" }),
      "win-x64",
    );
    assert.equal(
      recommendedInstallPlatform({ os: "windows", arch: "arm64", osVersion: "Windows 11", source: "ua-ch" }),
      "win-arm64",
    );
  });
});
