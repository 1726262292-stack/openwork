"use client";

import { DownloadPlatformGrid, type DownloadPlatformGroup, type DownloadPlatformOption } from "@openwork/ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requestJson } from "../_lib/den-flow";
import { getInstallConfigErrorMessage } from "../_lib/install-errors";
import { buildInstallDownloadHref, type InstallPlatform } from "../_lib/install-download";
import { isMobileUserAgent } from "../_lib/platform";
import { OnboardingShell } from "./onboarding-shell";
import { OrganizationBrandIdentity } from "./organization-brand-identity";

type InstallConfig = {
  appName: string;
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
  iconUrl: string | null;
  connectUrl: string | null;
  connectExpiresAt: string | null;
  activationUrl: string;
  activationExpiresAt: string;
};

const CONNECT_CODE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const RETURN_TO_OPENWORK_URL = "openwork://open";

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

function isConnectUrl(value: string) {
  try {
    const url = new URL(value);
    const route = (url.hostname || url.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
    if (url.protocol !== "openwork:" || route !== "connect") return false;
    const token = url.searchParams.get("token")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const apiBaseUrl = url.searchParams.get("apiBaseUrl")?.trim() ?? "";
    return (Boolean(token) && !code && !apiBaseUrl)
      || (!token && /^[A-Za-z0-9_-]{24,128}$/.test(code) && isUrl(apiBaseUrl));
  } catch {
    return false;
  }
}

function activationCodeFromUrl(value: string) {
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code")?.trim() ?? "";
    return CONNECT_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

function exchangeConnectUrl(code: string, apiBaseUrl: string) {
  const url = new URL("openwork://connect");
  url.searchParams.set("code", code);
  url.searchParams.set("apiBaseUrl", apiBaseUrl);
  return url.toString();
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
  const iconUrl = value.iconUrl ?? null;
  const connectUrl = value.connectUrl ?? null;
  const connectExpiresAt = value.connectExpiresAt ?? null;
  const activationUrl = typeof value.activationUrl === "string" ? value.activationUrl.trim() : "";
  const activationExpiresAt = typeof value.activationExpiresAt === "string" ? value.activationExpiresAt : "";

  if (!clientName || !isUrl(webUrl) || !isUrl(apiUrl) || typeof requireSignin !== "boolean") {
    return null;
  }
  if (logoUrl !== null && (typeof logoUrl !== "string" || !isUrl(logoUrl))) {
    return null;
  }
  if (iconUrl !== null && (typeof iconUrl !== "string" || !isUrl(iconUrl))) {
    return null;
  }
  if (connectUrl !== null && (typeof connectUrl !== "string" || !isConnectUrl(connectUrl))) {
    return null;
  }
  if (connectExpiresAt !== null && (typeof connectExpiresAt !== "string" || Number.isNaN(Date.parse(connectExpiresAt)))) {
    return null;
  }
  if (!isUrl(activationUrl) || Number.isNaN(Date.parse(activationExpiresAt))) {
    return null;
  }

  return {
    appName,
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
    iconUrl,
    connectUrl,
    connectExpiresAt,
    activationUrl,
    activationExpiresAt,
  };
}

async function fetchInstallConfig(token: string) {
  const { response, payload } = await requestJson(
    `/v1/install-config?token=${encodeURIComponent(token)}`,
    { method: "GET" },
    12000,
  );
  if (!response.ok) {
    throw new Error(getInstallConfigErrorMessage(payload, response.status));
  }
  const parsed = parseInstallConfig(payload);
  if (!parsed) {
    throw new Error("This install link returned incomplete setup details.");
  }
  return parsed;
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
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started">("idle");
  const [downloadLabel, setDownloadLabel] = useState("");
  const [downloadHref, setDownloadHref] = useState("");
  const [currentLink, setCurrentLink] = useState("");
  const requestedStep = searchParams.get("step");
  const initialStep = requestedStep === "3" ? 3 : requestedStep === "2" ? 2 : 1;
  const [guideStep, setGuideStep] = useState<1 | 2 | 3>(initialStep);
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(initialStep);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectRecoveryVisible, setConnectRecoveryVisible] = useState(false);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [activationStatus, setActivationStatus] = useState<"idle" | "pending" | "connected" | "expired">("idle");
  const [connectLink, setConnectLink] = useState("");
  const [connectCopied, setConnectCopied] = useState(false);
  const [returnCopied, setReturnCopied] = useState(false);
  const downloadStartedTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    setCurrentLink(window.location.href);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!token) {
        setError("This install link is missing its token. Ask your organization admin for a fresh link.");
        setBusy(false);
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const parsed = await fetchInstallConfig(token);
        if (cancelled) {
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

  useEffect(() => {
    if (!activationCode) {
      setActivationStatus("idle");
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setActivationStatus("pending");

    async function poll() {
      try {
        const { response, payload } = await requestJson(
          "/v1/install-connect/status",
          { method: "POST", body: JSON.stringify({ code: activationCode }) },
          12000,
        );
        if (cancelled) return;
        if (response.status === 410) {
          setActivationStatus("expired");
          return;
        }
        if (response.ok && isRecord(payload) && payload.status === "connected") {
          setActivationStatus("connected");
          return;
        }
      } catch {
        // Keep waiting through temporary network failures.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activationCode]);

  useEffect(() => () => {
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
  }, []);

  const downloadGroups = useMemo<DownloadPlatformGroup[]>(() => {
    if (!config) {
      return [];
    }

    return [
      {
        os: "macos",
        title: "macOS",
        options: [
          { href: installHref(config, "mac-arm64", token), label: "Apple Silicon (M1+)", arch: "arm64" },
          { href: installHref(config, "mac-x64", token), label: "Intel", arch: "x64" },
        ],
      },
      {
        os: "windows",
        title: "Windows",
        options: [
          { href: installHref(config, "win-x64", token), label: "x64 Installer", arch: "x64" },
        ],
      },
      {
        os: "linux",
        title: "Linux",
        options: [
          { href: installHref(config, "linux-x64", token), label: "Setup script (x64)", arch: "x64" },
          { href: installHref(config, "linux-arm64", token), label: "Setup script (ARM64)", arch: "arm64" },
        ],
      },
    ];
  }, [config, token]);

  async function copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(currentLink || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the install link and copy it manually.");
    }
  }

  function advanceGuide(nextStep: 2 | 3) {
    setGuideStep(nextStep);
    setExpandedStep(nextStep);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(nextStep));
    window.history.replaceState(null, "", url);
  }

  function beginDownload(label: string, href: string) {
    setDownloadLabel(label);
    setDownloadHref(href);
    setDownloadState("preparing");
    advanceGuide(2);
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
    downloadStartedTimer.current = window.setTimeout(() => {
      setDownloadState("started");
      downloadStartedTimer.current = null;
    }, 5000);
  }

  async function beginConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const freshConfig = await fetchInstallConfig(token);
      const code = activationCodeFromUrl(freshConfig.activationUrl);
      if (!code) throw new Error("This setup could not create a one-time activation link.");
      const nextConnectLink = exchangeConnectUrl(code, freshConfig.apiUrl);
      setConfig(freshConfig);
      setActivationCode(code);
      setConnectLink(nextConnectLink);
      advanceGuide(3);
      window.location.assign(nextConnectLink);
    } catch (connectFailure) {
      setConnectError(connectFailure instanceof Error ? connectFailure.message : "Could not open OpenWork. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function copyConnectionLink() {
    try {
      await navigator.clipboard.writeText(connectLink);
      setConnectCopied(true);
      window.setTimeout(() => setConnectCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the OpenWork link and copy it manually.");
    }
  }

  async function prepareAndCopyConnectionLink() {
    setConnecting(true);
    setConnectError(null);
    try {
      const freshConfig = await fetchInstallConfig(token);
      const code = activationCodeFromUrl(freshConfig.activationUrl);
      if (!code) throw new Error("This setup could not create a one-time activation link.");
      const nextConnectLink = exchangeConnectUrl(code, freshConfig.apiUrl);
      setConfig(freshConfig);
      setActivationCode(code);
      setConnectLink(nextConnectLink);
      await navigator.clipboard.writeText(nextConnectLink);
      setConnectCopied(true);
      window.setTimeout(() => setConnectCopied(false), 1800);
    } catch (copyFailure) {
      setConnectError(copyFailure instanceof Error ? copyFailure.message : "Could not copy a fresh OpenWork link.");
    } finally {
      setConnecting(false);
    }
  }

  async function copyReturnLink() {
    try {
      await navigator.clipboard.writeText(RETURN_TO_OPENWORK_URL);
      setReturnCopied(true);
      window.setTimeout(() => setReturnCopied(false), 1800);
    } catch {
      setConnectError("Could not copy automatically. Select the OpenWork link and copy it manually.");
    }
  }

  if (busy) {
    return (
      <OnboardingShell state="install-loading" width="wide">
        <section className="grid gap-4 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8" data-testid="install-page">
          <p className="den-eyebrow">OpenWork Desktop</p>
          <h1 className="den-title-lg">Loading your install link.</h1>
          <p className="den-copy">Checking your team's OpenWork setup...</p>
        </section>
      </OnboardingShell>
    );
  }

  if (!config) {
    return (
      <OnboardingShell state="install-error" width="wide">
        <section className="grid gap-6 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8" data-testid="install-page">
          <div className="grid gap-2">
            <p className="den-eyebrow">OpenWork Desktop</p>
            <h1 className="den-title-lg">This install link can't be opened.</h1>
            <p className="den-copy">{error ?? "Ask your workspace admin for a fresh install link."}</p>
          </div>
        </section>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell state="install" width="full">
      <section data-testid="install-page">
        <div className="grid gap-6 rounded-[1.75rem] border border-slate-200/80 bg-white p-5 text-center sm:p-6 md:p-8" data-testid="install-card">
          <div className="grid justify-items-center gap-3">
            <h1 className="m-0 grid max-w-[22ch] gap-1 text-[2rem] font-semibold leading-[1.04] tracking-[-0.05em] text-slate-950 sm:text-[2.4rem]">
              <span>Download OpenWork</span>
              <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-[0.18em] gap-y-1">
                <span>for</span>
                <OrganizationBrandIdentity
                  organizationName={config.clientName}
                  brand={{ appName: config.appName, logoUrl: config.logoUrl, iconUrl: config.iconUrl }}
                />
              </span>
            </h1>
            <p className="den-copy">
              This page walks you through connecting this computer to {config.clientName}.
            </p>
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
          <ol className="grid gap-3 text-left" data-testid="install-guide">
            <li
              className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-50"
              data-state={guideStep > 1 ? "complete" : "active"}
              data-testid="install-guide-step-download"
            >
              <button
                type="button"
                className="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 p-4 text-left sm:p-5"
                aria-expanded={expandedStep === 1}
                onClick={() => setExpandedStep(1)}
              >
                <span className="grid size-8 place-items-center rounded-full bg-[var(--dls-accent)] font-semibold text-white" aria-hidden="true">
                  {guideStep > 1 ? "✓" : "1"}
                </span>
                <span>
                  <span className="block font-semibold text-[var(--dls-text-primary)]">Download and install OpenWork</span>
                  <span className="den-copy block">The recommended installer is highlighted for this computer.</span>
                </span>
              </button>
              {expandedStep === 1 ? (
                <div className="grid gap-3 border-t border-slate-200 bg-white p-4 sm:p-5">
                  <DownloadPlatformGrid
                    groups={downloadGroups}
                    recommendedTestId="install-download-primary"
                    onDownload={(option: DownloadPlatformOption) => beginDownload(option.label, option.href)}
                  />
                  <button
                    type="button"
                    className="w-fit text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
                    onClick={() => advanceGuide(2)}
                    data-testid="install-skip-download"
                  >
                    I already have {config.appName}
                  </button>
                  {downloadState !== "idle" ? (
                    <div className="den-frame-inset grid gap-2 rounded-[1.25rem] p-4" aria-live="polite" data-testid="install-download-status">
                      {downloadState === "preparing" ? (
                        <>
                          <span className="size-5 animate-spin rounded-full border-2 border-[var(--dls-border-strong)] border-t-[var(--dls-accent)]" aria-hidden="true" />
                          <p className="m-0 font-medium text-[var(--dls-text-primary)]">Preparing your {downloadLabel} download...</p>
                          <p className="den-copy">The first download may take up to a minute. Your browser will begin downloading when it is ready.</p>
                        </>
                      ) : (
                        <>
                          <p className="m-0 font-medium text-[var(--dls-text-primary)]">Download started</p>
                          <p className="den-copy">Your browser is preparing the file. If it does not appear, try the download again.</p>
                          <a className="den-button-secondary w-fit" href={downloadHref} onClick={() => beginDownload(downloadLabel, downloadHref)}>
                            Try again
                          </a>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>

            <li
              className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-50"
              data-state={guideStep === 2 ? "active" : guideStep > 2 ? "complete" : "pending"}
              data-testid="install-guide-step-open"
            >
              <button
                type="button"
                className="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 p-4 text-left disabled:cursor-default sm:p-5"
                aria-expanded={expandedStep === 2}
                disabled={guideStep < 2}
                onClick={() => setExpandedStep(2)}
              >
                <span className={`grid size-8 place-items-center rounded-full font-semibold ${guideStep >= 2 ? "bg-[var(--dls-accent)] text-white" : "border border-[var(--dls-border-strong)] text-slate-500"}`} aria-hidden="true">
                  {guideStep > 2 ? "✓" : "2"}
                </span>
                <span>
                  <span className="block font-semibold text-[var(--dls-text-primary)]">Continue on your computer</span>
                  <span className="den-copy block">
                    {guideStep < 2 ? `Only continue once ${config.appName} is installed and running on this computer.` : `Open ${config.appName} or run the installer to connect this computer to ${config.clientName}.`}
                  </span>
                </span>
              </button>
              {expandedStep === 2 && guideStep >= 2 ? (
                <div className="grid gap-4 border-t border-slate-200 bg-white p-4 sm:p-5">
                  <div className="grid gap-3 rounded-2xl bg-slate-50 p-4">
                    <div>
                      <p className="m-0 font-medium text-slate-950">Already installed?</p>
                      <p className="den-copy">Open the app and confirm that you want to connect it to {config.clientName}.</p>
                    </div>
                    <button
                      type="button"
                      className="den-button-primary w-full justify-center sm:w-fit"
                      data-testid="install-connect-open"
                      disabled={connecting}
                      onClick={() => void beginConnect()}
                    >
                      {connecting ? "Preparing connection…" : `Open ${config.appName}`}
                    </button>
                    <button
                      type="button"
                      className="w-fit text-sm text-slate-500 underline-offset-4 hover:text-slate-950 hover:underline"
                      data-testid="install-connect-recovery"
                      onClick={() => setConnectRecoveryVisible(true)}
                    >
                      Didn&apos;t open?
                    </button>
                    {connectRecoveryVisible ? (
                      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="den-copy text-sm">Copy a fresh connection link and open it anywhere links work. The same confirmation will appear.</p>
                        <button
                          type="button"
                          className="den-button-secondary w-fit"
                          data-testid="install-connect-copy"
                          disabled={connecting}
                          onClick={() => void prepareAndCopyConnectionLink()}
                        >
                          {connectCopied ? "Copied" : "Copy connection link"}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <p className="m-0 font-medium text-slate-950">Using the installer?</p>
                      <p className="den-copy">Paste this organization link when asked. After installing, it opens a secure approval page in your browser.</p>
                    </div>
                    <div className="grid gap-2" data-testid="install-copy-link">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input className="den-input min-w-0 flex-1 text-xs" value={currentLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                        <button type="button" className="den-button-secondary sm:w-auto" onClick={() => void copyCurrentLink()}>
                          {copied ? "Copied" : "Copy install link"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {connectError ? <p className="m-0 text-sm text-red-600" role="alert">{connectError}</p> : null}
                </div>
              ) : null}
            </li>

            <li
              className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-50"
              data-state={guideStep === 3 ? "active" : "pending"}
              data-testid="install-guide-step-signin"
            >
              <button
                type="button"
                className="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 p-4 text-left disabled:cursor-default sm:p-5"
                aria-expanded={expandedStep === 3}
                disabled={guideStep < 3}
                onClick={() => setExpandedStep(3)}
              >
                <span className={`grid size-8 place-items-center rounded-full font-semibold ${guideStep === 3 ? "bg-[var(--dls-accent)] text-white" : "border border-[var(--dls-border-strong)] text-slate-500"}`} aria-hidden="true">3</span>
                <span>
                  <span className="block font-semibold text-[var(--dls-text-primary)]">Finish in your browser</span>
                  <span className="den-copy block">Confirm the connection, then Sign in. This page reports when OpenWork accepts the organization setup.</span>
                </span>
              </button>
              {expandedStep === 3 && guideStep === 3 ? (
                <div className="grid gap-3 border-t border-slate-200 bg-white p-4 sm:p-5" aria-live="polite">
                  {activationStatus === "connected" ? (
                    <>
                      <p className="m-0 text-sm font-medium text-emerald-700" data-testid="install-connected">✓ Connected to {config.clientName}</p>
                      <p className="den-copy">{config.clientName}&apos;s setup and branding are ready in {config.appName}.</p>
                      <a className="den-button-primary w-fit" href={RETURN_TO_OPENWORK_URL}>Return to OpenWork</a>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input className="den-input min-w-0 flex-1 text-xs" value={RETURN_TO_OPENWORK_URL} readOnly onFocus={(event) => event.currentTarget.select()} />
                        <button type="button" className="den-button-secondary sm:w-auto" onClick={() => void copyReturnLink()}>
                          {returnCopied ? "Copied" : "Copy OpenWork link"}
                        </button>
                      </div>
                    </>
                  ) : activationStatus === "expired" ? (
                    <p className="m-0 text-sm text-amber-700">This one-time link expired. Return to step 2 and open OpenWork again.</p>
                  ) : (
                    <>
                      <p className="m-0 text-sm text-[var(--dls-text-secondary)]">Waiting for OpenWork to accept this setup…</p>
                      {connectLink ? (
                        <div className="grid gap-2 rounded-xl bg-slate-50 p-3">
                          <p className="den-copy text-sm">Nothing opened? Copy this OpenWork link and open it anywhere links work.</p>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input className="den-input min-w-0 flex-1 text-xs" value={connectLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                            <button type="button" className="den-button-secondary sm:w-auto" onClick={() => void copyConnectionLink()}>
                              {connectCopied ? "Copied" : "Copy link"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </li>
          </ol>
        )}
        </div>
      </section>
    </OnboardingShell>
  );
}
