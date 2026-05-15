import { z } from "zod"

export const desktopAppRestrictionsSchema = z.object({
  // Category B: Org-level policies (cloud-only, not user-togglable)
  disallowNonCloudModels: z.boolean().optional(),
  blockZenModel: z.boolean().optional(),
  blockMultipleWorkspaces: z.boolean().optional(),
  blockSettingsAccess: z.boolean().optional(),
  restrictExtensions: z.boolean().optional(),

  // Category A: UI customization overrides (cloud overrides local user prefs)
  // When set, these take precedence over the user's local toggle.
  showStatusBar: z.boolean().optional(),
  showDocsButton: z.boolean().optional(),
  showFeedbackButton: z.boolean().optional(),
  showCloudSignin: z.boolean().optional(),
  showStarterCards: z.boolean().optional(),
  showModelPicker: z.boolean().optional(),
  showAddWorkspace: z.boolean().optional(),
}).meta({ ref: "DenDesktopAppRestrictions" })

export type DesktopAppRestrictions = z.infer<typeof desktopAppRestrictionsSchema>

export const desktopConfigSchema = desktopAppRestrictionsSchema.extend({
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

  const versions = [
    ...new Set(
      value
        .map((entry) => normalizeDesktopVersionString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ]

  return versions
}

export function normalizeDesktopAppRestrictions(value: unknown): DesktopAppRestrictions {
  const parsed = desktopAppRestrictionsSchema.safeParse(value)
  if (parsed.success) {
    // Only emit keys that are explicitly set (not undefined).
    // Boolean `true` keys are restrictions/overrides; boolean `false`
    // keys are explicit "allow" signals from the org.
    const result: DesktopAppRestrictions = {}
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) {
        (result as Record<string, unknown>)[key] = val
      }
    }
    return result
  }

  const legacy = value as {
    models?: {
      removeZen?: unknown
    }
  } | null

  return {
    ...(legacy?.models?.removeZen === true ? { blockZenModel: true } : {}),
  }
}

export function normalizeDesktopConfig(value: unknown): DesktopConfig {
  const restrictions = normalizeDesktopAppRestrictions(value)
  const allowedDesktopVersions = normalizeAllowedDesktopVersions(
    (value as { allowedDesktopVersions?: unknown } | null)?.allowedDesktopVersions,
  )

  return {
    ...restrictions,
    ...(allowedDesktopVersions !== undefined ? { allowedDesktopVersions } : {}),
  }
}
