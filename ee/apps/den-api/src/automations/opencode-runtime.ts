import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type {
  AutomationEngineAdmissionRequest,
  AutomationEngineAttachmentValue,
} from "@openwork/automations"
import type { AutomationError, AutomationRunEventType, AutomationUsage } from "@openwork/types/automations"
import { resolveAutomationModelAccess, type ResolvedAutomationModel } from "./authority.js"
import { decodeProviderCredential, readProviderEnvNames } from "../llm/provider-credentials.js"

type JsonRecord = Record<string, unknown>
type SdkResult = { data?: unknown; error?: unknown; response: Response }

const connectMcpName = "openwork_connect"
const connectToolIds = [
  `${connectMcpName}_search_capabilities`,
  `${connectMcpName}_execute_capability`,
] as const
const emptyUsage: AutomationUsage = { inputTokens: null, outputTokens: null, costMicros: null }
const modelConfigKeys = [
  "family", "release_date", "attachment", "reasoning", "temperature", "tool_call",
  "interleaved", "cost", "limit", "modalities", "status", "options", "headers",
  "provider", "variants",
] as const

export type AutomationOpenCodeObservation = {
  key: string
  type: AutomationRunEventType
  payload: Record<string, AutomationEngineAttachmentValue>
  createdAt: number
}

export type AutomationOpenCodeSnapshot = {
  state: "running" | "succeeded" | "failed"
  observations: AutomationOpenCodeObservation[]
  resultSummary: string | null
  usage: AutomationUsage
  error: AutomationError | null
}

export interface AutomationOpenCodeRuntime {
  sessionId: string
  inspect(): Promise<AutomationOpenCodeSnapshot>
  abort(): Promise<"cancelled" | "not_running" | "unsupported">
  dispose(): Promise<void>
  isAlive(): boolean
}

export type AutomationOpenCodeRuntimeFactory = (input: {
  executionId: string
  request: AutomationEngineAdmissionRequest
  runtimeDirectory: string
  sessionId: string | null
}) => Promise<AutomationOpenCodeRuntime>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function unwrap(result: SdkResult, message: string): unknown {
  if (result.data !== undefined) return result.data
  throw new Error(result.error === undefined ? message : `${message} (HTTP ${result.response.status})`)
}

function normalizedProviderError(value: unknown): AutomationError {
  const error = isRecord(value) ? value : {}
  const data = isRecord(error.data) ? error.data : {}
  const statusCode = safeInteger(data.statusCode)
  if (error.name === "ProviderAuthError" || statusCode === 401 || statusCode === 403) {
    return {
      code: "provider_unavailable",
      message: "The selected provider credential is unavailable.",
      retryable: false,
    }
  }
  return {
    code: "execution_failed",
    message: "OpenCode reported that Automation execution failed.",
    retryable: data.isRetryable === true,
  }
}

/** Global deny followed by the two exact Connect grants; new tools stay denied. */
export function failClosedAutomationPermissions(toolIds: readonly string[]) {
  const available = new Set(toolIds)
  const missing = connectToolIds.filter((toolId) => !available.has(toolId))
  if (missing.length > 0) {
    throw new Error(`OpenCode Connect tool inventory is incomplete: ${missing.join(", ")}`)
  }
  const unexpectedConnectTools = toolIds.filter(
    (toolId) => toolId.startsWith(`${connectMcpName}_`) && !connectToolIds.includes(toolId as typeof connectToolIds[number]),
  )
  if (unexpectedConnectTools.length > 0) {
    throw new Error("OpenCode exposed an unreviewed Connect tool.")
  }
  return [
    { permission: "*", pattern: "*", action: "deny" as const },
    ...connectToolIds.map((permission) => ({ permission, pattern: "*", action: "allow" as const })),
  ]
}

function providerRuntimeId(model: ResolvedAutomationModel): string {
  return model.providerId
}

function providerEnvironment(model: ResolvedAutomationModel): Record<string, string> {
  const names = readProviderEnvNames(model.providerConfig)
  const credential = decodeProviderCredential(model.apiKey)
  const environment: Record<string, string> = {}
  if (credential.apiKeys) {
    for (const [name, value] of Object.entries(credential.apiKeys)) {
      if (name.trim() && value.trim()) environment[name] = value
    }
  } else if (credential.apiKey && names[0]) {
    environment[names[0]] = credential.apiKey
  }
  if (model.accessKind === "openwork_managed" && credential.apiKey) {
    environment.OPENWORK_API_KEY = credential.apiKey
    const options = isRecord(model.providerConfig.options)
      ? model.providerConfig.options
      : {}
    const configured = stringValue(options.baseURL) ?? stringValue(model.providerConfig.api)
    if (configured) environment.OPENWORK_INFERENCE_BASE_URL = configured.replace(/\/api\/v1\/?$/, "")
  }
  return environment
}

function providerConfiguration(model: ResolvedAutomationModel): JsonRecord {
  const source = model.providerConfig
  const modelConfig: JsonRecord = { id: model.modelId, name: model.modelName }
  for (const key of modelConfigKeys) {
    const value = model.modelConfig[key]
    if (value !== undefined) modelConfig[key] = value
  }
  const options = isRecord(source.options) ? { ...source.options } : {}
  const envNames = readProviderEnvNames(source)
  const credential = decodeProviderCredential(model.apiKey)
  if (envNames.length === 0 && credential.apiKey) options.apiKey = credential.apiKey
  return {
    id: model.providerId,
    name: model.providerName,
    env: envNames,
    models: { [model.modelId]: modelConfig },
    ...(stringValue(source.npm) ? { npm: stringValue(source.npm) } : {}),
    ...(stringValue(source.api) ? { api: stringValue(source.api) } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(stringList(source.whitelist).length > 0 ? { whitelist: stringList(source.whitelist) } : {}),
    ...(stringList(source.blacklist).length > 0 ? { blacklist: stringList(source.blacklist) } : {}),
  }
}

function automationRuntimeConfig(input: {
  request: AutomationEngineAdmissionRequest
  model: ResolvedAutomationModel
}): JsonRecord {
  const providerId = providerRuntimeId(input.model)
  const enabledTools = Object.fromEntries([
    ["*", false],
    ...connectToolIds.map((toolId) => [toolId, true]),
  ])
  return {
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    formatter: false,
    lsp: false,
    plugin: [],
    enabled_providers: [providerId],
    default_agent: "automation",
    model: `${providerId}/${input.model.modelId}`,
    tools: enabledTools,
    permission: "deny",
    agent: {
      automation: {
        description: "OpenWork Den Automation runner",
        mode: "primary",
        tools: enabledTools,
        permission: "deny",
        prompt: [
          "You are running an unattended OpenWork Automation on Den.",
          "Use only the OpenWork Connect search and execute tools exposed to this session.",
          "Search before executing a capability.",
          "You have no workspace, filesystem, shell, terminal, browser, computer-use, task, or Automation-management access.",
          "Do not ask the absent user a question. Finish with a concise result summary.",
        ].join(" "),
      },
    },
    provider: { [providerId]: providerConfiguration(input.model) },
    mcp: {
      [connectMcpName]: {
        type: "remote",
        url: input.request.capabilityAccess.endpoint,
        enabled: true,
        oauth: false,
        headers: { Authorization: `Bearer ${input.request.capabilityAccess.bearerToken}` },
      },
    },
  }
}

async function freePort(hostname: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port)
        else reject(new Error("Unable to allocate an OpenCode port."))
      })
    })
  })
}

type ManagedServer = {
  url: string
  authorization: string
  child: ChildProcess
  close(): Promise<void>
  isAlive(): boolean
}

async function startServer(input: {
  cwd: string
  environment: Record<string, string>
}): Promise<ManagedServer> {
  const hostname = "127.0.0.1"
  const port = await freePort(hostname)
  const username = randomUUID().replaceAll("-", "")
  const password = `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`
  const command = process.env.AUTOMATIONS_OPENCODE_BIN?.trim() || "opencode"
  const child = spawn(command, ["serve", "--hostname", hostname, "--port", String(port)], {
    cwd: input.cwd,
    env: {
      ...input.environment,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let settled = false
  const ready = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCode server startup timed out.")), 15_000)
    let stdout = ""
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    child.once("error", () => fail(new Error("OpenCode server could not start.")))
    child.once("exit", () => fail(new Error("OpenCode server stopped during startup.")))
    child.stdout?.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-8_192)
      for (const line of stdout.split("\n")) {
        const match = line.match(/opencode server listening.*?on\s+(https?:\/\/[^\s]+)/)
        if (!match?.[1] || settled) continue
        settled = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    })
    child.stderr?.resume()
  })
  let url: string
  try {
    url = await ready
  } catch (error) {
    child.kill("SIGKILL")
    throw error
  }
  let closePromise: Promise<void> | null = null
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  return {
    url,
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    child,
    isAlive: () => child.exitCode === null && child.signalCode === null,
    close() {
      closePromise ??= (async () => {
        if (child.exitCode !== null) return
        child.kill("SIGTERM")
        await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))])
        if (child.exitCode === null) child.kill("SIGKILL")
      })()
      return closePromise
    },
  }
}

function observationPayload(value: unknown): AutomationEngineAttachmentValue {
  if (typeof value === "string") return value.slice(0, 20_000)
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean" || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(observationPayload)
  if (!isRecord(value)) return null
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) => [key, observationPayload(entry)]))
}

function readMessages(messages: unknown[], now: number): Omit<AutomationOpenCodeSnapshot, "state"> & {
  completed: boolean
} {
  const observations: AutomationOpenCodeObservation[] = []
  let completed = false
  let resultSummary: string | null = null
  let error: AutomationError | null = null
  let inputTokens = 0
  let outputTokens = 0
  let costMicros = 0
  let sawInput = false
  let sawOutput = false
  let sawCost = false

  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant") continue
    const info = message.info
    const messageId = stringValue(info.id) ?? `assistant-${observations.length}`
    if (info.error !== undefined) error = normalizedProviderError(info.error)
    const messageCompleted = isRecord(info.time) && typeof info.time.completed === "number"
    completed ||= messageCompleted
    if (isRecord(info.tokens)) {
      const input = safeInteger(info.tokens.input)
      const output = safeInteger(info.tokens.output)
      if (input !== null) { inputTokens += input; sawInput = true }
      if (output !== null) { outputTokens += output; sawOutput = true }
    }
    if (typeof info.cost === "number" && Number.isFinite(info.cost) && info.cost >= 0) {
      costMicros += Math.round(info.cost * 1_000_000)
      sawCost = true
    }
    if (!Array.isArray(message.parts)) continue
    for (const part of message.parts) {
      if (!isRecord(part)) continue
      const partId = stringValue(part.id) ?? `${messageId}-${observations.length}`
      if (part.type === "text" && stringValue(part.text) && messageCompleted) {
        const text = stringValue(part.text)!.slice(0, 20_000)
        resultSummary = text
        observations.push({ key: `assistant:${partId}`, type: "assistant", payload: { text }, createdAt: now })
      }
      if (part.type !== "tool" || !stringValue(part.tool) || !isRecord(part.state)) continue
      const tool = stringValue(part.tool)!
      const eventType = tool === connectToolIds[0]
        ? "capability_search"
        : tool === connectToolIds[1] ? "capability_execution" : null
      if (!eventType) continue
      const status = stringValue(part.state.status) ?? "unknown"
      if (!['pending', 'running', 'completed', 'error'].includes(status)) continue
      observations.push({
        key: `tool:${partId}:${status}`,
        type: eventType,
        payload: {
          phase: status,
          input: observationPayload(part.state.input),
          ...(status === "completed" ? { output: observationPayload(part.state.output) } : {}),
          ...(status === "error" ? { error: stringValue(part.state.error) ?? "Capability failed." } : {}),
        },
        createdAt: now,
      })
    }
  }
  const usage = {
    inputTokens: sawInput ? inputTokens : null,
    outputTokens: sawOutput ? outputTokens : null,
    costMicros: sawCost ? costMicros : null,
  }
  if (completed) {
    observations.push({ key: `usage:${messages.length}:${JSON.stringify(usage)}`, type: "usage", payload: usage, createdAt: now })
  }
  return { completed, observations, resultSummary, usage, error }
}

async function createRuntime(input: Parameters<AutomationOpenCodeRuntimeFactory>[0]): Promise<AutomationOpenCodeRuntime> {
  if (input.request.capabilityAccess.expiresAt <= Date.now()) {
    throw new Error("The Automation Connect capability access has expired.")
  }
  const authority = await resolveAutomationModelAccess({
    organizationId: input.request.automation.organizationId,
    ownerMemberId: input.request.automation.ownerMemberId,
    providerId: input.request.revision.model.providerId,
    modelId: input.request.revision.model.modelId,
  })
  if (!authority.ok) throw Object.assign(new Error(authority.message), { automationCode: authority.code })

  const runtimeRoot = path.join(input.runtimeDirectory, "runtime")
  const cwd = path.join(runtimeRoot, "cwd")
  const home = path.join(runtimeRoot, "home")
  const config = path.join(runtimeRoot, "opencode.json")
  const xdgData = path.join(runtimeRoot, "data")
  const xdgConfig = path.join(runtimeRoot, "config")
  const xdgCache = path.join(runtimeRoot, "cache")
  const temporary = path.join(runtimeRoot, "tmp")
  await Promise.all([cwd, home, xdgData, xdgConfig, xdgCache, temporary].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
  await writeFile(config, JSON.stringify(automationRuntimeConfig({ request: input.request, model: authority.value })), { mode: 0o600 })
  const inherited = ["PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]
  const environment: Record<string, string> = {
    HOME: home,
    TMPDIR: temporary,
    XDG_DATA_HOME: xdgData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    OPENCODE_CONFIG: config,
    ...providerEnvironment(authority.value),
  }
  for (const name of inherited) {
    if (process.env[name]) environment[name] = process.env[name]!
  }
  const server = await startServer({ cwd, environment })
  const client = createOpencodeClient({
    baseUrl: server.url,
    directory: cwd,
    headers: { Authorization: server.authorization },
  })
  try {
    const tools = unwrap(await client.tool.ids(), "OpenCode tools could not be inspected.")
    const toolIds = Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === "string") : []
    const permission = failClosedAutomationPermissions(toolIds)
    const providers = unwrap(await client.provider.list(), "OpenCode providers could not be inspected.")
    const connected = isRecord(providers) ? stringList(providers.connected) : []
    const runtimeProvider = providerRuntimeId(authority.value)
    if (!connected.includes(runtimeProvider)) throw new Error("The selected OpenCode provider is not connected.")

    let sessionId = input.sessionId
    if (!sessionId) {
      const created = unwrap(await client.session.create({
        title: `Automation: ${input.request.automation.name}`.slice(0, 120),
        agent: "automation",
        model: { providerID: runtimeProvider, id: authority.value.modelId },
        metadata: {
          openworkAutomation: true,
          automationRunId: input.request.run.id,
          admissionKey: input.request.admissionKey,
        },
        permission,
      }), "OpenCode could not create an Automation session.")
      sessionId = isRecord(created) ? stringValue(created.id) : null
      if (!sessionId) throw new Error("OpenCode returned an invalid Automation session.")
      const dispatched = await client.session.promptAsync({
        sessionID: sessionId,
        agent: "automation",
        model: { providerID: runtimeProvider, modelID: authority.value.modelId },
        system: "Run unattended. Use only the two granted OpenWork Connect tools and finish with a concise result.",
        parts: [{ type: "text", text: input.request.revision.instructions }],
      })
      if (dispatched.error !== undefined) throw new Error("OpenCode rejected the Automation prompt.")
    }

    const activeSessionId = sessionId
    return {
      sessionId: activeSessionId,
      isAlive: server.isAlive,
      async inspect() {
        if (!server.isAlive()) throw new Error("OpenCode Automation runtime stopped unexpectedly.")
        const [statusesResult, messagesResult] = await Promise.all([
          client.session.status(),
          client.session.messages({ sessionID: activeSessionId }),
        ])
        const statuses = unwrap(statusesResult, "OpenCode session status could not be read.")
        const messages = unwrap(messagesResult, "OpenCode session messages could not be read.")
        const status = isRecord(statuses) && isRecord(statuses[activeSessionId])
          ? stringValue(statuses[activeSessionId].type)
          : "idle"
        const summary = readMessages(Array.isArray(messages) ? messages : [], Date.now())
        if (summary.error) return { state: "failed", ...summary }
        if (status === "idle" && summary.completed) return { state: "succeeded", ...summary, error: null }
        return { state: "running", ...summary, error: null }
      },
      async abort() {
        const result = await client.session.abort({ sessionID: activeSessionId })
        if (result.data === true) return "cancelled"
        if (result.data === false) return "not_running"
        if ([404, 405, 501].includes(result.response.status)) return "unsupported"
        throw new Error("OpenCode cancellation could not be confirmed.")
      },
      dispose: server.close,
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

export const createAutomationOpenCodeRuntime: AutomationOpenCodeRuntimeFactory = createRuntime
export { connectToolIds as automationConnectToolIds, emptyUsage as automationEmptyUsage }
