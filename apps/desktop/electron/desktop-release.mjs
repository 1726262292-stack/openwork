function cleanHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function denApiBaseUrlFromBootstrap(config) {
  const explicit = cleanHttpUrl(config?.apiBaseUrl);
  if (explicit) return explicit;
  const webBaseUrl = cleanHttpUrl(config?.baseUrl);
  if (!webBaseUrl) throw new Error("Desktop bootstrap config is missing a valid Den URL.");
  return new URL("/api", `${webBaseUrl}/`).toString().replace(/\/+$/, "");
}

export function parseDesktopReleaseMetadata(payload) {
  if (!payload || typeof payload !== "object") return null;
  const desktopRelease = payload.desktopRelease;
  if (!desktopRelease || typeof desktopRelease !== "object") return null;
  const latestAppVersion = typeof payload.latestAppVersion === "string" ? payload.latestAppVersion.trim() : "";
  const version = typeof desktopRelease.version === "string" ? desktopRelease.version.trim() : "";
  const updateFeedUrl = cleanHttpUrl(desktopRelease.updateFeedUrl);
  const alphaUpdateFeedUrl = cleanHttpUrl(desktopRelease.alphaUpdateFeedUrl);
  const rawDownloads = desktopRelease.downloads;
  if (
    !latestAppVersion
    || version !== latestAppVersion
    || !updateFeedUrl
    || !rawDownloads
    || typeof rawDownloads !== "object"
  ) return null;

  const downloads = {};
  for (const platform of ["mac-arm64", "mac-x64", "win-x64"]) {
    const url = cleanHttpUrl(rawDownloads[platform]);
    if (!url) return null;
    downloads[platform] = url;
  }
  if (rawDownloads["win-arm64"] !== undefined) {
    const windowsArm64Url = cleanHttpUrl(rawDownloads["win-arm64"]);
    if (!windowsArm64Url) return null;
    downloads["win-arm64"] = windowsArm64Url;
  }
  return { version, updateFeedUrl, ...(alphaUpdateFeedUrl ? { alphaUpdateFeedUrl } : {}), downloads };
}

export async function fetchDeploymentDesktopRelease({ getDesktopBootstrapConfig, fetcher = fetch }) {
  if (typeof getDesktopBootstrapConfig !== "function") {
    throw new Error("Desktop bootstrap config reader is unavailable.");
  }
  const config = await getDesktopBootstrapConfig();
  const apiBaseUrl = denApiBaseUrlFromBootstrap(config);
  const response = await fetcher(`${apiBaseUrl}/v1/app-version`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Deployment version check failed (${response.status} ${response.statusText})`);
  }
  const metadata = parseDesktopReleaseMetadata(await response.json());
  if (!metadata) {
    throw new Error("Deployment did not publish Mac and Windows desktop release URLs.");
  }
  return metadata;
}

export function desktopReleaseDownloadUrl(metadata, platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return metadata.downloads[`mac-${arch}`] ?? null;
  }
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) {
    return metadata.downloads[`win-${arch}`] ?? null;
  }
  return null;
}
