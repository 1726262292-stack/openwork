import { z } from "zod";

// ---------------------------------------------------------------------------
// OpenWork extension manifest — single-source-of-truth schema (schemaVersion 1)
// Shared by the desktop app, Den (cloud API), and Den web.
// ---------------------------------------------------------------------------

export const openWorkExtensionSourceFormatSchema = z.enum([
  "openwork-builtin",
  "openwork-extension-manifest",
  "claude-plugin",
  "opencode-plugin",
  "mcp-directory",
  "manual",
]);
export type OpenWorkExtensionSourceFormat = z.infer<typeof openWorkExtensionSourceFormatSchema>;

export const openWorkExtensionSourceSchema = z.object({
  format: openWorkExtensionSourceFormatSchema,
  trusted: z.boolean(),
  origin: z.enum(["builtin", "den", "workspace", "local"]).optional(),
  reference: z.string().optional(),
});
export type OpenWorkExtensionSource = z.infer<typeof openWorkExtensionSourceSchema>;

export const openWorkExtensionResourceTypeSchema = z.enum([
  "skill",
  "agent",
  "command",
  "tool",
  "mcp",
  "opencode-plugin",
  "provider",
  "hook",
  "context",
  "secret",
  "file",
  "local-service",
  "native-binary",
]);
export type OpenWorkExtensionResourceType = z.infer<typeof openWorkExtensionResourceTypeSchema>;

export const openWorkExtensionResourceSchema = z.object({
  type: openWorkExtensionResourceTypeSchema,
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  path: z.string().optional(),
  command: z.array(z.string()).optional(),
  envKey: z.string().optional(),
  packageName: z.string().optional(),
  providerId: z.string().optional(),
  mcpServerName: z.string().optional(),
  localCommandRef: z.enum(["openwork.computerUseMcp", "openwork.uiMcp"]).optional(),
  required: z.boolean().optional(),
});
export type OpenWorkExtensionResource = z.infer<typeof openWorkExtensionResourceSchema>;

export const openWorkExtensionContributionTypeSchema = z.enum([
  "settings-panel",
  "setup-instructions",
  "composer-prompt",
  "session-side-panel",
  "session-rail-item",
  "control-actions",
  "server-route",
  "native-capability",
  "test-action",
]);
export type OpenWorkExtensionContributionType = z.infer<typeof openWorkExtensionContributionTypeSchema>;

export const openWorkExtensionContributionSchema = z.object({
  type: openWorkExtensionContributionTypeSchema,
  ref: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  location: z.enum(["settings-detail", "composer", "session-right-pane", "session-rail", "server", "native"]).optional(),
});
export type OpenWorkExtensionContribution = z.infer<typeof openWorkExtensionContributionSchema>;

export const openWorkExtensionSetupSchema = z.object({
  instructions: z.string().optional(),
  primaryCta: z.string().optional(),
  secondaryCta: z.string().optional(),
  requiredEnv: z.array(z.string()).optional(),
  testActionRef: z.string().optional(),
});
export type OpenWorkExtensionSetup = z.infer<typeof openWorkExtensionSetupSchema>;

export const openWorkExtensionReloadReasonSchema = z.enum([
  "plugins",
  "skills",
  "mcp",
  "config",
  "agents",
  "commands",
]);
export type OpenWorkExtensionReloadReason = z.infer<typeof openWorkExtensionReloadReasonSchema>;

export const openWorkExtensionLifecycleSchema = z.object({
  reload: z.array(openWorkExtensionReloadReasonSchema).optional(),
  detection: z.array(z.string()).optional(),
});
export type OpenWorkExtensionLifecycle = z.infer<typeof openWorkExtensionLifecycleSchema>;

// ---------------------------------------------------------------------------
// Enablement — declarative conditions for extension "active" state
// ---------------------------------------------------------------------------

export const enablementConditionTypeSchema = z.enum([
  "mcp-connected",
  "plugin-loaded",
  "provider-connected",
  "env-set",
  "permission-granted",
  "toggle-enabled",
]);
export type EnablementConditionType = z.infer<typeof enablementConditionTypeSchema>;

export const enablementConditionSchema = z.object({
  type: enablementConditionTypeSchema,
  /** What to check — MCP server name, plugin id, env key, etc. */
  ref: z.string(),
  /** Human-readable label shown in the UI. */
  label: z.string(),
});
export type EnablementCondition = z.infer<typeof enablementConditionSchema>;

export const openWorkExtensionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  preview: z.boolean().optional(),
  source: openWorkExtensionSourceSchema,
  icon: z
    .object({
      src: z.string().optional(),
      simpleIconSlug: z.string().optional(),
    })
    .optional(),
  composer: z
    .object({
      prompt: z.string(),
    })
    .optional(),
  setup: openWorkExtensionSetupSchema.optional(),
  resources: z.array(openWorkExtensionResourceSchema),
  contributions: z.array(openWorkExtensionContributionSchema).optional(),
  lifecycle: openWorkExtensionLifecycleSchema.optional(),
  /** Declarative conditions that must ALL be true for the extension to be "active". */
  enablement: z.array(enablementConditionSchema).optional(),
  defaultEnabled: z.boolean().optional(),
  defaultHidden: z.boolean().optional(),
  platform: z.array(z.enum(["darwin", "linux", "windows", "web"])).optional(),
  // Optional authoring metadata (backward compatible, still schemaVersion 1).
  version: z.string().optional(),
  author: z
    .object({
      name: z.string(),
      url: z.string().optional(),
    })
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  readme: z.string().optional(),
  permissionsSummary: z.string().optional(),
});
export type OpenWorkExtensionManifest = z.infer<typeof openWorkExtensionManifestSchema>;

/** Parse an unknown value into a manifest; returns null on any structural issue. */
export function parseExtensionManifest(value: unknown): OpenWorkExtensionManifest | null {
  const result = openWorkExtensionManifestSchema.safeParse(value);
  return result.success ? result.data : null;
}
