import { describe, expect, test } from "bun:test";

import {
  STABLE_UPDATER_ENDPOINT,
  coerceReleaseChannel,
  resolveUpdaterEndpoint,
  visibleReleaseChannels,
} from "../src/app/lib/release-channels";

describe("desktop release channels", () => {
  test("coerces the hidden channel names without accepting arbitrary values", () => {
    expect(coerceReleaseChannel("canary")).toBe("canary");
    expect(coerceReleaseChannel("experimental")).toBe("experimental");
    expect(coerceReleaseChannel("nightly")).toBe("stable");
  });

  test("keeps Electron-only hidden channels out of the legacy Tauri resolver", () => {
    expect(resolveUpdaterEndpoint("canary", "darwin")).toBe(
      STABLE_UPDATER_ENDPOINT,
    );
    expect(resolveUpdaterEndpoint("experimental", "darwin")).toBe(
      STABLE_UPDATER_ENDPOINT,
    );
    expect(resolveUpdaterEndpoint("canary", "linux")).toBe(
      STABLE_UPDATER_ENDPOINT,
    );
  });

  test("shows pre-alpha choices only in elevated Developer mode", () => {
    expect(visibleReleaseChannels(false)).toEqual(["stable", "alpha"]);
    expect(visibleReleaseChannels(true)).toEqual([
      "stable",
      "alpha",
      "canary",
      "experimental",
    ]);
  });
});
