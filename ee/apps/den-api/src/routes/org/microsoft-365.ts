import type { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import type { DenTypeId } from "@openwork-ee/utils/typeid"
import { env } from "../../env.js"
import { orgMemberRoute, paramValidator, queryValidator } from "../../middleware/index.js"
import { jsonResponse, unauthorizedSchema } from "../../openapi.js"
import { getValidAccessToken } from "../../capability-sources/generic-oauth.js"
import { MicrosoftGraphClient, MicrosoftGraphRequestError } from "../../capability-sources/microsoft-graph.js"
import { getOrgOAuthClient } from "../../capability-sources/oauth-credentials.js"
import { clientSelectedFeatures, getNativeOAuthProvider } from "../../capability-sources/provider-registry.js"
import type { OrgRouteVariables } from "./shared.js"

const MAIL_READ_SCOPE = "Mail.Read"
const CALENDAR_READ_SCOPE = "Calendars.Read"
const FILES_READ_SCOPE = "Files.Read"

const CONNECT_MICROSOFT_ACCOUNT_MESSAGE = "Connect your Microsoft work account first: open Settings > Connect and use Connect your account on the Microsoft 365 row, or connect from the OpenWork Cloud dashboard."

const emailAddressSchema = z.object({
  name: z.string(),
  address: z.string(),
}).meta({ ref: "Microsoft365EmailAddress" })

const mailMessageSummarySchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  subject: z.string(),
  receivedDateTime: z.string(),
  preview: z.string(),
  from: emailAddressSchema.nullable(),
  to: z.array(emailAddressSchema),
  webLink: z.string(),
  hasAttachments: z.boolean(),
}).meta({ ref: "Microsoft365MailMessageSummary" })

const mailMessageSchema = mailMessageSummarySchema.extend({
  cc: z.array(emailAddressSchema),
  body: z.string(),
  bodyContentType: z.string(),
  bodyTruncated: z.boolean(),
}).meta({ ref: "Microsoft365MailMessage" })

const mailMessagesQuerySchema = z.object({
  search: z.string().trim().min(1).max(1_000).optional().describe("Optional Outlook message search text."),
  maxResults: z.coerce.number().int().min(1).max(25).default(10).describe("Maximum messages to return, capped at 25."),
}).meta({ ref: "Microsoft365MailMessagesQuery" })

const mailMessageParamSchema = z.object({
  messageId: z.string().trim().min(1).max(512).describe("Microsoft Graph message id."),
}).meta({ ref: "Microsoft365MailMessageParams" })

const mailMessagesResponseSchema = z.object({
  ok: z.literal(true),
  messages: z.array(mailMessageSummarySchema),
}).meta({ ref: "Microsoft365MailMessagesResponse" })

const mailMessageResponseSchema = z.object({
  ok: z.literal(true),
  message: mailMessageSchema,
}).meta({ ref: "Microsoft365MailMessageResponse" })

const calendarEventsQuerySchema = z.object({
  timeMin: z.string().datetime().describe("Inclusive lower bound for event start time."),
  timeMax: z.string().datetime().describe("Exclusive upper bound for event start time."),
  maxResults: z.coerce.number().int().min(1).max(100).default(25).describe("Maximum events to return, capped at 100."),
}).meta({ ref: "Microsoft365CalendarEventsQuery" })

const calendarEventSchema = z.object({
  id: z.string(),
  subject: z.string(),
  preview: z.string(),
  start: z.string(),
  startTimeZone: z.string(),
  end: z.string(),
  endTimeZone: z.string(),
  isAllDay: z.boolean(),
  location: z.string(),
  organizer: emailAddressSchema.nullable(),
  attendees: z.array(emailAddressSchema),
  webLink: z.string(),
  onlineMeetingUrl: z.string().nullable(),
}).meta({ ref: "Microsoft365CalendarEvent" })

const calendarEventsResponseSchema = z.object({
  ok: z.literal(true),
  events: z.array(calendarEventSchema),
}).meta({ ref: "Microsoft365CalendarEventsResponse" })

const driveFilesQuerySchema = z.object({
  query: z.string().trim().min(1).max(500).describe("Text to search in OneDrive file names and content."),
  maxResults: z.coerce.number().int().min(1).max(25).default(10).describe("Maximum files to return, capped at 25."),
}).meta({ ref: "Microsoft365DriveFilesQuery" })

const driveFileParamSchema = z.object({
  itemId: z.string().trim().min(1).max(512).describe("Microsoft Graph drive item id."),
}).meta({ ref: "Microsoft365DriveFileParams" })

const driveItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nullable(),
  modifiedTime: z.string(),
  webUrl: z.string(),
  mimeType: z.string(),
  kind: z.enum(["file", "folder", "unknown"]),
}).meta({ ref: "Microsoft365DriveItem" })

const driveFilesResponseSchema = z.object({
  ok: z.literal(true),
  files: z.array(driveItemSchema),
}).meta({ ref: "Microsoft365DriveFilesResponse" })

const driveFileResponseSchema = z.object({
  ok: z.literal(true),
  file: driveItemSchema.extend({
    content: z.string().nullable(),
    contentType: z.string().nullable(),
    truncated: z.boolean(),
    contentUnavailableReason: z.enum(["folder", "file_too_large", "unsupported_content_type"]).nullable(),
  }),
}).meta({ ref: "Microsoft365DriveFileResponse" })

const needsConnectionSchema = z.object({
  error: z.literal("needs_connection"),
  message: z.string(),
}).meta({ ref: "Microsoft365NeedsConnectionError" })

const upstreamErrorSchema = z.object({
  error: z.literal("microsoft_graph_error"),
  message: z.string(),
}).meta({ ref: "Microsoft365GraphError" })

export type Microsoft365AccessToken =
  | { kind: "ok"; accessToken: string; scopes: string[] | null; enabledFeatures: string[] }
  | { kind: "needs_connection"; message: string }
  | { kind: "microsoft_graph_error"; message: string }

export type Microsoft365AccessTokenResolver = (input: {
  organizationId: DenTypeId<"organization">
  orgMembershipId: DenTypeId<"member">
}) => Promise<Microsoft365AccessToken>

export type Microsoft365RouteOptions = {
  graphBaseUrl?: string
  fetch?: typeof fetch
  resolveAccessToken?: Microsoft365AccessTokenResolver
  memberRoute?: MiddlewareHandler<{ Variables: OrgRouteVariables }>
}

async function defaultAccessTokenResolver(input: {
  organizationId: DenTypeId<"organization">
  orgMembershipId: DenTypeId<"member">
}): Promise<Microsoft365AccessToken> {
  const provider = getNativeOAuthProvider("microsoft-365")
  if (!provider) {
    return { kind: "microsoft_graph_error", message: "microsoft-365 provider is not registered." }
  }
  const client = await getOrgOAuthClient(input.organizationId, provider.providerId)
  if (!client) {
    return { kind: "needs_connection", message: CONNECT_MICROSOFT_ACCOUNT_MESSAGE }
  }
  let token: Awaited<ReturnType<typeof getValidAccessToken>>
  try {
    token = await getValidAccessToken({ provider, ...input })
  } catch (error) {
    return { kind: "microsoft_graph_error", message: error instanceof Error ? error.message : "Microsoft OAuth token refresh failed." }
  }
  if ("error" in token) {
    return { kind: "needs_connection", message: CONNECT_MICROSOFT_ACCOUNT_MESSAGE }
  }
  return {
    kind: "ok",
    accessToken: token.accessToken,
    scopes: token.account.scopes,
    enabledFeatures: clientSelectedFeatures(provider, client.extra),
  }
}

function missingScope(scopes: string[] | null, requiredScope: string): boolean {
  if (!scopes || scopes.length === 0) return false
  const required = requiredScope.toLowerCase()
  return !scopes.some((scope) => scope.toLowerCase() === required)
}

function missingPermissionMessage(label: string): string {
  return `Your connected Microsoft account is missing the ${label} permission. An admin can enable it on the Microsoft 365 connection in OpenWork Cloud -> Connections; then reconnect your account.`
}

function disabledFeatureMessage(label: string): string {
  return `The workspace administrator has disabled ${label} for the Microsoft 365 connection.`
}

function graphError(error: unknown): { error: "microsoft_graph_error"; message: string } {
  if (error instanceof MicrosoftGraphRequestError) {
    return { error: "microsoft_graph_error", message: error.message }
  }
  return {
    error: "microsoft_graph_error",
    message: error instanceof Error ? error.message : "Microsoft Graph request failed.",
  }
}

/**
 * Read-only Microsoft 365 capabilities. The default path uses the calling
 * member's delegated token from the shared native-provider vault. Tests and
 * self-host staging can inject a Graph base URL, fetch implementation, and
 * token resolver without changing production auth behavior.
 */
export function registerMicrosoft365Routes<T extends { Variables: OrgRouteVariables }>(
  app: Hono<T>,
  options: Microsoft365RouteOptions = {},
) {
  const resolveAccessToken = options.resolveAccessToken ?? defaultAccessTokenResolver
  const memberRoute = options.memberRoute ?? orgMemberRoute()

  function graphClient(accessToken: string) {
    return new MicrosoftGraphClient({
      accessToken,
      baseUrl: options.graphBaseUrl ?? env.microsoftGraphBaseUrl,
      fetch: options.fetch,
    })
  }

  app.get(
    "/v1/capabilities/microsoft-365/mail-messages",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "List or search Outlook mail as the calling member",
      description: "Reads recent Outlook messages from the calling member's connected Microsoft 365 account. This capability is delegated and read-only.",
      responses: {
        200: jsonResponse("Outlook messages returned.", mailMessagesResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Microsoft account or is missing permission.", needsConnectionSchema),
        502: jsonResponse("Microsoft Graph rejected the request.", upstreamErrorSchema),
      },
    }),
    memberRoute,
    queryValidator(mailMessagesQuerySchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const token = await resolveAccessToken({
        organizationId: payload.organization.id,
        orgMembershipId: payload.currentMember.id,
      })
      if (token.kind === "microsoft_graph_error") return c.json({ error: token.kind, message: token.message }, 502)
      if (token.kind === "needs_connection") return c.json({ error: token.kind, message: token.message }, 409)
      if (!token.enabledFeatures.includes("mailRead")) {
        return c.json({ error: "needs_connection", message: disabledFeatureMessage("Outlook mail access") }, 409)
      }
      if (missingScope(token.scopes, MAIL_READ_SCOPE)) {
        return c.json({ error: "needs_connection", message: missingPermissionMessage("Outlook mail read") }, 409)
      }

      try {
        const query = c.req.valid("query")
        const messages = await graphClient(token.accessToken).listMailMessages({
          search: query.search,
          maxResults: query.maxResults,
        })
        return c.json({ ok: true, messages })
      } catch (error) {
        return c.json(graphError(error), 502)
      }
    },
  )

  app.get(
    "/v1/capabilities/microsoft-365/mail-message/:messageId",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "Read an Outlook message as the calling member",
      description: "Reads one Outlook message and requests its body as plain text, using the calling member's delegated Microsoft 365 connection.",
      responses: {
        200: jsonResponse("Outlook message returned.", mailMessageResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Microsoft account or is missing permission.", needsConnectionSchema),
        502: jsonResponse("Microsoft Graph rejected the request.", upstreamErrorSchema),
      },
    }),
    memberRoute,
    paramValidator(mailMessageParamSchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const token = await resolveAccessToken({ organizationId: payload.organization.id, orgMembershipId: payload.currentMember.id })
      if (token.kind === "microsoft_graph_error") return c.json({ error: token.kind, message: token.message }, 502)
      if (token.kind === "needs_connection") return c.json({ error: token.kind, message: token.message }, 409)
      if (!token.enabledFeatures.includes("mailRead")) {
        return c.json({ error: "needs_connection", message: disabledFeatureMessage("Outlook mail access") }, 409)
      }
      if (missingScope(token.scopes, MAIL_READ_SCOPE)) {
        return c.json({ error: "needs_connection", message: missingPermissionMessage("Outlook mail read") }, 409)
      }

      try {
        const { messageId } = c.req.valid("param")
        return c.json({ ok: true, message: await graphClient(token.accessToken).getMailMessage(messageId) })
      } catch (error) {
        return c.json(graphError(error), 502)
      }
    },
  )

  app.get(
    "/v1/capabilities/microsoft-365/calendar-events",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "List Microsoft 365 calendar events as the calling member",
      description: "Lists the calling member's Outlook calendar events in a requested time range. This capability is delegated and read-only.",
      responses: {
        200: jsonResponse("Outlook calendar events returned.", calendarEventsResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Microsoft account or is missing permission.", needsConnectionSchema),
        502: jsonResponse("Microsoft Graph rejected the request.", upstreamErrorSchema),
      },
    }),
    memberRoute,
    queryValidator(calendarEventsQuerySchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const token = await resolveAccessToken({ organizationId: payload.organization.id, orgMembershipId: payload.currentMember.id })
      if (token.kind === "microsoft_graph_error") return c.json({ error: token.kind, message: token.message }, 502)
      if (token.kind === "needs_connection") return c.json({ error: token.kind, message: token.message }, 409)
      if (!token.enabledFeatures.includes("calendarRead")) {
        return c.json({ error: "needs_connection", message: disabledFeatureMessage("Outlook calendar access") }, 409)
      }
      if (missingScope(token.scopes, CALENDAR_READ_SCOPE)) {
        return c.json({ error: "needs_connection", message: missingPermissionMessage("Outlook calendar read") }, 409)
      }

      try {
        const query = c.req.valid("query")
        const events = await graphClient(token.accessToken).listCalendarEvents({
          start: query.timeMin,
          end: query.timeMax,
          maxResults: query.maxResults,
        })
        return c.json({ ok: true, events })
      } catch (error) {
        return c.json(graphError(error), 502)
      }
    },
  )

  app.get(
    "/v1/capabilities/microsoft-365/drive-files",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "Search OneDrive files as the calling member",
      description: "Searches the calling member's OneDrive by name and content, returning source links. This capability is delegated and read-only.",
      responses: {
        200: jsonResponse("OneDrive files returned.", driveFilesResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Microsoft account or is missing permission.", needsConnectionSchema),
        502: jsonResponse("Microsoft Graph rejected the request.", upstreamErrorSchema),
      },
    }),
    memberRoute,
    queryValidator(driveFilesQuerySchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const token = await resolveAccessToken({ organizationId: payload.organization.id, orgMembershipId: payload.currentMember.id })
      if (token.kind === "microsoft_graph_error") return c.json({ error: token.kind, message: token.message }, 502)
      if (token.kind === "needs_connection") return c.json({ error: token.kind, message: token.message }, 409)
      if (!token.enabledFeatures.includes("filesRead")) {
        return c.json({ error: "needs_connection", message: disabledFeatureMessage("OneDrive access") }, 409)
      }
      if (missingScope(token.scopes, FILES_READ_SCOPE)) {
        return c.json({ error: "needs_connection", message: missingPermissionMessage("OneDrive read") }, 409)
      }

      try {
        const query = c.req.valid("query")
        const files = await graphClient(token.accessToken).searchDriveItems({ query: query.query, maxResults: query.maxResults })
        return c.json({ ok: true, files })
      } catch (error) {
        return c.json(graphError(error), 502)
      }
    },
  )

  app.get(
    "/v1/capabilities/microsoft-365/drive-file/:itemId",
    describeRoute({
      tags: ["Capability Sources"],
      summary: "Read a OneDrive text file as the calling member",
      description: "Returns OneDrive metadata, source link, and bounded UTF-8 text content. Folders, large files, and binary Office files return metadata with an explicit contentUnavailableReason instead of decoding unsafe binary data.",
      responses: {
        200: jsonResponse("OneDrive file returned.", driveFileResponseSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        409: jsonResponse("The calling member has not connected their Microsoft account or is missing permission.", needsConnectionSchema),
        502: jsonResponse("Microsoft Graph rejected the request.", upstreamErrorSchema),
      },
    }),
    memberRoute,
    paramValidator(driveFileParamSchema),
    async (c) => {
      const payload = c.get("organizationContext")
      const token = await resolveAccessToken({ organizationId: payload.organization.id, orgMembershipId: payload.currentMember.id })
      if (token.kind === "microsoft_graph_error") return c.json({ error: token.kind, message: token.message }, 502)
      if (token.kind === "needs_connection") return c.json({ error: token.kind, message: token.message }, 409)
      if (!token.enabledFeatures.includes("filesRead")) {
        return c.json({ error: "needs_connection", message: disabledFeatureMessage("OneDrive access") }, 409)
      }
      if (missingScope(token.scopes, FILES_READ_SCOPE)) {
        return c.json({ error: "needs_connection", message: missingPermissionMessage("OneDrive read") }, 409)
      }

      try {
        const { itemId } = c.req.valid("param")
        return c.json({ ok: true, file: await graphClient(token.accessToken).getDriveItemWithContent(itemId) })
      } catch (error) {
        return c.json(graphError(error), 502)
      }
    },
  )
}
