"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { DynamicToolUIPart } from "ai"
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

import type { OpenworkMcpAppResource, OpenworkMcpAppToolResult } from "@/app/lib/openwork-server"
import { useWorkspace } from "@/react-app/shell/workspace-provider"
import { cn } from "@/lib/utils"

const MIN_HEIGHT = 160
const MAX_HEIGHT = 800
const DEFAULT_HEIGHT = 320
const SIZE_EVENT_INTERVAL_MS = 100
const INITIALIZE_TIMEOUT_MS = 5_000

type PreservedMcpAppResult = {
  content: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function preservedResult(part: DynamicToolUIPart): PreservedMcpAppResult | null {
  const openwork = isRecord(part.callProviderMetadata?.openwork) ? part.callProviderMetadata.openwork : null
  const result = openwork && isRecord(openwork.mcpApp) ? openwork.mcpApp : null
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

export function McpAppFrame({ part }: { part: DynamicToolUIPart }) {
  const { openworkServerClient, workspaceId } = useWorkspace()
  const result = useMemo(() => preservedResult(part), [part])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [app, setApp] = useState<OpenworkMcpAppResource | null>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setApp(null)
    setError(null)
    if (!result || !openworkServerClient || !workspaceId) return () => { cancelled = true }
    void openworkServerClient.resolveMcpApp(workspaceId, part.toolName)
      .then(({ app: resolved }) => {
        if (!cancelled) setApp(resolved)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The interactive view could not be loaded.")
      })
    return () => { cancelled = true }
  }, [openworkServerClient, part.toolName, result, workspaceId])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!app || !result || !iframe || !iframe.contentWindow || !openworkServerClient || !workspaceId) return
    let disposed = false
    let lastSizeEventAt = 0
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
    const initializeTimer = window.setTimeout(() => {
      if (!disposed) setError("The interactive view did not finish its MCP Apps handshake.")
    }, INITIALIZE_TIMEOUT_MS)
    const sandbox = openworkServerClient.mcpAppSandbox(app, window.location.origin)
    if (sandbox.expectedOrigin === window.location.origin) {
      window.clearTimeout(initializeTimer)
      setError("The MCP Apps sandbox must use a different origin from the OpenWork host.")
      return
    }

    bridge.onsizechange = ({ height: requestedHeight }) => {
      const now = Date.now()
      if (now - lastSizeEventAt < SIZE_EVENT_INTERVAL_MS || !Number.isFinite(requestedHeight)) return
      lastSizeEventAt = now
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(requestedHeight ?? DEFAULT_HEIGHT))))
    }
    bridge.onrequestteardown = () => {
      setApp(null)
    }
    bridge.oncalltool = async ({ name, arguments: args }) => mcpToolResult(
      await openworkServerClient.callMcpAppTool(workspaceId, {
        serverName: app.serverName,
        name,
        arguments: args,
      }),
    )
    bridge.oninitialized = () => {
      window.clearTimeout(initializeTimer)
      void bridge.sendToolInput({
        arguments: isRecord(part.input) ? part.input : {},
      }).then(() => bridge.sendToolResult({
        content: result.content as CallToolResult["content"],
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result._meta ? { _meta: result._meta } : {}),
      })).catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : "The tool result could not be delivered to the view.")
      })
    }
    const handleSandboxReady = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow
        || event.origin !== sandbox.expectedOrigin
        || event.data?.method !== "ui/notifications/sandbox-proxy-ready") return
      window.removeEventListener("message", handleSandboxReady)
      const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
      void bridge.connect(transport)
        .then(() => bridge.sendSandboxResourceReady({
          html: secureMcpAppHtml(app),
          csp: app.csp,
          sandbox: "allow-scripts allow-same-origin",
        }))
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : "The MCP Apps sandbox could not load the view.")
        })
    }
    window.addEventListener("message", handleSandboxReady)
    iframe.src = sandbox.url

    return () => {
      disposed = true
      window.removeEventListener("message", handleSandboxReady)
      window.clearTimeout(initializeTimer)
      void Promise.race([
        bridge.teardownResource({}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 500)),
      ]).catch(() => undefined).finally(() => bridge.close().catch(() => undefined))
    }
  }, [app, openworkServerClient, part.input, result, workspaceId])

  if (!result || (!app && !error)) return null
  if (error) {
    return (
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        Interactive view unavailable. The normal tool result is still available. {error}
      </p>
    )
  }

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-xl bg-background",
        app?.prefersBorder && "border border-border",
      )}
      data-mcp-app-resource={app?.resourceUri}
    >
      <iframe
        ref={iframeRef}
        title={`${part.toolName} interactive view`}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  )
}
