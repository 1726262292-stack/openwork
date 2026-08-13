"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { DynamicToolUIPart } from "ai"
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Pin, PinOff } from "lucide-react"

import { OpenworkServerError, type OpenworkMcpAppResource, type OpenworkMcpAppToolResult } from "@/app/lib/openwork-server"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/react-app/shell/workspace-provider"
import {
  pinWorkspaceArtifact,
  unpinWorkspaceArtifact,
  useWorkspaceArtifactLayout,
  workspaceArtifactWidgetIdentity,
} from "@/react-app/domains/session/artifacts/workspace-artifact-layout"
import { cn } from "@/lib/utils"
import {
  formatMcpAppDiagnostic,
  safeMcpAppDiagnosticMessage,
  type McpAppDiagnostic,
  type McpAppDiagnosticStage,
} from "./mcp-app-diagnostics"

const MIN_HEIGHT = 160
const MAX_HEIGHT = 800
const DEFAULT_HEIGHT = 320
const SIZE_EVENT_INTERVAL_MS = 100
const SANDBOX_READY_TIMEOUT_MS = 5_000
const RESOURCE_ACCEPT_TIMEOUT_MS = 1_000
const MAX_RESOURCE_SEND_ATTEMPTS = 2
const INITIALIZE_TIMEOUT_MS = 10_000
const EMPTY_TOOL_INPUT: Record<string, unknown> = {}

const ACTIONABLE_MCP_APP_RESOLUTION_CODES = new Set([
  "ambiguous_tool",
  "invalid_resource",
  "invalid_resource_csp",
  "invalid_resource_mime",
  "invalid_resource_uri",
  "resource_read_failed",
  "resource_too_large",
  "tool_denied",
  "unsupported_resource_permissions",
])

export type PreservedMcpAppResult = {
  content: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

type ConversationMcpAppFrameProps = {
  part: DynamicToolUIPart
  surface?: "conversation"
  resolvedApp?: never
  toolName?: never
  input?: never
  result?: never
  fixedHeight?: never
}

export type WorkspaceMcpAppFrameProps = {
  part?: never
  surface: "workspace"
  resolvedApp: OpenworkMcpAppResource
  toolName: string
  input: Record<string, unknown>
  result: PreservedMcpAppResult
  fixedHeight: number
}

type McpAppFrameProps = ConversationMcpAppFrameProps | WorkspaceMcpAppFrameProps

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function preservedResult(part: DynamicToolUIPart): PreservedMcpAppResult | null {
  const openwork = isRecord(part.callProviderMetadata?.openwork) ? part.callProviderMetadata.openwork : null
  const result = openwork && isRecord(openwork.mcpResult)
    ? openwork.mcpResult
    : openwork && isRecord(openwork.mcpApp)
      ? openwork.mcpApp
      : null
  if (!result || !Array.isArray(result.content)) return null
  const content = result.content.filter(isRecord) as Array<Record<string, unknown>>
  if (content.length !== result.content.length) return null
  return {
    content,
    ...(isRecord(result.structuredContent) ? { structuredContent: result.structuredContent } : {}),
    ...(isRecord(result._meta) ? { _meta: result._meta } : {}),
  }
}

export function buildMcpAppCsp(app: OpenworkMcpAppResource): string {
  const resources = app.csp.resourceDomains.join(" ")
  const withResources = (source: string) => resources ? `${source} ${resources}` : source
  const sourceList = (values: string[]) => values.length ? values.join(" ") : "'none'"
  return [
    "default-src 'none'",
    `script-src ${withResources("'unsafe-inline'")}`,
    `style-src ${withResources("'unsafe-inline'")}`,
    `img-src ${withResources("data: blob:")}`,
    `font-src ${withResources("data:")}`,
    `media-src ${withResources("blob:")}`,
    `connect-src ${sourceList(app.csp.connectDomains)}`,
    `frame-src ${sourceList(app.csp.frameDomains)}`,
    `base-uri ${sourceList(app.csp.baseUriDomains)}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ")
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

export function secureMcpAppHtml(app: OpenworkMcpAppResource): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(buildMcpAppCsp(app))}">`
  const html = /<html(?:\s[^>]*)?>/i.exec(app.html)
  if (html?.index !== undefined) {
    const prefix = app.html.slice(0, html.index).replace(/^\uFEFF/, "")
    if (!/^\s*(?:<!doctype\s+html\s*>)?\s*$/i.test(prefix)) {
      throw new Error("The MCP App document contains executable markup before its HTML root.")
    }
    const htmlEnd = html.index + html[0].length
    const head = /<head(?:\s[^>]*)?>/i.exec(app.html)
    if (head?.index !== undefined) {
      if (head.index < htmlEnd || app.html.slice(htmlEnd, head.index).trim()) {
        throw new Error("The MCP App document contains markup before its policy-bearing head.")
      }
      const headEnd = head.index + head[0].length
      return `${app.html.slice(0, headEnd)}${meta}${app.html.slice(headEnd)}`
    }
    const body = /<body(?:\s[^>]*)?>/i.exec(app.html)
    if (body?.index !== undefined && (body.index < htmlEnd || app.html.slice(htmlEnd, body.index).trim())) {
      throw new Error("The MCP App document contains markup before its policy-bearing head.")
    }
    return `${app.html.slice(0, htmlEnd)}<head>${meta}</head>${app.html.slice(htmlEnd)}`
  }
  return `<!doctype html><html><head>${meta}</head><body>${app.html}</body></html>`
}

function mcpToolResult(result: OpenworkMcpAppToolResult): CallToolResult {
  return result as CallToolResult
}

export function isActionableMcpAppResolutionError(cause: unknown): boolean {
  return cause instanceof OpenworkServerError && ACTIONABLE_MCP_APP_RESOLUTION_CODES.has(cause.code)
}

function dynamicArtifactProgramId(result: PreservedMcpAppResult): string | null {
  const artifact = isRecord(result.structuredContent?.artifact) ? result.structuredContent.artifact : null
  return artifact && typeof artifact.configObjectId === "string" && artifact.configObjectId.trim()
    ? artifact.configObjectId.trim()
    : null
}

export function isPinnableWorkspaceArtifactApp(app: Pick<OpenworkMcpAppResource, "resourceUri">): boolean {
  return app.resourceUri.startsWith("ui://openwork/artifacts/")
}

function McpAppPinButton({
  app,
  input,
  result,
}: {
  app: OpenworkMcpAppResource
  input: Record<string, unknown>
  result: PreservedMcpAppResult
}) {
  const { openworkServerClient, workspaceId } = useWorkspace()
  const { layout, update, isLoading, isSaving, error } = useWorkspaceArtifactLayout(openworkServerClient, workspaceId)
  const programId = dynamicArtifactProgramId(result)
  if (!programId || !isPinnableWorkspaceArtifactApp(app)) return null
  const identity = workspaceArtifactWidgetIdentity({
    programId,
    serverName: app.serverName,
    resourceUri: app.resourceUri,
    input,
  })
  const pinned = layout.widgets.find((widget) => workspaceArtifactWidgetIdentity(widget) === identity) ?? null
  const atLimit = !pinned && layout.widgets.length >= 12
  const title = app.title.trim().slice(0, 120) || app.toolName
  const label = pinned ? `Unpin ${title} from workspace` : `Pin ${title} to workspace`

  if (error) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground",
              pinned && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
            aria-label={label}
            aria-pressed={Boolean(pinned)}
            disabled={isLoading || isSaving || atLimit}
            onClick={() => {
              if (pinned) {
                update((current) => unpinWorkspaceArtifact(current, pinned.id))
                return
              }
              update((current) => pinWorkspaceArtifact(current, {
                id: `waw_${crypto.randomUUID()}`,
                title,
                programId,
                serverName: app.serverName,
                resourceUri: app.resourceUri,
                input,
              }))
            }}
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
        }
      />
      <TooltipContent>{atLimit ? "A workspace can hold up to 12 Artifact widgets" : label}</TooltipContent>
    </Tooltip>
  )
}

export function McpAppFrame(props: McpAppFrameProps) {
  const { openworkServerClient, workspaceId } = useWorkspace()
  const conversationPart = "part" in props ? props.part ?? null : null
  const resolvedApp = "resolvedApp" in props ? props.resolvedApp ?? null : null
  const directResult = "result" in props ? props.result ?? null : null
  const toolName = conversationPart?.toolName ?? ("toolName" in props ? props.toolName ?? "" : "")
  const surface = "surface" in props && props.surface === "workspace" ? "workspace" : "conversation"
  const fixedHeight = "fixedHeight" in props && typeof props.fixedHeight === "number" ? props.fixedHeight : null
  const input = conversationPart && isRecord(conversationPart.input)
    ? conversationPart.input
    : "input" in props
      ? props.input ?? EMPTY_TOOL_INPUT
      : EMPTY_TOOL_INPUT
  const result = useMemo(
    () => conversationPart ? preservedResult(conversationPart) : directResult,
    [conversationPart, directResult],
  )
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fixedHeightRef = useRef(fixedHeight)
  const [app, setApp] = useState<OpenworkMcpAppResource | null>(resolvedApp)
  const [height, setHeight] = useState(fixedHeight ?? DEFAULT_HEIGHT)
  const [error, setError] = useState<McpAppDiagnostic | null>(null)
  const [detailsCopied, setDetailsCopied] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fixedHeightRef.current = fixedHeight
    if (fixedHeight !== null) setHeight(fixedHeight)
  }, [fixedHeight])

  useEffect(() => {
    let cancelled = false
    setApp(resolvedApp)
    setError(null)
    setDetailsCopied(false)
    setDismissed(false)
    setReady(false)
    if (resolvedApp) return () => { cancelled = true }
    if (!result || !openworkServerClient || !workspaceId) return () => { cancelled = true }
    const startedAt = performance.now()
    void openworkServerClient.resolveMcpApp(workspaceId, toolName)
      .then(({ app: resolved }) => {
        if (cancelled) return
        // A preserved MCP result is neutral transport data. A null resolution
        // means the current tool definition does not advertise an MCP App, so
        // ordinary tools such as save_artifact_view render only their normal
        // result without claiming an unavailable interactive view.
        setApp(resolved)
      })
      .catch((cause) => {
        if (!cancelled && isActionableMcpAppResolutionError(cause)) {
          const diagnostic: McpAppDiagnostic = {
            code: "MCP_APP_RESOURCE_RESOLUTION_FAILED",
            ...(cause instanceof OpenworkServerError ? { causeCode: cause.code } : {}),
            stage: "resource-resolution",
            message: safeMcpAppDiagnosticMessage(cause, "The interactive view resource could not be resolved."),
            toolName,
            elapsedMs: Math.round(performance.now() - startedAt),
            checkpoints: ["resolve-started"],
          }
          console.error(`[OpenWork MCP App] ${diagnostic.code}`, diagnostic)
          setError(diagnostic)
        }
      })
    return () => { cancelled = true }
  }, [openworkServerClient, resolvedApp, result, toolName, workspaceId])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!app || !result || !iframe || !iframe.contentWindow || !openworkServerClient || !workspaceId) return
    let disposed = false
    let lastSizeEventAt = 0
    const startedAt = performance.now()
    const checkpoints: string[] = []
    let sandboxDocument: McpAppDiagnostic["sandboxDocument"]
    let failed = false
    const checkpoint = (name: string) => checkpoints.push(`${name}+${Math.round(performance.now() - startedAt)}ms`)
    const fail = (
      code: string,
      stage: McpAppDiagnosticStage,
      cause: unknown,
      fallback: string,
      sandboxOrigin?: string,
    ) => {
      if (disposed || failed) return
      failed = true
      const diagnostic: McpAppDiagnostic = {
        code,
        stage,
        message: safeMcpAppDiagnosticMessage(cause, fallback),
        toolName,
        resourceUri: app.resourceUri,
        ...(sandboxOrigin ? { sandboxOrigin } : {}),
        elapsedMs: Math.round(performance.now() - startedAt),
        checkpoints: [...checkpoints],
        ...(sandboxDocument ? { sandboxDocument } : {}),
      }
      console.error(`[OpenWork MCP App] ${code}`, diagnostic)
      setError(diagnostic)
    }
    checkpoint("resource-resolved")
    setReady(false)
    const sandbox = openworkServerClient.mcpAppSandbox(app, window.location.origin)
    if (sandbox.expectedOrigin === window.location.origin) {
      fail(
        "MCP_APP_SANDBOX_ORIGIN_INVALID",
        "sandbox-proxy",
        null,
        "The sandbox resolved to the same origin as the OpenWork host.",
        sandbox.expectedOrigin,
      )
      return
    }
    const bridge = new AppBridge(
      null,
      { name: "OpenWork", version: "1.0.0" },
      { serverTools: {} },
      {
        hostContext: {
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          displayMode: "inline",
        },
      },
    )
    let resourceDeliveryTimer: number | undefined
    let initializeTimer: number | undefined
    let initialized = false
    let resourceAccepted = false
    let resourceSendAttempts = 0
    const sandboxReadyTimer = window.setTimeout(() => {
      fail(
        "MCP_APP_SANDBOX_PROXY_TIMEOUT",
        "sandbox-proxy",
        null,
        "The sandbox proxy did not report that it was ready within 5 seconds.",
        sandbox.expectedOrigin,
      )
    }, SANDBOX_READY_TIMEOUT_MS)

    bridge.onsizechange = ({ height: requestedHeight }) => {
      if (fixedHeightRef.current !== null) return
      const now = Date.now()
      if (now - lastSizeEventAt < SIZE_EVENT_INTERVAL_MS || !Number.isFinite(requestedHeight)) return
      lastSizeEventAt = now
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(requestedHeight ?? DEFAULT_HEIGHT))))
    }
    bridge.onrequestteardown = () => {
      setDismissed(true)
    }
    bridge.oncalltool = async ({ name, arguments: args }) => mcpToolResult(
      await openworkServerClient.callMcpAppTool(workspaceId, {
        serverName: app.serverName,
        name,
        arguments: args,
      }),
    )
    bridge.oninitialized = () => {
      initialized = true
      checkpoint("app-initialized")
      if (resourceDeliveryTimer !== undefined) window.clearTimeout(resourceDeliveryTimer)
      if (initializeTimer !== undefined) window.clearTimeout(initializeTimer)
      void bridge.sendToolInput({
        arguments: input,
      }).then(() => bridge.sendToolResult({
        content: result.content as CallToolResult["content"],
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result._meta ? { _meta: result._meta } : {}),
      })).then(() => {
        if (!disposed) setReady(true)
      }).catch((cause) => {
        fail(
          "MCP_APP_TOOL_RESULT_DELIVERY_FAILED",
          "tool-result-delivery",
          cause,
          "The tool result could not be delivered to the initialized view.",
          sandbox.expectedOrigin,
        )
      })
    }
    const startInitializeTimer = () => {
      if (initialized || initializeTimer !== undefined) return
      initializeTimer = window.setTimeout(() => {
        const message = sandboxDocument
          ? "The HTML document loaded, but the MCP App did not send ui/notifications/initialized within 10 seconds."
          : "The sandbox accepted the resource, but the MCP App did not complete initialization within 10 seconds."
        fail(
          "MCP_APP_INITIALIZE_TIMEOUT",
          "app-initialization",
          null,
          message,
          sandbox.expectedOrigin,
        )
      }, INITIALIZE_TIMEOUT_MS)
    }
    const markResourceAccepted = () => {
      resourceAccepted = true
      if (resourceDeliveryTimer !== undefined) window.clearTimeout(resourceDeliveryTimer)
      startInitializeTimer()
    }
    const handleSandboxDiagnosticMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow
        || event.origin !== sandbox.expectedOrigin
        || !isRecord(event.data)) return
      if (event.data.method === "ui/notifications/sandbox-resource-loaded") {
        const params = isRecord(event.data.params) ? event.data.params : {}
        sandboxDocument = {
          readyState: typeof params.readyState === "string" ? params.readyState : null,
          hasHtmlRoot: typeof params.hasHtmlRoot === "boolean" ? params.hasHtmlRoot : null,
          scriptCount: typeof params.scriptCount === "number" ? params.scriptCount : null,
        }
        checkpoint("resource-document-loaded")
        markResourceAccepted()
        return
      }
      if (event.data.method === "ui/notifications/sandbox-resource-accepted") {
        checkpoint("resource-accepted")
        markResourceAccepted()
        return
      }
      if (event.data.method === "ui/notifications/sandbox-diagnostic") {
        const params = isRecord(event.data.params) ? event.data.params : {}
        const code = typeof params.code === "string" ? params.code : "MCP_APP_SANDBOX_RESOURCE_FAILED"
        checkpoint("sandbox-diagnostic")
        fail(
          code,
          code === "MCP_APP_DOCUMENT_RUNTIME_ERROR" ? "app-initialization" : "resource-delivery",
          typeof params.message === "string" ? params.message : null,
          "The sandbox could not load the MCP App resource.",
          sandbox.expectedOrigin,
        )
      }
    }
    const handleSandboxReady = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow
        || event.origin !== sandbox.expectedOrigin
        || !isRecord(event.data)
        || event.data.method !== "ui/notifications/sandbox-proxy-ready") return
      window.removeEventListener("message", handleSandboxReady)
      checkpoint("sandbox-proxy-ready")
      window.clearTimeout(sandboxReadyTimer)
      const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
      const deliverResource = async () => {
        resourceSendAttempts += 1
        try {
          await bridge.sendSandboxResourceReady({
            html: secureMcpAppHtml(app),
            csp: app.csp,
            sandbox: "allow-scripts allow-same-origin",
          })
          checkpoint(resourceSendAttempts === 1 ? "resource-sent" : `resource-resent-${resourceSendAttempts}`)
          if (resourceAccepted || initialized) return
          resourceDeliveryTimer = window.setTimeout(() => {
            if (resourceAccepted || initialized) return
            if (resourceSendAttempts < MAX_RESOURCE_SEND_ATTEMPTS) {
              void deliverResource()
              return
            }
            fail(
              "MCP_APP_RESOURCE_ACCEPT_TIMEOUT",
              "resource-delivery",
              null,
              "The sandbox proxy did not acknowledge the MCP App resource after two delivery attempts.",
              sandbox.expectedOrigin,
            )
          }, RESOURCE_ACCEPT_TIMEOUT_MS)
        } catch (cause) {
          fail(
            "MCP_APP_RESOURCE_DELIVERY_FAILED",
            "resource-delivery",
            cause,
            "The host could not deliver the MCP App HTML to the sandbox.",
            sandbox.expectedOrigin,
          )
        }
      }
      void bridge.connect(transport)
        .then(() => {
          checkpoint("bridge-connected")
          return deliverResource()
        })
        .catch((cause) => {
          fail(
            "MCP_APP_RESOURCE_DELIVERY_FAILED",
            "resource-delivery",
            cause,
            "The host could not deliver the MCP App HTML to the sandbox.",
            sandbox.expectedOrigin,
          )
        })
    }
    window.addEventListener("message", handleSandboxDiagnosticMessage)
    window.addEventListener("message", handleSandboxReady)
    checkpoint("sandbox-navigation-started")
    iframe.src = sandbox.url

    return () => {
      disposed = true
      window.removeEventListener("message", handleSandboxDiagnosticMessage)
      window.removeEventListener("message", handleSandboxReady)
      window.clearTimeout(sandboxReadyTimer)
      if (resourceDeliveryTimer !== undefined) window.clearTimeout(resourceDeliveryTimer)
      if (initializeTimer !== undefined) window.clearTimeout(initializeTimer)
      void Promise.race([
        bridge.teardownResource({}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 500)),
      ]).catch(() => undefined).finally(() => bridge.close().catch(() => undefined))
    }
  }, [app, input, openworkServerClient, result, toolName, workspaceId])

  if (!result || (!app && !error) || dismissed) return null
  if (error) {
    const details = formatMcpAppDiagnostic(error)
    return (
      <div className="mt-2 text-xs text-muted-foreground" role="status">
        <p>Interactive view unavailable. The normal tool result is still available. {error.message}</p>
        <details className="mt-1">
          <summary className="cursor-pointer select-none">Technical details ({error.code})</summary>
          <p className="mt-1">Copy these details when reporting the rendering problem.</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{details}</pre>
          <button
            type="button"
            className="mt-1 underline underline-offset-2"
            onClick={() => {
              if (!navigator.clipboard) return
              void navigator.clipboard.writeText(details)
                .then(() => setDetailsCopied(true))
                .catch(() => setDetailsCopied(false))
            }}
          >
            {detailsCopied ? "Copied" : "Copy details"}
          </button>
        </details>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group/mcp-app overflow-hidden rounded-xl bg-background",
        surface === "conversation" ? "mt-3" : "h-full",
        app?.prefersBorder && "border border-border",
      )}
      data-mcp-app-resource={app?.resourceUri}
      data-mcp-app-surface={surface}
      data-mcp-app-ready={ready ? "true" : "false"}
      aria-busy={!ready}
    >
      {surface === "conversation" && app?.resourceUri.startsWith("ui://openwork/artifacts/") ? (
        <div className="flex h-8 items-center gap-2 border-b border-border/70 bg-muted/20 px-2.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">{app.title}</span>
          <McpAppPinButton app={app} input={input} result={result} />
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={`${app?.title ?? toolName} interactive view`}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  )
}
