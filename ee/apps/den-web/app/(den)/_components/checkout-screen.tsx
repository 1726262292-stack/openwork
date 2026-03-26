"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoneyMinor } from "../_lib/den-flow";
import { useDenFlow } from "../_providers/den-flow-provider";

// For local layout testing (no deploy needed)
// Enable with: NEXT_PUBLIC_DEN_MOCK_BILLING=1
const MOCK_BILLING = process.env.NEXT_PUBLIC_DEN_MOCK_BILLING === "1";
const MOCK_CHECKOUT_URL = (process.env.NEXT_PUBLIC_DEN_MOCK_CHECKOUT_URL ?? "").trim() || null;
const TRIAL_DAYS = 14;

function formatSubscriptionStatus(value: string | null | undefined) {
  if (!value) return "Trial ready";
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

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
        checkoutRequired: true,
        checkoutUrl: MOCK_CHECKOUT_URL,
        portalUrl: null,
        price: { amount: 5000, currency: "usd", recurringInterval: "month", recurringIntervalCount: 1 },
        subscription: null,
        invoices: [],
        productId: null,
        benefitId: null,
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
      if (target !== "/checkout") {
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
        if (target && target !== "/checkout" && !MOCK_BILLING) {
          router.replace(target);
        }
      });
    }
  }, [onboardingPending, resolveUserLandingRoute, resuming, router, sessionHydrated, user]);

  if (!sessionHydrated || (!user && !mockMode)) {
    return (
      <section className="den-page py-4">
        <div className="den-frame-soft grid max-w-[44rem] gap-4 p-6">
          <p className="text-sm text-slate-500">Checking your billing session...</p>
        </div>
      </section>
    );
  }

  const billingPrice = billingSummary?.price ?? null;
  const showLoading = resuming || (billingBusy && !billingSummary && !MOCK_BILLING);
  const checkoutHref = effectiveCheckoutUrl ?? MOCK_CHECKOUT_URL ?? null;
  const planAmountLabel = billingPrice && billingPrice.amount !== null
    ? `${formatMoneyMinor(billingPrice.amount, billingPrice.currency)}/${billingPrice.recurringInterval}`
    : "$50.00/month";
  const subscription = billingSummary?.subscription ?? null;
  const subscriptionStatus = formatSubscriptionStatus(subscription?.status);

  return (
    <section className="den-page grid gap-6 py-4 lg:py-6">
      <div className="den-frame grid gap-6 p-6 md:p-8 lg:p-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3">
            <p className="den-eyebrow">{onboardingPending ? "Finish setup" : "Billing"}</p>
            <h1 className="den-title-xl max-w-[10ch]">Choose how to run Den.</h1>
            <p className="den-copy max-w-2xl">
              Start with hosted workers for your team, or stay local and add
              Cloud later.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`den-status-pill ${billingSummary?.hasActivePlan ? "is-positive" : "is-neutral"}`}>
              {billingSummary?.hasActivePlan ? "Active plan" : "Trial ready"}
            </span>
            <span className="den-kicker">{user?.email ?? "Signed in"}</span>
          </div>
        </div>

        <div className="den-stat-grid">
          <div className="den-stat-card">
            <p className="den-stat-label">Cloud plan</p>
            <p className="den-stat-value">{planAmountLabel}</p>
            <p className="den-stat-copy">Hosted workers, team access, and billing in one place.</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Subscription</p>
            <p className="den-stat-value">{subscriptionStatus}</p>
            <p className="den-stat-copy">{billingSummary?.hasActivePlan ? "Your workspace is ready to keep running." : `${TRIAL_DAYS}-day free trial before billing starts.`}</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Invoices</p>
            <p className="den-stat-value">{billingSummary?.invoices.length ?? 0}</p>
            <p className="den-stat-copy">Past billing history appears here as soon as your plan is active.</p>
          </div>
        </div>
      </div>

      {billingError ? <div className="den-notice is-error">{billingError}</div> : null}
      {showLoading ? <div className="den-frame-soft px-5 py-4 text-sm text-[var(--dls-text-secondary)]">Refreshing access state...</div> : null}

      {billingSummary ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="grid gap-6 lg:grid-cols-2">
            <article className="den-frame grid gap-6 p-6 md:p-7">
              <div className="grid gap-3">
                <span className="den-kicker w-fit">Hosted workers</span>
                <h2 className="den-title-lg">Den Cloud</h2>
                <p className="den-copy">
                  Run workers that stay on, share access with your team, and
                  manage billing without leaving Den.
                </p>
              </div>

              <div className="grid gap-3 text-sm text-[var(--dls-text-secondary)]">
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />{TRIAL_DAYS}-day free trial</div>
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />{planAmountLabel} after trial</div>
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />Hosted workers, team access, and billing controls</div>
              </div>

              {checkoutHref ? (
                <div className="mt-auto flex flex-wrap gap-3 pt-2">
                  <a
                    href={checkoutHref}
                    rel="noreferrer"
                    className="den-button-primary w-full sm:w-auto"
                  >
                    Start free trial
                  </a>
                  {billingSummary.portalUrl ? (
                    <a href={billingSummary.portalUrl} rel="noreferrer" target="_blank" className="den-button-secondary w-full sm:w-auto">
                      Open billing portal
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className="mt-auto grid gap-3 pt-2">
                  <div className="den-frame-inset rounded-[1.5rem] px-4 py-3 text-sm text-[var(--dls-text-secondary)]">
                    We are still preparing your trial link.
                  </div>
                  <button
                    type="button"
                    className="den-button-secondary w-full sm:w-auto"
                    onClick={() => void refreshBilling({ includeCheckout: true, quiet: false })}
                    disabled={billingBusy || billingCheckoutBusy}
                  >
                    Refresh trial link
                  </button>
                </div>
              )}
            </article>

            <article className="den-frame-soft grid gap-6 p-6 md:p-7">
              <div className="grid gap-3">
                <span className="den-kicker w-fit">Local-first</span>
                <h2 className="den-title-lg">Desktop App</h2>
                <p className="den-copy">
                  Run locally for free, keep your data on your machine, and add
                  Cloud when your team needs it.
                </p>
              </div>

              <div className="grid gap-3 text-sm text-[var(--dls-text-secondary)]">
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />Run locally for free</div>
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />Keep data on your machine</div>
                <div className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />Add Den Cloud whenever you are ready</div>
              </div>

              <div className="mt-auto pt-2">
                <a href="/" className="den-button-secondary w-full sm:w-auto">
                  Download app
                </a>
              </div>
            </article>
          </div>

          <aside className="den-frame-soft grid h-fit gap-5 p-6 md:p-7">
            <div className="grid gap-2">
              <p className="den-eyebrow">Billing snapshot</p>
              <h2 className="den-title-lg">Keep billing tidy.</h2>
              <p className="den-copy text-sm">
                Track plan status, open the billing portal, and review invoices
                from one place.
              </p>
            </div>

            <div className="den-frame-inset grid gap-3 rounded-[1.5rem] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-[var(--dls-text-primary)]">Plan status</span>
                <span className={`den-status-pill ${billingSummary.hasActivePlan ? "is-positive" : "is-neutral"}`}>
                  {subscriptionStatus}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-[var(--dls-text-secondary)]">
                <span>Price</span>
                <span className="font-medium text-[var(--dls-text-primary)]">{planAmountLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm text-[var(--dls-text-secondary)]">
                <span>Invoices</span>
                <span className="font-medium text-[var(--dls-text-primary)]">{billingSummary.invoices.length}</span>
              </div>
            </div>

            <div className="grid gap-3">
              {billingSummary.portalUrl ? (
                <a href={billingSummary.portalUrl} rel="noreferrer" target="_blank" className="den-button-secondary w-full">
                  Open billing portal
                </a>
              ) : null}
              <button
                type="button"
                className="den-button-secondary w-full"
                onClick={() => void refreshBilling({ includeCheckout: true, quiet: false })}
                disabled={billingBusy || billingCheckoutBusy}
              >
                Refresh billing
              </button>
            </div>

            <div className="den-list-shell">
              <div className="px-5 py-4">
                <p className="den-eyebrow">Invoices</p>
              </div>
              {billingSummary.invoices.length === 0 ? (
                <div className="den-list-row text-sm text-[var(--dls-text-secondary)]">
                  Invoices will appear here once your Cloud plan begins billing.
                </div>
              ) : (
                billingSummary.invoices.slice(0, 5).map((invoice) => (
                  <div key={invoice.id} className="den-list-row">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium text-[var(--dls-text-primary)]">
                        {invoice.invoiceNumber ?? "Invoice"}
                      </p>
                      <p className="text-xs text-[var(--dls-text-secondary)]">
                        {invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : "Recent"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[var(--dls-text-secondary)]">
                        {invoice.totalAmount !== null ? formatMoneyMinor(invoice.totalAmount, invoice.currency) : "Pending"}
                      </span>
                      {invoice.invoiceUrl ? (
                        <a href={invoice.invoiceUrl} rel="noreferrer" target="_blank" className="den-button-ghost text-sm">
                          View
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
