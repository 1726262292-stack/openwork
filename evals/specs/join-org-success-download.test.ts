import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  buildInstallDownloadHref,
  detectedInstallPlatform,
  downloadCtaLabel,
  installerApiUrlFromConfig,
  installTokenFromPageUrl,
} from "../../ee/apps/den-web/app/(den)/_lib/install-download";

test("joining a workspace downloads the detected OS installer on the success card", async ({ evidence }) => {
  const installPageUrl = "https://den.example.test/join-org";
  const minted = "https://den.example.test/install?token=invite-success-token";
  const apiUrl = "https://api.example.test/den";
  const href = buildInstallDownloadHref(
    installerApiUrlFromConfig({ apiUrl }) ?? "",
    detectedInstallPlatform({ os: "macos", arch: "arm64" }) ?? "mac-arm64",
    installTokenFromPageUrl(minted) ?? "",
  );

  expect(downloadCtaLabel("macos")).toBe("Download for macOS");
  expect(downloadCtaLabel("windows")).toBe("Download for Windows");
  expect(href).toBe("https://api.example.test/den/v1/install/mac-arm64?token=invite-success-token");
  expect(href).not.toContain("/install?");
  expect(installTokenFromPageUrl(installPageUrl)).toBeNull();
  evidence.fact(
    "The joined welcome screen starts the OS installer instead of opening /install",
    "Download for macOS resolves to the org-served /v1/install/mac-arm64 artifact with the minted token, not the guided install page.",
    true,
  );
});
