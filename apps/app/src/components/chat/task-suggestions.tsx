"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { createDenClient, readDenSettings } from "@/app/lib/den"
import { t } from "@/i18n"
import { cn } from "@/lib/utils"
import { useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider"
import {
  EMPTY_CONNECT_CAPABILITY_INVENTORY,
  listAssignedConnectCapabilities,
  type ConnectCapabilityInventory,
  type ConnectCapabilityReadiness,
} from "@/react-app/domains/session/surface/connect-capability-inventory"
import { encodeConnectSkillToken } from "@/react-app/domains/session/surface/composer/connect-skill-token"
import { BoltIcon, CubeIcon, DocumentChartBarIcon, GlobeAltIcon, SparklesIcon } from "@heroicons/react/24/solid"
import type {
  OnboardingPrompt,
  OnboardingPromptConnectSkillReference,
  OnboardingPromptSkillReference,
} from "@openwork/types/den/desktop-policies"

const CSV_PROMPT =
  "Create a sample CSV file with 20 rows of fake customer data (name, email, company, revenue). Then show me a summary of the data."

const BROWSER_PROMPT =
  "Open craigslist.org in the browser and search for couches for sale. Show me the top 5 results with prices."

const ORGANIZATION_PROMPT_TITLES = ["Organization prompt 1", "Organization prompt 2", "Organization prompt 3"]

export type OrganizationPromptSkillReadiness = ConnectCapabilityReadiness | "checking"
export type OrganizationPromptCardAction = "fill" | "open_connect" | "blocked"

const EMPTY_PROMPT_READINESS: Record<string, OrganizationPromptSkillReadiness> = {}

function promptText(prompt: string | OnboardingPrompt) {
  return typeof prompt === "string" ? prompt : prompt.prompt
}

function promptSkill(prompt: string | OnboardingPrompt) {
  return typeof prompt === "string" ? undefined : prompt.skill
}

function skillLabel(skill: OnboardingPromptSkillReference) {
  return `/${skill.slug}`
}

export function organizationPromptSkillKey(skill: OnboardingPromptSkillReference) {
  return skill.source === "local"
    ? `local:${skill.slug}`
    : `connect:${skill.marketplaceId}:${skill.pluginId}:${skill.configObjectId}:${skill.capabilityName}`
}

function connectSkillPath(skill: OnboardingPromptConnectSkillReference) {
  return `openwork-connect://${skill.marketplaceId}/${skill.pluginId}/${skill.configObjectId}`
}

export function readinessLabel(readiness: OrganizationPromptSkillReadiness) {
  switch (readiness) {
    case "ready":
      return t("connect.group_ready")
    case "needs_signin":
      return t("connect.group_needs_signin")
    case "needs_admin_setup":
      return t("connect.group_needs_admin_setup")
    case "checking":
      return "Checking skill readiness"
  }
}

function promptSkillToken(skill: OnboardingPromptSkillReference) {
  if (skill.source === "local") return `[skill ${skill.slug}]`
  return encodeConnectSkillToken({
    slug: skill.slug,
    name: skill.name,
    marketplace: skill.marketplaceName,
    capability: skill.capabilityName,
  })
}

export function selectionPromptForOrganizationPrompt(prompt: string | OnboardingPrompt) {
  const text = promptText(prompt)
  const skill = promptSkill(prompt)
  return skill ? `${promptSkillToken(skill)} ${text}` : text
}

export function resolveOrganizationPromptCardAction(input: {
  skill?: OnboardingPromptSkillReference
  readiness: OrganizationPromptSkillReadiness
}): OrganizationPromptCardAction {
  if (!input.skill) return "fill"
  if (input.readiness === "ready") return "fill"
  if (input.readiness === "needs_signin") return "open_connect"
  return "blocked"
}

function readinessRecord(
  skills: OnboardingPromptConnectSkillReference[],
  readiness: OrganizationPromptSkillReadiness,
) {
  const record: Record<string, OrganizationPromptSkillReadiness> = {}
  for (const skill of skills) {
    record[organizationPromptSkillKey(skill)] = readiness
  }
  return record
}

export function resolveConnectPromptSkillReadiness(input: {
  skill: OnboardingPromptConnectSkillReference
  inventory: ConnectCapabilityInventory
}): ConnectCapabilityReadiness {
  const path = connectSkillPath(input.skill)
  const match = input.inventory.skills.find((skill) =>
    skill.connectCapabilityName === input.skill.capabilityName || skill.path === path
  )
  return match?.connectReadiness ?? "needs_admin_setup"
}

export function useOrganizationPromptSkillReadiness(prompts: OnboardingPrompt[] | undefined) {
  const connectSkills = useMemo(() => prompts?.flatMap((prompt) =>
    prompt.skill?.source === "connect" ? [prompt.skill] : []
  ) ?? [], [prompts])
  const signature = connectSkills.map(organizationPromptSkillKey).join("\n")

  const [readinessByKey, setReadinessByKey] = useState<Record<string, OrganizationPromptSkillReadiness>>(EMPTY_PROMPT_READINESS)

  useEffect(() => {
    if (!connectSkills.length) {
      setReadinessByKey(EMPTY_PROMPT_READINESS)
      return
    }

    let cancelled = false
    setReadinessByKey(readinessRecord(connectSkills, "checking"))

    const loadReadiness = async () => {
      const settings = readDenSettings()
      const token = settings.authToken?.trim() ?? ""
      const organizationId = settings.activeOrgId?.trim() ?? ""
      if (!token || !organizationId) {
        if (!cancelled) setReadinessByKey(readinessRecord(connectSkills, "needs_signin"))
        return
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token })
      let inventory = EMPTY_CONNECT_CAPABILITY_INVENTORY
      try {
        inventory = await listAssignedConnectCapabilities({ client, organizationId })
      } catch {
        if (!cancelled) setReadinessByKey(readinessRecord(connectSkills, "needs_admin_setup"))
        return
      }

      const next: Record<string, OrganizationPromptSkillReadiness> = {}
      for (const skill of connectSkills) {
        next[organizationPromptSkillKey(skill)] = resolveConnectPromptSkillReadiness({ skill, inventory })
      }
      if (!cancelled) setReadinessByKey(next)
    }

    void loadReadiness()
    return () => {
      cancelled = true
    }
  }, [signature])

  return readinessByKey
}

export function resolveOrganizationPromptCardContent(input: {
  prompt: string | OnboardingPrompt
  description?: string
  index: number
  readiness?: OrganizationPromptSkillReadiness
}) {
  const prompt = promptText(input.prompt)
  const skill = promptSkill(input.prompt)
  const readiness = skill ? input.readiness ?? "checking" : "ready"
  const title = input.description?.trim()
  return {
    title: title || ORGANIZATION_PROMPT_TITLES[input.index] || "Organization prompt",
    description: prompt,
    selectionPrompt: selectionPromptForOrganizationPrompt(input.prompt),
    skill,
    skillLabel: skill ? skillLabel(skill) : undefined,
    readiness,
    readinessLabel: skill ? readinessLabel(readiness) : undefined,
    action: resolveOrganizationPromptCardAction({ skill, readiness }),
  }
}

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()
  const orgRestrictions = useOrgRestrictions()
  const organizationPrompts = orgRestrictions.onboardingPrompts
  const organizationPromptDescriptions = orgRestrictions.onboardingPromptDescriptions
  const readinessByKey = useOrganizationPromptSkillReadiness(organizationPrompts)

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0
  const hasOrganizationPrompts = organizationPrompts !== undefined

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {noProviders
          ? "Connect a model provider to get started:"
          : hasOrganizationPrompts
            ? "Try one of your organization's prompts:"
            : "Try one of these:"}
      </p>
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
        {noProviders ? (
          <DescriptiveButton
            orientation="vertical"
            className="border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2 @2xl:col-span-3"
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
            const skill = prompt.skill
            const card = resolveOrganizationPromptCardContent({
              prompt,
              description: organizationPromptDescriptions?.[index],
              index,
              readiness: skill ? readinessByKey[organizationPromptSkillKey(skill)] : undefined,
            })
            const disabled = card.action === "blocked"
            const handleClick = () => {
              if (card.action === "open_connect") {
                dispatchAction({
                  target: "settings",
                  action: "open",
                  section: "connect",
                })
                return
              }
              if (card.action === "fill") setPrompt(card.selectionPrompt)
            }
            return (
              <DescriptiveButton key={`${index}-${prompt.prompt}`} orientation="vertical" onClick={handleClick} disabled={disabled}>
                <DescriptiveButtonIcon>
                  <SparklesIcon className="size-6 text-purple-10" aria-hidden />
                </DescriptiveButtonIcon>
                <DescriptiveButtonContent>
                  <DescriptiveButtonTitle>{card.title}</DescriptiveButtonTitle>
                  {card.skillLabel || card.readinessLabel ? (
                    <span className="flex flex-wrap gap-1 text-[11px] font-medium text-muted-foreground">
                      {card.skillLabel ? <span>{card.skillLabel}</span> : null}
                      {card.readinessLabel ? <span>{card.readinessLabel}</span> : null}
                    </span>
                  ) : null}
                  <DescriptiveButtonDescription>{card.description}</DescriptiveButtonDescription>
                </DescriptiveButtonContent>
              </DescriptiveButton>
            )
          })
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
        )}
      </div>
    </div>
  )
}
