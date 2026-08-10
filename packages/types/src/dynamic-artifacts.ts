import { z } from "zod"

const idSchema = z.string().trim().min(1).max(160)
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const artifactFreshnessSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("never_run") }),
  z.object({ state: z.literal("fresh"), ageMs: z.number().int().nonnegative() }),
  z.object({
    state: z.literal("stale"),
    ageMs: z.number().int().nonnegative(),
    maxAgeMs: z.number().int().positive(),
  }),
  z.object({
    state: z.literal("needs_attention"),
    ageMs: z.number().int().nonnegative().nullable(),
    lastSuccessfulReceiptId: idSchema.nullable(),
    reason: z.string().trim().min(1).max(2_000),
  }),
])
export type ArtifactFreshness = z.infer<typeof artifactFreshnessSchema>

export const savedScriptCapabilitySchema = z.object({
  capabilityName: z.string().trim().min(1).max(255),
  scriptPath: z.string().trim().min(1).max(255),
})
export type SavedScriptCapability = z.infer<typeof savedScriptCapabilitySchema>

export const savedScriptAutomationReferenceSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  state: z.enum(["active", "inactive", "needs_attention", "archived"]),
  configObjectVersionId: idSchema,
  input: z.unknown().optional(),
})
export type SavedScriptAutomationReference = z.infer<typeof savedScriptAutomationReferenceSchema>

export const savedScriptVersionSchema = z.object({
  id: idSchema,
  code: z.string(),
  inputSchema: z.unknown().nullable(),
  outputSchema: z.unknown().nullable(),
  requiredCapabilities: z.array(savedScriptCapabilitySchema),
  codeDigest: digestSchema,
  inputSchemaDigest: digestSchema.nullable(),
  outputSchemaDigest: digestSchema.nullable(),
  createdAt: z.string().datetime(),
  automationReferences: z.array(savedScriptAutomationReferenceSchema),
})
export type SavedScriptVersion = z.infer<typeof savedScriptVersionSchema>

export const savedScriptArtifactSnapshotSchema = z.object({
  receiptId: idSchema,
  pluginId: idSchema,
  configObjectId: idSchema,
  configObjectVersionId: idSchema,
  automationRunId: idSchema.nullable(),
  input: z.unknown().nullable(),
  value: z.unknown().nullable(),
  markdown: z.string().nullable(),
  codeDigest: digestSchema,
  resultDigest: digestSchema.nullable(),
  inputSchemaDigest: digestSchema.nullable(),
  outputSchemaDigest: digestSchema.nullable(),
  rendererVersion: z.literal("codemode-markdown-v1").nullable(),
  status: z.enum(["succeeded", "failed"]),
  errorKind: z.string().nullable(),
  errorMessage: z.string().nullable(),
  source: z.enum(["manual", "scheduled"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  contentDeletedAt: z.string().datetime().nullable(),
})
export type SavedScriptArtifactSnapshot = z.infer<typeof savedScriptArtifactSnapshotSchema>

export const savedScriptDetailSchema = z.object({
  pluginId: idSchema,
  configObjectId: idSchema,
  title: z.string().trim().min(1).max(255),
  description: z.string().nullable(),
  canManage: z.boolean(),
  currentVersion: savedScriptVersionSchema,
  versions: z.array(savedScriptVersionSchema),
  latestSnapshot: savedScriptArtifactSnapshotSchema.nullable(),
  latestSuccessfulSnapshot: savedScriptArtifactSnapshotSchema.nullable(),
  freshness: artifactFreshnessSchema,
})
export type SavedScriptDetail = z.infer<typeof savedScriptDetailSchema>

export const savedScriptTestResultSchema = z.object({
  receiptId: idSchema,
  value: z.unknown(),
  markdown: z.string(),
  codeDigest: digestSchema,
  resultDigest: digestSchema,
  inputSchemaDigest: digestSchema.nullable(),
  outputSchemaDigest: digestSchema.nullable(),
  rendererVersion: z.literal("codemode-markdown-v1"),
  requiredCapabilities: z.array(savedScriptCapabilitySchema),
  finishedAt: z.string().datetime(),
})
export type SavedScriptTestResult = z.infer<typeof savedScriptTestResultSchema>
