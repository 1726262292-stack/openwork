import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { control, evalIn, waitFor } from "@openwork/behaviors";
import {
  app,
  needs,
  server,
  test,
  unmetNeeds,
} from "@openwork/testkit";
import type { App, NeedsSpec } from "@openwork/testkit";
import { expect } from "vitest";

const EXPECTED_PREVIEW_VERSION = "0.0.0-beta-202608110357";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const requirements: NeedsSpec = { optIn: ["OPENWORK_EVAL_APP_SPECS"] };
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `OpenCode v2 preview skipped — needs: ${missingRequirements.join(", ")}`
  : "developer mode swaps the running workspace between default and OpenCode v2 preview engines";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewPackageName(): string {
  if (process.platform === "win32") return "opencode-windows-x64";
  const platform = process.platform === "darwin"
    ? "darwin"
    : process.platform === "linux"
      ? "linux"
      : null;
  if (!platform || (process.arch !== "x64" && process.arch !== "arm64")) {
    throw new Error(`OpenCode v2 preview has no eval package for ${process.platform}-${process.arch}.`);
  }
  return `opencode-${platform}-${process.arch}`;
}

function extractArchive(archivePath: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xzf", archivePath, "-C", destination], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function requireExecutable(binaryPath: string): Promise<string> {
  await access(binaryPath, fsConstants.X_OK).catch((error: unknown) => {
    throw new Error(`OpenCode v2 preview binary is unavailable or not executable: ${binaryPath}`, {
      cause: error,
    });
  });
  return binaryPath;
}

async function resolvePreviewBinary(version: string): Promise<string> {
  const supplied = process.env.OPENWORK_EVAL_OPENCODE_V2_BIN?.trim();
  if (supplied) {
    if (!isAbsolute(supplied)) {
      throw new Error(`OPENWORK_EVAL_OPENCODE_V2_BIN must be absolute: ${supplied}`);
    }
    return requireExecutable(supplied);
  }

  const packageName = previewPackageName();
  const cacheDir = join(homedir(), ".cache", "openwork-evals", "opencode-v2-preview", version);
  const binaryPath = join(cacheDir, "package", "bin", "opencode");
  try {
    return await requireExecutable(binaryPath);
  } catch {
    // The deterministic cache is cold; fetch and extract the pinned package below.
  }

  await mkdir(cacheDir, { recursive: true });
  const archivePath = join(cacheDir, `${packageName}-${version}.tgz`);
  const url = `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download OpenCode v2 preview from ${url}: ${response.status} ${response.statusText}`);
  }
  await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
  await extractArchive(archivePath, cacheDir).catch((error: unknown) => {
    throw new Error(`Failed to extract OpenCode v2 preview archive ${archivePath}.`, { cause: error });
  });
  await chmod(binaryPath, 0o755);
  return requireExecutable(binaryPath);
}

async function clickTestId(desktopApp: App, testId: string): Promise<void> {
  const clicked = await evalIn(desktopApp, `(() => {
    const element = document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  })()`);
  expect(clicked, `Could not click [data-testid="${testId}"]`).toBe(true);
}

async function navigateTo(desktopApp: App, hash: string): Promise<void> {
  const result = await evalIn(desktopApp, `(() => {
    window.location.hash = ${JSON.stringify(hash)};
    return window.location.hash;
  })()`);
  expect(result).toBe(hash);
}

test.skipIf(missingRequirements.length > 0)(title, { timeout: 900_000 }, async ({ evidence, place }) => {
  needs(requirements);

  const constantsValue: unknown = JSON.parse(await readFile(join(repoRoot, "constants.json"), "utf8"));
  if (!isRecord(constantsValue)) throw new Error("constants.json did not contain an object.");
  expect(constantsValue.opencodeV2PreviewVersion).toBe(EXPECTED_PREVIEW_VERSION);
  const previewBinary = process.env.OPENWORK_EVAL_DAYTONA === "1"
    ? null
    : await resolvePreviewBinary(EXPECTED_PREVIEW_VERSION);

  await using den = await server({ place });
  await using desktopApp = await app({
    den,
    as: "admin",
    place,
    ...(previewBinary ? { env: { OPENWORK_OPENCODE_V2_BIN: previewBinary } } : {}),
  });

  await navigateTo(desktopApp, "#/settings/advanced");
  await waitFor(
    desktopApp,
    `document.querySelector('[data-testid="developer-mode-toggle"]')?.getAttribute("aria-checked") === "false"`,
    { timeoutMs: 60_000, label: "developer mode switch off on Advanced settings" },
  );
  await clickTestId(desktopApp, "developer-mode-toggle");
  await waitFor(
    desktopApp,
    `document.querySelector('[data-testid="developer-mode-toggle"]')?.getAttribute("aria-checked") === "true"
      && [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Debug")`,
    { timeoutMs: 30_000, label: "developer mode enabled and Debug tab visible" },
  );

  await navigateTo(desktopApp, "#/settings/debug");
  await waitFor(
    desktopApp,
    `(() => {
      const version = document.querySelector('[data-testid="engine-version-label"]')?.textContent?.trim() ?? "";
      const toggle = document.querySelector('[data-testid="engine-v2-preview-toggle"]');
      return version !== "" && version !== "—" && version !== "managed"
        && toggle?.getAttribute("aria-checked") === "false";
    })()`,
    { timeoutMs: 120_000, label: "default engine version and disabled v2 preview switch" },
  );
  const defaultVersion = String(await evalIn(
    desktopApp,
    `document.querySelector('[data-testid="engine-version-label"]')?.textContent?.trim() ?? ""`,
  ));
  expect(defaultVersion).not.toBe(EXPECTED_PREVIEW_VERSION);
  evidence.fact(
    "Developer mode exposes Debug with the real default engine version",
    `The Debug tab was visible, its preview switch was unchecked, and engine-version-label read ${defaultVersion}.`,
    true,
  );

  const rendererMarker = `engine-v2-preview-${Date.now()}`;
  expect(await evalIn(
    desktopApp,
    `window.__engineV2PreviewRendererMarker = ${JSON.stringify(rendererMarker)}; window.__engineV2PreviewRendererMarker`,
  )).toBe(rendererMarker);
  await clickTestId(desktopApp, "engine-v2-preview-toggle");
  await waitFor(
    desktopApp,
    `(() => {
      const toggle = document.querySelector('[data-testid="engine-v2-preview-toggle"]');
      return toggle?.getAttribute("aria-checked") === "true"
        && toggle.getAttribute("aria-busy") === "false"
        && !toggle.hasAttribute("disabled")
        && document.querySelector('[data-testid="engine-version-label"]')?.textContent === ${JSON.stringify(EXPECTED_PREVIEW_VERSION)};
    })()`,
    { timeoutMs: 240_000, label: "v2 preview download and engine restart completed" },
  );
  expect(await evalIn(desktopApp, "window.__engineV2PreviewRendererMarker ?? null")).toBe(rendererMarker);
  evidence.fact(
    "The preview switch restarts only the engine in place",
    `The same renderer retained its marker, the switch became checked, and engine-version-label became exactly ${EXPECTED_PREVIEW_VERSION}.`,
    true,
  );

  await navigateTo(desktopApp, `#/workspace/${encodeURIComponent(desktopApp.workspaceId)}/session`);
  await waitFor(
    desktopApp,
    `window.__openworkControl?.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`,
    { timeoutMs: 120_000, label: "workspace session action after preview engine restart" },
  );
  await control(desktopApp, "session.create_task", undefined, { timeoutMs: 30_000 });
  await waitFor(
    desktopApp,
    `window.location.hash.includes("/session")
      && window.__openworkControl?.listActions().some((action) => action.id === "composer.set_text" && !action.disabled)
      && !document.body.innerText.includes("Something went wrong")`,
    { timeoutMs: 120_000, label: "healthy workspace composer after preview engine restart" },
  );
  expect(await evalIn(desktopApp, "window.__engineV2PreviewRendererMarker ?? null")).toBe(rendererMarker);
  evidence.fact(
    "The workspace remains healthy after the engine swap",
    "The existing app renderer navigated to the workspace session, created a task, and exposed an enabled composer.set_text action without a crash screen.",
    true,
  );

  await navigateTo(desktopApp, "#/settings/debug");
  await waitFor(
    desktopApp,
    `document.querySelector('[data-testid="engine-v2-preview-toggle"]')?.getAttribute("aria-checked") === "true"
      && document.querySelector('[data-testid="engine-version-label"]')?.textContent === ${JSON.stringify(EXPECTED_PREVIEW_VERSION)}`,
    { timeoutMs: 120_000, label: "preview state restored on Debug settings" },
  );
  await clickTestId(desktopApp, "engine-v2-preview-toggle");
  await waitFor(
    desktopApp,
    `(() => {
      const toggle = document.querySelector('[data-testid="engine-v2-preview-toggle"]');
      return toggle?.getAttribute("aria-checked") === "false"
        && toggle.getAttribute("aria-busy") === "false"
        && !toggle.hasAttribute("disabled")
        && document.querySelector('[data-testid="engine-version-label"]')?.textContent === ${JSON.stringify(defaultVersion)};
    })()`,
    { timeoutMs: 180_000, label: "default engine restored after disabling preview" },
  );
  expect(await evalIn(desktopApp, "window.__engineV2PreviewRendererMarker ?? null")).toBe(rendererMarker);
  evidence.fact(
    "Disabling preview restores the original engine",
    `The switch became unchecked and engine-version-label returned exactly to ${defaultVersion} in the same renderer.`,
    true,
  );

  await navigateTo(desktopApp, "#/settings/advanced");
  await waitFor(
    desktopApp,
    `document.querySelector('[data-testid="developer-mode-toggle"]')?.getAttribute("aria-checked") === "true"`,
    { timeoutMs: 60_000, label: "enabled developer mode switch on Advanced settings" },
  );
  await clickTestId(desktopApp, "developer-mode-toggle");
  await waitFor(
    desktopApp,
    `document.querySelector('[data-testid="developer-mode-toggle"]')?.getAttribute("aria-checked") === "false"
      && ![...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Debug")`,
    { timeoutMs: 30_000, label: "developer mode disabled and Debug tab hidden" },
  );
  await navigateTo(desktopApp, "#/settings/debug");
  await waitFor(
    desktopApp,
    `window.location.hash === "#/settings/debug"
      && !document.querySelector('[data-testid="engine-v2-preview-toggle"]')
      && !document.querySelector('[data-testid="engine-version-label"]')
      && ![...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Debug")`,
    { timeoutMs: 30_000, label: "Debug controls unreachable without developer mode" },
  );
  evidence.fact(
    "Debug and the preview engine control are unreachable without developer mode",
    "After developer mode was disabled, the Debug navigation entry, engine-v2-preview-toggle, and engine-version-label were absent even at the direct Debug hash.",
    true,
  );
});
