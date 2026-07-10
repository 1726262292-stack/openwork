"use client";

import { detectPlatform, type DetectedPlatform } from "@openwork/ui/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import {
  installPlatformOptions,
  installPlatformsForOs,
  recommendedInstallPlatform,
  type InstallPlatform,
} from "../_lib/install-platform";
import { isMobileUserAgent } from "../_lib/platform";

type InstallConfig = {
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
};

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
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
  };
}

function apiOrigin(config: InstallConfig) {
  return new URL(config.apiUrl).origin;
}

function installHref(config: InstallConfig, platform: InstallPlatform, token: string) {
  return `${apiOrigin(config)}/v1/install/${platform}?token=${encodeURIComponent(token)}`;
}

export function InstallScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<DetectedPlatform | null>(null);
  const [detectionComplete, setDetectionComplete] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    let cancelled = false;
    void detectPlatform().then((detected) => {
      if (!cancelled) {
        setDetectedPlatform(detected);
        setDetectionComplete(true);
      }
    });
    return () => {
      cancelled = true;
    };
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

  const platform = useMemo(() => recommendedInstallPlatform(detectedPlatform), [detectedPlatform]);
  const sameOsPlatforms = useMemo(
    () => installPlatformsForOs(detectedPlatform?.os),
    [detectedPlatform?.os],
  );
  const secondaryPlatforms = useMemo(
    () => installPlatformOptions.filter((option) => option.value !== platform),
    [platform],
  );

  async function copyCurrentLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (busy) {
    return (
      <section className="den-page py-4 lg:py-6" data-testid="install-page">
        <div className="den-frame grid max-w-[44rem] gap-4 p-6 md:p-8">
          <p className="den-eyebrow">OpenWork Desktop</p>
          <h1 className="den-title-lg">Loading your install link.</h1>
          <p className="den-copy">Checking your team's OpenWork setup...</p>
        </div>
      </section>
    );
  }

  if (!config) {
    return (
      <section className="den-page py-4 lg:py-6" data-testid="install-page">
        <div className="den-frame grid max-w-[44rem] gap-6 p-6 md:p-8">
          <div className="grid gap-2">
            <p className="den-eyebrow">OpenWork Desktop</p>
            <h1 className="den-title-lg">This install link can't be opened.</h1>
            <p className="den-copy">{error ?? "Ask your workspace admin for a fresh install link."}</p>
          </div>
        </div>
      </section>
    );
  }

  const primaryHref = platform ? installHref(config, platform, token) : null;
  const primaryLabel = installPlatformOptions.find((option) => option.value === platform)?.label ?? "your computer";
  const uncertainPlatforms = detectionComplete && !platform && sameOsPlatforms.length > 0
    ? sameOsPlatforms
    : installPlatformOptions;

  return (
    <section
      className="den-page py-4 lg:py-6"
      data-testid="install-page"
      data-detected-os={detectedPlatform?.os}
      data-detected-arch={detectedPlatform ? detectedPlatform.arch ?? "unknown" : undefined}
      data-detection-source={detectedPlatform?.source}
    >
      <div className="den-frame grid max-w-[48rem] gap-6 p-6 md:p-8">
        <div className="grid gap-3">
          <p className="den-eyebrow">OpenWork Desktop</p>
          <h1 className="den-title-xl">Download OpenWork for {config.clientName}</h1>
          <p className="den-copy">Run it, then sign in — your team's workspace is preconfigured.</p>
        </div>

        {isMobile ? (
          <div className="den-frame-inset grid gap-3 rounded-[1.5rem] p-5" data-testid="install-mobile-note">
            <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">OpenWork runs on your computer.</p>
            <p className="den-copy">Open this link on your Mac, Windows, or Linux machine. You can also copy it and send it to yourself.</p>
            <button type="button" className="den-button-secondary w-full sm:w-auto" onClick={() => void copyCurrentLink()}>
              {copied ? "Copied" : "Copy install link"}
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {primaryHref ? (
              <a className="den-button-primary w-full justify-center sm:w-auto" href={primaryHref} data-testid="install-download-primary">
                Download for {primaryLabel}
              </a>
            ) : (
              <div className="den-frame-inset grid gap-3 rounded-[1.5rem] p-5" data-testid="install-architecture-choice">
                <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">
                  {detectedPlatform?.os === "macos" ? "Choose your Mac" : detectedPlatform?.os === "windows" ? "Choose your Windows PC" : "Choose your computer"}
                </p>
                <p className="den-copy">We could not safely determine the processor, so choose the option that matches this computer.</p>
                <div className="flex flex-wrap gap-2">
                  {uncertainPlatforms.map((option) => (
                    <a key={option.value} className="den-button-secondary" href={installHref(config, option.value, token)}>
                      {option.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {primaryHref ? (
              <div className="flex flex-wrap gap-2">
                {secondaryPlatforms.map((option) => (
                  <a key={option.value} className="den-button-secondary" href={installHref(config, option.value, token)}>
                    {option.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="den-meta-row">
          <span className="den-kicker">Team · {config.clientName}</span>
          <span>{config.webUrl}</span>
        </div>
      </div>
    </section>
  );
}
