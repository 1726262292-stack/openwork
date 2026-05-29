import Stripe from "stripe"
import { and, eq, isNull, sql } from "@openwork-ee/den-db/drizzle"
import {
  MemberTable,
  OrgSubscriptionStatus,
  OrgSubscriptionTable,
  OrganizationTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "./db.js"
import { env } from "./env.js"
import { setInferenceEnabled } from "./inference.js"

type OrgId = typeof OrganizationTable.$inferSelect.id
type MemberId = typeof MemberTable.$inferSelect.id
type OrgSubscriptionStatusValue = (typeof OrgSubscriptionStatus)[number]
type BillingProduct = "inference" | "org_seats"

const STRIPE_API_VERSION = "2026-04-22.dahlia"
const INFERENCE_SUBSCRIPTION_TYPE = "inference" as const
const ORG_SEATS_SUBSCRIPTION_TYPE = "org_seats" as const
const ACTIVE_STATUSES = new Set<OrgSubscriptionStatusValue>(["active", "trialing"])
const EXPIRED_STATUSES = new Set<OrgSubscriptionStatusValue>(["past_due", "canceled", "unpaid", "incomplete_expired", "expired"])

let stripeClient: Stripe | null = null

function stripe() {
  if (!env.stripe.secretKey) {
    throw new Error("stripe_secret_key_missing")
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripe.secretKey, {
      apiVersion: STRIPE_API_VERSION as any,
    })
  }
  return stripeClient
}

function requireInferencePriceId() {
  if (!env.stripe.inferencePriceId) {
    throw new Error("stripe_inference_price_id_missing")
  }
  return env.stripe.inferencePriceId
}

function requireOrgSeatsPriceId() {
  if (!env.stripe.orgSeatsPriceId) {
    throw new Error("stripe_org_seats_price_id_missing")
  }
  return env.stripe.orgSeatsPriceId
}

function productPriceId(product: BillingProduct) {
  return product === ORG_SEATS_SUBSCRIPTION_TYPE ? requireOrgSeatsPriceId() : requireInferencePriceId()
}

function productMetadataName(product: BillingProduct) {
  return product === ORG_SEATS_SUBSCRIPTION_TYPE ? "openwork_team_seats" : "openwork_models"
}

function fromUnixSeconds(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000) : null
}

function subscriptionStatus(value: string | null | undefined): OrgSubscriptionStatusValue {
  switch (value) {
    case "incomplete":
    case "incomplete_expired":
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "paused":
      return value
    default:
      return "expired"
  }
}

function customerIdFromSubscription(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
}

function firstSubscriptionItem(subscription: Stripe.Subscription) {
  return subscription.items.data[0] ?? null
}

function getSubscriptionMetadata(subscription: Stripe.Subscription) {
  const orgId = subscription.metadata.org_id?.trim() ?? ""
  const orgMemberId = subscription.metadata.created_by_org_member_id?.trim() ?? ""
  const subscriptionType = subscription.metadata.subscription_type?.trim() === ORG_SEATS_SUBSCRIPTION_TYPE
    ? ORG_SEATS_SUBSCRIPTION_TYPE
    : INFERENCE_SUBSCRIPTION_TYPE
  return {
    organizationId: orgId || null,
    orgMemberId: orgMemberId || null,
    subscriptionType,
  }
}

async function activeMemberCount(organizationId: OrgId) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(MemberTable)
    .where(and(eq(MemberTable.organizationId, organizationId), isNull(MemberTable.removedAt)))
  return Math.max(0, Number(row?.count ?? 0))
}

export async function getActiveMemberCountForBilling(organizationId: OrgId) {
  return activeMemberCount(organizationId)
}

async function findSubscriptionByOrg(organizationId: OrgId, product: BillingProduct) {
  return db
    .select()
    .from(OrgSubscriptionTable)
    .where(and(
      eq(OrgSubscriptionTable.organization_id, organizationId),
      eq(OrgSubscriptionTable.type, product),
    ))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function findInferenceSubscriptionByOrg(organizationId: OrgId) {
  return findSubscriptionByOrg(organizationId, INFERENCE_SUBSCRIPTION_TYPE)
}

async function findOrgSeatsSubscriptionByOrg(organizationId: OrgId) {
  return findSubscriptionByOrg(organizationId, ORG_SEATS_SUBSCRIPTION_TYPE)
}

async function findInferenceSubscriptionByStripeId(stripeSubscriptionId: string) {
  return db
    .select()
    .from(OrgSubscriptionTable)
    .where(eq(OrgSubscriptionTable.stripe_subscription_id, stripeSubscriptionId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function findStripeCustomerIdByOrg(organizationId: string) {
  return db
    .select({ stripeCustomerId: OrgSubscriptionTable.stripe_customer_id })
    .from(OrgSubscriptionTable)
    .where(eq(OrgSubscriptionTable.organization_id, organizationId as OrgId))
    .limit(1)
    .then((rows) => rows[0]?.stripeCustomerId ?? null)
}

function stripeSearchLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function findStripeCustomerIdByOrgMetadata(organizationId: string) {
  try {
    const customers = await stripe().customers.search({
      query: `metadata['org_id']:'${stripeSearchLiteral(organizationId)}'`,
      limit: 1,
    })
    return customers.data[0]?.id ?? null
  } catch (error) {
    console.warn("[stripe-billing] failed to search customers by org metadata", error)
    return null
  }
}

export async function organizationHasActiveInferenceSubscription(organizationId: OrgId) {
  const row = await findInferenceSubscriptionByOrg(organizationId)
  return Boolean(row && ACTIVE_STATUSES.has(row.status))
}

export async function upsertInferenceSubscriptionFromStripe(subscription: Stripe.Subscription, eventId?: string | null) {
  const item = firstSubscriptionItem(subscription)
  const metadata = getSubscriptionMetadata(subscription)
  if (!metadata.organizationId) {
    return null
  }

  const status = subscriptionStatus(subscription.status)
  const quantity = item?.quantity ?? 0
  const priceId = typeof item?.price?.id === "string" ? item.price.id : null
  const now = new Date()
  const values = {
    id: createDenTypeId("orgSubscription"),
    organization_id: metadata.organizationId as OrgId,
    created_by_org_membership_id: metadata.orgMemberId as MemberId | null,
    type: metadata.subscriptionType,
    status,
    stripe_customer_id: customerIdFromSubscription(subscription),
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    stripe_subscription_item_id: item?.id ?? null,
    quantity,
    current_period_start: fromUnixSeconds((subscription as Stripe.Subscription & { current_period_start?: number }).current_period_start),
    current_period_end: fromUnixSeconds((subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: fromUnixSeconds(subscription.canceled_at),
    ended_at: fromUnixSeconds(subscription.ended_at),
    last_event_id: eventId ?? null,
    created_at: now,
    updated_at: now,
  }

  await db.insert(OrgSubscriptionTable).values(values).onDuplicateKeyUpdate({
    set: {
      created_by_org_membership_id: values.created_by_org_membership_id,
      status: values.status,
      stripe_customer_id: values.stripe_customer_id,
      stripe_subscription_id: values.stripe_subscription_id,
      stripe_price_id: values.stripe_price_id,
      stripe_subscription_item_id: values.stripe_subscription_item_id,
      quantity: values.quantity,
      current_period_start: values.current_period_start,
      current_period_end: values.current_period_end,
      cancel_at_period_end: values.cancel_at_period_end,
      canceled_at: values.canceled_at,
      ended_at: values.ended_at,
      last_event_id: values.last_event_id,
      updated_at: now,
    },
  })

  if (metadata.subscriptionType === INFERENCE_SUBSCRIPTION_TYPE && EXPIRED_STATUSES.has(status)) {
    await setInferenceEnabled({ organizationId: metadata.organizationId as OrgId, enabled: false })
  }

  return findInferenceSubscriptionByStripeId(subscription.id)
}

export async function findOrCreateStripeCustomer(input: {
  email: string
  name: string
  organizationId?: string | null
  metadata?: Stripe.MetadataParam
  existingCustomerId?: string | null
}) {
  const existingCustomerId = input.existingCustomerId?.trim()
  if (existingCustomerId) {
    return existingCustomerId
  }

  const organizationId = input.organizationId?.trim()
  if (organizationId) {
    const dbCustomerId = await findStripeCustomerIdByOrg(organizationId)
    if (dbCustomerId) {
      return dbCustomerId
    }

    const stripeCustomerId = await findStripeCustomerIdByOrgMetadata(organizationId)
    if (stripeCustomerId) {
      return stripeCustomerId
    }
  }

  const email = input.email.trim()
  if (!email) {
    throw new Error("stripe_customer_email_missing")
  }

  const existing = await stripe().customers.list({ email, limit: 1 })
  if (existing.data[0]) {
    return existing.data[0].id
  }

  const customer = await stripe().customers.create({
    email,
    name: input.name,
    metadata: input.metadata,
  })
  return customer.id
}

async function createCheckoutSession(input: {
  product: BillingProduct
  organizationId: OrgId
  orgMemberId: MemberId
  email: string
  name: string
  quantity?: number
  successUrl: string
  cancelUrl: string
}) {
  const priceId = productPriceId(input.product)
  const quantity = Math.max(1, input.quantity ?? await activeMemberCount(input.organizationId))
  const customer = await findOrCreateStripeCustomer({
    organizationId: input.organizationId,
    email: input.email,
    name: input.name,
    metadata: {
      org_id: input.organizationId,
      created_by_org_member_id: input.orgMemberId,
      openwork_product: productMetadataName(input.product),
    },
  })
  return stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    allow_promotion_codes: true,
    line_items: [{ price: priceId, quantity }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.organizationId,
    metadata: {
      org_id: input.organizationId,
      created_by_org_member_id: input.orgMemberId,
      openwork_product: productMetadataName(input.product),
    },
    subscription_data: {
      metadata: {
        org_id: input.organizationId,
        created_by_org_member_id: input.orgMemberId,
        openwork_product: productMetadataName(input.product),
        subscription_type: input.product,
      },
    },
  })
}

export async function createInferenceCheckoutSession(input: {
  organizationId: OrgId
  orgMemberId: MemberId
  email: string
  name: string
  successUrl: string
  cancelUrl: string
}) {
  return createCheckoutSession({ ...input, product: INFERENCE_SUBSCRIPTION_TYPE })
}

export async function createOrgSeatsCheckoutSession(input: {
  organizationId: OrgId
  orgMemberId: MemberId
  email: string
  name: string
  quantity: number
  successUrl: string
  cancelUrl: string
}) {
  return createCheckoutSession({ ...input, product: ORG_SEATS_SUBSCRIPTION_TYPE })
}

export async function createInferencePortalSession(input: { organizationId: OrgId; returnUrl: string }) {
  return createPortalSession({ organizationId: input.organizationId, returnUrl: input.returnUrl, product: INFERENCE_SUBSCRIPTION_TYPE })
}

export async function createOrgSeatsPortalSession(input: { organizationId: OrgId; returnUrl: string }) {
  return createPortalSession({ organizationId: input.organizationId, returnUrl: input.returnUrl, product: ORG_SEATS_SUBSCRIPTION_TYPE })
}

async function createPortalSession(input: { organizationId: OrgId; returnUrl: string; product: BillingProduct }) {
  const row = await findSubscriptionByOrg(input.organizationId, input.product)
  if (!row?.stripe_customer_id) {
    throw new Error("stripe_customer_missing")
  }
  return stripe().billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: input.returnUrl,
  })
}

function productEnabled(product: BillingProduct) {
  if (env.stripe.billingProvider === "disabled") return false
  return product === ORG_SEATS_SUBSCRIPTION_TYPE ? env.stripe.orgSeatsEnabled : env.stripe.inferenceEnabled
}

function productConfigured(product: BillingProduct) {
  if (!productEnabled(product)) return false
  if (env.stripe.billingProvider === "disabled") return false
  if (env.stripe.billingProvider === "simulated") return true
  return Boolean(env.stripe.secretKey && (product === ORG_SEATS_SUBSCRIPTION_TYPE ? env.stripe.orgSeatsPriceId : env.stripe.inferencePriceId))
}

function productUnitAmount(product: BillingProduct) {
  return product === ORG_SEATS_SUBSCRIPTION_TYPE ? 2000 : 1000
}

function serializeSubscription(row: Awaited<ReturnType<typeof findSubscriptionByOrg>>) {
  return row ? {
    id: row.id,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    quantity: row.quantity,
    currentPeriodStart: row.current_period_start?.toISOString() ?? null,
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  } : null
}

async function getBillingProductSummary(input: { organizationId: OrgId; product: BillingProduct; includePortalUrl?: boolean; returnUrl: string }) {
  const row = await findSubscriptionByOrg(input.organizationId, input.product)
  const usedSeats = await activeMemberCount(input.organizationId)
  const hasActiveSubscription = Boolean(row && ACTIVE_STATUSES.has(row.status))
  let portalUrl: string | null = null
  if (input.includePortalUrl && row?.stripe_customer_id && env.stripe.billingProvider === "stripe") {
    try {
      portalUrl = (await createPortalSession({ organizationId: input.organizationId, returnUrl: input.returnUrl, product: input.product })).url
    } catch (error) {
      console.warn(`[stripe-billing] failed to create ${input.product} billing portal session`, error)
    }
  }

  return {
    enabled: productEnabled(input.product),
    configured: productConfigured(input.product),
    provider: env.stripe.billingProvider,
    priceId: input.product === ORG_SEATS_SUBSCRIPTION_TYPE ? env.stripe.orgSeatsPriceId ?? null : env.stripe.inferencePriceId ?? null,
    unitAmount: productUnitAmount(input.product),
    currency: "usd",
    interval: "month",
    usedSeats,
    purchasedSeats: input.product === ORG_SEATS_SUBSCRIPTION_TYPE && row ? row.quantity : null,
    memberCount: usedSeats,
    hasActiveSubscription,
    portalUrl,
    enforceSeats: input.product === ORG_SEATS_SUBSCRIPTION_TYPE && env.stripe.enforcementEnabled && productConfigured(input.product),
    subscription: serializeSubscription(row),
  }
}

export async function getOrgBillingSummary(input: { organizationId: OrgId; includePortalUrl?: boolean; returnUrl: string }) {
  const inference = await getBillingProductSummary({ ...input, product: INFERENCE_SUBSCRIPTION_TYPE })
  const orgSeats = await getBillingProductSummary({ ...input, product: ORG_SEATS_SUBSCRIPTION_TYPE })

  return {
    provider: env.stripe.billingProvider,
    products: { inference, orgSeats },
    stripe: inference,
  }
}

export async function getOrgSeatEntitlement(organizationId: OrgId) {
  const orgSeats = await getBillingProductSummary({ organizationId, product: ORG_SEATS_SUBSCRIPTION_TYPE, returnUrl: "" })
  if (!orgSeats.enforceSeats) {
    return { allowed: true, reason: "billing_not_enforced" as const, ...orgSeats }
  }
  if (!orgSeats.hasActiveSubscription) {
    return { allowed: false, reason: "subscription_inactive" as const, ...orgSeats }
  }
  if (orgSeats.purchasedSeats !== null && orgSeats.usedSeats >= orgSeats.purchasedSeats) {
    return { allowed: false, reason: "seat_limit_reached" as const, ...orgSeats }
  }
  return { allowed: true, reason: "has_available_seat" as const, ...orgSeats }
}

export async function upsertSimulatedSubscription(input: { organizationId: OrgId; orgMemberId: MemberId | null; product: BillingProduct; quantity: number; status: OrgSubscriptionStatusValue }) {
  if (env.stripe.billingProvider !== "simulated") {
    throw new Error("billing_simulator_disabled")
  }
  const now = new Date()
  const values = {
    id: createDenTypeId("orgSubscription"),
    organization_id: input.organizationId,
    created_by_org_membership_id: input.orgMemberId,
    type: input.product,
    status: input.status,
    stripe_customer_id: `sim_cus_${input.organizationId}`,
    stripe_subscription_id: `sim_sub_${input.organizationId}_${input.product}`,
    stripe_price_id: input.product === ORG_SEATS_SUBSCRIPTION_TYPE ? "sim_org_seats" : "sim_inference",
    stripe_subscription_item_id: `sim_item_${input.organizationId}_${input.product}`,
    quantity: Math.max(1, input.quantity),
    current_period_start: now,
    current_period_end: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
    cancel_at_period_end: false,
    canceled_at: input.status === "canceled" ? now : null,
    ended_at: null,
    last_event_id: `sim_evt_${Date.now()}`,
    created_at: now,
    updated_at: now,
  }
  await db.insert(OrgSubscriptionTable).values(values).onDuplicateKeyUpdate({
    set: {
      created_by_org_membership_id: values.created_by_org_membership_id,
      status: values.status,
      stripe_customer_id: values.stripe_customer_id,
      stripe_subscription_id: values.stripe_subscription_id,
      stripe_price_id: values.stripe_price_id,
      stripe_subscription_item_id: values.stripe_subscription_item_id,
      quantity: values.quantity,
      current_period_start: values.current_period_start,
      current_period_end: values.current_period_end,
      cancel_at_period_end: values.cancel_at_period_end,
      canceled_at: values.canceled_at,
      ended_at: values.ended_at,
      last_event_id: values.last_event_id,
      updated_at: now,
    },
  })
  return findSubscriptionByOrg(input.organizationId, input.product)
}

export async function syncInferenceSubscriptionQuantityAfterMemberChange(input: { organizationId: OrgId; memberCount: number }) {
  const row = await findInferenceSubscriptionByOrg(input.organizationId)
  if (!row || !ACTIVE_STATUSES.has(row.status) || !row.stripe_subscription_item_id) {
    return
  }

  const quantity = Math.max(1, input.memberCount)
  await stripe().subscriptionItems.update(row.stripe_subscription_item_id, {
    quantity,
    proration_behavior: "always_invoice",
  })
}

export async function handleStripeWebhook(input: { payload: string; signature: string | null }) {
  if (!env.stripe.webhookSecret) {
    throw new Error("stripe_webhook_secret_missing")
  }
  if (!input.signature) {
    throw new Error("stripe_signature_missing")
  }

  const event = stripe().webhooks.constructEvent(input.payload, input.signature, env.stripe.webhookSecret)
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      if (typeof session.subscription === "string") {
        const subscription = await stripe().subscriptions.retrieve(session.subscription)
        await upsertInferenceSubscriptionFromStripe(subscription, event.id)
        const metadata = getSubscriptionMetadata(subscription)
        if (metadata.subscriptionType === INFERENCE_SUBSCRIPTION_TYPE && metadata.organizationId && ACTIVE_STATUSES.has(subscriptionStatus(subscription.status))) {
          await setInferenceEnabled({ organizationId: metadata.organizationId as OrgId, enabled: true })
        }
      }
      break
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await upsertInferenceSubscriptionFromStripe(event.data.object as Stripe.Subscription, event.id)
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const subscriptionId = typeof (invoice as Stripe.Invoice & { subscription?: unknown }).subscription === "string"
        ? (invoice as Stripe.Invoice & { subscription: string }).subscription
        : null
      if (subscriptionId) {
        const row = await findInferenceSubscriptionByStripeId(subscriptionId)
        if (row) {
          await db
            .update(OrgSubscriptionTable)
            .set({ status: "expired", last_event_id: event.id, updated_at: new Date() })
            .where(eq(OrgSubscriptionTable.id, row.id))
          if (row.type === INFERENCE_SUBSCRIPTION_TYPE) {
            await setInferenceEnabled({ organizationId: row.organization_id, enabled: false })
          }
        }
      }
      break
    }
  }

  return { received: true, type: event.type }
}
