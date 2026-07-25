export type InstallPlatform = "mac-arm64" | "mac-x64" | "win-x64" | "linux-x64" | "linux-arm64";

// Mirrors genericInstallerArtifactName() in den-api. The published installers carry no
// version in their name, so these are the exact names the browser saves. Linux is absent
// on purpose: its setup script name embeds the organization slug, which this page never sees.
const INSTALLER_FILE_NAMES: Partial<Record<InstallPlatform, string>> = {
  "mac-arm64": "OpenWork-Installer-mac-arm64.dmg",
  "mac-x64": "OpenWork-Installer-mac-x64.dmg",
  "win-x64": "OpenWork-Installer-win-x64.exe",
};

export function installerFileName(platform: InstallPlatform | null) {
  return platform ? INSTALLER_FILE_NAMES[platform] ?? null : null;
}

export function buildInstallDownloadHref(apiUrl: string, platform: InstallPlatform, token: string) {
  const url = new URL(apiUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/install/${platform}`;
  url.search = `?token=${encodeURIComponent(token)}`;
  url.hash = "";
  return url.toString();
}
