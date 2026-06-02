import { randomBytes } from "node:crypto"

export type WorkerBackgroundJobInput = {
  openworkUrl: string
  clientToken: string
  prompt: string
  title?: string
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
  variant?: string
}

type CloudTaskJobSource = {
  name: string
  prompt: string
  model_provider_id: string | null
  model_id: string | null
  agent: string | null
  variant: string | null
}

export type WorkerBackgroundJobResult = {
  jobId: string
  status: "accepted"
  openworkUrl: string
  sessionId: string
}

type WorkerBackgroundJobFetch = typeof fetch

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function jsonHeaders(clientToken: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${clientToken}`,
    "Content-Type": "application/json",
  }
}

function createJobId() {
  return `job_${randomBytes(16).toString("hex")}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readOpencodeSessionId(payload: unknown) {
  if (!isRecord(payload)) {
    return null
  }

  if (typeof payload.id === "string") {
    return payload.id
  }

  if (isRecord(payload.data) && typeof payload.data.id === "string") {
    return payload.data.id
  }

  if (isRecord(payload.session) && typeof payload.session.id === "string") {
    return payload.session.id
  }

  return null
}

export function buildBackgroundJobPromptBody(input: WorkerBackgroundJobInput) {
  return {
    ...(input.model ? { model: input.model } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    parts: [{ type: "text", text: input.prompt }],
  }
}

export function buildCloudTaskRunJobInput(input: {
  task: CloudTaskJobSource
  openworkUrl: string
  clientToken: string
}): WorkerBackgroundJobInput {
  const model = input.task.model_provider_id && input.task.model_id
    ? { providerID: input.task.model_provider_id, modelID: input.task.model_id }
    : undefined

  return {
    openworkUrl: input.openworkUrl,
    clientToken: input.clientToken,
    prompt: input.task.prompt,
    title: input.task.name,
    ...(model ? { model } : {}),
    ...(input.task.agent ? { agent: input.task.agent } : {}),
    ...(input.task.variant ? { variant: input.task.variant } : {}),
  }
}

async function fetchJson(input: {
  fetchImpl: WorkerBackgroundJobFetch
  url: string
  clientToken: string
  body: unknown
}) {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: jsonHeaders(input.clientToken),
    body: JSON.stringify(input.body),
  })
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = { message: text }
    }
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `Worker background job request failed with ${response.status}`
    throw new Error(message)
  }

  return payload
}

export async function startWorkerBackgroundJob(
  input: WorkerBackgroundJobInput,
  fetchImpl: WorkerBackgroundJobFetch = fetch,
): Promise<WorkerBackgroundJobResult> {
  const openworkUrl = normalizeUrl(input.openworkUrl)
  const sessionPayload = await fetchJson({
    fetchImpl,
    url: `${openworkUrl}/opencode/session`,
    clientToken: input.clientToken,
    body: input.title ? { title: input.title } : {},
  })
  const sessionId = readOpencodeSessionId(sessionPayload)
  if (!sessionId) {
    throw new Error("Worker did not return an OpenCode session id")
  }

  await fetchJson({
    fetchImpl,
    url: `${openworkUrl}/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`,
    clientToken: input.clientToken,
    body: buildBackgroundJobPromptBody(input),
  })

  return {
    jobId: createJobId(),
    status: "accepted",
    openworkUrl,
    sessionId,
  }
}
