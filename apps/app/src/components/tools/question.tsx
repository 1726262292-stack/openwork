"use client"

import type { QuestionToolPart } from "@/lib/build-in-tools"
import { truncateText } from "@/components/tools/path"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"

interface QuestionToolProps {
  part: QuestionToolPart
}

interface ParsedQuestionAnswer {
  question: string
  answer: string
}

const QUESTION_ANSWER_PATTERN = /"([^"]*)"="([^"]*)"/g

function parseQuestionOutput(output: string): ParsedQuestionAnswer[] {
  const answers: ParsedQuestionAnswer[] = []

  for (const match of output.matchAll(QUESTION_ANSWER_PATTERN)) {
    const question = match[1]
    const answer = match[2]
    if (question && answer) {
      answers.push({ question, answer })
    }
  }

  return answers
}

export function QuestionTool({ part }: QuestionToolProps) {
  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">
          Asking question...
        </span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">
          Question attempted
        </span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const answers = parseQuestionOutput(part.output)

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger disabled={answers.length === 0}>
          <span className="flex min-w-0 gap-2">
            <span className="shrink-0">
              {answers.length > 1
                ? `Answered ${answers.length} questions`
                : `Answered ${
                  part.input.questions[0]?.header || part.input.questions[0]?.question
                    ? truncateText(part.input.questions[0]?.header || part.input.questions[0]?.question || "", 56)
                    : part.input.questions.length > 1
                      ? `${part.input.questions.length} questions`
                      : "a question"
                }`}
            </span>
            {answers.length === 1 ? (
              <span className="grow truncate opacity-80">{answers[0].answer}</span>
            ) : null}
          </span>
        </CollapsibleToolTrigger>
        {answers.length > 0 ? (
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <div className="flex flex-col gap-2 text-xs">
              {answers.map((item) => (
                <div key={item.question} className="space-y-1">
                  <div className="font-medium">{item.question}</div>
                  <div className="opacity-80">{item.answer}</div>
                </div>
              ))}
            </div>
          </CollapsibleToolContent>
        ) : null}
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
