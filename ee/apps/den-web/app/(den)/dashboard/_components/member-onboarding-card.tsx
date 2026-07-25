"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { createOrganizationInstallLink } from "../../_lib/install-link-data";

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

const GENERIC_DOWNLOAD_URL = "https://openworklabs.com/download";
const TEXT_BUTTON_CLASS = "text-[13px] font-medium text-[#5A6886] underline-offset-4 hover:text-[#07192C] hover:underline";

type MemberOnboardingState = {
  orgId: string | null;
  ready: boolean;
  installed: boolean;
  dismissed: boolean;
};

type MemberOnboardingCardProps = {
  organizationId: string;
  organizationName: string;
  memberEmail: string;
  installLinksEnabled: boolean;
  collapsed: boolean;
  installed: boolean;
  onMarkInstalled: () => void;
  onDismiss: () => void;
  onReopen: () => void;
};

function installedKey(orgId: string) {
  return `openwork:member-onboarding:installed:${orgId}`;
}

function dismissedKey(orgId: string) {
  return `openwork:member-onboarding:dismissed:${orgId}`;
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : "Could not create the install link.";
}

export function useMemberOnboarding(orgId: string | null) {
  const [state, setState] = useState<MemberOnboardingState>({
    orgId: null,
    ready: false,
    installed: false,
    dismissed: false,
  });

  useEffect(() => {
    if (!orgId) {
      setState({ orgId: null, ready: false, installed: false, dismissed: false });
      return;
    }

    let installed = false;
    let dismissed = false;
    try {
      installed = localStorage.getItem(installedKey(orgId)) === "1";
      dismissed = localStorage.getItem(dismissedKey(orgId)) === "1";
    } catch {
      // localStorage unavailable
    }
    setState({ orgId, ready: true, installed, dismissed });
  }, [orgId]);

  function markInstalled() {
    if (!orgId) return;
    setState((current) => current.orgId === orgId ? { ...current, installed: true } : current);
    try {
      localStorage.setItem(installedKey(orgId), "1");
    } catch {
      // localStorage unavailable
    }
  }

  function reopen() {
    if (!orgId) return;
    setState((current) => current.orgId === orgId ? { ...current, dismissed: false } : current);
    try {
      localStorage.removeItem(dismissedKey(orgId));
    } catch {
      // localStorage unavailable
    }
  }

  function dismiss() {
    if (!orgId) return;
    setState((current) => current.orgId === orgId ? { ...current, dismissed: true } : current);
    try {
      localStorage.setItem(dismissedKey(orgId), "1");
    } catch {
      // localStorage unavailable
    }
  }

  const ready = state.ready && state.orgId === orgId && orgId !== null;

  return {
    ready,
    installed: ready && state.installed,
    dismissed: ready && state.dismissed,
    markInstalled,
    reopen,
    dismiss,
  };
}

function OnboardingStep({
  index,
  state,
  title,
  helper,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  helper: string;
  children?: ReactNode;
}) {
  return (
    <li className={`rounded-[18px] border ${STEP_SHELL[state]}`} data-state={state}>
      <div className="flex items-start gap-4 p-5 sm:px-7 sm:py-6">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${STEP_BADGE[state]}`} aria-hidden="true">
          {state === "complete" ? "✓" : index}
        </span>
        <div className="min-w-0 grow">
          <p className={`text-base font-semibold ${state === "complete" ? "text-[#667085]" : "text-[#101828]"}`}>{title}</p>
          {state !== "complete" ? <p className="mt-1 text-[13px] leading-5 text-[#60646c]">{helper}</p> : null}
          {state !== "complete" && children ? <div className="mt-4 grid gap-3">{children}</div> : null}
        </div>
      </div>
    </li>
  );
}

export function MemberOnboardingCard({
  organizationId,
  organizationName,
  memberEmail,
  installLinksEnabled,
  collapsed,
  installed,
  onMarkInstalled,
  onDismiss,
  onReopen,
}: MemberOnboardingCardProps) {
  const [minting, setMinting] = useState<"download" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mintInstallLink(action: "download" | "copy") {
    setError(null);
    setMinting(action);
    try {
      return await createOrganizationInstallLink(organizationId, false);
    } catch (linkError) {
      setError(getErrorText(linkError));
      return null;
    } finally {
      setMinting(null);
    }
  }

  async function downloadInstallLink() {
    const url = await mintInstallLink("download");
    if (url) {
      window.location.assign(url);
    }
  }

  async function copyInstallLink() {
    const url = await mintInstallLink("copy");
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      setError(getErrorText(copyError));
    }
  }

  function openGenericDownload() {
    window.location.assign(GENERIC_DOWNLOAD_URL);
  }

  return (
    <section className="max-w-[720px]" data-testid="member-onboarding">
      {collapsed ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${installed ? "border-emerald-100 bg-emerald-50" : "border-gray-100 bg-white"}`} data-testid="member-onboarding-complete">
          <div className={`flex items-center gap-2.5 text-[14px] font-medium ${installed ? "text-emerald-800" : "text-[#344054]"}`}>
            {installed ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : null}
            <span>{installed ? `You're set up for ${organizationName}` : `Finish setting up OpenWork for ${organizationName}`}</span>
          </div>
          <button type="button" className={TEXT_BUTTON_CLASS} data-testid="member-onboarding-reopen" onClick={onReopen}>
            Show setup steps
          </button>
        </div>
      ) : (
        <div className="rounded-[24px] border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#07192C]">Welcome to {organizationName}</h1>
          <p className="mt-2 text-[14px] leading-6 text-[#5A6886]">
            OpenWork runs on your computer. Install it once — the models, plugins, and marketplaces your team set up come with it.
          </p>

          <p className="mt-4 text-[13px] font-medium text-[#5A6886]" data-testid="member-onboarding-progress">Step {installed ? 2 : 1} of 2</p>

          <ol className="mt-3 grid gap-3" data-testid="member-onboarding-steps">
            <OnboardingStep
              index={1}
              state={installed ? "complete" : "active"}
              title={`Install OpenWork for ${organizationName}`}
              helper="Your download is already configured for this workspace."
            >
              {!installed ? (
                <>
                  <div className="flex flex-wrap gap-2.5">
                    {installLinksEnabled ? (
                      <>
                        <DenButton
                          icon={Download}
                          loading={minting === "download"}
                          disabled={minting !== null}
                          data-testid="member-onboarding-download"
                          onClick={() => void downloadInstallLink()}
                        >
                          Download OpenWork
                        </DenButton>
                        <DenButton
                          variant="secondary"
                          icon={Copy}
                          loading={minting === "copy"}
                          disabled={minting !== null}
                          data-testid="member-onboarding-copy"
                          onClick={() => void copyInstallLink()}
                        >
                          {copied ? "Copied" : "Copy install link"}
                        </DenButton>
                      </>
                    ) : (
                      <DenButton icon={Download} data-testid="member-onboarding-download" onClick={openGenericDownload}>
                        Download OpenWork
                      </DenButton>
                    )}
                  </div>
                  <button type="button" className={`${TEXT_BUTTON_CLASS} justify-self-start`} data-testid="member-onboarding-installed" onClick={onMarkInstalled}>
                    I already installed it
                  </button>
                  {error ? <p role="alert" className="text-[13px] leading-5 text-red-600">{error}</p> : null}
                </>
              ) : null}
            </OnboardingStep>

            <OnboardingStep
              index={2}
              state={installed ? "active" : "pending"}
              title={memberEmail ? `Sign in with ${memberEmail}` : "Sign in with your work email"}
              helper="Everything your admins set up appears automatically — no extra configuration."
            >
              {installed ? (
                <DenButton className="justify-self-start" data-testid="member-onboarding-finish" onClick={onDismiss}>
                  Show my workspace
                </DenButton>
              ) : null}
            </OnboardingStep>
          </ol>

          {!installed ? (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <button type="button" className={TEXT_BUTTON_CLASS} data-testid="member-onboarding-skip" onClick={onDismiss}>
                Skip for now — show workspace details
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
