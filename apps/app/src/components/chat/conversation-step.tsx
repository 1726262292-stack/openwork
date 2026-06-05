"use memo";

import * as React from "react"
import {
  Split,
  Undo2,
} from "lucide-react"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  type Variants,
} from "motion/react"
import {
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai"
import { useMessageList } from "@/components/chat/message-list-provider"
import { ArtifactList } from "@/components/chat/artifact"
import { Button } from "@/components/ui/button"
import { Message, MessageAction, MessageActions, MessageContent } from "@/components/ui/message"
import {
  Steps,
  StepsContent,
  StepsTrigger,
} from "@/components/ui/steps"
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area"
import {
  CopyMessageButton,
  EmptyMessage,
  FileMessage,
  MessageComponent,
  ToolMessage,
} from "@/components/chat/message"
import { isBashToolPart, isReadToolPart, isWebSearchToolPart } from "@/lib/build-in-tools"
import { getLastTextPart, type UIMessageWithIndex, getAssistantRenderGroups } from "./utils"
import { cn } from "@/lib/utils";

function isRenderableMessagePart(part: UIMessage["parts"][number]) {
  return (isTextUIPart(part) && part.text.trim().length > 0) || part.type === "file";
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

function getStepSummary(items: UIMessageWithIndex[]) {
  let webSearches = 0
  let filesRead = 0
  let commandsRan = 0

  for (const { message } of items) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) {
        continue
      }

      if (isWebSearchToolPart(part)) {
        webSearches++
      } else if (isReadToolPart(part)) {
        filesRead++
      } else if (isBashToolPart(part)) {
        commandsRan++
      }
    }
  }

  const summary = [pluralize(items.length, "step", "steps")]

  if (webSearches > 0) {
    summary.push(pluralize(webSearches, "web search", "web searches"))
  }

  if (filesRead > 0) {
    summary.push(pluralize(filesRead, "file read", "files read"))
  }

  if (commandsRan > 0) {
    summary.push(pluralize(commandsRan, "command ran", "commands ran"))
  }

  return summary.join(", ")
}

const getRenderableMessages = (messages: UIMessageWithIndex[]) =>
  messages.flatMap((item) => {
    const parts = item.message.parts.filter(isRenderableMessagePart);

    return parts.length > 0 ? [{ ...item, message: { ...item.message, parts } }] : []
  })

interface AssistantMessageGroupProps {
  items: UIMessageWithIndex[]
  messages: UIMessage[]
  isStreaming: boolean
}

export function MessageGroup({
  items,
  messages,
  isStreaming,
}: AssistantMessageGroupProps) {
  const { onRevertToUserMessage, onForkAtMessage, showThinking } = useMessageList()
  const [open, setOpen] = React.useState(false)
  // Only run layout animations while the collapsible is expanding/collapsing.
  // Otherwise (e.g. while streaming) layout changes apply instantly.
  const [isAnimating, setIsAnimating] = React.useState(false)
  const layoutTransition = isAnimating
  ? { type: "spring" as const, bounce: 0.1, duration: 0.1 }
  : { duration: 0 }

  const lastItem = items[items.length - 1]
  const hasVisibleContent = items.some((item) => getAssistantRenderGroups(item.message.parts, showThinking).length > 0)

  if (!lastItem || !hasVisibleContent) {
    if (isStreaming) {
      return null;
    }

    return <EmptyMessage />
  }

  const renderableItems = getRenderableMessages(items)
  const lastTextMessage = getLastTextPart(lastItem.message)
  const latestRenderGroup = items
    .map((item) => getAssistantRenderGroups(item.message.parts, showThinking))
    .findLast((groups) => groups.length > 0)
    ?.at(-1)
  const shouldShowStepPreview =
    !open && items.length > 0 && isStreaming && latestRenderGroup?.kind !== "text"

  return (
    <LayoutGroup>
      <div className="flex flex-col gap-2 group/message-group">
      <Steps
        className="mx-auto w-full max-w-3xl"
        open={open}
        onOpenChange={(next) => {
          setIsAnimating(true)
          setOpen(next)
        }}
      >
        <StepsTrigger className="px-2 md:px-10">
          {getStepSummary(items)}
        </StepsTrigger>
        <StepsContent>
          {items.map((item, groupIndex) => {
            const isLastMessage = item.index === messages.length - 1
            const isLastStep = groupIndex === items.length - 1

            return (
              <motion.div
                key={`${groupIndex}-${item.message.id}`}
                layoutId={`msg-${item.message.id}`}
                layout
                transition={layoutTransition}
                onLayoutAnimationComplete={() => setIsAnimating(false)}
              >
                <MessageComponent
                  message={item.message}
                  isLastMessage={isLastMessage}
                  isStreaming={isStreaming}
                  isLastStep={isLastStep}
                />
              </motion.div>
            )
          })}
        </StepsContent>
      </Steps>
      <AnimatePresence initial={false}>
        {!open ? renderableItems.map(({ index, message }) => (
          <motion.div
            key={message.id}
            layoutId={`msg-${message.id}`}
            layout
            transition={layoutTransition}
            onLayoutAnimationComplete={() => setIsAnimating(false)}
          >
            <MessageComponent
              message={message}
              isStreaming={index === messages.length - 1 && isStreaming}
              isLastMessage={index === messages.length - 1}
              isLastStep={index === items.length}
            />
          </motion.div>
        )) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {shouldShowStepPreview ? (
          <StepPreview key="step-preview" items={items} />
        ) : null}
      </AnimatePresence>
      <ArtifactList messages={items.map((item) => item.message)} />
      {lastTextMessage && !isStreaming && (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-2 opacity-0 transition-opacity duration-150 group-hover/message-group:opacity-100 md:px-8">
          <MessageActions className="flex gap-0">
            <CopyMessageButton messages={renderableItems.map((item) => item.message)} />
            <MessageAction tooltip="Branch in new chat">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onForkAtMessage(lastItem.message.id)}
              >
                <Split className="rotate-90" />
              </Button>
            </MessageAction>
            <MessageAction tooltip="Revert">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRevertToUserMessage(lastItem.message.id)}
              >
                <Undo2 />
              </Button>
            </MessageAction>
          </MessageActions>
          {/* <MessageSources messages={items.map((item) => item.message)} /> */}
        </div>
      )}
      {renderableItems.length === 0 && !isStreaming ? <EmptyMessage /> : null}
      </div>
    </LayoutGroup>
  )
}

interface StepPreviewProps {
  items: UIMessageWithIndex[]
}

const stepPreviewVariants: Variants = {
  enter: { opacity: 0, y: -20, filter: "blur(4px)" },
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 20, filter: "blur(4px)" },
}

export function StepPreview({ items }: StepPreviewProps) {
  const { showThinking } = useMessageList()
  const lastMessage = items.findLast((item) => getAssistantRenderGroups(item.message.parts, showThinking).length > 0)?.message;

  if (!lastMessage) {
    return null
  }

  return (
    <motion.div
      className="relative max-h-96 overflow-hidden"
      variants={stepPreviewVariants}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      initial="enter"
      animate="center"
      exit="exit"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={lastMessage.id}
          variants={stepPreviewVariants}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <PreviewMessage
            message={lastMessage}
            isLastMessage
          />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

type AssistantMessageProps = {
  message: UIMessage
  isLastMessage: boolean
}

const PreviewMessage = React.memo(
  ({ message }: AssistantMessageProps) => {
    const { showThinking } = useMessageList()
    const assistantRenderGroups = React.useMemo(
      () => getAssistantRenderGroups(message.parts, showThinking).slice(-2),
      [message.parts, showThinking]
    )

    return (
      <Message
        className="mx-auto flex w-full max-w-3xl flex-col items-start gap-2 px-2 md:px-10"
        // data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col gap-0 space-y-2">
          {assistantRenderGroups.map((group, index) => {
            if (group.kind === "text") {
              return (
                <PreviewContainer key={`text-${index}`} className="w-full">
                  <MessageContent
                    className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
                    markdown
                  >
                    {group.text}
                  </MessageContent>
                </PreviewContainer>
              )
            }

            if (group.kind === "reasoning") {
              return (
                <PreviewContainer key={`reasoning-${index}`} className="w-full">
                  <MessageContent
                    className="text-muted-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
                    markdown
                  >
                    {group.text}
                  </MessageContent>
                </PreviewContainer>
              )
            }

            if (group.kind === "file") {
              return (
                <PreviewContainer key={`file-${index}`} className="w-full">
                  <FileMessage part={group.part} tone="assistant" />
                </PreviewContainer>
              )
            }

            if (group.kind === "tool") {
              return (
                <PreviewContainer key={`tool-${index}`} className="w-full">
                  <ToolMessage part={group.part} />
                </PreviewContainer>
              )
            }

            return null
          })}
        </div>
      </Message>
    )
  }
)

PreviewMessage.displayName = "PreviewMessage"

interface PreviewContainerProps {
  children: React.ReactNode
  className?: string
}

function PreviewContainer({ children, className }: PreviewContainerProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) {
      return
    }

    const stickToBottom = () => {
      viewport.scrollTop = viewport.scrollHeight
    }

    stickToBottom()
    const observer = new ResizeObserver(stickToBottom)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return (
    <ScrollArea
      className={cn(
        "**:data-[slot=scroll-area-scrollbar]:hidden",
        className,
      )}
    >
      <ScrollAreaViewport ref={viewportRef} className="max-h-24 pointer-events-none select-none">
        <div ref={contentRef}>{children}</div>
      </ScrollAreaViewport>
    </ScrollArea>
  )
}