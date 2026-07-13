"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import { buildInstallDownloadHref, buildInstallPreparePath, getInstallDownloadStage, parseInstallPrepareStatus, shouldAutoRequestInstaller, type InstallPlatform } from "../_lib/install-download";
import { isMobileUserAgent } from "../_lib/platform";
import { InstallDownloadSpinner } from "./install-download-spinner";

type InstallConfig = {
  appName: string;
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
};

const platformOptions: Array<{ value: InstallPlatform; label: string }> = [
  { value: "mac-arm64", label: "Mac (Apple silicon)" },
  { value: "mac-x64", label: "Mac (Intel)" },
  { value: "win-x64", label: "Windows" },
  { value: "linux-x64", label: "Linux (x64)" },
  { value: "linux-arm64", label: "Linux (ARM64)" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parseInstallConfig(value: unknown): InstallConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const clientName = typeof value.clientName === "string" ? value.clientName.trim() : "";
  const appName = typeof value.appName === "string" && value.appName.trim() ? value.appName.trim() : "OpenWork";
  const webUrl = typeof value.webUrl === "string" ? value.webUrl.trim() : "";
  const apiUrl = typeof value.apiUrl === "string" ? value.apiUrl.trim() : "";
  const requireSignin = value.requireSignin;
  const logoUrl = value.logoUrl;

  if (!clientName || !isUrl(webUrl) || !isUrl(apiUrl) || typeof requireSignin !== "boolean") {
    return null;
  }
  if (logoUrl !== null && (typeof logoUrl !== "string" || !isUrl(logoUrl))) {
    return null;
  }

  return {
    appName,
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
  };
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") {
    return "mac-arm64";
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "win-x64";
  }
  if (platform.includes("linux") || userAgent.includes("linux")) {
    return userAgent.includes("aarch64") || userAgent.includes("arm64") ? "linux-arm64" : "linux-x64";
  }
  return "mac-arm64";
}

function installHref(config: InstallConfig, platform: InstallPlatform, token: string) {
  return buildInstallDownloadHref(config.apiUrl, platform, token);
}

export function InstallScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>("mac-arm64");
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "requested" | "error">("idle");
  const [downloadLabel, setDownloadLabel] = useState("your computer");
  const [downloadPlatform, setDownloadPlatform] = useState<InstallPlatform | null>(null);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadDetail, setDownloadDetail] = useState("");
  const [showPreparationRetry, setShowPreparationRetry] = useState(false);
  const [downloadHref, setDownloadHref] = useState("");
  const prepareAbortController = useRef<AbortController | null>(null);
  const prepareStageInterval = useRef<number | null>(null);
  const prepareTimeout = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!token) {
        setError("This install link is missing its token. Ask your workspace admin for a fresh link.");
        setBusy(false);
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const { response, payload } = await requestJson(`/v1/install-config?token=${encodeURIComponent(token)}`, { method: "GET" }, 12000);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(getErrorMessage(payload, response.status === 404 ? "This install link is expired or no longer available." : `Could not load this install link (${response.status}).`));
          setConfig(null);
          return;
        }
        const parsed = parseInstallConfig(payload);
        if (!parsed) {
          setError("This install link returned incomplete setup details.");
          setConfig(null);
          return;
        }
        setConfig(parsed);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this install link.");
          setConfig(null);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => () => {
    prepareAbortController.current?.abort();
    if (prepareStageInterval.current !== null) {
      window.clearInterval(prepareStageInterval.current);
    }
    if (prepareTimeout.current !== null) {
      window.clearTimeout(prepareTimeout.current);
    }
  }, []);

  const secondaryPlatforms = useMemo(() => platformOptions.filter((option) => option.value !== platform), [platform]);

  async function copyCurrentLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function clearPreparationTimers() {
    if (prepareStageInterval.current !== null) {
      window.clearInterval(prepareStageInterval.current);
      prepareStageInterval.current = null;
    }
    if (prepareTimeout.current !== null) {
      window.clearTimeout(prepareTimeout.current);
      prepareTimeout.current = null;
    }
  }

  function updatePreparationStage(startedAt: number) {
    const stage = getInstallDownloadStage(Date.now() - startedAt);
    setDownloadMessage(stage.label);
    setDownloadDetail(stage.detail);
    setShowPreparationRetry(stage.showRetry);
  }

  async function beginDownload(targetPlatform: InstallPlatform, label: string) {
    if (!config || !token) {
      return;
    }

    prepareAbortController.current?.abort();
    clearPreparationTimers();

    const href = installHref(config, targetPlatform, token);
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;

    setDownloadLabel(label);
    setDownloadPlatform(targetPlatform);
    setDownloadHref(href);
    setDownloadState("preparing");
    setShowPreparationRetry(false);
    updatePreparationStage(startedAt);

    prepareAbortController.current = controller;
    prepareStageInterval.current = window.setInterval(() => updatePreparationStage(startedAt), 1000);
    prepareTimeout.current = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);

    try {
      const { response, payload } = await requestJson(
        buildInstallPreparePath(targetPlatform, token),
        { method: "GET", signal: controller.signal },
        0,
      );

      if (controller.signal.aborted || prepareAbortController.current !== controller) {
        return;
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, response.status === 404 ? "This install link is expired or no longer available." : `Could not prepare this download (${response.status}).`));
      }

      const status = parseInstallPrepareStatus(payload);
      if (!status) {
        throw new Error("The server did not return a usable installer readiness status.");
      }

      clearPreparationTimers();
      setShowPreparationRetry(false);
      setDownloadState("requested");
      setDownloadMessage(status.status === "fallback" ? "Standard OpenWork download requested" : "Team installer ready — download requested");
      setDownloadDetail(status.status === "fallback"
        ? "This server could not prepare a team ZIP, so the download request will use the verified standard installer."
        : "Your browser is now handling the real installer request. Check your downloads if no prompt appears.");

      if (shouldAutoRequestInstaller(status)) {
        window.location.assign(href);
      }
    } catch (downloadError) {
      if (controller.signal.aborted && !timedOut) {
        return;
      }
      if (prepareAbortController.current !== controller) {
        return;
      }
      clearPreparationTimers();
      setDownloadState("error");
      setDownloadMessage("Download was not requested");
      setDownloadDetail(timedOut ? "The server did not report readiness in time. Retry the readiness check before downloading." : downloadError instanceof Error ? downloadError.message : "Could not prepare this download.");
      setShowPreparationRetry(true);
    } finally {
      if (prepareAbortController.current === controller) {
        prepareAbortController.current = null;
        clearPreparationTimers();
      }
    }
  }

  function retryDownload() {
    if (!downloadPlatform) {
      return;
    }
    void beginDownload(downloadPlatform, downloadLabel);
  }

  if (busy) {
    return (
      <section className="den-page grid min-h-dvh place-items-center py-4 lg:py-6" data-testid="install-page">
        <div className="den-frame grid w-full max-w-[44rem] gap-4 p-6 md:p-8">
          <p className="den-eyebrow">OpenWork Desktop</p>
          <h1 className="den-title-lg">Loading your install link.</h1>
          <p className="den-copy">Checking your team's OpenWork setup...</p>
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section className="den-page grid min-h-dvh place-items-center py-4 lg:py-6" data-testid="install-page">
        <div className="den-frame grid w-full max-w-[44rem] gap-6 p-6 md:p-8">
          <div className="grid gap-2">
            <p className="den-eyebrow">OpenWork Desktop</p>
            <h1 className="den-title-lg">This install link can't be opened.</h1>
            <p className="den-copy">{error ?? "Ask your workspace admin for a fresh install link."}</p>
          </div>
        </div>
      </section>
    );
  }

  const primaryHref = installHref(config, platform, token);
  const primaryLabel = platformOptions.find((option) => option.value === platform)?.label ?? "your computer";

  return (
    <section className="den-page grid min-h-dvh place-items-center py-4 lg:py-6" data-testid="install-page">
      <div className="den-frame grid w-full max-w-[44rem] gap-6 p-6 text-center md:p-8" data-testid="install-card">
        <div className="grid justify-items-center gap-3">
          <p className="den-eyebrow">{config.appName} Desktop</p>
          {config.logoUrl ? (
            // Organization logos may be served by private on-prem hosts that
            // are intentionally absent from this deployment's image allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt={`${config.clientName} wordmark`} className="max-h-16 max-w-64 object-contain object-center" />
          ) : null}
          <h1 className="den-title-xl">Download {config.appName} for {config.clientName}</h1>
          <p className="den-copy">Mac and Windows downloads include the standard OpenWork installer and your team's setup file in one ZIP. Keep them together, run the installer, then sign in.</p>
        </div>

        {isMobile ? (
          <div className="den-frame-inset grid gap-3 rounded-[1.5rem] p-5" data-testid="install-mobile-note">
            <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">{config.appName} runs on your computer.</p>
            <p className="den-copy">Open this link on your Mac, Windows, or Linux machine. You can also copy it and send it to yourself.</p>
            <button type="button" className="den-button-secondary w-full sm:w-auto" onClick={() => void copyCurrentLink()}>
              {copied ? "Copied" : "Copy install link"}
            </button>
          </div>
        ) : (
          <div className="grid justify-items-center gap-4">
            <a className="den-button-primary w-full justify-center sm:w-auto" href={primaryHref} data-testid="install-download-primary" onClick={(event) => { event.preventDefault(); void beginDownload(platform, primaryLabel); }}>
              Download for {primaryLabel}
            </a>
            <div className="flex flex-wrap justify-center gap-2">
              {secondaryPlatforms.map((option) => (
                <a key={option.value} className="den-button-secondary" href={installHref(config, option.value, token)} onClick={(event) => { event.preventDefault(); void beginDownload(option.value, option.label); }}>
                  {option.label}
                </a>
              ))}
            </div>
            {downloadState !== "idle" ? (
              <div className="den-frame-inset grid w-full justify-items-center gap-2 rounded-[1.25rem] p-4" aria-live={downloadState === "error" ? "assertive" : "polite"} role={downloadState === "error" ? "alert" : "status"} data-testid="install-download-status">
                {downloadState === "preparing" ? (
                  <>
                    <InstallDownloadSpinner />
                    <p className="m-0 font-medium text-[var(--dls-text-primary)]" data-testid="install-download-stage">{downloadMessage}</p>
                    <p className="den-copy">Preparing {downloadLabel}. {downloadDetail}</p>
                    {showPreparationRetry ? (
                      <button type="button" className="den-button-secondary" onClick={retryDownload} data-testid="install-download-retry">
                        Retry readiness check
                      </button>
                    ) : null}
                  </>
                ) : downloadState === "requested" ? (
                  <>
                    <p className="m-0 font-medium text-[var(--dls-text-primary)]">{downloadMessage}</p>
                    <p className="den-copy">{downloadDetail}</p>
                    <button type="button" className="den-button-secondary" onClick={retryDownload} data-testid="install-download-retry">
                      Try again
                    </button>
                  </>
                ) : (
                  <>
                    <p className="m-0 font-medium text-[var(--dls-text-primary)]">{downloadMessage}</p>
                    <p className="den-copy">{downloadDetail}</p>
                    <button type="button" className="den-button-secondary" onClick={retryDownload} data-testid="install-download-retry" disabled={!downloadHref}>
                      Retry readiness check
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
