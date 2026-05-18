import { z } from "zod"

export const desktopPolicyValueSchema = z.object({
  allowNonCloudModels: z.boolean().optional(),
  allowZenModel: z.boolean().optional(),
  allowMultipleWorkspaces: z.boolean().optional(),
}).meta({ ref: "DenDesktopPolicyValue" })

export type DesktopPolicyValue = z.infer<typeof desktopPolicyValueSchema>
export type DesktopPolicyKey = keyof DesktopPolicyValue

export type DesktopPolicyDefinition = {
  id: DesktopPolicyKey
  name: string
  description: string
  userNotice: string
  defaultValue: boolean
}

export const desktopPolicyDefinitions = [
  {
    id: "allowNonCloudModels",
    name: "Allow non-cloud models",
    description: "Allow users to add and use models that are not deployed through OpenWork Cloud.",
    userNotice: "Your organization administrator has disabled adding custom providers.",
    defaultValue: true,
  },
  {
    id: "allowZenModel",
    name: "Allow OpenCode Zen Models",
    description: "Allow users to use the built in models provided by OpenCode.",
    userNotice: "Your administrator has disabled access to OpenCode Models.",
    defaultValue: true,
  },
  {
    id: "allowMultipleWorkspaces",
    name: "Allow multiple workspaces",
    description: "Allow users to create or configure more than one workspace on their machine.",
    userNotice: "Your organization administrator has restricted access to adding additional workspaces.",
    defaultValue: true,
  },
] as const satisfies readonly DesktopPolicyDefinition[]

export const desktopPolicyKeys = desktopPolicyDefinitions.map((definition) => definition.id)

export const desktopPolicyDefaults = Object.fromEntries(
  desktopPolicyDefinitions.map((definition) => [definition.id, definition.defaultValue]),
) as Required<DesktopPolicyValue>

export const desktopConfigSchema = desktopPolicyValueSchema.extend({
  allowedDesktopVersions: z.array(z.string().trim().min(1).max(32)).optional(),
}).meta({ ref: "DenDesktopConfig" })

export type DesktopConfig = z.infer<typeof desktopConfigSchema>

function normalizeDesktopVersionString(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().replace(/^v/i, "")
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : null
}

function normalizeAllowedDesktopVersions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return [
    ...new Set(
      value
        .map((entry) => normalizeDesktopVersionString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ]
}

export function normalizeDesktopPolicyValue(value: unknown): DesktopPolicyValue {
  const parsed = desktopPolicyValueSchema.safeParse(value)
  if (parsed.success) {
    return Object.fromEntries(
      desktopPolicyKeys.flatMap((key) => typeof parsed.data[key] === "boolean" ? [[key, parsed.data[key]] as const] : []),
    ) as DesktopPolicyValue
  }

  return {}
}

export function normalizeDefaultDesktopPolicyValue(value: unknown): Required<DesktopPolicyValue> {
  const normalized = normalizeDesktopPolicyValue(value)
  return Object.fromEntries(
    desktopPolicyDefinitions.map((definition) => [
      definition.id,
      normalized[definition.id] ?? definition.defaultValue,
    ]),
  ) as Required<DesktopPolicyValue>
}

export function allDesktopPolicies(value: boolean): Required<DesktopPolicyValue> {
  return Object.fromEntries(
    desktopPolicyDefinitions.map((definition) => [definition.id, value]),
  ) as Required<DesktopPolicyValue>
}

export function calculateEffectiveDesktopPolicy(input: {
  orgPolicyCount: number
  defaultPolicy?: DesktopPolicyValue | null
  assignedPolicies: DesktopPolicyValue[]
}): Required<DesktopPolicyValue> {
  if (input.orgPolicyCount === 0) {
    return allDesktopPolicies(true)
  }

  const calculated = allDesktopPolicies(false)
  const policies = [
    normalizeDefaultDesktopPolicyValue(input.defaultPolicy ?? {}),
    ...input.assignedPolicies.map((policy) => normalizeDesktopPolicyValue(policy)),
  ]

  for (const policy of policies) {
    for (const key of desktopPolicyKeys) {
      if (policy[key] === true) {
        calculated[key] = true
      }
    }
  }

  return calculated
}

export function normalizeDesktopConfig(value: unknown): DesktopConfig {
  const policy = normalizeDesktopPolicyValue(value)
  const allowedDesktopVersions = normalizeAllowedDesktopVersions(
    (value as { allowedDesktopVersions?: unknown } | null)?.allowedDesktopVersions,
  )

  return {
    ...policy,
    ...(allowedDesktopVersions !== undefined ? { allowedDesktopVersions } : {}),
  }
}
