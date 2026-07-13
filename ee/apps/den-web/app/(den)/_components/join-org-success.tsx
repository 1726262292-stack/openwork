"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import { isMobileUserAgent } from "../_lib/platform";

type JoinOrgSuccessProps = {
  organizationName: string;
  installPageUrl: string | null;
  onContinueInBrowser: () => void;
};

type JourneyStepProps = {
  step: number;
  title: string;
  status: "done" | "current" | "up-next";
  children: ReactNode;
};

function JourneyStep({ step, title, status, children }: JourneyStepProps) {
  const statusLabel = status === "done" ? "Done" : status === "current" ? "Current" : "Up next";

  return (
    <li className="den-frame-inset grid gap-3 rounded-[1.35rem] p-4 sm:grid-cols-[auto_minmax(0,1fr)]" aria-current={status === "current" ? "step" : undefined} data-testid={`join-org-step-${step}`}>
      <div className="grid size-10 place-items-center rounded-full border border-[var(--dls-border)] bg-[var(--dls-surface)] text-sm font-semibold text-[var(--dls-text-primary)]">
        {status === "done" ? "✓" : step}
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-base font-semibold text-[var(--dls-text-primary)]">{title}</h2>
          <span className="den-kicker">{statusLabel}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOpenworkUrl(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const url = payload.openworkUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export function JoinOrgSuccess({ organizationName, installPageUrl, onContinueInBrowser }: JoinOrgSuccessProps) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffAttempted, setHandoffAttempted] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [installLinkCopied, setInstallLinkCopied] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
  }, []);

  async function createDesktopHandoff() {
    const { response, payload } = await requestJson(
      "/v1/auth/desktop-handoff",
      {
        method: "POST",
        body: JSON.stringify({ desktopScheme: "openwork" }),
      },
      12000,
    );

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `Could not prepare a desktop sign-in link (${response.status}).`));
    }

    const openworkUrl = getOpenworkUrl(payload);
    if (!openworkUrl) {
      throw new Error("Desktop sign-in succeeded, but no app link was returned.");
    }

    return openworkUrl;
  }

  async function handleOpenOpenWork() {
    setHandoffBusy(true);
    setHandoffAttempted(true);
    setActionError(null);

    try {
      window.location.assign(await createDesktopHandoff());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not open OpenWork.");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function handleCopySignInLink() {
    setCopyBusy(true);
    setCopied(false);
    setActionError(null);

    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard is not available in this browser.");
      }
      await navigator.clipboard.writeText(await createDesktopHandoff());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not copy the sign-in link.");
    } finally {
      setCopyBusy(false);
    }
  }

  async function handleCopyInstallLink() {
    setInstallLinkCopied(false);
    setActionError(null);

    try {
      if (!installPageUrl) {
        throw new Error("The team install link was not returned. Continue in the browser and ask an admin to share it again.");
      }
      if (!navigator.clipboard) {
        throw new Error("Clipboard is not available in this browser.");
      }
      await navigator.clipboard.writeText(installPageUrl);
      setInstallLinkCopied(true);
      window.setTimeout(() => setInstallLinkCopied(false), 1800);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not copy the install link.");
    }
  }

  async function handleEmailDownload() {
    setEmailBusy(true);
    setActionError(null);

    try {
      const { response, payload } = await requestJson("/v1/me/send-download-link", { method: "POST" }, 12000);
      if (!response.ok) {
        setActionError(getErrorMessage(payload, `Could not send the download link (${response.status}).`));
        return;
      }
      setEmailSent(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send the download link.");
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <section className="den-page py-4 lg:py-6" data-testid="join-org-success">
      <div className="den-frame grid max-w-[48rem] gap-6 p-6 md:p-8">
        <div className="grid gap-2">
          <p className="den-eyebrow">OpenWork Cloud</p>
          <h1 className="den-title-xl max-w-[16ch]">You&apos;re in, welcome to {organizationName}</h1>
          <p className="den-copy">The desktop app is where OpenWork runs on your computer and puts your team&apos;s setup to work.</p>
        </div>

        {isMobile === null ? <p className="den-copy">Preparing your next step...</p> : null}

        {isMobile !== null ? (
          <ol className="grid list-none gap-3 p-0" data-testid="join-org-journey-map">
            <JourneyStep step={1} title="Join team" status="done">
              <p className="den-copy">Your account is now a member of {organizationName}.</p>
            </JourneyStep>

            <JourneyStep step={2} title="Download app" status="current">
              {isMobile ? (
                <div className="grid gap-3" data-testid="join-org-mobile-note">
                  <p className="den-copy">OpenWork runs on your computer. Copy this team install link or email yourself a reminder for when you are back at your desk.</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="den-button-primary w-full sm:w-auto"
                      onClick={() => void handleCopyInstallLink()}
                      disabled={!installPageUrl}
                      data-testid="join-org-download"
                    >
                      {installLinkCopied ? "Copied team install link" : "Copy team install link"}
                    </button>
                    <button
                      type="button"
                      className="den-button-secondary w-full sm:w-auto"
                      onClick={() => void handleEmailDownload()}
                      disabled={emailBusy || emailSent}
                      data-testid="join-org-email-download"
                    >
                      {emailBusy ? "Sending..." : emailSent ? "Sent" : "Email me"}
                    </button>
                  </div>
                  {emailSent ? <div className="den-notice is-info">Sent — check your inbox when you&apos;re back at your desk.</div> : null}
                </div>
              ) : (
                <div className="grid gap-3">
                  <p className="den-copy">Get the {organizationName} installer so the desktop app starts with your team&apos;s setup.</p>
                  {installPageUrl ? (
                    // Open the team installer in a new tab so this journey map
                    // (including the remaining "connect" step) stays available
                    // while the download prepares.
                    <a href={installPageUrl} target="_blank" rel="noreferrer" className="den-button-primary w-full justify-center sm:w-fit" data-testid="join-org-download">
                      Download {organizationName} app
                    </a>
                  ) : (
                    <div className="den-notice is-error">The team install link was not returned. Continue in the browser and ask an admin to share it again.</div>
                  )}
                </div>
              )}
            </JourneyStep>

            <JourneyStep step={3} title="Connect and try your first workflow" status="up-next">
              <div className="grid gap-3">
                <p className="den-copy">After installing, open OpenWork to connect this account and start with your team&apos;s first workflow.</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="den-button-secondary w-full sm:w-auto"
                    onClick={() => void handleOpenOpenWork()}
                    disabled={handoffBusy}
                    data-testid="join-org-open-openwork"
                  >
                    {handoffBusy ? "Opening OpenWork..." : "Already installed? Open OpenWork"}
                  </button>
                  <button
                    type="button"
                    className="w-fit text-sm text-[var(--dls-text-secondary)] underline-offset-4 hover:underline"
                    onClick={() => void handleCopySignInLink()}
                    disabled={copyBusy}
                  >
                    {copyBusy ? "Copying..." : copied ? "Copied sign-in link" : "Copy sign-in link"}
                  </button>
                </div>
                {handoffAttempted && !actionError ? (
                  <p className="den-copy text-sm">Opening OpenWork now. If nothing happens, copy the sign-in link and paste it into the desktop app.</p>
                ) : null}
              </div>
            </JourneyStep>
          </ol>
        ) : null}

        <button
          type="button"
          className="w-fit text-sm text-[var(--dls-text-secondary)] underline-offset-4 hover:underline"
          onClick={onContinueInBrowser}
          data-testid="join-org-continue-browser"
        >
          Continue in the browser
        </button>

        {actionError ? <div className="den-notice is-error">{actionError}</div> : null}
      </div>
    </section>
  );
}
