"use client";

import { detectPlatform, DownloadPlatformGrid, type DetectedPlatform, type DownloadPlatformGroup, type DownloadPlatformOption } from "@openwork/ui/react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
const INSTALL_PLATFORMS: InstallPlatform[] = ["mac-arm64", "mac-x64", "win-x64", "linux-x64", "linux-arm64"];

type InstallerOs = "macos" | "windows" | "linux";

type OpenGuidance = {
  actions: [string, string];
  trust: { title: string; body: string } | null;
};

function detectedInstallPlatform(detected: DetectedPlatform | null): InstallPlatform | null {
  if (!detected) return null;
  if (detected.os === "windows") return "win-x64";
  if (detected.os === "macos" && detected.arch === "arm64") return "mac-arm64";
  if (detected.os === "macos" && detected.arch === "x64") return "mac-x64";
  return null;
}

function installerOsFor(platform: InstallPlatform | null, detected: DetectedPlatform | null): InstallerOs | null {
  if (platform) {
    if (platform.startsWith("mac-")) return "macos";
    return platform === "win-x64" ? "windows" : "linux";
  }
  return detected?.os ?? null;
}

/** Copy for opening the downloaded desktop installer, per operating system. */
function openGuidance(os: InstallerOs | null, appName: string): OpenGuidance {
  const openFile = `Open the ${appName} installer from Downloads.`;

  if (os === "macos") {
    return {
      // The disk image holds only "Install OpenWork" — there is no Applications
      // shortcut to drag onto. That app is the installer, and it installs the app.
      actions: [openFile, `Follow the macOS prompts to install ${appName}, then open it.`],
      trust: {
        title: "macOS may ask before it opens the installer",
        body: "If you see “unidentified developer”, choose Open. This is normal for a new app.",
      },
    };
  }
  if (os === "windows") {
    return {
      actions: [openFile, `Follow the Windows prompts to install ${appName}, then open it.`],
      trust: {
        title: "Windows may warn before it opens the installer",
        body: "If you see “Windows protected your PC”, choose More info, then Run anyway.",
      },
    };
  }
  if (os === "linux") {
    return {
      actions: [
        "Run the setup script from your Downloads folder in a terminal.",
        `It prints where to get the ${appName} AppImage — download that, then open it.`,
      ],
      trust: null,
    };
  }
  return {
    actions: [openFile, `Follow the prompts to install ${appName}, then open it.`],
    trust: {
      title: "Your computer may ask before it opens the installer",
      body: "If you see a warning about an app from the internet, choose to open it anyway. This is normal for a new app.",
    },
  };
}

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

type StepState = "complete" | "active" | "pending";

const STEP_SHELL: Record<StepState, string> = {
  complete: "border-[#e7eaef] bg-[#fafbfc]",
  active: "border-[#c8d6f5] bg-[#f8faff]",
  pending: "border-[#e1e4e8] bg-[#f7f8fa]",
};

const STEP_BADGE: Record<StepState, string> = {
  complete: "border-[1.5px] border-[#c9cfd7] bg-white text-[#7a828e]",
  active: "bg-[#101828] text-white",
  pending: "border-[1.5px] border-[#101828] text-[#101828]",
};

function InstallStep({
  index,
  state,
  title,
  description,
  expanded,
  onExpand,
  testId,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  description: string;
  expanded: boolean;
  onExpand: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li className={`rounded-[18px] border ${STEP_SHELL[state]}`} data-state={state} data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-start gap-4 p-5 text-left disabled:cursor-default sm:px-7 sm:py-6"
        aria-expanded={expanded}
        disabled={state === "pending"}
        onClick={onExpand}
      >
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${STEP_BADGE[state]}`} aria-hidden="true">
          {state === "complete" ? "✓" : index}
        </span>
        <span className="grid grow gap-1">
          <span className={`text-base font-semibold ${state === "complete" ? "text-[#667085]" : "text-[#101828]"}`}>{title}</span>
          {expanded ? <span className="text-[13px] leading-5 text-[#60646c]">{description}</span> : null}
        </span>
        <ChevronDown className={`mt-0.5 size-5 shrink-0 text-[#667085] ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded ? <div className="grid gap-4 px-5 pb-5 sm:pb-6 sm:pl-[4.25rem] sm:pr-7">{children}</div> : null}
    </li>
  );
}

function CopyLinkRow({
  value,
  copied,
  onCopy,
  testId,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[#e1e4e8] bg-[#fafbfc] px-3 py-2.5" data-testid={testId}>
      <input
        className="min-w-0 grow bg-transparent text-[11px] text-[#344054] outline-none"
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="shrink-0 text-[11px] font-semibold text-[#101828] hover:underline" onClick={onCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
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
  const [downloadPlatform, setDownloadPlatform] = useState<InstallPlatform | null>(null);
  const [detected, setDetected] = useState<DetectedPlatform | null>(null);
  const [currentLink, setCurrentLink] = useState("");
  const requestedStep = searchParams.get("step");
  const initialStep = requestedStep === "3" ? 3 : requestedStep === "2" ? 2 : 1;
  const [guideStep, setGuideStep] = useState<1 | 2 | 3>(initialStep);
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(initialStep);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState<string | null>(null);
  const [activationStatus, setActivationStatus] = useState<"idle" | "pending" | "connected" | "expired">("idle");
  const [connectLink, setConnectLink] = useState("");
  const [connectCopied, setConnectCopied] = useState(false);
  const [returnCopied, setReturnCopied] = useState(false);
  const downloadStartedTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    setCurrentLink(window.location.href);
    let cancelled = false;
    void detectPlatform().then((platform) => {
      if (!cancelled) setDetected(platform);
    });
    return () => {
      cancelled = true;
    };
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

  const platformByHref = useMemo<Record<string, InstallPlatform>>(() => {
    if (!config) {
      return {};
    }
    return Object.fromEntries(INSTALL_PLATFORMS.map((platform) => [installHref(config, platform, token), platform]));
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
    setDownloadPlatform(platformByHref[href] ?? null);
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

  const guidance = openGuidance(installerOsFor(downloadPlatform, detected), config.appName);

  return (
    <OnboardingShell state="install" width="full">
      <section data-testid="install-page">
        <div className="grid gap-6 rounded-[1.75rem] border border-[#e7eaef] bg-[#fcfcfd] p-5 text-center sm:p-6 md:p-8" data-testid="install-card">
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
            <p className="den-copy">Complete one step at a time. Select any step to expand or review.</p>
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
            <InstallStep
              index={1}
              state={guideStep > 1 ? "complete" : "active"}
              title="Download the OpenWork installer"
              description="When the download finishes, install the desktop app and keep this page open."
              expanded={expandedStep === 1}
              onExpand={() => setExpandedStep(1)}
              testId="install-guide-step-download"
            >
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
            </InstallStep>

            <InstallStep
              index={2}
              state={guideStep === 2 ? "active" : guideStep > 2 ? "complete" : "pending"}
              title="Continue on your computer"
              description={guideStep < 2
                ? `Only continue once ${config.appName} is installed and running on this computer.`
                : `Your download is done. Install and open ${config.appName} on this computer.`}
              expanded={expandedStep === 2 && guideStep >= 2}
              onExpand={() => setExpandedStep(2)}
              testId="install-guide-step-open"
            >
                  <div className="grid gap-5">
                    <div className="grid content-start gap-3 rounded-[14px] border border-[#e1e4e8] bg-white p-[18px]">
                      <p className="m-0 text-xs font-semibold uppercase tracking-[0.04em] text-[#667085]">Next, on your computer</p>
                      <p className="m-0 text-base font-semibold text-[#101828]">Open the file you just downloaded</p>

                      <ol className="m-0 grid list-none gap-2.5 p-0">
                        {guidance.actions.map((action, index) => (
                          <li key={action} className="flex items-start gap-2.5">
                            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#eef1f5] text-xs font-semibold text-[#344054]" aria-hidden="true">
                              {index + 1}
                            </span>
                            <span className="text-[13px] leading-5 text-[#344054]">{action}</span>
                          </li>
                        ))}
                      </ol>

                      {guidance.trust ? (
                        <div className="flex items-start gap-2.5" data-testid="install-os-trust-note">
                          <ShieldCheck className="mt-px size-[15px] shrink-0 text-[#8a6420]" aria-hidden="true" />
                          <span className="grid gap-0.5">
                            <span className="text-[13px] font-semibold leading-[17px] text-[#7a5714]">{guidance.trust.title}</span>
                            <span className="text-[13px] leading-[17px] text-[#7a5714]">{guidance.trust.body}</span>
                          </span>
                        </div>
                      ) : null}

                      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#d3e0fb] bg-[#eef4ff] px-3 py-2.5" data-testid="install-handoff-note">
                        <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full bg-[#3e63dd]/20" aria-hidden="true">
                          <span className="size-1.5 rounded-full bg-[#3e63dd]" />
                        </span>
                        <span className="grid gap-0.5">
                          <span className="text-[13px] font-semibold leading-[17px] text-[#1f3d8f]">{config.appName} continues from here</span>
                          <span className="text-[13px] leading-[17px] text-[#3a4e80]">Open the app, then use this page or the pasted link to approve this computer.</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5 py-1">
                        <span className="h-px grow bg-[#e1e4e8]" />
                        <span className="text-xs text-[#7a808a]">OR</span>
                        <span className="h-px grow bg-[#e1e4e8]" />
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <p className="m-0 text-[13px] leading-[17px] text-[#344054]">Already have {config.appName} on this computer?</p>
                        <button
                          type="button"
                          className="grid h-9 shrink-0 place-items-center rounded-[9px] bg-[#101828] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
                          data-testid="install-connect-open"
                          disabled={connecting}
                          onClick={() => void beginConnect()}
                        >
                          {connecting ? "Preparing…" : `Open ${config.appName}`}
                        </button>
                      </div>

                      <details className="grid gap-2 border-t border-[#e1e4e8] pt-3 [&[open]_svg]:rotate-180">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-[#344054] [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-3 shrink-0 text-[#7a808a] transition-transform" aria-hidden="true" />
                          Nothing happening on your computer?
                        </summary>
                        <p className="m-0 text-[13px] leading-[17px] text-[#60646c]">Paste this link into {config.appName} on your computer to connect it by hand.</p>
                        <CopyLinkRow
                          value={currentLink}
                          copied={copied}
                          onCopy={() => void copyCurrentLink()}
                          testId="install-copy-link"
                        />
                        <button
                          type="button"
                          className="w-fit text-[11px] font-medium text-[#667085] underline-offset-4 hover:text-[#101828] hover:underline"
                          data-testid="install-connect-copy"
                          disabled={connecting}
                          onClick={() => void prepareAndCopyConnectionLink()}
                        >
                          {connectCopied ? "Copied a fresh connection link" : "Or copy a fresh connection link"}
                        </button>
                      </details>
                    </div>
                  </div>

                  {connectError ? <p className="m-0 text-sm text-red-600" role="alert">{connectError}</p> : null}
            </InstallStep>

            <InstallStep
              index={3}
              state={guideStep === 3 ? "active" : "pending"}
              title="Finish in your browser, then return to OpenWork"
              description="Sign in and approve this computer. The browser will give you a button back to the desktop app."
              expanded={expandedStep === 3 && guideStep === 3}
              onExpand={() => setExpandedStep(3)}
              testId="install-guide-step-signin"
            >
                  <div className="grid gap-3" aria-live="polite">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        className="grid h-11 shrink-0 place-items-center rounded-[11px] bg-[#101828] px-6 text-[13px] font-semibold text-white transition-colors hover:bg-black sm:w-[18rem]"
                        href={RETURN_TO_OPENWORK_URL}
                      >
                        Return to OpenWork
                      </a>
                      {activationStatus === "connected" ? null : (
                        <p className="m-0 flex grow items-center gap-3 rounded-[11px] border border-[#e1e4e8] bg-white px-4 text-[13px] text-[#60646c]">
                          <span className="size-4 animate-spin rounded-full border-2 border-[#b0b7c3] border-t-[#101828]" aria-hidden="true" />
                          Waiting for browser confirmation…
                        </p>
                      )}
                    </div>

                    {activationStatus === "connected" ? (
                      <div className="flex items-start gap-3 rounded-[11px] border border-[#e7eaef] bg-[#fafbfc] px-3.5 py-3" data-testid="install-connected">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[#c9cfd7] bg-white text-[11px] font-bold text-[#30a46c]" aria-hidden="true">✓</span>
                        <span className="grid gap-0.5">
                          <span className="text-[13px] font-semibold text-[#1c2024]">Connected to {config.clientName}</span>
                          <span className="text-[11px] text-[#60646c]">Your organization setup and branding are ready in {config.appName}.</span>
                        </span>
                      </div>
                    ) : activationStatus === "expired" ? (
                      <p className="m-0 text-sm text-amber-700">This one-time link expired. Return to step 2 and open {config.appName} again.</p>
                    ) : null}

                    {activationStatus === "connected" ? (
                      <CopyLinkRow value={RETURN_TO_OPENWORK_URL} copied={returnCopied} onCopy={() => void copyReturnLink()} />
                    ) : connectLink ? (
                      <div className="grid gap-2">
                        <p className="m-0 text-[11px] text-[#7a808a]">Nothing opened? Copy this {config.appName} link and open it anywhere links work.</p>
                        <CopyLinkRow value={connectLink} copied={connectCopied} onCopy={() => void copyConnectionLink()} />
                      </div>
                    ) : null}
                  </div>
            </InstallStep>
          </ol>
        )}
        </div>
      </section>
    </OnboardingShell>
  );
}
