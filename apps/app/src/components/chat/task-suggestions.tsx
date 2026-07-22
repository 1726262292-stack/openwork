"use client"

import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { cn } from "@/lib/utils"
import { t } from "@/i18n"
import { useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider"
import { useLocal } from "@/react-app/kernel/local-provider"
import { BoltIcon, CubeIcon, DocumentChartBarIcon, GlobeAltIcon, SparklesIcon } from "@heroicons/react/24/solid"

const CSV_PROMPT =
  "Create a sample CSV file with 20 rows of fake customer data (name, email, company, revenue). Then show me a summary of the data."

const BROWSER_PROMPT =
  "Open craigslist.org in the browser and search for couches for sale. Show me the top 5 results with prices."

const ORGANIZATION_PROMPT_TITLES = ["Organization prompt 1", "Organization prompt 2", "Organization prompt 3"]

export function resolveOrganizationPromptCardContent(input: {
  prompt: string
  description?: string
  index: number
}) {
  const title = input.description?.trim()
  return {
    title: title || ORGANIZATION_PROMPT_TITLES[input.index] || "Organization prompt",
    description: input.prompt,
    selectionPrompt: input.prompt,
  }
}

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()
  const local = useLocal()
  const orgRestrictions = useOrgRestrictions()
  const organizationPrompts = orgRestrictions.onboardingPrompts
  const organizationPromptDescriptions = orgRestrictions.onboardingPromptDescriptions

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0
  const hasOrganizationPrompts = organizationPrompts !== undefined
  const showChatFirstSuggestions = local.prefs.featureFlags.chatFirstOnboarding && !hasOrganizationPrompts
  const chatFirstCards = [
    {
      title: t("suggestions.summarize_week"),
      description: t("suggestions.summarize_week_desc"),
      prompt: t("suggestions.summarize_week_prompt"),
      icon: <SparklesIcon className="size-6 text-purple-10" aria-hidden />,
    },
    {
      title: t("suggestions.clean_spreadsheet"),
      description: t("suggestions.clean_spreadsheet_desc"),
      prompt: t("suggestions.clean_spreadsheet_prompt"),
      icon: <DocumentChartBarIcon className="size-6 text-green-10" aria-hidden />,
    },
    {
      title: t("suggestions.draft_document"),
      description: t("suggestions.draft_document_desc"),
      prompt: t("suggestions.draft_document_prompt"),
      icon: <CubeIcon className="size-6 text-amber-10" aria-hidden />,
    },
    {
      title: t("suggestions.automate_web_task"),
      description: t("suggestions.automate_web_task_desc"),
      prompt: t("suggestions.automate_web_task_prompt"),
      icon: <GlobeAltIcon className="size-6 text-blue-10" aria-hidden />,
    },
  ]

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {showChatFirstSuggestions
          ? t("suggestions.what_do_you_need")
          : noProviders
          ? "Connect a model provider to get started:"
          : hasOrganizationPrompts
            ? "Try one of your organization's prompts:"
            : "Try one of these:"}
      </p>
      {/* Chat-first keeps the four suggestions even with zero providers (the
          composer's "No AI model connected" notice carries provider guidance
          on fresh installs). */}
      <div className={cn("grid min-w-0 gap-2 @lg:grid-cols-2", showChatFirstSuggestions ? "@2xl:grid-cols-4" : "@2xl:grid-cols-3")}>
        {noProviders && !showChatFirstSuggestions ? (
          <DescriptiveButton
            orientation="vertical"
            className={cn(
              "border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2",
              showChatFirstSuggestions ? "@2xl:col-span-4" : "@2xl:col-span-3",
            )}
            onClick={() =>
              dispatchAction({
                target: "settings",
                action: "open",
                section: "providers",
              })
            }
          >
            <DescriptiveButtonIcon>
              <BoltIcon className="size-6 text-blue-10" aria-hidden />
            </DescriptiveButtonIcon>
            <DescriptiveButtonContent>
              <DescriptiveButtonTitle>Connect a model provider</DescriptiveButtonTitle>
              <DescriptiveButtonDescription>
                Add an API key for Anthropic, OpenAI, Google, or others
              </DescriptiveButtonDescription>
            </DescriptiveButtonContent>
          </DescriptiveButton>
        ) : null}

        {hasOrganizationPrompts ? (
          organizationPrompts.map((prompt, index) => {
            const card = resolveOrganizationPromptCardContent({
              prompt,
              description: organizationPromptDescriptions?.[index],
              index,
            })
            return (
              <DescriptiveButton key={`${index}-${prompt}`} orientation="vertical" onClick={() => setPrompt(card.selectionPrompt)}>
                <DescriptiveButtonIcon>
                  <SparklesIcon className="size-6 text-purple-10" aria-hidden />
                </DescriptiveButtonIcon>
                <DescriptiveButtonContent>
                  <DescriptiveButtonTitle>{card.title}</DescriptiveButtonTitle>
                  <DescriptiveButtonDescription>{card.description}</DescriptiveButtonDescription>
                </DescriptiveButtonContent>
              </DescriptiveButton>
            )
            })
        ) : (
          showChatFirstSuggestions ? (
            <>
              {chatFirstCards.map((card) => (
                <DescriptiveButton key={card.title} orientation="vertical" onClick={() => setPrompt(card.prompt)}>
                  <DescriptiveButtonIcon>{card.icon}</DescriptiveButtonIcon>
                  <DescriptiveButtonContent>
                    <DescriptiveButtonTitle>{card.title}</DescriptiveButtonTitle>
                    <DescriptiveButtonDescription>{card.description}</DescriptiveButtonDescription>
                  </DescriptiveButtonContent>
                </DescriptiveButton>
              ))}
            </>
          ) : (
          <>
            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(CSV_PROMPT)}>
              <DescriptiveButtonIcon>
                <DocumentChartBarIcon className="size-6 text-green-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Edit a CSV</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Create a sample spreadsheet</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(BROWSER_PROMPT)}>
              <DescriptiveButtonIcon>
                <GlobeAltIcon className="size-6 text-blue-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Browse the web</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Search Craigslist for couches</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton
              orientation="vertical"
              onClick={() =>
                dispatchAction({
                  target: "settings",
                  action: "open",
                  section: "mcps",
                })
              }
            >
              <DescriptiveButtonIcon>
                <CubeIcon className="size-6 text-amber-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Connect an extension</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Add MCPs and integrations</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>
          </>
          )
        )}
      </div>
    </div>
  )
}
