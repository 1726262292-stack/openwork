import { isReasoningUIPart, isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai"
import type { ThreadStatus } from "@/lib/messages"

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const SAFE_DOWNLOAD_PROTOCOLS = new Set(["blob:", "data:"])
const FILE_URL_PREFIX = "file://"

interface MessageGroup {
  messages: UIMessageWithIndex[]
}

export type UIMessageWithIndex = { index: number, message: UIMessage }
type MessageListItem = MessageGroup | UIMessageWithIndex

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

export function getMessagesText(messages: UIMessage[]): string {
  return messages
    .map(getMessageText)
    .filter(Boolean)
    .join("\n\n")
}

export function getLastTextPart(message: UIMessage): UIMessage | null {
  const lastTextPart = message.parts.findLast((part) => part.type === "text")

  return lastTextPart ? { ...message, parts: [lastTextPart] } : null
}

export function getFileTitle(part: Pick<FileUIPart, "filename" | "url">) {
  if (part.filename) {
    return part.filename
  }

  if (part.url.startsWith("data:")) {
    return "Attached file"
  }

  return part.url || "File"
}

function extensionBadge(filename: string | undefined) {
  const extension = filename?.split(".").pop()?.trim().toUpperCase() ?? ""
  return /^[A-Z0-9]{1,8}$/.test(extension) ? extension : null
}

export function getMediaBadge(part: Pick<FileUIPart, "filename" | "mediaType">) {
  const mime = part.mediaType?.trim().toLowerCase().split(";")[0] ?? ""

  if (mime === DOCX_MIME) return "DOCX"
  if (mime === PPTX_MIME) return "PPTX"

  const fromExtension = extensionBadge(part.filename)
  if (fromExtension === "DOCX" || fromExtension === "PPTX") return fromExtension

  if (mime && mime !== "application/octet-stream") {
    return mime.replace(/^application\//, "").replace(/^text\//, "").toUpperCase()
  }

  return fromExtension
}

export function getSafeFileDownloadUrl(part: Pick<FileUIPart, "url">) {
  try {
    const url = new URL(part.url)
    return SAFE_DOWNLOAD_PROTOCOLS.has(url.protocol) ? part.url : null
  } catch {
    return null
  }
}

type FilePathStyle = "posix" | "windows"

function filePathStyle(workspaceRoot: string): FilePathStyle | null {
  const root = workspaceRoot.trim()
  if (/^[A-Za-z]:[\\/]/.test(root)) return "windows"
  if (root.startsWith("/")) return "posix"
  return null
}

function rawLocalFilePathname(value: string) {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith(FILE_URL_PREFIX)) return null

  const pathWithSuffix = trimmed.slice(FILE_URL_PREFIX.length)
  if (!pathWithSuffix.startsWith("/")) return null

  const queryIndex = pathWithSuffix.indexOf("?")
  const hashIndex = pathWithSuffix.indexOf("#")
  const suffixIndex = [queryIndex, hashIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]
  if (suffixIndex === undefined) return pathWithSuffix

  return pathWithSuffix.slice(0, suffixIndex)
}

function decodeFilePathSegments(pathname: string) {
  if (!pathname.startsWith("/")) return null
  const rawSegments = pathname.slice(1).split("/")
  const segments: string[] = []

  for (const rawSegment of rawSegments) {
    if (!rawSegment) return null

    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      return null
    }

    if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) return null
    segments.push(segment)
  }

  return segments
}

function nativePathFromFileUrl(url: URL, style: FilePathStyle) {
  const segments = decodeFilePathSegments(url.pathname)
  if (!segments || segments.length === 0) return null

  if (style === "windows") {
    const [drive] = segments
    if (!drive) return null
    if (!/^[A-Za-z]:$/.test(drive)) return null
    return segments.join("\\")
  }

  return `/${segments.join("/")}`
}

function normalizePathForCompare(path: string, style: FilePathStyle) {
  const separator = style === "windows" ? "\\" : "/"
  const replaced = style === "windows" ? path.trim().replaceAll("/", "\\") : path.trim()
  let normalized = replaced

  while (normalized.endsWith(separator) && normalized.length > separator.length && !/^[A-Za-z]:\\$/.test(normalized)) {
    normalized = normalized.slice(0, -1)
  }

  return style === "windows" ? normalized.toLowerCase() : normalized
}

function isWithinWorkspace(nativePath: string, workspaceRoot: string, style: FilePathStyle) {
  const root = normalizePathForCompare(workspaceRoot, style)
  const target = normalizePathForCompare(nativePath, style)
  const separator = style === "windows" ? "\\" : "/"
  const boundary = root.endsWith(separator) ? root : `${root}${separator}`

  return target === root || target.startsWith(boundary)
}

export function fileUrlToSafeWorkspacePath(fileUrl: string, workspaceRoot: string) {
  const style = filePathStyle(workspaceRoot)
  if (!style) return null

  const rawPathname = rawLocalFilePathname(fileUrl)
  if (!rawPathname || !decodeFilePathSegments(rawPathname)) return null

  let url: URL
  try {
    url = new URL(fileUrl)
  } catch {
    return null
  }

  if (url.protocol !== "file:" || url.host || url.search || url.hash) return null

  const nativePath = nativePathFromFileUrl(url, style)
  if (!nativePath || !isWithinWorkspace(nativePath, workspaceRoot, style)) return null

  return nativePath
}

export function getSafeFileOpenPath(part: Pick<FileUIPart, "url">, workspaceRoot: string, isRemoteWorkspace: boolean) {
  if (isRemoteWorkspace) return null
  return fileUrlToSafeWorkspacePath(part.url, workspaceRoot)
}

export function getMessageCreated(message: UIMessage): number | null {
  const metadata: unknown = message.metadata
  if (!metadata || typeof metadata !== "object" || !("opencode" in metadata)) return null

  const opencode: unknown = metadata.opencode
  if (!opencode || typeof opencode !== "object" || !("created" in opencode)) return null

  const created: unknown = opencode.created
  return typeof created === "number" ? created : null
}

export function formatMessageTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  if (date.toDateString() === now.toDateString()) {
    return time
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })

  return `${day}, ${time}`
}

export function isMessageGroup(item: MessageListItem): item is MessageGroup {
  return "messages" in item
}

export function groupMessages(messages: UIMessage[], status: ThreadStatus): MessageListItem[] {
  const items: MessageListItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (message.role !== "assistant") {
      items.push({ index, message })
      index++
      continue
    }

    const assistantMessages: UIMessageWithIndex[] = []

    while (index < messages.length && messages[index].role === "assistant") {
      assistantMessages.push({ message: messages[index], index });
      index++
    }

    items.push({ messages: assistantMessages });
  }

  return items
}

type AssistantRenderGroup =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; isStreaming: boolean }
  | { kind: "file"; part: FileUIPart }
  | { kind: "tool"; part: ToolUIPart | DynamicToolUIPart }

export function getAssistantRenderGroups(
  parts: UIMessage["parts"],
  showThinking: boolean
): AssistantRenderGroup[] {
  const filteredParts = parts.filter((part) => showThinking || !isReasoningUIPart(part))
  const groups: AssistantRenderGroup[] = []

  const appendText = (text: string) => {
    if (!text) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "text") {
      previous.text += text
      return
    }

    groups.push({ kind: "text", text })
  }

  const appendReasoning = (part: UIMessage["parts"][number]) => {
    if (!isReasoningUIPart(part)) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "reasoning") {
      previous.text += part.text
      previous.isStreaming = previous.isStreaming || part.state === "streaming"
      return
    }

    if (!part.text.trim()) {
      return
    }

    groups.push({ kind: "reasoning", text: part.text, isStreaming: part.state === "streaming" })
  }

  for (const part of filteredParts) {
    if (part.type === "text") {
      appendText(part.text)
      continue
    }

    if (isReasoningUIPart(part)) {
      if (showThinking) {
        appendReasoning(part)
      }
      continue
    }

    if (part.type === "file") {
      groups.push({ kind: "file", part })
      continue
    }

    if (isToolUIPart(part)) {
      groups.push({ kind: "tool", part })
    }
  }

  return groups
}
