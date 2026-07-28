import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DenCloudInstance } from "../src/app/lib/den";
import { CloudWorkspaceOverlay } from "../src/react-app/shell/cloud-workspace-overlay";
import {
  cloudWorkspaceUpdateAvailable,
  mapCloudWorkspaceState,
} from "../src/react-app/shell/cloud-workspace-status";

const originalWindow = globalThis.window;

function instance(input: Partial<DenCloudInstance> = {}): DenCloudInstance {
  return {
    status: input.status ?? "ready",
    url: input.url ?? "https://workspace.example.test",
    imageVersion: "imageVersion" in input ? input.imageVersion ?? null : "openwork-0.18.8",
    latestVersion: "latestVersion" in input ? input.latestVersion ?? null : "openwork-0.18.8",
  };
}

describe("cloud workspace overlay state", () => {
  test("maps ready and current workers to the quiet Cloud pill", () => {
    const state = mapCloudWorkspaceState({ instance: instance(), updating: false });

    expect(state.variant).toBe("ready");
    expect(state.label).toBe("Cloud · v0.18.8");
    expect(state.statusLine).toBe("Connected · v0.18.8 (latest)");
    expect(state.latestLine).toBe("Latest: v0.18.8 (up to date)");
    expect(state.showUpdate).toBe(false);
  });

  test("maps stale and legacy workers to Update available", () => {
    const stale = mapCloudWorkspaceState({
      instance: instance({ imageVersion: "openwork-0.18.2", latestVersion: "openwork-0.18.8" }),
      updating: false,
    });
    const legacyInstance = instance({ imageVersion: null, latestVersion: "openwork-0.18.8" });
    const legacy = mapCloudWorkspaceState({
      instance: legacyInstance,
      updating: false,
    });

    expect(stale.variant).toBe("stale");
    expect(stale.label).toBe("Update available");
    expect(stale.statusLine).toBe("Connected · v0.18.2 -> v0.18.8");
    expect(stale.versionLine).toBe("Version: v0.18.2");
    expect(stale.latestLine).toBe("Latest: v0.18.8");
    expect(stale.showUpdate).toBe(true);
    expect(cloudWorkspaceUpdateAvailable(legacyInstance)).toBe(true);
    expect(legacy.label).toBe("Update available");
    expect(legacy.versionLine).toBe("Version: Legacy workspace");
  });

  test("maps not-ready and failed workers to user-facing labels", () => {
    expect(mapCloudWorkspaceState({ instance: instance({ status: "waking" }), updating: false }).label)
      .toBe("Waking your workspace…");
    expect(mapCloudWorkspaceState({ instance: instance({ status: "provisioning" }), updating: false }).label)
      .toBe("Provisioning your workspace…");

    const failed = mapCloudWorkspaceState({ instance: instance({ status: "failed" }), updating: false });
    expect(failed.variant).toBe("failed");
    expect(failed.tone).toBe("amber");
    expect(failed.label).toBe("Workspace needs attention");
    expect(failed.showRetry).toBe(true);
  });

  test("keeps the pill in updating state after the user clicks update", () => {
    const state = mapCloudWorkspaceState({
      instance: instance({ imageVersion: "openwork-0.18.2", latestVersion: "openwork-0.18.8" }),
      updating: true,
    });

    expect(state.variant).toBe("updating");
    expect(state.label).toBe("Updating your workspace…");
    expect(state.showUpdate).toBe(false);
    expect(state.pollMs).toBe(5_000);
  });
});

describe("cloud workspace overlay gateway gating", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("renders nothing outside gateway mode", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://instance.example.test" } },
    });

    expect(renderToStaticMarkup(<CloudWorkspaceOverlay />)).toBe("");
  });
});
