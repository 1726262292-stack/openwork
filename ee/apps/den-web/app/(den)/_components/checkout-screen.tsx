"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoneyMinor, formatRecurringInterval } from "../_lib/den-flow";
import { useDenFlow } from "../_providers/den-flow-provider";

// For local layout testing (no deploy needed)
// Enable with: NEXT_PUBLIC_DEN_MOCK_BILLING=1
const MOCK_BILLING = process.env.NEXT_PUBLIC_DEN_MOCK_BILLING === "1";
const MOCK_CHECKOUT_URL = (process.env.NEXT_PUBLIC_DEN_MOCK_CHECKOUT_URL ?? "").trim() || null;
const TRIAL_DAYS = 14;

const desktopAppPoints = ["Run Den locally for free.", "Keep prompts and sessions on your machine.", "Upgrade to Den Cloud later if you need hosted workers."];

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
  const planStatusDetail = !billingSummary?.featureGateEnabled
    ? "Cloud billing gates are disabled in this environment."
    : billingSummary.hasActivePlan
      ? "Your account can launch cloud workers right now."
      : `Start your ${TRIAL_DAYS}-day Den Cloud trial to unlock hosted worker launches.`;
  const planAmountLabel = billingPrice && billingPrice.amount !== null
    ? `${formatMoneyMinor(billingPrice.amount, billingPrice.currency)} ${formatRecurringInterval(billingPrice.recurringInterval, billingPrice.recurringIntervalCount)}`
    : "Current plan amount is unavailable.";
  const trialFootnote = billingPrice && billingPrice.amount !== null
    ? `Then ${planAmountLabel}. Cancel before the trial ends and you will not be charged.`
    : `Cancel before day ${TRIAL_DAYS} and you will not be charged.`;

  return (
    <section className="mx-auto flex w-full max-w-[74rem] flex-col gap-6 px-1 py-2 lg:px-3 lg:py-6">
      <div className="grid gap-4 rounded-[32px] border border-[var(--dls-border)] bg-[var(--dls-surface)] p-6 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.32)] md:p-8">
        <div className="grid gap-3 border-b border-[var(--dls-border)] pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">
            {onboardingPending ? "Finish setup" : "Den access"}
          </p>
          <h1 className="max-w-[12ch] text-[2.5rem] font-semibold leading-[0.95] tracking-[-0.06em] text-[var(--dls-text-primary)] md:text-[3.4rem]">
            Choose how you want to start with Den.
          </h1>
          <p className="max-w-[44rem] text-[15px] leading-7 text-[var(--dls-text-secondary)]">
            Start a {TRIAL_DAYS}-day Den Cloud trial for hosted workers, or download the desktop app and run locally for free.
          </p>
        </div>

        {billingError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{billingError}</div>
        ) : null}

        {showLoading ? <p className="text-sm text-[var(--dls-text-secondary)]">Refreshing access state...</p> : null}

        {billingSummary ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="grid gap-5 rounded-[28px] border border-[#d7e3ee] bg-[linear-gradient(180deg,#ffffff_0%,#f4f8fc_100%)] p-5 md:p-6">
              <div className="grid gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Den Cloud</div>
                <h2 className="text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[var(--dls-text-primary)]">
                  Try Den Cloud free for {TRIAL_DAYS} days
                </h2>
                <p className="text-[14px] leading-7 text-[var(--dls-text-secondary)]">
                  Launch a hosted Den worker now. After signup, we bring you right back here and continue setup automatically.
                </p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/80 bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                  Hosted worker access with a real {TRIAL_DAYS}-day trial.
                </div>
                <div className="rounded-2xl border border-white/80 bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                  {planStatusDetail}
                </div>
                <div className="rounded-2xl border border-white/80 bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                  {trialFootnote}
                </div>
              </div>

              {checkoutHref ? (
                <div className="grid gap-3">
                  <a
                    href={checkoutHref}
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#011627] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
                  >
                    Try Den Cloud free
                    <span aria-hidden="true">-&gt;</span>
                  </a>
                  <p className="text-[12px] leading-5 text-[var(--dls-text-secondary)]">No extra setup steps here. Start the trial and we handle the return flow.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-[var(--dls-border)] bg-white px-4 py-4 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                    We are still preparing your trial link.
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full border border-[var(--dls-border)] bg-white px-5 py-3 text-sm font-medium text-[var(--dls-text-primary)] transition hover:bg-[var(--dls-hover)]"
                    onClick={() => void refreshBilling({ includeCheckout: true, quiet: false })}
                    disabled={billingBusy || billingCheckoutBusy}
                  >
                    Refresh trial link
                  </button>
                </div>
              )}
            </article>

            <article className="grid gap-5 rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-sidebar)] p-5 md:p-6">
              <div className="grid gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dls-text-secondary)]">Desktop app</div>
                <h2 className="text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[var(--dls-text-primary)]">
                  Download the desktop app
                </h2>
                <p className="text-[14px] leading-7 text-[var(--dls-text-secondary)]">
                  Use Den locally for free today, then come back to Den Cloud whenever you want hosted workers.
                </p>
              </div>

              <div className="grid gap-3">
                {desktopAppPoints.map((point) => (
                  <div key={point} className="rounded-2xl border border-[var(--dls-border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--dls-text-secondary)]">
                    {point}
                  </div>
                ))}
              </div>

              <div className="grid gap-3">
                <a
                  href="/"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--dls-border)] bg-white px-5 py-3 text-sm font-medium text-[var(--dls-text-primary)] transition hover:bg-[var(--dls-hover)]"
                >
                  Download desktop app
                </a>
                <p className="text-[12px] leading-5 text-[var(--dls-text-secondary)]">
                  Best if you want a free local setup first. Account email: {accountEmail ?? "No email on file"}.
                </p>
              </div>
            </article>
          </div>
        ) : null}
      </div>
    </section>
  );
}
