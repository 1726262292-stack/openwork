import { createHash } from "node:crypto"
import type { Hono } from "hono"
import { env } from "./env.js"
import { findActiveInferenceKey } from "./keys.js"
import { ensureUsableBuckets } from "./limits.js"

const OPENWORK_VOICE_REALTIME_MODEL = "gpt-realtime-2"
const OPENWORK_VOICE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe"

const OPENWORK_VOICE_REALTIME_TOOLS = [
  {
    type: "function",
    name: "openwork_snapshot",
    description: "Read the current OpenWork UI control snapshot: route, status, narration, and visible action metadata.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "openwork_list_actions",
    description: "List semantic OpenWork UI actions. Call this before openwork_execute_action when you do not know the exact action id.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "openwork_execute_action",
    description: "Execute a semantic OpenWork UI action by id. Prefer this over screen coordinates or DOM guessing.",
    parameters: {
      type: "object",
      properties: {
        actionId: { type: "string", description: "The action id from openwork_list_actions, such as composer.set_text or composer.send." },
        args: { type: "object", description: "Optional JSON arguments for the action.", additionalProperties: true },
      },
      required: ["actionId"],
      additionalProperties: false,
    },
  },
]

function readApiKey(request: Request) {
  const auth = request.headers.get("authorization")
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim()
  }
  return request.headers.get("x-api-key")?.trim() ?? null
}

function buildRequestId() {
  return createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringField(value: unknown, key: string) {
  if (!isRecord(value)) return ""
  const field = value[key]
  return typeof field === "string" ? field.trim() : ""
}

function readOpenAiClientSecret(payload: unknown): { clientSecret: string; expiresAt: number | null } {
  if (!isRecord(payload)) return { clientSecret: "", expiresAt: null }
  const clientSecret = payload.client_secret
  if (typeof clientSecret === "string") return { clientSecret, expiresAt: null }
  if (isRecord(clientSecret)) {
    const value = typeof clientSecret.value === "string" ? clientSecret.value : ""
    const expiresAt = typeof clientSecret.expires_at === "number" ? clientSecret.expires_at : null
    return { clientSecret: value, expiresAt }
  }
  const value = typeof payload.value === "string" ? payload.value : ""
  return { clientSecret: value, expiresAt: null }
}

function openworkVoiceRealtimeInstructions() {
  return `# Role and Objective

You are OpenWork Voice Mode, a voice-first control layer inside OpenWork.
Help the user control OpenWork by using the semantic OpenWork UI tools.

# Tool Policy

- Prefer openwork_snapshot, openwork_list_actions, and openwork_execute_action over visual guessing.
- If the user asks to write or draft something, use composer.set_text.
- If the user asks to send or run the current prompt, use composer.send.
- For navigation, settings, session, transcript, and composer work, inspect the action list first if the action id is unknown.
- Do not claim an action completed until the tool succeeds.
- Ask for confirmation before destructive actions such as deleting a session.

# Voice Style

- Be concise, calm, and direct.
- If audio is unclear, ask the user to repeat it instead of guessing.
- Ignore background speech that is not addressed to OpenWork.
- Summarize tool results briefly and offer the next useful step.`
}

async function createOpenAiRealtimeClientSecret(input: unknown, openworkRequestId: string) {
  if (!env.openAiRealtimeApiKey) {
    return Response.json({ error: { message: "Managed voice is not configured.", type: "invalid_request_error", code: "openai_realtime_key_missing" } }, { status: 503 })
  }

  const model = readStringField(input, "model") || OPENWORK_VOICE_REALTIME_MODEL
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openAiRealtimeApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: OPENWORK_VOICE_TRANSCRIPTION_MODEL, language: "en" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.58,
              silence_duration_ms: 320,
              prefix_padding_ms: 300,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
        instructions: openworkVoiceRealtimeInstructions(),
        tool_choice: "auto",
        tools: OPENWORK_VOICE_REALTIME_TOOLS,
      },
    }),
  })

  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    const message = typeof errorPayload?.message === "string" ? errorPayload.message : response.statusText
    return Response.json({ error: { message: message || "Failed to create OpenAI Realtime session", type: "api_error", code: "openai_realtime_failed" } }, { status: response.status })
  }

  const { clientSecret, expiresAt } = readOpenAiClientSecret(payload)
  if (!clientSecret) {
    return Response.json({ error: { message: "OpenAI did not return a usable Realtime client secret.", type: "api_error", code: "openai_realtime_invalid_response" } }, { status: 502 })
  }

  return Response.json({
    ok: true,
    clientSecret,
    expiresAt,
    model,
    transcriptionModel: OPENWORK_VOICE_TRANSCRIPTION_MODEL,
    tools: OPENWORK_VOICE_REALTIME_TOOLS.map((tool) => tool.name),
    source: "openwork-models",
    openworkRequestId,
  })
}

export function registerVoiceRoutes(app: Hono) {
  app.post("/voice/realtime/session", async (c) => {
    const rawKey = readApiKey(c.req.raw)
    if (!rawKey) {
      return c.json({ error: { message: "Missing OpenWork inference API key.", type: "authentication_error", code: "missing_api_key" } }, 401)
    }

    const inferenceKey = await findActiveInferenceKey(rawKey)
    if (!inferenceKey) {
      return c.json({ error: { message: "Invalid OpenWork inference API key.", type: "authentication_error", code: "invalid_api_key" } }, 401)
    }

    const limits = await ensureUsableBuckets(inferenceKey.organization_id)
    if (!limits.ok) {
      return c.json({ error: { message: `Rate limit reached for organization ${inferenceKey.organization_id}.`, type: "tokens", code: "rate_limit_exceeded" } }, 429)
    }

    const openworkRequestId = buildRequestId()
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    return createOpenAiRealtimeClientSecret(body, openworkRequestId)
  })
}
