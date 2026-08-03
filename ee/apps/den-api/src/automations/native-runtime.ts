import { randomUUID } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
  AutomationEngineAdmissionRequest,
  AutomationEngineAttachmentValue,
} from "@openwork/automations"
import type { AutomationError, AutomationRunEventType, AutomationUsage } from "@openwork/types/automations"
import { resolveAutomationModelAccess, type AutomationAuthorityResult, type ResolvedAutomationModel } from "./authority.js"
import { decodeProviderCredential, readProviderEnvNames } from "../llm/provider-credentials.js"

/**
 * Native TypeScript Automation engine runtime. Executes one admission attempt
 * fully in-process: a bounded chat-completions tool loop against the resolved
 * provider plus the two run-scoped OpenWork Connect MCP tools. There is no
 * engine binary, no child process, and no filesystem surface — the only
 * outbound calls are the provider endpoint and the Den run-scoped MCP
 * endpoint, which keeps the declared "provider-and-connect-only" network
 * boundary true by construction.
 */

type JsonRecord = Record<string, unknown>

const emptyUsage: AutomationUsage = { inputTokens: null, outputTokens: null, costMicros: null }
const connectToolNames = ["search_capabilities", "execute_capability"] as const
const maximumConversationSteps = 32
const providerRequestTimeoutMs = 120_000
const capabilityCallTimeoutMs = 180_000
const modelMessageTextLimit = 32_000

/** Wire protocols the native engine can speak. Everything Den lets an org
 * configure today resolves to OpenAI-compatible chat completions: the free
 * zen model, the OpenWork inference proxy, and custom providers (whose npm
 * package the provider API restricts at creation time). */
const openAiCompatiblePackages = new Set(["@ai-sdk/openai-compatible", "@ai-sdk/openai"])

export type AutomationEngineObservation = {
  key: string
  type: AutomationRunEventType
  payload: Record<string, AutomationEngineAttachmentValue>
  createdAt: number
}

export type AutomationEngineSnapshot = {
  state: "running" | "succeeded" | "failed"
  observations: AutomationEngineObservation[]
  resultSummary: string | null
  usage: AutomationUsage
  error: AutomationError | null
}

export interface AutomationEngineRuntime {
  sessionId: string
  inspect(): Promise<AutomationEngineSnapshot>
  abort(): Promise<"cancelled" | "not_running" | "unsupported">
  dispose(): Promise<void>
  isAlive(): boolean
}

export type AutomationEngineRuntimeFactory = (input: {
  executionId: string
  request: AutomationEngineAdmissionRequest
  runtimeDirectory: string
  sessionId: string | null
}) => Promise<AutomationEngineRuntime>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function providerFailure(message: string): Error {
  return Object.assign(new Error(message), { automationCode: "provider_unavailable" })
}

/** The run-scoped Den MCP endpoint must expose exactly the reviewed Connect
 * pair. Anything extra or missing means the boundary changed underneath the
 * engine, so admission fails closed instead of running with surprise tools. */
export function failClosedAutomationConnectTools(toolNames: readonly string[]): void {
  const available = new Set(toolNames)
  const missing = connectToolNames.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(`The Automation Connect endpoint is missing required tools: ${missing.join(", ")}`)
  }
  const unexpected = toolNames.filter(
    (name) => !connectToolNames.includes(name as (typeof connectToolNames)[number]),
  )
  if (unexpected.length > 0) {
    throw new Error(`The Automation Connect endpoint exposed unreviewed tools: ${unexpected.join(", ")}`)
  }
}

export type AutomationProviderEndpoint = {
  url: string
  headers: Record<string, string>
}

/** Resolve the chat-completions endpoint and credentials for a resolved model.
 * Custom providers outside the OpenAI-compatible allowlist fail closed before
 * any request is made. Credentials become an Authorization header only — they
 * never enter prompts, observations, or persisted engine state. */
export function resolveAutomationProviderEndpoint(model: ResolvedAutomationModel): AutomationProviderEndpoint {
  const npm = stringValue(model.providerConfig.npm)
  if (model.accessKind === "authorized_custom" && npm && !openAiCompatiblePackages.has(npm)) {
    throw providerFailure("The selected provider is not compatible with the Den Automation engine.")
  }
  const options = isRecord(model.providerConfig.options) ? model.providerConfig.options : {}
  const baseUrl = stringValue(options.baseURL) ?? stringValue(model.providerConfig.api)
  if (!baseUrl) {
    throw providerFailure("The selected provider does not declare an API endpoint.")
  }
  const headers: Record<string, string> = { "content-type": "application/json" }
  for (const source of [model.providerConfig.headers, options.headers]) {
    if (!isRecord(source)) continue
    for (const [name, value] of Object.entries(source)) {
      if (stringValue(name) && typeof value === "string") headers[name.trim()] = value
    }
  }
  const credential = decodeProviderCredential(model.apiKey)
  const envNames = readProviderEnvNames(model.providerConfig)
  const apiKey = credential.apiKeys
    ? (envNames.map((name) => credential.apiKeys?.[name]).find((value) => stringValue(value))
      ?? Object.values(credential.apiKeys).find((value) => stringValue(value))
      ?? null)
    : credential.apiKey
  if (stringValue(apiKey)) headers.authorization = `Bearer ${apiKey!.trim()}`
  return { url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`, headers }
}

const chatToolDefinitions = [
  {
    type: "function",
    function: {
      name: connectToolNames[0],
      description:
        "Search the Automation owner's current OpenWork Connect capabilities. Always search before executing a capability.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What capability to look for." },
          limit: { type: "integer", minimum: 1, maximum: 20 },
          type: { type: "string", enum: ["all", "api", "mcp"] },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: connectToolNames[1],
      description:
        "Execute an exact capability name returned by search_capabilities. Automation-management operations are never accepted.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact capability name from search_capabilities." },
          schemaDigest: { type: "string" },
          path: { anyOf: [{ type: "object" }, { type: "string" }] },
          query: { anyOf: [{ type: "object" }, { type: "string" }] },
          body: {},
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
] as const

const systemPrompt = [
  "You are running an unattended OpenWork Automation on Den.",
  "Use only the OpenWork Connect search_capabilities and execute_capability tools exposed to this run.",
  "Search before executing a capability.",
  "You have no workspace, filesystem, shell, terminal, browser, computer-use, task, or Automation-management access.",
  "Do not ask the absent user a question. Finish with a concise result summary.",
].join(" ")

function observationPayload(value: unknown): AutomationEngineAttachmentValue {
  if (typeof value === "string") return value.slice(0, 20_000)
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean" || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(observationPayload)
  if (!isRecord(value)) return null
  return Object.fromEntries(
    Object.entries(value).slice(0, 100).map(([key, entry]) => [key, observationPayload(entry)]),
  )
}

type ChatToolCall = { id: string; name: string; arguments: JsonRecord }

type ChatCompletion = {
  toolCalls: ChatToolCall[]
  text: string | null
  finishReason: string | null
  inputTokens: number | null
  outputTokens: number | null
}

function chatHttpError(status: number): AutomationError {
  if (status === 401 || status === 403) {
    return {
      code: "provider_unavailable",
      message: "The selected provider rejected the Automation credential.",
      retryable: false,
    }
  }
  return {
    code: "execution_failed",
    message: `The selected provider returned HTTP ${status} during Automation execution.`,
    retryable: status === 408 || status === 429 || status >= 500,
  }
}

function parseChatCompletion(payload: unknown): ChatCompletion {
  const body = isRecord(payload) ? payload : {}
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : {}
  const message = isRecord(choice.message) ? choice.message : {}
  const usage = isRecord(body.usage) ? body.usage : {}
  const toolCalls: ChatToolCall[] = []
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecord(call) || !isRecord(call.function)) continue
      const name = stringValue(call.function.name)
      if (!name) continue
      let parsed: unknown = {}
      const rawArguments = call.function.arguments
      if (typeof rawArguments === "string" && rawArguments.trim()) {
        try {
          parsed = JSON.parse(rawArguments)
        } catch {
          parsed = {}
        }
      } else if (isRecord(rawArguments)) {
        parsed = rawArguments
      }
      toolCalls.push({
        id: stringValue(call.id) ?? `call_${toolCalls.length + 1}`,
        name,
        arguments: isRecord(parsed) ? parsed : {},
      })
    }
  }
  return {
    toolCalls,
    text: stringValue(message.content),
    finishReason: stringValue(choice.finish_reason),
    inputTokens: safeInteger(usage.prompt_tokens),
    outputTokens: safeInteger(usage.completion_tokens),
  }
}

export type AutomationNativeRuntimeDependencies = {
  resolveModelAccess?: (input: {
    organizationId: string
    ownerMemberId: string
    providerId: string
    modelId: string
  }) => Promise<AutomationAuthorityResult>
  fetchImplementation?: typeof fetch
  now?: () => number
}

class NativeConversation {
  readonly sessionId = randomUUID()
  readonly #observations: AutomationEngineObservation[] = []
  readonly #controller = new AbortController()
  readonly #settled: Promise<void>
  #state: AutomationEngineSnapshot["state"] = "running"
  #resultSummary: string | null = null
  #error: AutomationError | null = null
  #inputTokens = 0
  #outputTokens = 0
  #sawTokens = false
  #disposed = false

  constructor(
    readonly input: {
      request: AutomationEngineAdmissionRequest
      model: ResolvedAutomationModel
      endpoint: AutomationProviderEndpoint
      connect: Client
      fetchImplementation: typeof fetch
      now: () => number
    },
  ) {
    this.#settled = this.#run().catch((error) => {
      if (this.#controller.signal.aborted || this.#state !== "running") return
      this.#fail(
        isRecord(error) && error.automationError
          ? (error.automationError as AutomationError)
          : {
              code: "execution_failed",
              message: error instanceof Error ? error.message.slice(0, 2_000) : "Automation execution failed.",
              retryable: false,
            },
      )
    })
  }

  #observe(key: string, type: AutomationRunEventType, payload: Record<string, AutomationEngineAttachmentValue>): void {
    this.#observations.push({ key: `${this.sessionId}:${key}`, type, payload, createdAt: this.input.now() })
  }

  #fail(error: AutomationError): void {
    this.#state = "failed"
    this.#error = error
  }

  get #usage(): AutomationUsage {
    if (!this.#sawTokens) return emptyUsage
    const cost = isRecord(this.input.model.modelConfig.cost) ? this.input.model.modelConfig.cost : null
    const inputRate = cost && typeof cost.input === "number" && Number.isFinite(cost.input) ? cost.input : null
    const outputRate = cost && typeof cost.output === "number" && Number.isFinite(cost.output) ? cost.output : null
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      costMicros: inputRate !== null && outputRate !== null
        ? Math.round(this.#inputTokens * inputRate + this.#outputTokens * outputRate)
        : null,
    }
  }

  async #chat(messages: JsonRecord[]): Promise<ChatCompletion> {
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(providerRequestTimeoutMs)])
    let response: Response
    try {
      response = await this.input.fetchImplementation(this.input.endpoint.url, {
        method: "POST",
        headers: this.input.endpoint.headers,
        body: JSON.stringify({
          model: this.input.model.modelId,
          messages,
          tools: chatToolDefinitions,
          tool_choice: "auto",
        }),
        signal,
      })
    } catch (error) {
      if (this.#controller.signal.aborted) throw error
      throw Object.assign(new Error("The selected provider could not be reached."), {
        automationError: {
          code: "execution_failed",
          message: "The selected provider could not be reached during Automation execution.",
          retryable: true,
        } satisfies AutomationError,
      })
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Provider request failed with HTTP ${response.status}.`), {
        automationError: chatHttpError(response.status),
      })
    }
    const completion = parseChatCompletion(await response.json().catch(() => null))
    if (completion.inputTokens !== null || completion.outputTokens !== null) {
      this.#inputTokens += completion.inputTokens ?? 0
      this.#outputTokens += completion.outputTokens ?? 0
      this.#sawTokens = true
    }
    return completion
  }

  async #invokeConnectTool(call: ChatToolCall, step: number): Promise<string> {
    const eventType = call.name === connectToolNames[0] ? "capability_search" : "capability_execution"
    const callKey = `tool:${step}:${call.id}`
    this.#observe(`${callKey}:running`, eventType, {
      phase: "running",
      input: observationPayload(call.arguments),
    })
    try {
      const result = await this.input.connect.callTool(
        { name: call.name, arguments: call.arguments },
        undefined,
        { signal: this.#controller.signal, timeout: capabilityCallTimeoutMs, resetTimeoutOnProgress: true },
      )
      const content = Array.isArray(result.content) ? result.content : []
      const text = content
        .map((part) => (isRecord(part) && part.type === "text" ? stringValue(part.text) ?? "" : ""))
        .filter(Boolean)
        .join("\n")
      if (result.isError === true) {
        this.#observe(`${callKey}:error`, eventType, {
          phase: "error",
          input: observationPayload(call.arguments),
          error: text.slice(0, 20_000) || "Capability failed.",
        })
        return JSON.stringify({ error: text.slice(0, modelMessageTextLimit) || "capability_failed" })
      }
      this.#observe(`${callKey}:completed`, eventType, {
        phase: "completed",
        input: observationPayload(call.arguments),
        output: observationPayload(text),
      })
      return text.slice(0, modelMessageTextLimit) || "{}"
    } catch (error) {
      if (this.#controller.signal.aborted) throw error
      this.#observe(`${callKey}:error`, eventType, {
        phase: "error",
        input: observationPayload(call.arguments),
        error: error instanceof Error ? error.message.slice(0, 2_000) : "Capability failed.",
      })
      return JSON.stringify({ error: "capability_failed" })
    }
  }

  async #run(): Promise<void> {
    const messages: JsonRecord[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: this.input.request.revision.instructions },
    ]
    for (let step = 1; step <= maximumConversationSteps; step += 1) {
      if (this.#controller.signal.aborted) return
      const completion = await this.#chat(messages)
      if (completion.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: completion.text,
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        })
        for (const call of completion.toolCalls) {
          if (this.#controller.signal.aborted) return
          const known = connectToolNames.includes(call.name as (typeof connectToolNames)[number])
          const output = known
            ? await this.#invokeConnectTool(call, step)
            : JSON.stringify({ error: "unknown_tool", message: "Only the two OpenWork Connect tools exist." })
          messages.push({ role: "tool", tool_call_id: call.id, content: output })
        }
        continue
      }
      if (completion.text) {
        const text = completion.text.slice(0, 20_000)
        this.#observe(`assistant:${step}`, "assistant", { text })
        this.#observe(`usage:${step}`, "usage", { ...this.#usage })
        this.#resultSummary = text
        this.#state = "succeeded"
        return
      }
      this.#fail({
        code: "execution_failed",
        message: completion.finishReason === "length"
          ? "The selected model ran out of output before finishing the Automation."
          : "The selected model returned an empty Automation completion.",
        retryable: false,
      })
      return
    }
    this.#fail({
      code: "execution_failed",
      message: "The Automation exceeded the engine tool-call iteration limit.",
      retryable: false,
    })
  }

  runtime(): AutomationEngineRuntime {
    return {
      sessionId: this.sessionId,
      isAlive: () => !this.#disposed,
      inspect: async () => ({
        state: this.#state,
        observations: [...this.#observations],
        resultSummary: this.#resultSummary,
        usage: this.#usage,
        error: this.#error,
      }),
      abort: async () => {
        if (this.#state !== "running" || this.#controller.signal.aborted) return "not_running"
        this.#controller.abort()
        await this.#settled.catch(() => undefined)
        return "cancelled"
      },
      dispose: async () => {
        this.#disposed = true
        this.#controller.abort()
        await this.#settled.catch(() => undefined)
        await this.input.connect.close().catch(() => undefined)
      },
    }
  }
}

export function automationNativeRuntimeFactory(
  dependencies: AutomationNativeRuntimeDependencies = {},
): AutomationEngineRuntimeFactory {
  const resolveModelAccess = dependencies.resolveModelAccess ?? resolveAutomationModelAccess
  const fetchImplementation = dependencies.fetchImplementation ?? fetch
  const now = dependencies.now ?? Date.now
  return async (input) => {
    if (input.request.capabilityAccess.expiresAt <= now()) {
      throw new Error("The Automation Connect capability access has expired.")
    }
    const authority = await resolveModelAccess({
      organizationId: input.request.automation.organizationId,
      ownerMemberId: input.request.automation.ownerMemberId,
      providerId: input.request.revision.model.providerId,
      modelId: input.request.revision.model.modelId,
    })
    if (!authority.ok) throw Object.assign(new Error(authority.message), { automationCode: authority.code })
    const endpoint = resolveAutomationProviderEndpoint(authority.value)

    const connect = new Client({ name: "openwork-den-automation-engine", version: "1.0.0" })
    try {
      await connect.connect(new StreamableHTTPClientTransport(new URL(input.request.capabilityAccess.endpoint), {
        requestInit: {
          headers: { authorization: `Bearer ${input.request.capabilityAccess.bearerToken}` },
        },
      }))
      const inventory = await connect.listTools()
      failClosedAutomationConnectTools(inventory.tools.map((tool) => tool.name))
    } catch (error) {
      await connect.close().catch(() => undefined)
      throw error
    }

    const conversation = new NativeConversation({
      request: input.request,
      model: authority.value,
      endpoint,
      connect,
      fetchImplementation,
      now,
    })
    return conversation.runtime()
  }
}

export const createAutomationEngineRuntime: AutomationEngineRuntimeFactory = automationNativeRuntimeFactory()
export { connectToolNames as automationConnectToolNames, emptyUsage as automationEmptyUsage }
