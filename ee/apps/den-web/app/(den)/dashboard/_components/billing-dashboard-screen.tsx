"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { formatMoneyMinor, formatSubscriptionStatus, getErrorMessage, requestJson } from "../../_lib/den-flow";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type BillingProduct = {
  enabled: boolean;
  configured: boolean;
  provider: "disabled" | "simulated" | "stripe";
  priceId: string | null;
  unitAmount: number;
  currency: string;
  interval: string;
  usedSeats: number;
  purchasedSeats: number | null;
  memberCount: number;
  hasActiveSubscription: boolean;
  portalUrl: string | null;
  enforceSeats: boolean;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};

type BillingSummary = {
  provider: "disabled" | "simulated" | "stripe";
  products: {
    inference: BillingProduct;
    orgSeats: BillingProduct;
  };
};

type PolarBilling = {
  hasActivePlan: boolean;
  portalUrl: string | null;
  subscription: { status: string } | null;
};

function parseProduct(value: unknown): BillingProduct | null {
  if (!value || typeof value !== "object") return null;
  const product = value as Partial<BillingProduct>;
  return {
    enabled: product.enabled === true,
    configured: product.configured === true,
    provider: product.provider === "disabled" || product.provider === "simulated" || product.provider === "stripe" ? product.provider : "stripe",
    priceId: typeof product.priceId === "string" ? product.priceId : null,
    unitAmount: typeof product.unitAmount === "number" ? product.unitAmount : 1000,
    currency: typeof product.currency === "string" ? product.currency : "usd",
    interval: typeof product.interval === "string" ? product.interval : "month",
    usedSeats: typeof product.usedSeats === "number" ? product.usedSeats : typeof product.memberCount === "number" ? product.memberCount : 0,
    purchasedSeats: typeof product.purchasedSeats === "number" ? product.purchasedSeats : null,
    memberCount: typeof product.memberCount === "number" ? product.memberCount : 0,
    hasActiveSubscription: product.hasActiveSubscription === true,
    portalUrl: typeof product.portalUrl === "string" ? product.portalUrl : null,
    enforceSeats: product.enforceSeats === true,
    subscription: product.subscription && typeof product.subscription === "object"
      ? {
          status: typeof product.subscription.status === "string" ? product.subscription.status : "unknown",
          quantity: typeof product.subscription.quantity === "number" ? product.subscription.quantity : 0,
          currentPeriodEnd: typeof product.subscription.currentPeriodEnd === "string" ? product.subscription.currentPeriodEnd : null,
          cancelAtPeriodEnd: product.subscription.cancelAtPeriodEnd === true,
        }
      : null,
  };
}

function parseBillingSummary(payload: unknown): BillingSummary | null {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return null;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object") return null;
  const value = billing as { provider?: unknown; products?: unknown; stripe?: unknown };
  const products = value.products && typeof value.products === "object" ? value.products as { inference?: unknown; orgSeats?: unknown } : null;
  const inference = parseProduct(products?.inference ?? value.stripe);
  if (!inference) return null;
  const orgSeats = parseProduct(products?.orgSeats) ?? { ...inference, enabled: false, configured: false, hasActiveSubscription: false, purchasedSeats: null, subscription: null };
  const provider = value.provider === "disabled" || value.provider === "simulated" || value.provider === "stripe" ? value.provider : inference.provider;
  return { provider, products: { inference, orgSeats } };
}

function parsePolarBilling(payload: unknown): PolarBilling | null {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return null;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object" || !("polar" in billing)) return null;
  const polar = (billing as { polar?: unknown }).polar;
  if (!polar || typeof polar !== "object") return null;
  const value = polar as Partial<PolarBilling>;
  return {
    hasActivePlan: value.hasActivePlan === true,
    portalUrl: typeof value.portalUrl === "string" ? value.portalUrl : null,
    subscription: value.subscription && typeof value.subscription === "object" ? { status: typeof value.subscription.status === "string" ? value.subscription.status : "active" } : null,
  };
}

function productStatus(product: BillingProduct | null) {
  return product?.hasActiveSubscription ? formatSubscriptionStatus(product.subscription?.status ?? "active") : "Not subscribed";
}

export function BillingDashboardScreen() {
  const { sessionHydrated, user } = useDenFlow();
  const { orgContext } = useOrgDashboard();
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [polarBilling, setPolarBilling] = useState<PolarBilling | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seatQuantity, setSeatQuantity] = useState(10);

  const isOwner = orgContext?.currentMember.isOwner === true;
  const orgSeats = billing?.products.orgSeats ?? null;
  const inference = billing?.products.inference ?? null;
  const simulated = billing?.provider === "simulated";

  async function refreshBilling(quiet = false) {
    setBusy(true);
    if (!quiet) setError(null);
    try {
      const { response, payload } = await requestJson("/v1/billing", { method: "GET" }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `Billing lookup failed (${response.status}).`));
      const parsed = parseBillingSummary(payload);
      if (!parsed) throw new Error("Billing response was incomplete.");
      setBilling(parsed);
      setPolarBilling(parsePolarBilling(payload));
      const nextQuantity = parsed.products.orgSeats.purchasedSeats ?? Math.max(10, parsed.products.orgSeats.usedSeats || orgContext?.members.length || 1);
      setSeatQuantity(nextQuantity);
      return parsed;
    } catch (nextError) {
      if (!quiet) setError(nextError instanceof Error ? nextError.message : "Could not load billing.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionHydrated || !user) return;
    void refreshBilling(true);
  }, [sessionHydrated, user, orgContext?.organization.id]);

  async function openUrlFromResponse(path: string, init: RequestInit, busyKey: string) {
    setActionBusy(busyKey);
    setError(null);
    try {
      const { response, payload } = await requestJson(path, init, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `Billing action failed (${response.status}).`));
      const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
      if (!url) throw new Error("Billing response did not include a URL.");
      if (simulated) {
        await refreshBilling(true);
      } else {
        window.location.href = url;
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Billing action failed.");
    } finally {
      setActionBusy(null);
    }
  }

  async function updateSimulated(product: "org_seats" | "inference", status: "active" | "past_due" | "canceled", quantity?: number) {
    setActionBusy(`${product}:${status}`);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/billing/simulated/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, status, quantity }),
      }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `Simulated billing update failed (${response.status}).`));
      const parsed = parseBillingSummary({ billing: payload });
      if (parsed) setBilling(parsed);
      await refreshBilling(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Simulated billing update failed.");
    } finally {
      setActionBusy(null);
    }
  }

  const showPolar = polarBilling?.hasActivePlan === true && Boolean(polarBilling.portalUrl);
  const seatsPrice = formatMoneyMinor(orgSeats?.unitAmount ?? 2000, orgSeats?.currency ?? "usd");
  const inferencePrice = formatMoneyMinor(inference?.unitAmount ?? 1000, inference?.currency ?? "usd");
  const minSeats = Math.max(1, orgSeats?.usedSeats ?? orgContext?.members.length ?? 1);

  return (
    <DashboardPageTemplate
      icon={CreditCard}
      title="Billing"
      description="Manage Team Seats for hosted org access and OpenWork Models for hosted inference. Self-hosted deployments can keep billing disabled."
      colors={["#EFF6FF", "#1E3A5F", "#3B82F6", "#93C5FD"]}
    >
      {error ? <div className="mb-6 rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div> : null}
      {!isOwner ? <div className="mb-6 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">Only workspace owners can start checkout or open billing portals. Other members can view the current billing state.</div> : null}
      {simulated ? <div className="mb-6 rounded-[20px] border border-purple-200 bg-purple-50 px-4 py-3 text-[13px] text-purple-800">Simulated billing is enabled. These controls exercise the full billing UI without Stripe.</div> : null}

      {showPolar ? (
        <section className="mb-6 rounded-[20px] border border-gray-100 bg-white p-8 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-gray-400">Polar</p>
              <h2 className="text-[18px] font-medium text-gray-950">Cloud worker plan</h2>
              <p className="mt-2 text-[14px] text-gray-500">Your existing Polar subscription is {formatSubscriptionStatus(polarBilling?.subscription?.status ?? "active").toLowerCase()}.</p>
            </div>
            {polarBilling?.portalUrl ? <a href={polarBilling.portalUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "secondary" })}>Open Polar portal</a> : null}
          </div>
        </section>
      ) : null}

      <div className="mb-6 flex justify-end">
        <DenButton variant="secondary" loading={busy} onClick={() => void refreshBilling(false)}>Refresh</DenButton>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {orgSeats?.enabled ? (
          <section className="rounded-[20px] border border-gray-100 bg-white p-8 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-500">Team Seats</p>
            <h2 className="text-[20px] font-medium text-gray-950">Hosted org access</h2>
            <p className="mt-2 text-[14px] leading-6 text-gray-500">Invite teammates into your hosted Den org. Model usage is billed separately.</p>
            <div className="my-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Metric label="Price" value={`${seatsPrice}/seat/month`} />
              <Metric label="Seats used" value={`${orgSeats.usedSeats} / ${orgSeats.purchasedSeats ?? 0}`} />
              <Metric label="Status" value={productStatus(orgSeats)} />
            </div>
            <label className="mb-4 block text-[13px] font-medium text-gray-700">
              Seats
              <input className="mt-2 w-full rounded-[14px] border border-gray-200 px-3 py-2 text-[14px]" type="number" min={minSeats} max={500} value={seatQuantity} onChange={(event) => setSeatQuantity(Number(event.target.value))} />
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              {orgSeats.hasActiveSubscription ? <DenButton disabled={!isOwner || !orgSeats.configured} loading={actionBusy === "org-seats:portal"} onClick={() => simulated ? void updateSimulated("org_seats", "active", seatQuantity) : void openUrlFromResponse("/v1/billing/org-seats/portal", { method: "POST" }, "org-seats:portal")}>{simulated ? "Update simulated seats" : "Manage seats"}</DenButton> : null}
              {!orgSeats.hasActiveSubscription ? <DenButton disabled={!isOwner || !orgSeats.configured} loading={actionBusy === "org-seats:checkout"} onClick={() => void openUrlFromResponse("/v1/billing/org-seats/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quantity: seatQuantity }) }, "org-seats:checkout")}>Buy Team Seats</DenButton> : null}
              {simulated && orgSeats.hasActiveSubscription ? <DenButton variant="secondary" disabled={!isOwner} loading={actionBusy === "org_seats:canceled"} onClick={() => void updateSimulated("org_seats", "canceled", seatQuantity)}>Cancel simulated seats</DenButton> : null}
              {simulated && orgSeats.hasActiveSubscription ? <DenButton variant="secondary" disabled={!isOwner} loading={actionBusy === "org_seats:past_due"} onClick={() => void updateSimulated("org_seats", "past_due", seatQuantity)}>Simulate failed payment</DenButton> : null}
            </div>
          </section>
        ) : null}

        {inference?.enabled ? (
          <section className="rounded-[20px] border border-gray-100 bg-white p-8 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-500">OpenWork Models</p>
            <h2 className="text-[20px] font-medium text-gray-950">Hosted inference</h2>
            <p className="mt-2 text-[14px] leading-6 text-gray-500">Use OpenWork-hosted model access without bringing your own provider key.</p>
            <div className="my-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Metric label="Price" value={`${inferencePrice}/month`} />
              <Metric label="Active members" value={String(inference.memberCount)} />
              <Metric label="Status" value={productStatus(inference)} />
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              {inference.hasActiveSubscription ? <DenButton disabled={!isOwner || !inference.configured} loading={actionBusy === "inference:portal"} onClick={() => simulated ? void updateSimulated("inference", "active", 1) : void openUrlFromResponse("/v1/billing/inference/portal", { method: "POST" }, "inference:portal")}>{simulated ? "Refresh simulated models" : "Manage models"}</DenButton> : null}
              {!inference.hasActiveSubscription ? <DenButton disabled={!isOwner || !inference.configured} loading={actionBusy === "inference:checkout"} onClick={() => void openUrlFromResponse("/v1/billing/inference/checkout", { method: "POST" }, "inference:checkout")}>Enable OpenWork Models</DenButton> : null}
              {simulated && inference.hasActiveSubscription ? <DenButton variant="secondary" disabled={!isOwner} loading={actionBusy === "inference:canceled"} onClick={() => void updateSimulated("inference", "canceled", 1)}>Cancel simulated models</DenButton> : null}
            </div>
          </section>
        ) : null}
      </div>

      {!orgSeats?.enabled && !inference?.enabled ? (
        <section className="rounded-[20px] border border-gray-100 bg-white p-8 text-[14px] text-gray-500 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
          Billing is disabled for this deployment. Team seats are unlimited and Stripe is not required.
        </section>
      ) : null}
    </DashboardPageTemplate>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-gray-100 bg-gray-50 p-4">
      <p className="text-[12px] text-gray-500">{props.label}</p>
      <p className="mt-1 text-[20px] font-semibold text-gray-950">{props.value}</p>
    </div>
  );
}
