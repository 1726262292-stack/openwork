"use memo";

import * as React from "react"
import type { UIMessage } from "ai"
import { MessageGroup } from "@/components/chat/conversation-step"
import {
  ErrorMessage,
  LoadingMessage,
  MessageComponent,
  RetryMessage,
} from "@/components/chat/message"
import { useSessionErrorMessage } from "@/components/chat/message-list-provider"
import { TaskSuggestions } from "@/components/chat/task-suggestions"
import type { ThreadStatus } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { groupMessages, isMessageGroup, isSessionErrorMessage } from "./utils"

interface MessageListProps {
  messages: UIMessage[]
  status: ThreadStatus
}

export function MessageList({ messages, status }: MessageListProps) {
  const isStreaming = status.type === "streaming" || status.type === "retrying"
  const items = React.useMemo(() => groupMessages(messages, status), [messages, status]);
  const error = useSessionErrorMessage()
  const hasSessionErrorMessage = React.useMemo(() => messages.some(isSessionErrorMessage), [messages])

  return (
    <div className={cn("flex flex-col gap-2 @container/message-list")}>
      <span> Status: {status.type}</span>
      {messages.length === 0 && <TaskSuggestions className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3 md:px-5 md:pb-5 grow" />}

      {items.map((item) => {
        if (isMessageGroup(item)) {
          return (
            <MessageGroup
              key={item.messages[0]?.message.id ?? "empty-assistant-group"}
              items={item.messages}
              messages={messages}
              isStreaming={isStreaming}
            />
          )
        }

        const isLastMessage = item.index === messages.length - 1
        const isLastStep =
          !messages[item.index + 1] || messages[item.index + 1].role !== item.message.role

        return (
          <div key={item.message.id}>
            <MessageComponent
              message={item.message}
              isLastMessage={isLastMessage}
              isStreaming={isLastMessage && isStreaming}
              isLastStep={isLastStep}
            />
          </div>
        )
      })}

      {status.type === "streaming" && <LoadingMessage />}
      {status.type === "retrying" ? <RetryMessage attempt={status.attempt} message={status.message} action={status.action} /> : null}
      {error && !hasSessionErrorMessage ? <ErrorMessage error={error} /> : null}
    </div>
  )
}
