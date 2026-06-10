import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
import {
  isApplyPatchToolPart,
  isBashToolPart,
  isEditToolPart,
  isGlobToolPart,
  isGrepToolPart,
  isLspToolPart,
  isQuestionToolPart,
  isReadToolPart,
  isSkillToolPart,
  isTaskToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import { parseFilename, truncateText } from "@/components/tools/path"

type AnyToolPart = ToolUIPart | DynamicToolUIPart

export function isToolPartInFlight(part: AnyToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available"
}

export function collectToolParts(messages: UIMessage[]): DynamicToolUIPart[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part): part is DynamicToolUIPart => part.type === "dynamic-tool"
    )
  )
}

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Human-readable "what is this tool doing" label. Safe against partial
 * streamed input (fields may be missing despite the type contract).
 */
export function getToolActivityLabel(part: AnyToolPart): string {
  if (isBashToolPart(part)) {
    const description = part.input?.description?.trim()
    return description ? truncateText(description, 64) : "Running a command"
  }
  if (isReadToolPart(part)) {
    return `Reading ${parseFilename(part.input?.filePath)}`
  }
  if (isEditToolPart(part)) {
    return `Editing ${parseFilename(part.input?.filePath)}`
  }
  if (isWriteToolPart(part)) {
    return `Writing ${parseFilename(part.input?.filePath)}`
  }
  if (isApplyPatchToolPart(part)) {
    return "Applying changes"
  }
  if (isGrepToolPart(part) || isGlobToolPart(part)) {
    const pattern = part.input?.pattern?.trim()
    return pattern
      ? `Searching for ${truncateText(pattern, 44)}`
      : "Searching files"
  }
  if (isLspToolPart(part)) {
    return `Inspecting ${parseFilename(part.input?.filePath)}`
  }
  if (isSkillToolPart(part)) {
    const name = part.input?.name?.trim()
    return name ? `Loading ${name} skill` : "Loading a skill"
  }
  if (isTodoWriteToolPart(part)) {
    return "Updating the plan"
  }
  if (isWebFetchToolPart(part)) {
    const host = hostnameOf(part.input?.url)
    return host ? `Reading ${host}` : "Fetching a page"
  }
  if (isWebSearchToolPart(part)) {
    const query = part.input?.query?.trim()
    return query
      ? `Searching the web for ${truncateText(query, 44)}`
      : "Searching the web"
  }
  if (isQuestionToolPart(part)) {
    return "Asking a question"
  }
  if (isTaskToolPart(part)) {
    const description = part.input?.description?.trim()
    return description
      ? `Agent: ${truncateText(description, 56)}`
      : "Running an agent"
  }
  if (part.type === "dynamic-tool") {
    return `Running ${part.toolName.replace(/[_-]+/g, " ")}`
  }
  return "Working"
}

/** Label for the most recent tool still in flight, if any. */
export function getActiveToolLabel(parts: DynamicToolUIPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part && isToolPartInFlight(part)) {
      return getToolActivityLabel(part)
    }
  }
  return null
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Outcome summary for a finished run of tool calls, e.g.
 * "Read 6 files · Edited 2 files · Ran 3 commands".
 */
export function summarizeToolParts(parts: DynamicToolUIPart[]): string | null {
  const readFiles = new Set<string>()
  const editedFiles = new Set<string>()
  let commands = 0
  let searches = 0
  let fetches = 0
  let agents = 0
  let planUpdates = 0
  let other = 0
  let failed = 0

  for (const part of parts) {
    if (part.state === "output-error") {
      failed += 1
    }
    if (isReadToolPart(part)) {
      readFiles.add(part.input?.filePath ?? part.toolCallId)
    } else if (isEditToolPart(part) || isWriteToolPart(part)) {
      editedFiles.add(part.input?.filePath ?? part.toolCallId)
    } else if (isApplyPatchToolPart(part)) {
      editedFiles.add(part.toolCallId)
    } else if (isBashToolPart(part)) {
      commands += 1
    } else if (
      isGrepToolPart(part) ||
      isGlobToolPart(part) ||
      isWebSearchToolPart(part)
    ) {
      searches += 1
    } else if (isWebFetchToolPart(part)) {
      fetches += 1
    } else if (isTaskToolPart(part)) {
      agents += 1
    } else if (isTodoWriteToolPart(part)) {
      planUpdates += 1
    } else {
      other += 1
    }
  }

  const segments: string[] = []
  if (readFiles.size > 0) {
    segments.push(`Read ${formatCount(readFiles.size, "file")}`)
  }
  if (editedFiles.size > 0) {
    segments.push(`Edited ${formatCount(editedFiles.size, "file")}`)
  }
  if (commands > 0) {
    segments.push(`Ran ${formatCount(commands, "command")}`)
  }
  if (searches > 0) {
    segments.push(formatCount(searches, "search", "searches"))
  }
  if (fetches > 0) {
    segments.push(`Fetched ${formatCount(fetches, "page")}`)
  }
  if (agents > 0) {
    segments.push(`Ran ${formatCount(agents, "agent")}`)
  }
  if (planUpdates > 0) {
    segments.push("Updated plan")
  }
  if (other > 0) {
    segments.push(formatCount(other, "action"))
  }
  if (failed > 0) {
    segments.push(`${failed} failed`)
  }

  return segments.length > 0 ? segments.join(" · ") : null
}
