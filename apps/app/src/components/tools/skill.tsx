"use client"

import type { SkillToolPart } from "@/lib/build-in-tools"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"

interface SkillToolProps {
  part: SkillToolPart
}

interface ParsedSkillOutput {
  name?: string
  content: string
  files: string[]
}

const SKILL_CONTENT_PATTERN = /<skill_content(?:\s+name="([^"]*)")?>([\s\S]*?)<\/skill_content>/
const SKILL_FILES_PATTERN = /<skill_files>([\s\S]*?)<\/skill_files>/
const SKILL_FILE_PATTERN = /<file>([\s\S]*?)<\/file>/g

function parseSkillOutput(output: string): ParsedSkillOutput {
  const contentMatch = SKILL_CONTENT_PATTERN.exec(output)
  const name = contentMatch?.[1]
  const rawContent = contentMatch?.[2] ?? output
  const filesBlock = SKILL_FILES_PATTERN.exec(rawContent)?.[1] ?? ""
  const files: string[] = []

  for (const fileMatch of filesBlock.matchAll(SKILL_FILE_PATTERN)) {
    const file = fileMatch[1]?.trim()
    if (file) {
      files.push(file)
    }
  }

  return {
    name,
    content: rawContent.replace(SKILL_FILES_PATTERN, ""),
    files,
  }
}

export function SkillTool({ part }: SkillToolProps) {
  if (part.state === "input-streaming") {
    return (
      <div>
        <span className="text-muted-foreground">
          {part.input.name ? `Loading skill ${part.input.name}` : "Loading skill"}
        </span>
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div>
        <span className="text-muted-foreground">
          {part.input.name ? `Load skill ${part.input.name}` : "Load skill"} attempted
        </span>
      </div>
    )
  }

  if (part.state !== "output-available") {
    return null
  }

  const output = parseSkillOutput(part.output)
  const outputName = output.name || part.input.name
  const hasContent = /\S/.test(output.content)
  const hasDetails = hasContent || output.files.length > 0

  return (
    <CollapsibleTool>
      <CollapsibleToolStep className="flex flex-col gap-2">
        <CollapsibleToolTrigger disabled={!hasDetails}>
          <span className="flex min-w-0 gap-2">
            <span className="shrink-0">
              {outputName ? `Loaded skill ${outputName}` : "Loaded skill"}
            </span>
            {output.files.length > 0 ? (
              <span className="shrink-0 opacity-80">
                {output.files.length} {output.files.length === 1 ? "file" : "files"}
              </span>
            ) : null}
          </span>
        </CollapsibleToolTrigger>
        {hasDetails ? (
          <CollapsibleToolContent className="bg-muted rounded-lg p-2">
            <div className="flex max-h-64 flex-col gap-3 overflow-auto text-xs">
              {hasContent ? (
                <pre className="whitespace-pre-wrap wrap-break-word">
                  {output.content}
                </pre>
              ) : null}
              {output.files.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <div className="font-medium">Files</div>
                  {output.files.map((file, index) => (
                    <div key={`${file}-${index}`} className="font-mono opacity-80">
                      {file}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CollapsibleToolContent>
        ) : null}
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
