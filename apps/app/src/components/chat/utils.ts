import { isReasoningUIPart, isToolUIPart, type DynamicToolUIPart, type FileUIPart, type ToolUIPart, type UIMessage } from "ai"
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types"
import type { ThreadStatus } from "@/lib/messages"

export interface MessageGroup {
  messages: UIMessageWithIndex[]
}

export interface UIMessageWithIndex {
  index: number
  message: UIMessage
}

export type MessageListItem = MessageGroup | UIMessageWithIndex

export function isEmptyMessage(message: UIMessage): boolean {
  return message.parts.every((part) => {
    if (part.type === "text") {
      return part.text.trim().length === 0
    }

    if (isReasoningUIPart(part)) {
      return part.text.trim().length === 0
    }

    return false
  })
}

export function isSessionErrorMessage(message: UIMessage) {
  return message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text]
      }

      return []
    })
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

export function getFileTitle(part: FileUIPart) {
  if (part.filename) {
    return part.filename
  }

  if (part.url.startsWith("data:")) {
    return "Attached file"
  }

  return part.url || "File"
}

export function getMediaBadge(part: FileUIPart) {
  if (part.mediaType && part.mediaType !== "application/octet-stream") {
    return part.mediaType.replace(/^application\//, "").replace(/^text\//, "").toUpperCase()
  }

  return part.filename?.split(".").pop()?.toUpperCase() ?? null
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

export function  getAssistantRenderGroups(
  parts: UIMessage["parts"],
  showThinking: boolean
): AssistantRenderGroup[] {
  const filteredParts = parts.filter((part) => showThinking || !isReasoningUIPart(part))
  const groups: AssistantRenderGroup[] = []

  const appendText = (text: string) => {
    if (!text.trim()) {
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

    if (!part.text.trim()) {
      return
    }

    const previous = groups.at(-1)
    if (previous?.kind === "reasoning") {
      previous.text += part.text
      previous.isStreaming = previous.isStreaming || part.state === "streaming"
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
