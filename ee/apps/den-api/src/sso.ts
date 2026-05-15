import { and, eq } from "@openwork-ee/den-db/drizzle"
import { SsoConnectionTable, SsoProviderTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { auth } from "./auth.js"
import { db } from "./db.js"
import { env } from "./env.js"

type SsoConnection = typeof SsoConnectionTable.$inferSelect
type OrganizationId = SsoConnection["organizationId"]

type SamlRegistrationInput = {
  kind: "saml"
  issuer: string
  domain: string
  entryPoint: string
  cert: string
  audience?: string | null
  wantAssertionsSigned?: boolean | null
  authnRequestsSigned?: boolean | null
}

type OidcRegistrationInput = {
  kind: "oidc"
  issuer: string
  domain: string
  clientId: string
  clientSecret: string
  scopes?: string[] | null
  skipDiscovery?: boolean | null
  authorizationEndpoint?: string | null
  tokenEndpoint?: string | null
  jwksEndpoint?: string | null
  userInfoEndpoint?: string | null
}

export type OrganizationSsoRegistrationInput = (SamlRegistrationInput | OidcRegistrationInput) & {
  organizationId: OrganizationId
  organizationSlug: string
  headers: Headers
}

export function buildOrganizationSsoProviderId(organizationId: OrganizationId) {
  return `openwork-sso-${organizationId}`
}

export function getOrganizationSsoSignInPath(organizationSlug: string) {
  return `/sso/${encodeURIComponent(organizationSlug)}`
}

export function getSsoAcsUrl(providerId: string) {
  return `${env.betterAuthUrl}/api/auth/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`
}

export function getSsoMetadataUrl(providerId: string) {
  return `${env.betterAuthUrl}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`
}

export function getSsoOidcRedirectUrl(providerId: string) {
  return `${env.betterAuthUrl}/api/auth/sso/callback/${encodeURIComponent(providerId)}`
}

export async function getOrganizationSsoConnection(organizationId: OrganizationId) {
  const rows = await db
    .select()
    .from(SsoConnectionTable)
    .where(eq(SsoConnectionTable.organizationId, organizationId))
    .limit(1)

  return rows[0] ?? null
}

export async function deleteOrganizationSsoConnection(organizationId: OrganizationId) {
  const connection = await getOrganizationSsoConnection(organizationId)
  if (!connection) {
    return false
  }

  await db.delete(SsoConnectionTable).where(eq(SsoConnectionTable.id, connection.id))
  await db.delete(SsoProviderTable).where(eq(SsoProviderTable.providerId, connection.providerId))
  return true
}

export async function registerOrganizationSsoConnection(input: OrganizationSsoRegistrationInput) {
  const providerId = buildOrganizationSsoProviderId(input.organizationId)
  await deleteOrganizationSsoConnection(input.organizationId)

  const common = {
    providerId,
    issuer: input.issuer,
    domain: input.domain,
    organizationId: input.organizationId,
  }

  if (input.kind === "saml") {
    await auth.api.registerSSOProvider({
      body: {
        ...common,
        samlConfig: {
          entryPoint: input.entryPoint,
          cert: input.cert,
          callbackUrl: getSsoAcsUrl(providerId),
          audience: input.audience || env.betterAuthUrl,
          wantAssertionsSigned: input.wantAssertionsSigned ?? true,
          authnRequestsSigned: input.authnRequestsSigned ?? false,
          spMetadata: {},
          mapping: {
            id: "nameID",
            email: "email",
            name: "displayName",
            extraFields: {
              department: "department",
              role: "role",
              groups: "groups",
            },
          },
        },
      },
      headers: input.headers,
    })
  } else {
    await auth.api.registerSSOProvider({
      body: {
        ...common,
        oidcConfig: {
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          skipDiscovery: input.skipDiscovery ?? false,
          authorizationEndpoint: input.authorizationEndpoint ?? undefined,
          tokenEndpoint: input.tokenEndpoint ?? undefined,
          jwksEndpoint: input.jwksEndpoint ?? undefined,
          userInfoEndpoint: input.userInfoEndpoint ?? undefined,
          scopes: input.scopes ?? ["openid", "email", "profile"],
          pkce: true,
          mapping: {
            id: "sub",
            email: "email",
            emailVerified: "email_verified",
            name: "name",
            image: "picture",
            extraFields: {
              department: "department",
              role: "role",
              groups: "groups",
            },
          },
        },
      },
      headers: input.headers,
    })
  }

  await db.insert(SsoConnectionTable).values({
    id: createDenTypeId("ssoConnection"),
    organizationId: input.organizationId,
    providerId,
    kind: input.kind,
    issuer: input.issuer,
    domain: input.domain,
    status: "enabled",
    signInPath: getOrganizationSsoSignInPath(input.organizationSlug),
    lastTestedAt: new Date(),
    lastError: null,
  })

  const connection = await getOrganizationSsoConnection(input.organizationId)
  if (!connection) {
    throw new Error("SSO connection was created, but could not be loaded.")
  }

  return connection
}

export async function startOrganizationSsoSignIn(input: {
  organizationSlug: string
  callbackURL: string
  loginHint?: string | null
}) {
  return auth.api.signInSSO({
    body: {
      organizationSlug: input.organizationSlug,
      callbackURL: input.callbackURL,
      loginHint: input.loginHint || undefined,
    },
  })
}

export async function getSsoProviderForConnection(connection: SsoConnection) {
  const rows = await db
    .select()
    .from(SsoProviderTable)
    .where(and(
      eq(SsoProviderTable.providerId, connection.providerId),
      eq(SsoProviderTable.organizationId, connection.organizationId),
    ))
    .limit(1)

  return rows[0] ?? null
}
