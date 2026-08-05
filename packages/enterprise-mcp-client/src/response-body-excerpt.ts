const SENSITIVE_RESPONSE_KEY = /token|secret|password|assertion|code|key|authorization/i
const SENSITIVE_JSON_VALUE = /("(?:[^"\\]|\\.)*(?:token|secret|password|assertion|code|key|authorization)(?:[^"\\]|\\.)*"\s*:\s*)("(?:[^"\\]|\\.)*(?:"|$)|[^,}\]]*)/gi

export const ENTERPRISE_MCP_RESPONSE_BODY_EXCERPT_CHARS = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue)
  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_RESPONSE_KEY.test(key) ? "[redacted]" : redactJsonValue(entry),
  ]))
}

export function redactedResponseBodyExcerpt(text: string, limit = ENTERPRISE_MCP_RESPONSE_BODY_EXCERPT_CHARS): string {
  let redacted = text.replace(SENSITIVE_JSON_VALUE, '$1"[redacted]"')
  try {
    const parsed: unknown = JSON.parse(text)
    const serialized = JSON.stringify(redactJsonValue(parsed))
    if (serialized !== undefined) redacted = serialized
  } catch {
    // A bounded excerpt may end mid-JSON. The conservative regex above still
    // removes values whose sensitive key is visible in the excerpt.
  }
  return redacted.slice(0, limit)
}

async function responseTextExcerpt(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    while (text.length < limit) {
      const next = await reader.read()
      if (next.done) {
        text += decoder.decode()
        return text.slice(0, limit)
      }
      text += decoder.decode(next.value, { stream: true })
      if (text.length >= limit) {
        void reader.cancel().catch(() => undefined)
        return text.slice(0, limit)
      }
    }
    return text.slice(0, limit)
  } catch {
    return null
  }
}

export async function boundedRedactedResponseBodyExcerpt(
  response: Response,
  limit = ENTERPRISE_MCP_RESPONSE_BODY_EXCERPT_CHARS,
): Promise<string | undefined> {
  try {
    const text = await responseTextExcerpt(response.clone(), limit)
    return text === null ? undefined : redactedResponseBodyExcerpt(text, limit)
  } catch {
    return undefined
  }
}
