import type { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { auth } from "../../auth.js"
import { env } from "../../env.js"
import {
  deleteOrganizationSsoConnection,
  getOrganizationSsoConnection,
  getOrganizationSsoSignInPath,
  getSsoAcsUrl,
  getSsoMetadataUrl,
  getSsoOidcRedirectUrl,
  getSsoProviderForConnection,
  registerOrganizationSsoConnection,
} from "../../sso.js"
import { requireUserMiddleware, resolveOrganizationContextMiddleware } from "../../middleware/index.js"
import type { OrgRouteVariables } from "./shared.js"
import { ensureSsoManager } from "./shared.js"

const invalidRequestSchema = z.object({
  error: z.literal("invalid_request"),
  details: z.array(z.object({
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
  }).passthrough()),
}).meta({ ref: "SsoInvalidRequestError" })

const unauthorizedSchema = z.object({
  error: z.literal("unauthorized"),
}).meta({ ref: "SsoUnauthorizedError" })

const organizationNotFoundSchema = z.object({
  error: z.literal("organization_not_found"),
}).meta({ ref: "SsoOrganizationNotFoundError" })

const forbiddenSchema = z.object({
  error: z.literal("forbidden"),
  message: z.string(),
}).meta({ ref: "SsoForbiddenError" })

const ssoConnectionSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  kind: z.enum(["oidc", "saml"]),
  issuer: z.string().url(),
  domain: z.string(),
  status: z.string(),
  signInPath: z.string(),
  signInUrl: z.string().url(),
  redirectUrl: z.string().url(),
  acsUrl: z.string().url().nullable(),
  metadataUrl: z.string().url().nullable(),
  domainVerified: z.boolean(),
  lastTestedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).meta({ ref: "OrganizationSsoConnection" })

const ssoConnectionResponseSchema = z.object({
  connection: ssoConnectionSchema.nullable(),
}).meta({ ref: "OrganizationSsoConnectionResponse" })

const baseRegistrationSchema = z.object({
  issuer: z.string().url(),
  domain: z.string().min(1),
})

const samlRegistrationSchema = baseRegistrationSchema.extend({
  entryPoint: z.string().url(),
  cert: z.string().min(1),
  audience: z.string().url().optional(),
  wantAssertionsSigned: z.boolean().optional(),
  authnRequestsSigned: z.boolean().optional(),
}).meta({ ref: "RegisterOrganizationSamlSsoBody" })

const oidcRegistrationSchema = baseRegistrationSchema.extend({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  skipDiscovery: z.boolean().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  jwksEndpoint: z.string().url().optional(),
  userInfoEndpoint: z.string().url().optional(),
}).meta({ ref: "RegisterOrganizationOidcSsoBody" })

const metadataQuerySchema = z.object({
  format: z.enum(["xml", "json"]).default("xml"),
}).meta({ ref: "OrganizationSsoMetadataQuery" })

const domainVerificationResponseSchema = z.object({
  domainVerificationToken: z.string().min(1),
}).meta({ ref: "OrganizationSsoDomainVerificationResponse" })

function serializeConnection(input: {
  connection: NonNullable<Awaited<ReturnType<typeof getOrganizationSsoConnection>>>
  signInUrl: string
  redirectUrl: string
  acsUrl: string | null
  metadataUrl: string | null
  domainVerified: boolean
}) {
  const { connection, signInUrl, redirectUrl, acsUrl, metadataUrl, domainVerified } = input
  return {
    id: connection.id,
    providerId: connection.providerId,
    kind: connection.kind === "saml" ? "saml" : "oidc",
    issuer: connection.issuer,
    domain: connection.domain,
    status: connection.status,
    signInPath: connection.signInPath,
    signInUrl,
    redirectUrl,
    acsUrl,
    metadataUrl,
    domainVerified,
    lastTestedAt: connection.lastTestedAt ? connection.lastTestedAt.toISOString() : null,
    lastError: connection.lastError,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  }
}

async function buildConnectionPayload(connection: NonNullable<Awaited<ReturnType<typeof getOrganizationSsoConnection>>>, origin: string) {
  const provider = await getSsoProviderForConnection(connection)
  const signInUrl = new URL(connection.signInPath || getOrganizationSsoSignInPath(""), env.betterAuthUrl).toString()
  const redirectUrl = getSsoOidcRedirectUrl(connection.providerId)
  const acsUrl = connection.kind === "saml" ? getSsoAcsUrl(connection.providerId) : null
  const metadataUrl = connection.kind === "saml" ? getSsoMetadataUrl(connection.providerId) : null
  return serializeConnection({
    connection,
    signInUrl,
    redirectUrl,
    acsUrl,
    metadataUrl,
    domainVerified: provider?.domainVerified ?? false,
  })
}

export function registerOrgSsoRoutes<T extends { Variables: OrgRouteVariables }>(app: Hono<T>) {
  app.get(
    "/v1/sso",
    describeRoute({
      tags: ["SSO"],
      summary: "Get organization SSO connection",
      description: "Returns the current organization SSO connection and setup URLs.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: "Organization SSO configuration", content: { "application/json": { schema: resolver(ssoConnectionResponseSchema) } } },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const payload = c.get("organizationContext")
      const connection = await getOrganizationSsoConnection(payload.organization.id)
      if (!connection) {
        return c.json({ connection: null })
      }

      return c.json({
        connection: await buildConnectionPayload(connection, c.req.url),
      })
    },
  )

  app.post(
    "/v1/sso/saml",
    describeRoute({
      tags: ["SSO"],
      summary: "Register organization SAML SSO",
      description: "Registers or replaces the active organization SAML SSO provider.",
      security: [{ bearerAuth: [] }],
      responses: {
        201: { description: "Organization SSO connection created", content: { "application/json": { schema: resolver(ssoConnectionResponseSchema) } } },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const parsed = samlRegistrationSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({
          error: "invalid_request",
          details: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        }, 400)
      }

      const payload = c.get("organizationContext")
      const connection = await registerOrganizationSsoConnection({
        kind: "saml",
        organizationId: payload.organization.id,
        organizationSlug: payload.organization.slug,
        headers: c.req.raw.headers,
        ...parsed.data,
      })

      return c.json({ connection: await buildConnectionPayload(connection, c.req.url) }, 201)
    },
  )

  app.post(
    "/v1/sso/oidc",
    describeRoute({
      tags: ["SSO"],
      summary: "Register organization OIDC SSO",
      description: "Registers or replaces the active organization OIDC SSO provider.",
      security: [{ bearerAuth: [] }],
      responses: {
        201: { description: "Organization SSO connection created", content: { "application/json": { schema: resolver(ssoConnectionResponseSchema) } } },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const parsed = oidcRegistrationSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({
          error: "invalid_request",
          details: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        }, 400)
      }

      const payload = c.get("organizationContext")
      const connection = await registerOrganizationSsoConnection({
        kind: "oidc",
        organizationId: payload.organization.id,
        organizationSlug: payload.organization.slug,
        headers: c.req.raw.headers,
        ...parsed.data,
      })

      return c.json({ connection: await buildConnectionPayload(connection, c.req.url) }, 201)
    },
  )

  app.delete(
    "/v1/sso",
    describeRoute({
      tags: ["SSO"],
      summary: "Delete organization SSO connection",
      description: "Deletes the active organization SSO connection.",
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: "Organization SSO connection deleted" },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const payload = c.get("organizationContext")
      await deleteOrganizationSsoConnection(payload.organization.id)
      return c.body(null, 204)
    },
  )

  app.get(
    "/v1/sso/metadata",
    describeRoute({
      tags: ["SSO"],
      summary: "Get organization SAML SP metadata",
      description: "Returns the generated Service Provider metadata for the current organization's SAML connection.",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: "SAML metadata document" },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const parsed = metadataQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return c.json({
          error: "invalid_request",
          details: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        }, 400)
      }

      const payload = c.get("organizationContext")
      const connection = await getOrganizationSsoConnection(payload.organization.id)
      if (!connection || connection.kind !== "saml") {
        return c.json({ error: "organization_not_found" }, 404)
      }

      const response = await auth.api.spMetadata({
        query: {
          providerId: connection.providerId,
          format: parsed.data.format,
        },
      })

      return response
    },
  )

  app.post(
    "/v1/sso/request-domain-verification",
    describeRoute({
      tags: ["SSO"],
      summary: "Request an SSO domain verification token",
      description: "Returns the DNS TXT verification token for the current organization's SSO provider.",
      security: [{ bearerAuth: [] }],
      responses: {
        201: { description: "Domain verification token returned", content: { "application/json": { schema: resolver(domainVerificationResponseSchema) } } },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const payload = c.get("organizationContext")
      const connection = await getOrganizationSsoConnection(payload.organization.id)
      if (!connection) {
        return c.json({ error: "organization_not_found" }, 404)
      }

      let body: { domainVerificationToken?: string } | null = null
      try {
        body = await auth.api.requestDomainVerification({
          body: { providerId: connection.providerId },
          headers: c.req.raw.headers,
        })
      } catch (error) {
        return c.json({
          error: "invalid_request",
          details: [{ message: error instanceof Error ? error.message : "Could not request a domain verification token." }],
        }, 400)
      }

      if (!body?.domainVerificationToken) {
        return c.json({
          error: "invalid_request",
          details: [{ message: "Could not request a domain verification token." }],
        }, 400)
      }

      return c.json({ domainVerificationToken: body.domainVerificationToken }, 201)
    },
  )

  app.post(
    "/v1/sso/verify-domain",
    describeRoute({
      tags: ["SSO"],
      summary: "Verify the organization SSO domain",
      description: "Checks the provider's DNS TXT record and marks the domain as verified when present.",
      security: [{ bearerAuth: [] }],
      responses: {
        204: { description: "Organization SSO domain verified" },
        400: { description: "Invalid request", content: { "application/json": { schema: resolver(invalidRequestSchema) } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: resolver(unauthorizedSchema) } } },
        403: { description: "Only workspace owners and admins can manage SSO.", content: { "application/json": { schema: resolver(forbiddenSchema) } } },
        404: { description: "Organization not found", content: { "application/json": { schema: resolver(organizationNotFoundSchema) } } },
      },
    }),
    requireUserMiddleware,
    resolveOrganizationContextMiddleware,
    async (c) => {
      const access = ensureSsoManager(c)
      if (!access.ok) {
        return c.json(access.response, access.response.error === "forbidden" ? 403 : 404)
      }

      const payload = c.get("organizationContext")
      const connection = await getOrganizationSsoConnection(payload.organization.id)
      if (!connection) {
        return c.json({ error: "organization_not_found" }, 404)
      }

      try {
        await auth.api.verifyDomain({
          body: { providerId: connection.providerId },
          headers: c.req.raw.headers,
        })
      } catch (error) {
        return c.json({
          error: "invalid_request",
          details: [{ message: error instanceof Error ? error.message : "Could not verify the SSO domain." }],
        }, 400)
      }

      return c.body(null, 204)
    },
  )
}
