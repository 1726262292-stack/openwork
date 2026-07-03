import type { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { env } from "../../env.js"
import { jsonValidator, orgMemberRoute } from "../../middleware/index.js"
import { jsonResponse, unauthorizedSchema } from "../../openapi.js"
import { buildGmailDraftRaw, readGmailDraftIds } from "../../capability-sources/gmail.js"
import { getValidAccessToken } from "../../capability-sources/generic-oauth.js"
import { getNativeOAuthProvider } from "../../capability-sources/provider-registry.js"
import type { OrgRouteVariables } from "./shared.js"

const createDraftBodySchema = z.object({
  to: z.string().trim().min(3).max(320).describe("Recipient email address."),
  subject: z.string().trim().min(1).max(500).describe("Draft subject line."),
  body: z.string().min(1).max(50_000).describe("Plain-text draft body."),
})

const createDraftResponseSchema = z.object({
  ok: z.literal(true),
  draftId: z.string(),
  messageId: z.string().nullable(),
  to: z.string(),
  subject: z.string(),
}).meta({ ref: "GoogleWorkspaceDraftResponse" })

const needsConnectionSchema = z.object({
  error: z.literal("needs_connection"),
  message: z.string(),
}).meta({ ref: "GoogleWorkspaceNeedsConnectionError" })

const upstreamErrorSchema = z.object({
  error: z.literal("google_api_error"),
  message: z.string(),
}).meta({ ref: "GoogleWorkspaceUpstreamError" })

function gmailApiBase(): string {
  return (env.googleApiBaseUrl ?? "https://gmail.googleapis.com").replace(/\/+$/, "")
}

/**
 * Native Google Workspace capabilities, executed by Den with the calling
 * member Den-brokered credential (getValidAccessToken). Tagged
 * "Capability Sources" so search_capabilities/execute_capability discover
 * them — the agent path needs no MCP server and no extra wiring.
 */
export function registerGoogleWorkspaceRoutes<T extends { Variables: OrgRouteVariables }>(app: Hono<T>) {
  app.post(
    "/v1/capabilities/google-workspace/gmail-drafts",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "Create a Gmail draft as the calling member",
      description: "Creates a plain-text Gmail draft in the calling member own mailbox, using the Google account they connected through the org Google Workspace connection. Returns needs_connection when the member has not connected their Google account yet.",
      responses: {
        200: jsonResponse("Draft created.", createDraftResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Google account.", needsConnectionSchema),
        502: jsonResponse("Google rejected the request.", upstreamErrorSchema),
      },
    }),
    orgMemberRoute(),
    jsonValidator(createDraftBodySchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const provider = getNativeOAuthProvider("google-workspace")
      if (!provider) {
        return c.json({ error: "google_api_error" as const, message: "google-workspace provider is not registered." }, 502)
      }

      const token = await getValidAccessToken({
        provider,
        organizationId: payload.organization.id,
        orgMembershipId: payload.currentMember.id,
      })
      if ("error" in token) {
        return c.json({
          error: "needs_connection" as const,
          message: "Connect your Google account first: open Settings, then Extensions, and use Connect your account on the Google Workspace card.",
        }, 409)
      }

      const { to, subject, body } = c.req.valid("json")
      const response = await fetch(`${gmailApiBase()}/gmail/v1/users/me/drafts`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: { raw: buildGmailDraftRaw({ to, subject, body }) } }),
      })
      const text = await response.text()
      if (!response.ok) {
        return c.json({ error: "google_api_error" as const, message: `Gmail draft create failed: ${response.status} ${text.slice(0, 300)}` }, 502)
      }

      const { draftId, messageId } = readGmailDraftIds(text)
      if (!draftId) {
        return c.json({ error: "google_api_error" as const, message: "Gmail returned no draft id." }, 502)
      }

      return c.json({ ok: true as const, draftId, messageId, to, subject })
    },
  )
}
