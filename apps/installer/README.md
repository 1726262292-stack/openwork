# OpenWork Installer

OpenWork desktop installer for custom deployments. Release builds are generic;
deployment config is resolved from an install link stamp, sidecar file, filename tag,
or local development env overrides. When an end user runs it, the installer:

1. Writes `desktop-bootstrap.json` to the OS-correct config location (the same path
   the desktop app and `openwork-bootstrap` CLI resolve), pointing the desktop app at
   the client's deployment. Existing extra fields (handoff, claim links) are preserved.
2. Uses the exact standard app version declared by the organization JSON and
   downloads that signed release directly from public OpenWork release hosting.
3. Installs the standard app (macOS: mounts the DMG and copies the `.app` into
   `~/Applications`; Windows: runs the NSIS installer silently; Linux: installs
   the AppImage under `~/.local/share/openwork` with a desktop entry).

The UI is a small native webview window (webview-bun); if the platform webview library
is unavailable, the same UI opens in the default browser.

## Install-link stamping

The Den API combines the unchanged lightweight generic installer artifact and
`openwork-installer.json` into one organization ZIP. The standard desktop DMG
or EXE is not included.
Both macOS and Windows read the JSON beside the exact installer the user
launches. The macOS resolver follows App Translocation back to that extracted
bundle. An unstamped UI build asks the user to paste their OpenWork install
link.

The sidecar includes the Den web/API origins, exact app version, managed app
name, wordmark URL, and square icon URL. The installer writes these to the
canonical `desktop-bootstrap.json` before downloading or launching the app.
On first visible launch, the desktop reads this file before creating its first
window so the company name, sign-in wordmark, server, and Dock/taskbar icon are
already selected. It never searches Downloads or Desktop.

## Local development

```bash
cd apps/installer
bun install
bun test

# Headless dry run (no download/install; verifies config write + version + asset):
OPENWORK_INSTALLER_CLIENT_NAME="Acme" \
OPENWORK_INSTALLER_WEB_URL="https://openwork.acme.com" \
OPENWORK_INSTALLER_API_URL="https://openwork-api.acme.com" \
bun run src/index.ts --headless --dry-run

# UI mode (uses install-link stamp, sidecar, filename tag, build config, or env overrides):
bun run dev

# Single binary:
bun run compile
```

`src/generated/build-config.ts` is a committed placeholder for legacy/dev builds.
Empty placeholder values make headless mode require `--install-link`; UI mode prompts
for the install link instead of pointing users at the wrong deployment.
