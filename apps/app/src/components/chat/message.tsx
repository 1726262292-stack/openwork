"use memo";

import * as React from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  FileIcon,
  LoaderCircle,
  Split,
  Undo2,
} from "lucide-react"
import { PaperGrainGradient } from "@openwork/ui/react"
import {
  DynamicToolUIPart,
  isFileUIPart,
  isTextUIPart,
  ToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai"
import { ApplyPatchTool } from "@/components/tools/apply-patch"
import { BashTool } from "@/components/tools/bash"
import { EditTool } from "@/components/tools/edit"
import { ReadFileTool, WriteFileTool } from "@/components/tools/file"
import { GlobTool } from "@/components/tools/glob"
import { GrepTool } from "@/components/tools/grep"
import { LspTool } from "@/components/tools/lsp"
import { QuestionTool } from "@/components/tools/question"
import { SkillTool } from "@/components/tools/skill"
import { TodoWriteTool } from "@/components/tools/todowrite"
import { WebfetchTool } from "@/components/tools/webfetch"
import { WebsearchTool } from "@/components/tools/websearch"
import { useMessageList } from "@/components/chat/message-list-provider"
import {
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { Button } from "@/components/ui/button"
import { Image } from "@/components/ui/image"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { Tool } from "@/components/ui/tool"
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
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import type { ThreadRetryAction } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { getAssistantRenderGroups, getFileTitle, getMediaBadge, getMessagesText, isEmptyMessage, isSessionErrorMessage } from "./utils"
import { openDesktopUrl } from "@/app/lib/desktop";

interface ToolMessageProps {
  part: ToolUIPart | DynamicToolUIPart
}

export function ToolMessage({ part }: ToolMessageProps) {
  if (isBashToolPart(part)) {
    return <BashTool part={part} />
  }

  if (isEditToolPart(part)) {
    return <EditTool part={part} />
  }

  if (isWriteToolPart(part)) {
    return <WriteFileTool part={part} />
  }

  if (isReadToolPart(part)) {
    return <ReadFileTool part={part} />
  }

  if (isGrepToolPart(part)) {
    return <GrepTool part={part} />
  }

  if (isGlobToolPart(part)) {
    return <GlobTool part={part} />
  }

  if (isLspToolPart(part)) {
    return <LspTool part={part} />
  }

  if (isApplyPatchToolPart(part)) {
    return <ApplyPatchTool part={part} />
  }

  if (isSkillToolPart(part)) {
    return <SkillTool part={part} />
  }

  if (isTodoWriteToolPart(part)) {
    return <TodoWriteTool part={part} />
  }

  if (isWebFetchToolPart(part)) {
    return <WebfetchTool part={part} />
  }

  if (isWebSearchToolPart(part)) {
    return <WebsearchTool part={part} />
  }

  if (isQuestionToolPart(part)) {
    return <QuestionTool part={part} />
  }

  return <Tool toolPart={part} />
}

interface FileMessageProps {
  part: FileUIPart
  tone: "user" | "assistant"
}

// TODO: Add tone to the file message
export function FileMessage({ part }: FileMessageProps) {
  const title = getFileTitle(part)
  const badge = getMediaBadge(part)
  const isImage = part.mediaType.startsWith("image/") && part.url

  if (isImage) {
    return (
      <Image
        src={part.url}
        alt={title}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    )
  }

  return (
    <div className="flex h-auto w-fit min-w-0 max-w-full shrink items-center justify-start gap-2 rounded-xl border border-border ps-2 pe-4 py-1 text-left text-sm font-medium whitespace-normal">
      <DescriptiveButtonIcon>
        <FileIcon className="size-6 shrink-0" />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className="gap-0">
        <DescriptiveButtonTitle>{title}</DescriptiveButtonTitle>
        {badge ? (
          <DescriptiveButtonDescription className="text-xs">
            {badge}
          </DescriptiveButtonDescription>
        ) : null}
      </DescriptiveButtonContent>
    </div>
  )
}

export function EmptyMessage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-2 md:px-10 text-muted-foreground",
        className
      )}
      {...props}
    >
      Empty message
    </div>
  )
}

interface CopyMessageButtonProps {
  messages: UIMessage[]
}

export function CopyMessageButton({ messages }: CopyMessageButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const text = React.useMemo(() => getMessagesText(messages), [messages])

  const onCopy = React.useCallback(async () => {
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures
    }
  }, [text])

  if (!text) {
    return null
  }

  return (
    <MessageAction tooltip={copied ? "Copied!" : "Copy"}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy message"
        onClick={() => void onCopy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </MessageAction>
  )
}

type AssistantMessageProps = {
  message: UIMessage
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
}

const AssistantMessage = React.memo(
  ({ message, isStreaming }: AssistantMessageProps) => {
    const { showThinking } = useMessageList()
    const assistantRenderGroups = React.useMemo(
      () => getAssistantRenderGroups(message.parts, showThinking),
      [message.parts, showThinking]
    )

    if (assistantRenderGroups.length === 0) {
      if (isStreaming) {
        return null
      }

      return (
        <EmptyMessage
          data-message-id={message.id}
          data-message-role={message.role}
        />
      )
    }

    return (
      <Message
        className="mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col gap-0 space-y-2">
          {assistantRenderGroups.map((group, index) => {
            if (group.kind === "text") {
              return (
                <MessageContent
                  key={`text-${index}`}
                  className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
                  markdown
                >
                  {group.text}
                </MessageContent>
              )
            }

            if (group.kind === "reasoning") {
              return (
                <MessageContent
                  key={`reasoning-${index}`}
                  className="text-muted-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
                  markdown
                >
                  {group.text}
                </MessageContent>
              )
            }

            if (group.kind === "file") {
              return (
                <div key={`file-${index}`} className="w-full">
                  <FileMessage part={group.part} tone="assistant" />
                </div>
              )
            }

            return (
              <div key={`tool-${index}`} className="w-full">
                <ToolMessage part={group.part} />
              </div>
            )
          })}
        </div>
      </Message>
    )
  }
)

AssistantMessage.displayName = "AssistantMessage"

type UserMessageProps = {
  message: UIMessage
  isStreaming: boolean
}

const USER_SKILL_TOKEN_RE = /(Load \[skill [^\]]+\] and follow its instructions\.|\[skill [^\]]+\])/

interface UserSkillChipProps {
  name: string
}

function UserSkillChip({ name }: UserSkillChipProps) {
  return (
    <span
      className="mx-0.5 inline-flex items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11 align-middle"
      title={`Skill: ${name}`}
    >
      {name}
    </span>
  )
}

function renderUserTextWithSkillChips(text: string) {
  if (!USER_SKILL_TOKEN_RE.test(text)) {
    return text
  }

  let offset = 0

  return text.split(USER_SKILL_TOKEN_RE).map((segment) => {
    const key = `${offset}:${segment}`
    offset += segment.length
    const skillMatch = segment.match(/^(?:Load )?\[skill ([^\]]+)\](?: and follow its instructions\.)?$/)

    if (skillMatch?.[1]) {
      return <UserSkillChip key={key} name={skillMatch[1]} />
    }

    return <React.Fragment key={key}>{segment}</React.Fragment>
  })
}

export const UserMessage = React.memo(
  ({ message, isStreaming }: UserMessageProps) => {
    const { onRevertToUserMessage, onForkAtMessage } = useMessageList()
    const inlineParts = message.parts.filter(isTextUIPart)

    return (
      <Message
        className="mx-auto flex w-full max-w-3xl flex-col items-end gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col items-end gap-1">
          {message.parts.filter(isFileUIPart).map((part, index) => (
            <FileMessage key={`${part.url}-${index}`} part={part} tone="user" />
          ))}
          {inlineParts.length > 0 ? (
            <MessageContent
              layoutId={message.id}
              className="bg-muted text-foreground max-w-[85%] rounded-3xl px-5 py-2.5 whitespace-pre-wrap sm:max-w-[75%]"
            >
              {inlineParts.map((part, index) => (
                <React.Fragment key={`text-${index}`}>
                  {renderUserTextWithSkillChips(part.text)}
                </React.Fragment>
              ))}
            </MessageContent>
          ) : null}
          {!isStreaming && (
            <MessageActions
              className={cn(
                "flex gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              )}
            >
              <CopyMessageButton messages={[message]} />
              <MessageAction tooltip="Branch in new chat">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onForkAtMessage(message.id)}
                >
                  <Split className="rotate-90" />
                </Button>
              </MessageAction>
              <MessageAction tooltip="Revert">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRevertToUserMessage(message.id)}
                >
                  <Undo2 />
                </Button>
              </MessageAction>
            </MessageActions>
          )}
        </div>
      </Message>
    )
  }
)

UserMessage.displayName = "UserMessage"

type MessageComponentProps = {
  message: UIMessage
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
}

export const MessageComponent = React.memo(
  ({ message, isLastMessage, isStreaming, isLastStep }: MessageComponentProps) => {
    if (isSessionErrorMessage(message)) {
      return <ErrorMessage error={getMessagesText([message]) || "Session failed"} />
    }

    if (isEmptyMessage(message)) {
      if (isStreaming) {
        return null
      }

      return (
        <EmptyMessage
          data-message-id={message.id}
          data-message-role={message.role}
        />
      )
    }

    if (message.role === "assistant") {
      return (
        <AssistantMessage
          message={message}
          isLastMessage={isLastMessage}
          isStreaming={isStreaming}
          isLastStep={isLastStep}
        />
      )
    }

    return (
      <UserMessage
        message={message}
        isStreaming={isStreaming}
      />
    )
  }
)

MessageComponent.displayName = "MessageComponent"

export const LoadingMessage = React.memo(() => (
  <Message className="mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-2 md:px-10">
    <div className="group flex w-full flex-col gap-0">
      <div className="flex items-center gap-1.5 px-1 py-1 text-sm text-muted-foreground">
        <div style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden" }}>
          <PaperGrainGradient
            speed={12}
            softness={0.1}
            intensity={1}
            noise={0.05}
            shape="sphere"
            colors={["#818cf8", "#fb7185", "#fbbf24", "#34d399"]}
            colorBack="#ffffff00"
            style={{ backgroundColor: "#818cf8", width: "100%", height: "100%", borderRadius: "50%" }}
          />
        </div>
        <span>Thinking…</span>
      </div>
    </div>
  </Message>
))

LoadingMessage.displayName = "LoadingMessage"

interface ErrorMessageProps {
  error: string | null
}

export function ErrorMessage({ error }: ErrorMessageProps) {
  return (
    <Message className="not-prose mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex min-w-0 flex-1 flex-row items-start gap-2 rounded-lg border-2 border-red-300 bg-red-300/20 px-2 py-1">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
          <p className="whitespace-pre-wrap text-destructive">{error}</p>
        </div>
      </div>
    </Message>
  )
}

interface RetryActionButtonProps {
  link: string;
  children: React.ReactNode;
}

function RetryActionButton({ children, link }: RetryActionButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 border-amber-500/70 bg-amber-50 text-xs text-amber-950 hover:bg-amber-100"
      onClick={() => void openDesktopUrl(link)}
    >
      {children}
    </Button>
  )
}


function retryDelaySeconds(timestamp: number) {
  return Math.max(0, Math.round((timestamp - Date.now()) / 1000))
}

function useCountdown(timestamp: number) {
  const [seconds, setSeconds] = React.useState(() => retryDelaySeconds(timestamp))

  React.useEffect(() => {
    const update = () => setSeconds(retryDelaySeconds(timestamp))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [timestamp])

  return seconds
}

interface RetryMessageProps {
  attempt: number
  message: string
  action?: ThreadRetryAction
}

export const RetryMessage = React.memo(({ attempt, message, action }: RetryMessageProps) => {
  const seconds = useCountdown(0)

  return (
    <Message className="not-prose mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex min-w-0 flex-1 flex-col gap-2 rounded-lg border-2 border-amber-300 bg-amber-300/20 px-3 py-2">
          <div className="flex items-start gap-2">
            <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-amber-700" />
            <div className="min-w-0 space-y-1">
              <p className="whitespace-pre-wrap text-sm font-medium text-amber-900">{message}</p>
              <p className="text-xs text-amber-800">
                {seconds > 0
                  ? `Retrying in ${seconds}s · attempt ${attempt}`
                  : `Retrying · attempt ${attempt}`}
              </p>
            </div>
          </div>
          {action ? (
            <div className="ml-6 space-y-1 border-t border-amber-400/60 pt-2">
              <p className="text-xs font-medium text-amber-950">{action.title}</p>
              <p className="text-xs text-amber-900">{action.message}</p>
              {action.link ? (
                <RetryActionButton link={action.link}>
                  {action.label}
                </RetryActionButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Message>
  )
})

RetryMessage.displayName = "RetryMessage"