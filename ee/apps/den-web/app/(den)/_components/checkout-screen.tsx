"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoneyMinor, formatRecurringInterval } from "../_lib/den-flow";
import { useDenFlow } from "../_providers/den-flow-provider";

// For local layout testing (no deploy needed)
// Enable with: NEXT_PUBLIC_DEN_MOCK_BILLING=1
const MOCK_BILLING = process.env.NEXT_PUBLIC_DEN_MOCK_BILLING === "1";
const MOCK_CHECKOUT_URL = (process.env.NEXT_PUBLIC_DEN_MOCK_CHECKOUT_URL ?? "").trim() || null;

const desktopAppPoints = [
  "Run OpenWork locally before you ever pay for hosted workers.",
  "Use the same app to manage checkout, launches, and billing later.",
  "Keep a free desktop control surface for prompts, sessions, and remote workers."
];

const launchSteps = [
  "Create or resume your Den account.",
  "Open a fresh Polar checkout session.",
  "Return here and we continue worker launch automatically."
];

export function CheckoutScreen({ customerSessionToken }: { customerSessionToken: string | null }) {
  const router = useRouter();
  const handledReturnRef = useRef(false);
  const [resuming, setResuming] = useState(false);
  const {
    user,
    sessionHydrated,
    billingSummary: realBillingSummary,
    billingBusy,
    billingCheckoutBusy,
    billingError,
    effectiveCheckoutUrl,
    onboardingPending,
    refreshBilling,
    refreshCheckoutReturn,
    resolveUserLandingRoute,
  } = useDenFlow();

  const mockMode = MOCK_BILLING && process.env.NODE_ENV !== "production";

  const billingSummary = MOCK_BILLING
    ? {
        featureGateEnabled: true,
        hasActivePlan: false,
        price: { amount: 5000, currency: "usd", recurringInterval: "month", recurringIntervalCount: 1 },
        subscription: null,
        invoices: [],
        account: { email: user?.email ?? "test@example.com", polarId: "123" }
      }
    : realBillingSummary;

  useEffect(() => {
    if (!sessionHydrated || resuming) {
      return;
    }
    if (!user) {
      if (mockMode) {
        return;
      }
      router.replace("/");
    }
  }, [mockMode, resuming, router, sessionHydrated, user]);

  useEffect(() => {
    if (!sessionHydrated || !user || handledReturnRef.current) {
      return;
    }

    if (!customerSessionToken) {
      return;
    }

    handledReturnRef.current = true;
    setResuming(true);
    void refreshCheckoutReturn(true).then((target) => {
      if (target === "/dashboard") {
        router.replace(target);
        return;
      }

      router.replace("/checkout");
      setResuming(false);
    });
  }, [customerSessionToken, refreshCheckoutReturn, router, sessionHydrated, user]);

  useEffect(() => {
    if (!sessionHydrated || !user || resuming) {
      return;
    }

    if (!billingSummary?.hasActivePlan && !effectiveCheckoutUrl && !billingBusy && !billingCheckoutBusy) {
      void refreshBilling({ includeCheckout: true, quiet: true });
    }
  }, [billingBusy, billingCheckoutBusy, billingSummary?.hasActivePlan, effectiveCheckoutUrl, refreshBilling, resuming, sessionHydrated, user]);

  useEffect(() => {
    if (!sessionHydrated || !user || resuming) {
      return;
    }

    if (!onboardingPending) {
      void resolveUserLandingRoute().then((target) => {
        if (target === "/dashboard" && !MOCK_BILLING) {
          router.replace(target);
        }
      });
    }
  }, [onboardingPending, resolveUserLandingRoute, resuming, router, sessionHydrated, user]);

  if (!sessionHydrated || (!user && !mockMode)) {
    return (
      <section className="mx-auto grid w-full max-w-[44rem] gap-4 rounded-[32px] border border-white/70 bg-white/92 p-6 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.35)]">
        <p className="text-sm text-slate-500">Checking your billing session...</p>
      </section>
    );
  }

  const billingPrice = billingSummary?.price ?? null;
  const showLoading = resuming || (billingBusy && !billingSummary && !MOCK_BILLING);
  const checkoutHref = effectiveCheckoutUrl ?? MOCK_CHECKOUT_URL ?? null;
  const accountEmail = user?.email ?? (mockMode ? "test@example.com" : null);
  const planStatusLabel = !billingSummary?.featureGateEnabled
    ? "Billing disabled"
    : billingSummary.hasActivePlan
      ? "Active plan"
      : "Payment required";
  const planStatusDetail = !billingSummary?.featureGateEnabled
    ? "Cloud billing gates are disabled in this environment."
    : billingSummary.hasActivePlan
      ? "Your account can launch cloud workers right now."
      : "Complete checkout to unlock cloud worker launches.";
  const planAmountLabel = billingPrice && billingPrice.amount !== null
    ? `${formatMoneyMinor(billingPrice.amount, billingPrice.currency)} ${formatRecurringInterval(billingPrice.recurringInterval, billingPrice.recurringIntervalCount)}`
    : "Current plan amount is unavailable.";

  return (
    <section className="mx-auto flex w-full max-w-[78rem] flex-col gap-6 px-1 py-2 lg:px-3 lg:py-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px] xl:items-start">
        <div className="grid gap-5 rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-surface)] p-5 md:p-7">
          <div className="grid gap-4 border-b border-[var(--dls-border)] pb-5 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
            <div className="grid gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">
                {onboardingPending ? "Finish billing to continue onboarding" : "Billing"}
              </p>
              <div className="grid gap-2">
                <h1 className="max-w-[14ch] text-[2.35rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[var(--dls-text-primary)] md:text-[3rem]">
                  {onboardingPending ? "Unlock your Den worker." : "Manage your Den plan."}
                </h1>
                <p className="max-w-[38rem] text-[15px] leading-7 text-[var(--dls-text-secondary)]">
                  {onboardingPending
                    ? "We wait for billing to confirm before resuming worker creation, so checkout returns land reliably on your dashboard."
                    : "Review plan status, generate a fresh checkout link, and keep billing inside the same OpenWork flow."}
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-sidebar)] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Plan overview</div>
              <div className="grid gap-1">
                <div className="text-lg font-semibold tracking-[-0.03em] text-[var(--dls-text-primary)]">{planStatusLabel}</div>
                <div className="text-sm text-[var(--dls-text-secondary)]">{planAmountLabel}</div>
              </div>
              <div className="rounded-xl border border-[var(--dls-border)] bg-white px-3 py-2.5 text-[13px] leading-6 text-[var(--dls-text-secondary)]">
                {planStatusDetail}
              </div>
            </div>
          </div>

          {billingError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{billingError}</div>
          ) : null}

          {showLoading ? <p className="text-sm text-[var(--dls-text-secondary)]">Refreshing billing state...</p> : null}

          {billingSummary ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
              <div className="grid gap-4 rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-sidebar)] p-5 md:p-6">
                <div className="flex items-start justify-between gap-4 border-b border-[var(--dls-border)] pb-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Checkout status</div>
                    <h2 className="mt-2 text-[1.5rem] font-semibold tracking-[-0.04em] text-[var(--dls-text-primary)]">Ready when you are</h2>
                  </div>
                  <div className="rounded-full border border-[var(--dls-border)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dls-text-secondary)]">
                    {billingSummary.hasActivePlan ? "Active" : "Pending"}
                  </div>
                </div>

                <div className="grid gap-3">
                  {launchSteps.map((step, index) => (
                    <div key={step} className="flex items-start gap-3 rounded-2xl border border-[var(--dls-border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--dls-hover)] text-[12px] font-semibold text-[var(--dls-text-primary)]">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                {checkoutHref ? (
                  <div className="grid gap-3 rounded-2xl border border-[#dbe4f0] bg-white p-4">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--dls-text-primary)]">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#e7f7f1] text-[11px] font-semibold text-[#0f766e]">OK</span>
                      Checkout available
                    </div>
                    <p className="text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                      Open a fresh checkout session, complete payment, and return here to resume automatically.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={checkoutHref}
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#011627] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
                      >
                        Continue to checkout
                        <span aria-hidden="true">-&gt;</span>
                      </a>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-full border border-[var(--dls-border)] bg-white px-5 py-3 text-sm font-medium text-[var(--dls-text-primary)] transition hover:bg-[var(--dls-hover)]"
                        onClick={() => void refreshBilling({ includeCheckout: true, quiet: false })}
                        disabled={billingBusy || billingCheckoutBusy}
                      >
                        Refresh billing
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--dls-border)] bg-white px-4 py-4 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                    We are still preparing your checkout link. Refresh billing and we will fetch a new session.
                  </div>
                )}
              </div>

              <div className="grid gap-4 rounded-[28px] border border-[var(--dls-border)] bg-white p-5 md:p-6">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Account</div>
                  <h2 className="mt-2 text-[1.35rem] font-semibold tracking-[-0.035em] text-[var(--dls-text-primary)]">Billing details</h2>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-sidebar)] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dls-text-secondary)]">Email</div>
                    <div className="mt-1 text-sm text-[var(--dls-text-primary)]">{accountEmail ?? "No email on file"}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-sidebar)] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dls-text-secondary)]">Plan amount</div>
                    <div className="mt-1 text-sm text-[var(--dls-text-primary)]">{planAmountLabel}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-sidebar)] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dls-text-secondary)]">Launch access</div>
                    <div className="mt-1 text-sm text-[var(--dls-text-primary)]">{planStatusDetail}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="hidden xl:grid xl:gap-4 xl:rounded-[28px] xl:border xl:border-[var(--dls-border)] xl:bg-[var(--dls-sidebar)] xl:p-5">
          <div className="grid gap-2 border-b border-[var(--dls-border)] pb-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Desktop app</div>
            <h2 className="max-w-[12ch] text-[1.9rem] font-semibold leading-[1] tracking-[-0.045em] text-[var(--dls-text-primary)]">
              Get started with our desktop app for free.
            </h2>
            <p className="text-[14px] leading-6 text-[var(--dls-text-secondary)]">
              Start locally, keep your sessions in one place, and come back here whenever you want hosted workers.
            </p>
          </div>

          <div className="grid gap-3">
            {desktopAppPoints.map((point) => (
              <div key={point} className="flex items-start gap-3 rounded-2xl border border-[var(--dls-border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e7f7f1] text-[11px] font-semibold text-[#0f766e]">OK</span>
                <span>{point}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded-[24px] border border-[var(--dls-border)] bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--dls-hover)] text-[var(--dls-text-primary)]">
                <span className="text-xs font-semibold uppercase tracking-[0.14em]">App</span>
              </div>
              <div>
                <div className="text-sm font-medium text-[var(--dls-text-primary)]">OpenWork desktop</div>
                <div className="text-[13px] text-[var(--dls-text-secondary)]">Free local setup</div>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-sidebar)] px-4 py-3 text-[13px] leading-6 text-[var(--dls-text-secondary)]">
              Launch prompts, manage workers, and reconnect to hosted billing from the same control surface.
            </div>
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--dls-border)] bg-white px-4 py-3 text-sm font-medium text-[var(--dls-text-primary)] transition hover:bg-[var(--dls-hover)]"
            >
              <span aria-hidden="true">[ ]</span>
              Open desktop app info
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}
