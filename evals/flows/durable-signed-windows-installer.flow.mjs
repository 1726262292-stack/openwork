import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("durable-signed-windows-installer");

const INSTALL_PAGE_URL = process.env.OPENWORK_EVAL_INSTALL_PAGE_URL?.trim() ?? "";
const WINDOWS_INSTALLER_UI_URL = process.env.OPENWORK_EVAL_WINDOWS_INSTALLER_UI_URL?.trim() ?? "";
const WINDOWS_PROOF_PATH = process.env.OPENWORK_EVAL_WINDOWS_PROOF_JSON?.trim() ?? "";
const DESKTOP_CDP_URL = process.env.OPENWORK_EVAL_DESKTOP_CDP_URL?.trim() ?? "";
const SIDECAR_NAME = "openwork-installer.json";
const WINDOWS_EXECUTABLE_NAME = "OpenWork Installer.exe";

const state = {
  intelRecommendation: null,
  packages: null,
  windowsProof: null,
};

export default {
  id: "durable-signed-windows-installer",
  title: "The organization installer recommends the right architecture and Windows packages stay signed and configured",
  kind: "user-facing",
  requiredEnv: [
    "OPENWORK_EVAL_INSTALL_PAGE_URL",
    "OPENWORK_EVAL_WINDOWS_INSTALLER_UI_URL",
    "OPENWORK_EVAL_WINDOWS_PROOF_JSON",
    "OPENWORK_EVAL_DESKTOP_CDP_URL",
  ],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("A detected Windows x64 computer gets one clear recommended package", {
          voiceover: vo[0],
          action: async () => {
            await emulatePlatform(ctx, windowsUa("x86"));
            await openInstallPage(ctx);
            await ctx.waitForText("Download for Windows (x64)", { timeoutMs: 30_000 });
          },
          assert: async () => {
            const result = await installPageState(ctx);
            ctx.assert(result.detectedOs === "windows", `Detected OS was ${result.detectedOs}.`);
            ctx.assert(result.detectedArch === "x64", `Detected architecture was ${result.detectedArch}.`);
            ctx.assert(result.primaryText.includes("Windows (x64)"), `Primary download was ${result.primaryText}.`);
            ctx.assert(result.primaryCount === 1, `Expected one primary download, found ${result.primaryCount}.`);
            ctx.output("windows-x64-recommendation", JSON.stringify(result, null, 2));
          },
          screenshot: {
            name: "windows-x64-recommended",
            requireText: ["Download for Windows (x64)", "Windows (ARM64)"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Intel Macs are recommended Intel while uncertain Macs are asked to choose", {
          voiceover: vo[1],
          action: async () => {
            await emulatePlatform(ctx, macUa("x86", "64"));
            await openInstallPage(ctx);
            await ctx.waitForText("Download for Mac (Intel)", { timeoutMs: 30_000 });
            state.intelRecommendation = await installPageState(ctx);

            await emulatePlatform(ctx, macUa("", ""));
            await openInstallPage(ctx);
            await ctx.waitForText("Choose your Mac", { timeoutMs: 30_000 });
          },
          assert: async () => {
            const intel = requireObject(state.intelRecommendation, "Intel recommendation");
            ctx.assert(intel.detectedArch === "x64", `Intel detection returned ${intel.detectedArch}.`);
            ctx.assert(intel.primaryText.includes("Mac (Intel)"), `Intel primary download was ${intel.primaryText}.`);

            const uncertain = await installPageState(ctx);
            ctx.assert(uncertain.detectedOs === "macos", `Uncertain platform OS was ${uncertain.detectedOs}.`);
            ctx.assert(uncertain.detectedArch === "unknown", `Uncertain Mac architecture was ${uncertain.detectedArch}.`);
            ctx.assert(uncertain.primaryCount === 0, "An uncertain Mac was given a false primary recommendation.");
            ctx.assert(uncertain.links.includes("Mac (Apple silicon)"), "Apple silicon choice was missing.");
            ctx.assert(uncertain.links.includes("Mac (Intel)"), "Intel choice was missing.");
            ctx.output("mac-architecture-guidance", JSON.stringify({ intel, uncertain }, null, 2));
          },
          screenshot: {
            name: "uncertain-mac-choices",
            requireText: ["Choose your Mac", "Mac (Apple silicon)", "Mac (Intel)"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The install page serves stamped Windows zips for x64 and ARM64", {
          voiceover: vo[2],
          action: async () => {
            await emulatePlatform(ctx, windowsUa("arm"));
            await openInstallPage(ctx);
            await ctx.waitForText("Download for Windows (ARM64)", { timeoutMs: 30_000 });
            state.packages = await downloadAndInspectWindowsPackages(ctx);
          },
          assert: async () => {
            const packages = requireObject(state.packages, "Windows packages");
            for (const architecture of ["x64", "arm64"]) {
              const current = requireObject(packages[architecture], `${architecture} package`);
              ctx.assert(current.status === 200, `${architecture} download returned ${current.status}.`);
              ctx.assert(current.contentType === "application/zip", `${architecture} content type was ${current.contentType}.`);
              ctx.assert(current.organizationNamed === true, `${architecture} attachment was not organization-named.`);
              ctx.assert(current.hasExecutable === true, `${architecture} zip did not contain ${WINDOWS_EXECUTABLE_NAME}.`);
              ctx.assert(current.hasSidecar === true, `${architecture} zip did not contain ${SIDECAR_NAME}.`);
              ctx.assert(current.clientName.length > 0, `${architecture} sidecar did not name the organization.`);
            }
            ctx.output("stamped-windows-packages", JSON.stringify(packages, null, 2));
          },
          screenshot: {
            name: "windows-arm64-and-x64",
            requireText: ["Download for Windows (ARM64)", "Windows (x64)"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("The renamed Windows setup remains signed and reads its adjacent organization config", {
          voiceover: vo[3],
          action: async () => {
            state.windowsProof = readWindowsProof();
            await navigateAbsolute(ctx, WINDOWS_INSTALLER_UI_URL);
            await ctx.waitForText("This sets up OpenWork for", { timeoutMs: 30_000 });
          },
          assert: async () => {
            const proof = requireObject(state.windowsProof, "Windows proof");
            ctx.assert(proof.signatureStatus === "Valid", `Authenticode status was ${proof.signatureStatus}.`);
            ctx.assert(typeof proof.publisher === "string" && proof.publisher.length > 0, "Verified publisher was missing.");
            ctx.assert(proof.originalExecutableSha256 === proof.renamedExecutableSha256, "Renaming changed executable bytes.");
            ctx.assert(proof.configSource === "sidecar", `Renamed executable config source was ${proof.configSource}.`);
            await ctx.expectText("Configured via install link");
            ctx.output("daytona-windows-signature-and-rename", JSON.stringify(proof, null, 2));
          },
          screenshot: {
            name: "renamed-windows-installer-configured",
            requireText: ["This sets up OpenWork for", "Configured via install link"],
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("Rotating the team link does not invalidate the already-downloaded Windows package", {
          voiceover: vo[4],
          action: async () => {
            await navigateAbsolute(ctx, WINDOWS_INSTALLER_UI_URL);
            await ctx.waitForText("This sets up OpenWork for", { timeoutMs: 30_000 });
            await ctx.eval("document.getElementById('action')?.focus(); true");
          },
          assert: async () => {
            const proof = requireObject(state.windowsProof ?? readWindowsProof(), "Windows proof");
            ctx.assert(proof.oldLinkStatusAfterRotation === 404, `Old link returned ${proof.oldLinkStatusAfterRotation} after rotation.`);
            ctx.assert(proof.newLinkStatus === 200, `New link returned ${proof.newLinkStatus}.`);
            ctx.assert(proof.renamedInstallerExitCode === 0, `Renamed installer exited ${proof.renamedInstallerExitCode}.`);
            ctx.assert(proof.configSource === "sidecar", `Installer used ${proof.configSource} after rotation.`);
            await ctx.expectText("Configured via install link");
          },
          screenshot: {
            name: "downloaded-package-survives-rotation",
            requireText: ["This sets up OpenWork for", "Install"],
          },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await withCdpClient(ctx, DESKTOP_CDP_URL, async () => {
          await ctx.prove("The installed desktop opens at the configured organization sign-in", {
            voiceover: vo[5],
            action: async () => {
              await ctx.waitForText("Sign in with OpenWork Cloud", { timeoutMs: 60_000 });
            },
            assert: async () => {
              const proof = requireObject(state.windowsProof ?? readWindowsProof(), "Windows proof");
              const page = await ctx.eval(`(() => ({
                text: document.body.innerText,
                visibleUrlInputs: Array.from(document.querySelectorAll('input[type="url"]')).filter((input) => input.getClientRects().length > 0).length,
              }))()`);
              ctx.assert(page.text.includes("Welcome to OpenWork"), "Forced sign-in screen was not visible.");
              ctx.assert(page.visibleUrlInputs === 0, "Desktop asked the member to type a server URL.");
              ctx.assert(typeof proof.bootstrapBaseUrl === "string" && proof.bootstrapBaseUrl.length > 0, "Bootstrap base URL proof was missing.");
              ctx.output("installed-desktop-bootstrap", JSON.stringify({ bootstrapBaseUrl: proof.bootstrapBaseUrl, page }, null, 2));
            },
            screenshot: {
              name: "desktop-opens-at-organization-sign-in",
              requireText: ["Welcome to OpenWork", "Sign in with OpenWork Cloud"],
            },
          });
        });
      },
    },
  ],
};

function windowsUa(architecture) {
  return {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Win32",
    metadata: {
      brands: [{ brand: "Chromium", version: "126" }],
      fullVersion: "126.0.0.0",
      platform: "Windows",
      platformVersion: "15.0.0",
      architecture,
      model: "",
      mobile: false,
      bitness: "64",
      wow64: false,
    },
  };
}

function macUa(architecture, bitness) {
  return {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "MacIntel",
    metadata: {
      brands: [{ brand: "Chromium", version: "126" }],
      fullVersion: "126.0.0.0",
      platform: "macOS",
      platformVersion: "14.5.0",
      architecture,
      model: "",
      mobile: false,
      bitness,
      wow64: false,
    },
  };
}

async function emulatePlatform(ctx, input) {
  await ctx.client.send("Emulation.setUserAgentOverride", {
    userAgent: input.userAgent,
    platform: input.platform,
    userAgentMetadata: input.metadata,
  });
}

async function openInstallPage(ctx) {
  await navigateAbsolute(ctx, INSTALL_PAGE_URL);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"install-page\"]'))", {
    timeoutMs: 30_000,
    label: "organization install page",
  });
  await ctx.waitForText("Download OpenWork for", { timeoutMs: 30_000 });
}

async function installPageState(ctx) {
  return ctx.eval(`(() => {
    const page = document.querySelector('[data-testid="install-page"]');
    const primary = Array.from(document.querySelectorAll('[data-testid="install-download-primary"]'));
    return {
      detectedOs: page?.dataset.detectedOs ?? "",
      detectedArch: page?.dataset.detectedArch ?? "",
      detectionSource: page?.dataset.detectionSource ?? "",
      primaryCount: primary.length,
      primaryText: primary[0]?.textContent?.trim() ?? "",
      links: Array.from(document.querySelectorAll('a')).map((link) => link.textContent?.trim() ?? "").filter(Boolean),
    };
  })()`);
}

async function downloadAndInspectWindowsPackages(ctx) {
  const links = await ctx.eval(`(() => Object.fromEntries(
    Array.from(document.querySelectorAll('a'))
      .map((link) => [(link.textContent ?? '').trim(), link.href])
      .filter(([label, href]) => label.startsWith('Windows (') && href)
  ))()`);
  const result = {};
  for (const [architecture, label] of [["x64", "Windows (x64)"], ["arm64", "Windows (ARM64)"]]) {
    const url = links[label];
    if (typeof url !== "string" || !url) throw new Error(`Missing ${label} download link.`);
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const dir = mkdtempSync(path.join(os.tmpdir(), `openwork-${architecture}-zip-`));
    const zipPath = path.join(dir, "package.zip");
    const extractedPath = path.join(dir, "extracted");
    mkdirSync(extractedPath);
    writeFileSync(zipPath, bytes);
    const unzip = spawnSync("unzip", ["-q", zipPath, "-d", extractedPath], { encoding: "utf8" });
    if (unzip.status !== 0) throw new Error(`Could not extract ${architecture} package: ${unzip.stderr || unzip.stdout}`);
    const sidecarPath = path.join(extractedPath, SIDECAR_NAME);
    const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf8")) : {};
    const disposition = response.headers.get("content-disposition") ?? "";
    result[architecture] = {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      contentDisposition: disposition,
      organizationNamed: new RegExp(`OpenWork-Installer-[a-z0-9._-]+-win-${architecture}\\.zip`).test(disposition),
      hasExecutable: existsSync(path.join(extractedPath, WINDOWS_EXECUTABLE_NAME)),
      hasSidecar: existsSync(sidecarPath),
      clientName: typeof sidecar.clientName === "string" ? sidecar.clientName : "",
      bytes: bytes.length,
    };
  }
  return result;
}

function readWindowsProof() {
  if (!WINDOWS_PROOF_PATH || !existsSync(WINDOWS_PROOF_PATH)) {
    throw new Error(`Daytona Windows proof JSON is missing at ${WINDOWS_PROOF_PATH || "(unset)"}.`);
  }
  return JSON.parse(readFileSync(WINDOWS_PROOF_PATH, "utf8"));
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} was not prepared.`);
  return value;
}

async function navigateAbsolute(ctx, url) {
  await ctx.client.send("Page.navigate", { url });
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: `load ${url}` });
}

async function withCdpClient(ctx, cdpBaseUrl, callback) {
  const targets = await listTargets(cdpBaseUrl);
  const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  if (!target) throw new Error(`No page target found at ${cdpBaseUrl}.`);
  const previous = ctx.client;
  const client = await connect(debuggerUrlFor(cdpBaseUrl, target));
  ctx.client = client;
  try {
    return await callback();
  } finally {
    ctx.client = previous;
    client.close();
  }
}
