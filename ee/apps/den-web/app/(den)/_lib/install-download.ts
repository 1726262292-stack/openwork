export type InstallPlatform = "mac-arm64" | "mac-x64" | "win-x64" | "linux-x64" | "linux-arm64";

export type InstallPrepareStatus =
  | { status: "ready"; stage: "bundle" | "script" }
  | { status: "fallback"; stage: "standard-download"; fallbackUrl: string };

export type InstallDownloadStage = {
  minimumElapsedMs: number;
  label: string;
  detail: string;
  showRetry: boolean;
};

const initialInstallDownloadStage: InstallDownloadStage = {
  minimumElapsedMs: 0,
  label: "Checking this install link...",
  detail: "The server is validating the token and platform before any download is requested.",
  showRetry: false,
};

export const installDownloadStages: InstallDownloadStage[] = [
  initialInstallDownloadStage,
  {
    minimumElapsedMs: 4_000,
    label: "Preparing your team package...",
    detail: "The server is resolving the signed installer and your workspace setup file.",
    showRetry: false,
  },
  {
    minimumElapsedMs: 12_000,
    label: "Fetching release artifacts...",
    detail: "First-time downloads can take a minute while OpenWork release files are cached.",
    showRetry: false,
  },
  {
    minimumElapsedMs: 30_000,
    label: "Still preparing the installer...",
    detail: "Cold servers may need longer. You can retry the readiness check without downloading twice.",
    showRetry: true,
  },
];

function installApiHref(apiUrl: string, path: string, token: string) {
  const url = new URL(apiUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${path}`;
  url.search = `?token=${encodeURIComponent(token)}`;
  url.hash = "";
  return url.toString();
}

export function buildInstallDownloadHref(apiUrl: string, platform: InstallPlatform, token: string) {
  return installApiHref(apiUrl, `/v1/install/${platform}`, token);
}

export function buildInstallPrepareHref(apiUrl: string, platform: InstallPlatform, token: string) {
  return installApiHref(apiUrl, `/v1/install/${platform}/prepare`, token);
}

export function buildInstallPreparePath(platform: InstallPlatform, token: string) {
  return `/v1/install/${platform}/prepare?token=${encodeURIComponent(token)}`;
}

export function getInstallDownloadStage(elapsedMs: number) {
  let stage = initialInstallDownloadStage;
  for (const candidate of installDownloadStages) {
    if (elapsedMs >= candidate.minimumElapsedMs) {
      stage = candidate;
    }
  }
  return stage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReadyStage(value: unknown): value is "bundle" | "script" {
  return value === "bundle" || value === "script";
}

export function parseInstallPrepareStatus(value: unknown): InstallPrepareStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.status === "ready" && isReadyStage(value.stage)) {
    return { status: "ready", stage: value.stage };
  }

  if (value.status === "fallback" && value.stage === "standard-download" && typeof value.fallbackUrl === "string" && value.fallbackUrl.trim()) {
    const fallbackUrl = value.fallbackUrl.trim();
    try {
      new URL(fallbackUrl);
    } catch {
      return null;
    }
    return { status: "fallback", stage: "standard-download", fallbackUrl };
  }

  return null;
}

export function shouldAutoRequestInstaller(status: InstallPrepareStatus | null) {
  return status?.status === "ready" || status?.status === "fallback";
}
