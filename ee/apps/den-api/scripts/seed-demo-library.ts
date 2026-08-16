/**
 * Fills the Library surfaces with sample data.
 *
 * The Library overview has four cards — Connections, Models, Skills, Plugins —
 * and a given local org usually has only some of them populated. This script
 * tops up whichever are empty, with enough rows in enough states that every
 * status colour and the "Show more" affordance are visible.
 *
 * Additive by default: it never deletes anything, and it skips rows that
 * already exist (matched by name). Pass --reset to remove what it previously
 * seeded and start clean.
 *
 * Usage:
 *   pnpm dev:den:seed-library                       # default org
 *   DEN_DEMO_ORG_SLUG=acme-robotics-demo pnpm dev:den:seed-library
 *   pnpm dev:den:seed-library -- --reset
 */
import { and, eq, inArray } from "@openwork-ee/den-db/drizzle"
import {
  ConfigObjectTable,
  ConfigObjectVersionTable,
  ExternalMcpConnectionAccessGrantTable,
  ExternalMcpConnectionTable,
  LlmProviderAccessTable,
  LlmProviderModelTable,
  LlmProviderTable,
  MemberTable,
  OrgOAuthClientTable,
  OrganizationTable,
  PluginConfigObjectTable,
  PluginTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../src/db.js"

const ORG_SLUG = process.env.DEN_DEMO_ORG_SLUG?.trim() || "default"
const RESET_MODE = process.argv.includes("--reset")
/** Marks rows this script owns, so --reset can remove exactly those. */
const SEED_TAG = "[sample]"

/**
 * Connection states are derived, not stored. This is how each is reached:
 *
 * - "signin"  per-member OAuth with no connected account for the caller.
 * - "ready"   shared credential that is actually present.
 * - "admin"   shared credential mode with nothing configured yet.
 *
 * There is deliberately no "available" case: with only `shared` and
 * `per_member` credential modes every connection resolves to one of the three
 * above, so the blue dot is currently unreachable in the product.
 */
type ConnectionState = "signin" | "ready" | "admin"

const CONNECTIONS: readonly { name: string; url: string; state: ConnectionState }[] = [
  { name: "Linear", url: "https://mcp.linear.app/mcp", state: "signin" },
  { name: "Notion", url: "https://mcp.notion.com/mcp", state: "signin" },
  { name: "Slack", url: "https://slack.com/mcp", state: "signin" },
  { name: "GitHub", url: "https://api.githubcopilot.com/mcp", state: "signin" },
  { name: "Figma", url: "https://figma.com/mcp", state: "signin" },
  { name: "Asana", url: "https://mcp.asana.com/mcp", state: "signin" },
  { name: "Atlassian Jira", url: "https://mcp.atlassian.com/mcp", state: "signin" },
  { name: "Intercom", url: "https://mcp.intercom.com/mcp", state: "signin" },
  { name: "HubSpot", url: "https://mcp.hubspot.com/mcp", state: "signin" },
  { name: "Airtable", url: "https://airtable.com/mcp", state: "signin" },
  { name: "Zendesk", url: "https://zendesk.com/mcp", state: "signin" },
  { name: "Vercel", url: "https://mcp.vercel.com/mcp", state: "signin" },
  { name: "Sentry", url: "https://mcp.sentry.dev/mcp", state: "ready" },
  { name: "Context7", url: "https://context7.com/mcp", state: "ready" },
  { name: "Stripe", url: "https://mcp.stripe.com", state: "ready" },
  { name: "Exa", url: "https://exa.ai/mcp", state: "ready" },
  { name: "Cloudflare", url: "https://cloudflare.com/mcp", state: "ready" },
  { name: "PagerDuty", url: "https://pagerduty.com/mcp", state: "admin" },
  { name: "Snowflake", url: "https://snowflake.com/mcp", state: "admin" },
]

const PROVIDERS: readonly {
  source: "models_dev" | "custom" | "openwork"
  providerId: string
  name: string
  doc: string | null
  models: { id: string; name: string }[]
}[] = [
  // Source "openwork" never stores model rows; the card expands it from the
  // shared inference alias table instead.
  { source: "openwork", providerId: "openwork", name: "OpenWork Models", doc: null, models: [] },
  {
    source: "models_dev",
    providerId: "anthropic",
    name: "Anthropic",
    doc: "https://docs.anthropic.com/en/docs/about-claude/models",
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    source: "models_dev",
    providerId: "openai",
    name: "OpenAI",
    doc: "https://platform.openai.com/docs/models",
    models: [
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.2-mini", name: "GPT-5.2 mini" },
      { id: "o4-mini", name: "o4-mini" },
    ],
  },
  {
    source: "models_dev",
    providerId: "google",
    name: "Google Gemini",
    doc: "https://ai.google.dev/gemini-api/docs/models",
    models: [
      { id: "gemini-3-pro", name: "Gemini 3 Pro" },
      { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    ],
  },
  {
    source: "custom",
    providerId: "acme-gateway",
    name: "Internal Model Gateway",
    doc: "https://gateway.internal.test/docs",
    // A custom provider is opaque to the card: it collapses to one tile named
    // by its configuration, so its model rows never surface individually.
    models: [{ id: "internal-router", name: "Internal Router" }],
  },
]

const SKILLS: readonly { title: string; description: string }[] = [
  { title: "Summarise a meeting", description: "Turn a transcript into decisions, owners, and next steps." },
  { title: "Draft a release note", description: "Write a changelog entry from merged pull requests." },
  { title: "Triage an incident", description: "Collect signals, propose a severity, and draft the update." },
  { title: "Review a contract", description: "Flag unusual terms and summarise obligations." },
  { title: "Prepare a QBR", description: "Assemble usage, risks, and expansion notes for an account." },
  { title: "Answer a security questionnaire", description: "Draft answers from the current policy set." },
  { title: "Write a bug report", description: "Turn a raw complaint into reproducible steps." },
  { title: "Plan a sprint", description: "Group open issues into a realistic two-week plan." },
  { title: "Audit access", description: "List who can reach which system and highlight outliers." },
  { title: "Draft a customer reply", description: "Answer in the account's tone with the right context." },
  { title: "Refresh onboarding docs", description: "Bring a runbook in line with the current product." },
  { title: "Compare vendors", description: "Build a decision table from pricing and security pages." },
]

async function main() {
  const [organization] = await db
    .select()
    .from(OrganizationTable)
    .where(eq(OrganizationTable.slug, ORG_SLUG))
    .limit(1)
  if (!organization) throw new Error(`No organization with slug "${ORG_SLUG}".`)

  const [actor] = await db
    .select()
    .from(MemberTable)
    .where(and(eq(MemberTable.organizationId, organization.id), eq(MemberTable.role, "owner")))
    .limit(1)
  const [fallbackActor] = actor
    ? []
    : await db.select().from(MemberTable).where(eq(MemberTable.organizationId, organization.id)).limit(1)
  const owner = actor ?? fallbackActor
  if (!owner) throw new Error(`Organization "${ORG_SLUG}" has no members.`)

  const organizationId = organization.id
  const createdByOrgMembershipId = owner.id

  if (RESET_MODE) {
    const seeded = await db
      .select({ id: ExternalMcpConnectionTable.id })
      .from(ExternalMcpConnectionTable)
      .where(and(
        eq(ExternalMcpConnectionTable.organizationId, organizationId),
        eq(ExternalMcpConnectionTable.createdByOrgMembershipId, createdByOrgMembershipId),
      ))
    const seededIds = seeded.map((row) => row.id)
    if (seededIds.length > 0) {
      await db
        .delete(ExternalMcpConnectionAccessGrantTable)
        .where(inArray(ExternalMcpConnectionAccessGrantTable.externalMcpConnectionId, seededIds))
      await db.delete(OrgOAuthClientTable).where(inArray(OrgOAuthClientTable.providerId, seededIds))
      await db.delete(ExternalMcpConnectionTable).where(inArray(ExternalMcpConnectionTable.id, seededIds))
    }
    const providers = await db
      .select({ id: LlmProviderTable.id })
      .from(LlmProviderTable)
      .where(eq(LlmProviderTable.organizationId, organizationId))
    if (providers.length > 0) {
      const providerIds = providers.map((row) => row.id)
      await db.delete(LlmProviderModelTable).where(inArray(LlmProviderModelTable.llmProviderId, providerIds))
      await db.delete(LlmProviderAccessTable).where(inArray(LlmProviderAccessTable.llmProviderId, providerIds))
      await db.delete(LlmProviderTable).where(inArray(LlmProviderTable.id, providerIds))
    }
  }

  // ── Connections ──
  const existingConnections = await db
    .select({ name: ExternalMcpConnectionTable.name })
    .from(ExternalMcpConnectionTable)
    .where(eq(ExternalMcpConnectionTable.organizationId, organizationId))
  const connectionNames = new Set(existingConnections.map((row) => row.name))
  let addedConnections = 0

  for (const connection of CONNECTIONS) {
    if (connectionNames.has(connection.name)) continue
    const id = createDenTypeId("externalMcpConnection")
    const shared = connection.state !== "signin"
    await db.insert(ExternalMcpConnectionTable).values({
      id,
      organizationId,
      name: connection.name,
      url: connection.url,
      kind: "external_mcp",
      authType: connection.state === "signin" ? "oauth" : "apikey",
      credentialMode: shared ? "shared" : "per_member",
      // A shared credential that is present is what makes a row "ready"; a
      // shared connection with nothing configured is what waits on an admin.
      apiKey: connection.state === "ready" ? `sample-key-${id}` : null,
      connectedAt: connection.state === "ready" ? new Date() : null,
      createdByOrgMembershipId,
    })
    await db.insert(ExternalMcpConnectionAccessGrantTable).values({
      id: createDenTypeId("externalMcpConnectionAccessGrant"),
      organizationId,
      externalMcpConnectionId: id,
      orgWide: true,
      createdByOrgMembershipId,
    })
    addedConnections += 1
  }

  // A native provider only appears once its org OAuth client exists.
  if (!connectionNames.has("Google Workspace")) {
    const googleId = createDenTypeId("externalMcpConnection")
    await db.insert(ExternalMcpConnectionTable).values({
      id: googleId,
      organizationId,
      name: "Google Workspace",
      url: "https://workspace.google.com",
      kind: "native_provider",
      nativeProviderKey: "google-workspace",
      authType: "oauth",
      credentialMode: "per_member",
      createdByOrgMembershipId,
    })
    await db.insert(ExternalMcpConnectionAccessGrantTable).values({
      id: createDenTypeId("externalMcpConnectionAccessGrant"),
      organizationId,
      externalMcpConnectionId: googleId,
      orgWide: true,
      createdByOrgMembershipId,
    })
    await db.insert(OrgOAuthClientTable).values({
      id: createDenTypeId("orgOAuthClient"),
      organizationId,
      providerId: googleId,
      clientId: "sample-google-workspace-client",
      clientSecret: "sample-google-workspace-secret",
      createdByOrgMembershipId,
    })
    addedConnections += 1
  }

  // ── Models ──
  const existingProviders = await db
    .select({ providerId: LlmProviderTable.providerId })
    .from(LlmProviderTable)
    .where(eq(LlmProviderTable.organizationId, organizationId))
  const providerKeys = new Set(existingProviders.map((row) => row.providerId))
  let addedProviders = 0

  for (const provider of PROVIDERS) {
    if (providerKeys.has(provider.providerId)) continue
    const id = createDenTypeId("llmProvider")
    await db.insert(LlmProviderTable).values({
      id,
      organizationId,
      createdByOrgMembershipId,
      source: provider.source,
      providerId: provider.providerId,
      name: provider.name,
      providerConfig: provider.doc ? { doc: provider.doc } : {},
      apiKey: provider.source === "openwork" ? null : `sample-provider-key-${id}`,
    })
    for (const model of provider.models) {
      await db.insert(LlmProviderModelTable).values({
        id: createDenTypeId("llmProviderModel"),
        llmProviderId: id,
        modelId: model.id,
        name: model.name,
        modelConfig: {},
      })
    }
    // Both target columns null means org-wide, so every member sees it.
    await db.insert(LlmProviderAccessTable).values({
      id: createDenTypeId("llmProviderAccess"),
      llmProviderId: id,
      orgMembershipId: null,
      teamId: null,
    })
    addedProviders += 1
  }

  // ── Skills ──
  // Skills are config objects that hang off a plugin: attaching them also gives
  // the plugin rows their per-kind badges.
  const existingSkills = await db
    .select({ title: ConfigObjectTable.title })
    .from(ConfigObjectTable)
    .where(and(
      eq(ConfigObjectTable.organizationId, organizationId),
      eq(ConfigObjectTable.objectType, "skill"),
    ))
  const skillTitles = new Set(existingSkills.map((row) => row.title))

  const plugins = await db
    .select({ id: PluginTable.id })
    .from(PluginTable)
    .where(and(eq(PluginTable.organizationId, organizationId), eq(PluginTable.status, "active")))
  let hostPluginId = plugins[0]?.id ?? null
  if (!hostPluginId) {
    hostPluginId = createDenTypeId("plugin")
    await db.insert(PluginTable).values({
      id: hostPluginId,
      organizationId,
      name: `Everyday Toolkit ${SEED_TAG}`,
      description: "Sample skills for the library.",
      status: "active",
      createdByOrgMembershipId,
    })
  }

  let addedSkills = 0
  for (const [index, skill] of SKILLS.entries()) {
    if (skillTitles.has(skill.title)) continue
    const configObjectId = createDenTypeId("configObject")
    await db.insert(ConfigObjectTable).values({
      id: configObjectId,
      organizationId,
      objectType: "skill",
      sourceMode: "cloud",
      title: skill.title,
      description: skill.description,
      status: "active",
      createdByOrgMembershipId,
    })
    await db.insert(ConfigObjectVersionTable).values({
      id: createDenTypeId("configObjectVersion"),
      organizationId,
      configObjectId,
      rawSourceText: `---\nname: ${skill.title}\ndescription: ${skill.description}\n---\n\n${skill.description}\n`,
      normalizedPayloadJson: { name: skill.title, description: skill.description },
      createdVia: "cloud",
      createdByOrgMembershipId,
    })
    // Spread the skills over the first few plugins so badges vary.
    const pluginId = plugins.length > 0
      ? plugins[index % Math.min(plugins.length, 4)].id
      : hostPluginId
    await db.insert(PluginConfigObjectTable).values({
      id: createDenTypeId("pluginConfigObject"),
      organizationId,
      pluginId,
      configObjectId,
      membershipSource: "manual",
      createdByOrgMembershipId,
    })
    addedSkills += 1
  }

  console.log(`Organization: ${organization.name} (${organization.slug})`)
  console.log(`  connections added: ${addedConnections}`)
  console.log(`  providers added:   ${addedProviders}`)
  console.log(`  skills added:      ${addedSkills}`)
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
