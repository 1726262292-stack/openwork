import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  denApiBaseUrlFromBootstrap,
  desktopReleaseDownloadUrl,
  fetchDeploymentDesktopRelease,
  parseDesktopReleaseMetadata,
} from "./desktop-release.mjs";
import { electronUpdaterFeedUrl } from "./updater.mjs";

const metadataPayload = {
  latestAppVersion: "0.17.19",
  desktopRelease: {
    version: "0.17.19",
    updateFeedUrl: "https://den.examplecorp.test/v1/desktop-releases/0.17.19",
    downloads: {
      "mac-arm64": "https://den.examplecorp.test/v1/desktop-releases/0.17.19/openwork-mac-arm64-0.17.19.dmg",
      "mac-x64": "https://den.examplecorp.test/v1/desktop-releases/0.17.19/openwork-mac-x64-0.17.19.dmg",
      "win-x64": "https://den.examplecorp.test/v1/desktop-releases/0.17.19/openwork-win-x64-0.17.19.exe",
      "win-arm64": "https://den.examplecorp.test/v1/desktop-releases/0.17.19/openwork-win-arm64-0.17.19.exe",
    },
  },
};

describe("deployment desktop release metadata", () => {
  it("prefers the explicit Den API URL and otherwise derives /api from the web URL", () => {
    assert.equal(
      denApiBaseUrlFromBootstrap({ baseUrl: "https://examplecorp.test", apiBaseUrl: "https://api.examplecorp.test/" }),
      "https://api.examplecorp.test",
    );
    assert.equal(
      denApiBaseUrlFromBootstrap({ baseUrl: "https://examplecorp.test/" }),
      "https://examplecorp.test/api",
    );
  });

  it("resolves platform downloads from Den-owned URLs", () => {
    const release = parseDesktopReleaseMetadata(metadataPayload);
    assert.ok(release);
    assert.equal(
      desktopReleaseDownloadUrl(release, "win32", "x64"),
      metadataPayload.desktopRelease.downloads["win-x64"],
    );
    assert.equal(
      desktopReleaseDownloadUrl(release, "win32", "arm64"),
      metadataPayload.desktopRelease.downloads["win-arm64"],
    );
    assert.equal(desktopReleaseDownloadUrl(release, "linux", "x64"), null);
  });

  it("keeps x64-only Den metadata valid while leaving Windows ARM64 unavailable", () => {
    const x64OnlyPayload = structuredClone(metadataPayload);
    delete x64OnlyPayload.desktopRelease.downloads["win-arm64"];
    const release = parseDesktopReleaseMetadata(x64OnlyPayload);
    assert.ok(release);
    assert.equal(desktopReleaseDownloadUrl(release, "win32", "x64"), metadataPayload.desktopRelease.downloads["win-x64"]);
    assert.equal(desktopReleaseDownloadUrl(release, "win32", "arm64"), null);
  });

  it("rejects release metadata whose version differs from Den's supported version", () => {
    assert.equal(parseDesktopReleaseMetadata({
      ...metadataPayload,
      latestAppVersion: "0.17.20",
    }), null);
  });

  it("checks only the configured Den host before returning its internal update feed", async () => {
    const contacted = [];
    const fetcher = async (url) => {
      contacted.push(url);
      return new Response(JSON.stringify(metadataPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const getDesktopBootstrapConfig = async () => ({
      baseUrl: "https://examplecorp.test",
      apiBaseUrl: "https://den.examplecorp.test",
      requireSignin: true,
    });

    const release = await fetchDeploymentDesktopRelease({ getDesktopBootstrapConfig, fetcher });
    const feedUrl = await electronUpdaterFeedUrl("stable", getDesktopBootstrapConfig, fetcher, "win32");

    assert.equal(release.updateFeedUrl, metadataPayload.desktopRelease.updateFeedUrl);
    assert.equal(feedUrl, metadataPayload.desktopRelease.updateFeedUrl);
    assert.deepEqual(contacted, [
      "https://den.examplecorp.test/v1/app-version",
      "https://den.examplecorp.test/v1/app-version",
    ]);
    assert.equal(contacted.some((url) => url.includes("github.com")), false);
  });

  it("fails closed for alpha unless Den explicitly publishes that feed", async () => {
    const getDesktopBootstrapConfig = async () => ({ apiBaseUrl: "https://den.examplecorp.test" });
    const fetcher = async () => Response.json(metadataPayload);
    await assert.rejects(
      electronUpdaterFeedUrl("alpha", getDesktopBootstrapConfig, fetcher, "darwin"),
      /does not publish an alpha desktop update feed/,
    );

    const alphaFeed = "https://den.examplecorp.test/v1/desktop-alpha";
    const alphaFetcher = async () => Response.json({
      ...metadataPayload,
      desktopRelease: { ...metadataPayload.desktopRelease, alphaUpdateFeedUrl: alphaFeed },
    });
    assert.equal(
      await electronUpdaterFeedUrl("alpha", getDesktopBootstrapConfig, alphaFetcher, "darwin"),
      alphaFeed,
    );
  });
});
