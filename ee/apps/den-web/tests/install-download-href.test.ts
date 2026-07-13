import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { buildInstallDownloadHref, buildInstallPrepareHref, buildInstallPreparePath, getInstallDownloadStage, parseInstallPrepareStatus, shouldAutoRequestInstaller } from "../app/(den)/_lib/install-download";

function readInstallScreen() {
  return readFileSync(
    fileURLToPath(new URL("../app/(den)/_components/install-screen.tsx", import.meta.url)),
    "utf8",
  );
}

test("organization installer downloads preserve a prefixed public API path", () => {
  expect(buildInstallDownloadHref(
    "https://on-prem.example.test/api/den/",
    "win-x64",
    "opaque/token value",
  )).toBe("https://on-prem.example.test/api/den/v1/install/win-x64?token=opaque%2Ftoken%20value");
});

test("organization installer downloads still support a root API origin", () => {
  expect(buildInstallDownloadHref(
    "https://api.openwork.example.test",
    "mac-arm64",
    "opaque-token",
  )).toBe("https://api.openwork.example.test/v1/install/mac-arm64?token=opaque-token");
});

test("installer readiness checks preserve prefixed API paths", () => {
  expect(buildInstallPrepareHref(
    "https://on-prem.example.test/api/den/",
    "win-x64",
    "opaque/token value",
  )).toBe("https://on-prem.example.test/api/den/v1/install/win-x64/prepare?token=opaque%2Ftoken%20value");
  expect(buildInstallPreparePath("mac-x64", "opaque/token value")).toBe("/v1/install/mac-x64/prepare?token=opaque%2Ftoken%20value");
});

test("download preparation stages describe a long real wait without claiming a start", () => {
  expect(getInstallDownloadStage(0).label).toBe("Checking this install link...");
  expect(getInstallDownloadStage(4_000).label).toBe("Preparing your team package...");
  expect(getInstallDownloadStage(12_000).label).toBe("Fetching release artifacts...");
  expect(getInstallDownloadStage(30_000)).toMatchObject({
    label: "Still preparing the installer...",
    showRetry: true,
  });
});

test("readiness responses drive automatic installer requests only for real outcomes", () => {
  const ready = parseInstallPrepareStatus({ status: "ready", stage: "bundle" });
  const fallback = parseInstallPrepareStatus({ status: "fallback", stage: "standard-download", fallbackUrl: "https://openworklabs.com/download" });

  expect(ready).toEqual({ status: "ready", stage: "bundle" });
  expect(fallback).toEqual({ status: "fallback", stage: "standard-download", fallbackUrl: "https://openworklabs.com/download" });
  expect(parseInstallPrepareStatus({ status: "ready" })).toBeNull();
  if (!ready || !fallback) {
    throw new Error("expected parseable readiness payloads");
  }
  expect(shouldAutoRequestInstaller(ready)).toBe(true);
  expect(shouldAutoRequestInstaller(fallback)).toBe(true);
  expect(shouldAutoRequestInstaller(null)).toBe(false);
});

test("install screen requests the real attachment only after readiness succeeds", () => {
  const source = readInstallScreen();

  expect(source).toContain("parseInstallPrepareStatus(payload)");
  expect(source).toContain("if (shouldAutoRequestInstaller(status))");
  expect(source).toContain("window.location.assign(href)");
  expect(source).not.toContain("Download started");
});
