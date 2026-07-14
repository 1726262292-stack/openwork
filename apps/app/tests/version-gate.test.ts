import { describe, expect, test } from "bun:test";
import {
  resolveFreshStableDesktopUpdate,
  selectStableDesktopUpdate,
} from "../src/app/lib/version-gate";

const metadata = {
  minAppVersion: "0.11.207",
  latestAppVersion: "0.17.24",
  publishedDesktopVersions: ["0.17.22", "0.17.23", "0.17.24"],
};

describe("selectStableDesktopUpdate", () => {
  test("selects the highest approved published release above the installed version", () => {
    expect(selectStableDesktopUpdate({
      currentVersion: "0.17.22",
      metadata,
      desktopConfig: { allowedDesktopVersions: ["0.17.23"] },
    })).toEqual({
      kind: "update",
      targetVersion: "0.17.23",
      latestPublishedVersion: "0.17.24",
    });
  });

  test("reports a newer published release that still needs administrator approval", () => {
    expect(selectStableDesktopUpdate({
      currentVersion: "0.17.23",
      metadata,
      desktopConfig: { allowedDesktopVersions: ["0.17.23"] },
    })).toEqual({ kind: "blocked", latestPublishedVersion: "0.17.24" });
  });

  test("never selects an older approved release", () => {
    expect(selectStableDesktopUpdate({
      currentVersion: "0.17.23",
      metadata,
      desktopConfig: { allowedDesktopVersions: ["0.17.22"] },
    })).toEqual({ kind: "blocked", latestPublishedVersion: "0.17.24" });
  });

  test("keeps unrestricted organizations on the latest compatible published release", () => {
    expect(selectStableDesktopUpdate({
      currentVersion: "0.17.22",
      metadata,
      desktopConfig: {},
    })).toEqual({
      kind: "update",
      targetVersion: "0.17.24",
      latestPublishedVersion: "0.17.24",
    });
  });

  test("does not downgrade when the installed version is newer than Den's inventory", () => {
    expect(selectStableDesktopUpdate({
      currentVersion: "0.17.25",
      metadata,
      desktopConfig: {},
    })).toEqual({ kind: "current", latestPublishedVersion: "0.17.24" });
  });

  test("uses the config returned by the manual refresh instead of a stale cached policy", async () => {
    let refreshCalls = 0;
    const selection = await resolveFreshStableDesktopUpdate({
      currentVersion: "0.17.22",
      refreshDesktopConfig: async () => {
        refreshCalls += 1;
        return { allowedDesktopVersions: ["0.17.23"] };
      },
      readMetadata: async () => metadata,
    });

    expect(refreshCalls).toBe(1);
    expect(selection).toEqual({
      kind: "update",
      targetVersion: "0.17.23",
      latestPublishedVersion: "0.17.24",
    });
  });
});
