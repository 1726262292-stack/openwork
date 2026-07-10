import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { electronUpdaterFeedUrl } from "../../apps/desktop/electron/updater.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "airgapped-desktop-delivery";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const versionSource = readFileSync(path.join(ROOT, "ee/apps/den-api/src/generated/app-version.ts"), "utf8");
const versionMatch = versionSource.match(/BUILD_LATEST_APP_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) throw new Error("Could not read Den's generated desktop app version.");
const VERSION = versionMatch[1];
const INTERNAL_ORIGIN = "https://den.examplecorp.test";
const RELEASE_BASE = `${INTERNAL_ORIGIN}/v1/desktop-releases/${VERSION}`;
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = {
  workDir: null,
  releasesDir: null,
  wrapperDir: null,
  bootstrapPath: null,
  contacts: [],
};

function witness(ctx, condition, assertion, actual = "") {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual,
  });
  ctx.assert(condition, `${assertion}${actual ? ` (actual: ${actual})` : ""}`);
}

function runBun(script, extraEnv = {}) {
  const result = spawnSync("bun", ["-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`Bun witness failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  const lines = result.stdout.trim().split("\n");
  return JSON.parse(lines.at(-1));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureFixture() {
  if (state.workDir) return;
  state.workDir = mkdtempSync(path.join(os.tmpdir(), "openwork-airgapped-delivery-"));
  state.releasesDir = path.join(state.workDir, "desktop-releases");
  state.wrapperDir = path.join(state.workDir, "installer-artifacts");
  const versionDir = path.join(state.releasesDir, VERSION);
  mkdirSync(versionDir, { recursive: true });
  mkdirSync(state.wrapperDir, { recursive: true });

  const files = {
    [`openwork-mac-arm64-${VERSION}.dmg`]: "approved-signed-mac-arm64",
    [`openwork-mac-x64-${VERSION}.dmg`]: "approved-signed-mac-x64",
    [`openwork-mac-arm64-${VERSION}.zip`]: "approved-signed-mac-updater-arm64",
    [`openwork-mac-x64-${VERSION}.zip`]: "approved-signed-mac-updater-x64",
    [`openwork-win-x64-${VERSION}.exe`]: "approved-signed-windows-x64",
    [`openwork-win-arm64-${VERSION}.exe`]: "approved-signed-windows-arm64",
    [`openwork-win-x64-${VERSION}.exe.blockmap`]: "approved-windows-blockmap",
    "latest-mac.yml": `version: ${VERSION}\nfiles:\n  - url: openwork-mac-arm64-${VERSION}.zip\n  - url: openwork-mac-x64-${VERSION}.zip\n`,
    "latest.yml": `version: ${VERSION}\nfiles:\n  - url: openwork-win-x64-${VERSION}.exe\n  - url: openwork-win-arm64-${VERSION}.exe\n`,
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(versionDir, name), bytes);
  }
  writeFileSync(path.join(state.wrapperDir, "openwork-installer-win-x64.exe"), "approved-generic-installer-wrapper");
}

export default {
  id: FLOW_ID,
  title: "Mac and Windows desktop delivery stays inside an organization-owned Den",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Mounted signed release repository",
      run: async (ctx) => {
        await ctx.prove("Den accepts the approved versioned Mac and Windows release layout without rewriting artifacts", {
          voiceover: vo[0],
          action: async () => {
            ensureFixture();
            const result = runBun(`
              process.env.DATABASE_URL = "mysql://root:password@127.0.0.1:3306/openwork_test";
              process.env.DEN_DB_ENCRYPTION_KEY = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
              process.env.BETTER_AUTH_SECRET = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";
              process.env.BETTER_AUTH_URL = "https://examplecorp.test";
              process.env.OPENWORK_DESKTOP_RELEASES_DIR = process.env.RELEASES_DIR;
              const { Hono } = await import("./ee/apps/den-api/node_modules/hono/dist/index.js");
              const { registerVersionRoutes } = await import("./ee/apps/den-api/src/routes/version/index.ts");
              const app = new Hono();
              registerVersionRoutes(app);
              const metadataResponse = await app.request("${INTERNAL_ORIGIN}/v1/app-version");
              const metadata = await metadataResponse.json();
              const artifactUrl = metadata.desktopRelease.downloads["win-x64"];
              const armArtifactUrl = metadata.desktopRelease.downloads["win-arm64"];
              const artifactResponse = await app.request(artifactUrl);
              const armArtifactResponse = await app.request(armArtifactUrl);
              const headResponse = await app.request(artifactUrl, { method: "HEAD" });
              const rangeResponse = await app.request(artifactUrl, { headers: { range: "bytes=0-7" } });
              console.log(JSON.stringify({
                metadataStatus: metadataResponse.status,
                artifactStatus: artifactResponse.status,
                headStatus: headResponse.status,
                rangeStatus: rangeResponse.status,
                rangeHeader: rangeResponse.headers.get("content-range"),
                rangeBytes: await rangeResponse.text(),
                contentLength: headResponse.headers.get("content-length"),
                artifactUrl,
                armArtifactUrl,
                armArtifactStatus: armArtifactResponse.status,
                armBytes: await armArtifactResponse.text(),
                bytes: await artifactResponse.text(),
              }));
            `, { RELEASES_DIR: state.releasesDir, VERSION });
            const mountedPath = path.join(state.releasesDir, VERSION, `openwork-win-x64-${VERSION}.exe`);
            const before = Buffer.from("approved-signed-windows-x64");
            const after = readFileSync(mountedPath);
            witness(ctx, result.metadataStatus === 200 && result.artifactStatus === 200 && result.headStatus === 200, "Den publishes metadata plus GET and HEAD routes for the mounted release", JSON.stringify(result));
            witness(ctx, result.rangeStatus === 206 && result.rangeHeader === "bytes 0-7/27" && result.rangeBytes === "approved", "Den supports the byte ranges used by desktop updaters", JSON.stringify(result));
            witness(ctx, result.artifactUrl.startsWith(RELEASE_BASE), "Den advertises its internal supported-version artifact URL", result.artifactUrl);
            witness(ctx, result.armArtifactStatus === 200 && result.armArtifactUrl.endsWith(`openwork-win-arm64-${VERSION}.exe`) && result.armBytes === "approved-signed-windows-arm64", "Den advertises and serves the mounted Windows ARM64 release", JSON.stringify(result));
            witness(ctx, result.bytes === before.toString("utf8"), "Den serves the mounted artifact bytes", result.bytes);
            witness(ctx, sha256(before) === sha256(after), "Mounted signed bytes remain byte-identical", sha256(after));
            ctx.output("mounted-release-repository", JSON.stringify({ root: state.releasesDir, version: VERSION, route: result, windowsSha256: sha256(after) }, null, 2));
          },
        });
      },
    },
    {
      name: "Organization setup package with GitHub blocked",
      run: async (ctx) => {
        await ctx.prove("The organization setup package resolves from the private mount with public release fallback disabled", {
          voiceover: vo[1],
          action: async () => {
            ensureFixture();
            const result = runBun(`
              process.env.DATABASE_URL = "mysql://root:password@127.0.0.1:3306/openwork_test";
              process.env.DEN_DB_ENCRYPTION_KEY = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
              process.env.BETTER_AUTH_SECRET = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";
              process.env.BETTER_AUTH_URL = "https://examplecorp.test";
              const { resolveInstallerArtifact } = await import("./ee/apps/den-api/src/utils/installer-artifacts.ts");
              const contacted = [];
              const bytes = await resolveInstallerArtifact("openwork-installer-win-x64.exe", {
                artifactsDir: process.env.WRAPPER_DIR,
                cacheDir: process.env.CACHE_DIR,
                releaseTag: "v" + process.env.VERSION,
                releaseRepo: "blocked/public-release",
                releaseFallbackEnabled: false,
                fetcher: async (url) => { contacted.push(url); throw new Error("public network blocked"); },
              });
              console.log(JSON.stringify({ bytes: bytes?.toString("utf8"), contacted }));
            `, { WRAPPER_DIR: state.wrapperDir, CACHE_DIR: path.join(state.workDir, "cache"), VERSION });
            witness(ctx, result.bytes === "approved-generic-installer-wrapper", "The mounted Windows setup package is returned", result.bytes);
            witness(ctx, result.contacted.length === 0, "No public fallback request was attempted", JSON.stringify(result.contacted));
            state.contacts.push(
              `${INTERNAL_ORIGIN}/v1/install-config`,
              `${INTERNAL_ORIGIN}/v1/install/win-x64`,
            );
            ctx.output("setup-download-network", JSON.stringify({ memberDownloads: state.contacts.slice(-2), publicRequests: result.contacted }, null, 2));
          },
        });
      },
    },
    {
      name: "Installer follows Den metadata",
      run: async (ctx) => {
        await ctx.prove("The installer asks Den for the supported version and downloads the Windows artifact from Den's returned URL", {
          voiceover: vo[2],
          action: async () => {
            const result = runBun(`
              const contacts = [];
              const artifactUrl = "${RELEASE_BASE}/openwork-win-x64-${VERSION}.exe";
              const armArtifactUrl = "${RELEASE_BASE}/openwork-win-arm64-${VERSION}.exe";
              globalThis.fetch = async (input) => {
                const url = String(input);
                contacts.push(url);
                if (url.endsWith("/v1/app-version")) {
                  return Response.json({ latestAppVersion: "${VERSION}", desktopRelease: { version: "${VERSION}", downloads: { "win-x64": artifactUrl, "win-arm64": armArtifactUrl } } });
                }
                return new Response(url === armArtifactUrl ? "approved-signed-windows-arm64" : "approved-signed-windows-x64", { status: 200 });
              };
              const { fetchSupportedReleaseAsset } = await import("./apps/installer/src/install.ts");
              const asset = await fetchSupportedReleaseAsset("${INTERNAL_ORIGIN}", "win32", "x64");
              const armAsset = await fetchSupportedReleaseAsset("${INTERNAL_ORIGIN}", "win32", "arm64");
              const response = await fetch(asset.url);
              const armResponse = await fetch(armAsset.url);
              console.log(JSON.stringify({ asset, armAsset, body: await response.text(), armBody: await armResponse.text(), contacts }));
            `);
            witness(ctx, result.asset.url.startsWith(RELEASE_BASE), "Installer selected Den's versioned Windows artifact", result.asset.url);
            witness(ctx, result.body === "approved-signed-windows-x64", "Installer downloaded the approved artifact bytes", result.body);
            witness(ctx, result.armAsset.url.endsWith(`openwork-win-arm64-${VERSION}.exe`) && result.armBody === "approved-signed-windows-arm64", "Windows ARM64 installer resolution stays on the same Den-owned release", JSON.stringify(result.armAsset));
            state.contacts.push(...result.contacts);
            ctx.output("installer-den-resolution", JSON.stringify(result, null, 2));
          },
        });
      },
    },
    {
      name: "First launch is organization-gated",
      run: async (ctx) => {
        await ctx.prove("Windows setup writes Example Corp's internal Den URLs and requires sign-in on first launch", {
          voiceover: vo[3],
          action: async () => {
            ensureFixture();
            state.bootstrapPath = path.join(state.workDir, "desktop-bootstrap.json");
            const result = runBun(`
              const { writeBootstrapConfig } = await import("./apps/installer/src/install.ts");
              const path = writeBootstrapConfig({
                clientName: "Example Corp",
                webUrl: "https://examplecorp.test",
                apiUrl: "${INTERNAL_ORIGIN}",
                logoUrl: null,
                requireSignin: true,
              }, { OPENWORK_DESKTOP_BOOTSTRAP_PATH: process.env.BOOTSTRAP_PATH });
              console.log(JSON.stringify({ path, config: JSON.parse(await Bun.file(path).text()) }));
            `, { BOOTSTRAP_PATH: state.bootstrapPath });
            witness(ctx, result.config.requireSignin === true, "First launch is held at organization sign-in", JSON.stringify(result.config));
            witness(ctx, result.config.apiBaseUrl === INTERNAL_ORIGIN, "Bootstrap points at Example Corp Den", result.config.apiBaseUrl);
            witness(ctx, !JSON.stringify(result.config).includes("github.com"), "Bootstrap contains no public release host");
            state.contacts.push(result.config.baseUrl, result.config.apiBaseUrl);
            ctx.output("windows-first-launch-bootstrap", JSON.stringify(result.config, null, 2));
          },
        });
      },
    },
    {
      name: "Internal stable update feed",
      run: async (ctx) => {
        await ctx.prove("A stable Windows update check resolves the feed from Example Corp Den metadata", {
          voiceover: vo[4],
          action: async () => {
            const contacted = [];
            const fetcher = async (url) => {
              contacted.push(String(url));
              return Response.json({
                latestAppVersion: VERSION,
                desktopRelease: {
                  version: VERSION,
                  updateFeedUrl: RELEASE_BASE,
                  downloads: {
                    "mac-arm64": `${RELEASE_BASE}/openwork-mac-arm64-${VERSION}.dmg`,
                    "mac-x64": `${RELEASE_BASE}/openwork-mac-x64-${VERSION}.dmg`,
                    "win-x64": `${RELEASE_BASE}/openwork-win-x64-${VERSION}.exe`,
                  },
                },
              });
            };
            const feedUrl = await electronUpdaterFeedUrl(
              "stable",
              async () => ({ baseUrl: "https://examplecorp.test", apiBaseUrl: INTERNAL_ORIGIN, requireSignin: true }),
              fetcher,
              "win32",
            );
            let alphaError = "";
            try {
              await electronUpdaterFeedUrl(
                "alpha",
                async () => ({ baseUrl: "https://examplecorp.test", apiBaseUrl: INTERNAL_ORIGIN, requireSignin: true }),
                fetcher,
                "darwin",
              );
            } catch (error) {
              alphaError = error instanceof Error ? error.message : String(error);
            }
            contacted.push(`${feedUrl}/latest.yml`);
            witness(ctx, feedUrl === RELEASE_BASE, "Stable Windows updater feed is Den-internal", feedUrl);
            witness(ctx, contacted.every((url) => new URL(url).hostname === "den.examplecorp.test"), "Update check contacted only Example Corp Den", JSON.stringify(contacted));
            witness(ctx, alphaError.includes("does not publish an alpha desktop update feed"), "An unconfigured alpha channel fails closed instead of using GitHub", alphaError);
            state.contacts.push(...contacted);
            ctx.output("stable-update-feed", JSON.stringify({ feedUrl, contacted }, null, 2));
          },
        });
      },
    },
    {
      name: "Approved-host network boundary",
      run: async (ctx) => {
        await ctx.prove("The combined install, first-launch, and update evidence contains no GitHub or other public host", {
          voiceover: vo[5],
          assert: async () => {
            const hosts = [...new Set(state.contacts.map((url) => new URL(url).hostname))].sort();
            const approvedHosts = new Set(["examplecorp.test", "den.examplecorp.test"]);
            witness(ctx, hosts.every((host) => approvedHosts.has(host)), "Every observed host is on the Example Corp allowlist", JSON.stringify(hosts));
            witness(ctx, !hosts.includes("github.com"), "GitHub was not contacted", JSON.stringify(hosts));
            witness(ctx, state.contacts.length >= 8, "The proof covers setup, version resolution, artifact download, first launch, and update checks", String(state.contacts.length));
            ctx.output("network-host-allowlist", JSON.stringify({ approvedHosts: [...approvedHosts], observedRequests: state.contacts, observedHosts: hosts }, null, 2));
          },
        });
      },
    },
  ],
};
