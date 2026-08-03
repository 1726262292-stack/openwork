import { z } from "zod"

const idSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.number().int().nonnegative()
const nullableTimestampSchema = timestampSchema.nullable()
const timezoneSchema = z.string().trim().min(1).max(120).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0))
    return true
  } catch {
    return false
  }
}, "Expected a valid IANA timezone")

export const automationStateSchema = z.enum(["active", "inactive", "needs_attention", "archived"])
export type AutomationState = z.infer<typeof automationStateSchema>

export const automationRunStatusSchema = z.enum([
  "queued", "claimed", "running", "succeeded", "failed", "cancelled", "skipped",
])
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>

export const automationRunTriggerSchema = z.enum(["scheduled", "recovery", "manual"])
export type AutomationRunTrigger = z.infer<typeof automationRunTriggerSchema>

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), timezone: timezoneSchema, at: timestampSchema }),
  z.object({
    kind: z.literal("daily"),
    timezone: timezoneSchema,
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    timezone: timezoneSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7)
      .transform((days) => [...new Set(days)].sort((left, right) => left - right)),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
])
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>

export const automationModelSchema = z.object({ providerId: idSchema, modelId: idSchema })
export type AutomationModel = z.infer<typeof automationModelSchema>

export const automationNeedsAttentionReasonSchema = z.object({
  code: z.enum([
    "owner_membership_lost",
    "model_access_lost",
    "provider_unavailable",
    "connect_access_unavailable",
    "execution_runtime_unavailable",
  ]),
  message: z.string().trim().min(1).max(2_000),
  occurredAt: timestampSchema,
})
export type AutomationNeedsAttentionReason = z.infer<typeof automationNeedsAttentionReasonSchema>

export const automationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  ownerMemberId: idSchema,
  name: z.string().trim().min(1).max(120),
  state: automationStateSchema,
  currentRevisionId: idSchema,
  nextDueAt: nullableTimestampSchema,
  latestRunAt: nullableTimestampSchema,
  needsAttentionReason: automationNeedsAttentionReasonSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: nullableTimestampSchema,
})
export type Automation = z.infer<typeof automationSchema>

export const automationRevisionSchema = z.object({
  id: idSchema,
  automationId: idSchema,
  version: z.number().int().positive(),
  instructions: z.string().trim().min(1).max(100_000),
  schedule: automationScheduleSchema,
  model: automationModelSchema,
  maximumRuntimeMs: z.number().int().min(10_000).max(60 * 60 * 1_000),
  digest: z.string().trim().min(16).max(128),
  createdAt: timestampSchema,
})
export type AutomationRevision = z.infer<typeof automationRevisionSchema>

export const automationErrorSchema = z.object({
  code: z.enum([
    "owner_membership_lost",
    "model_access_lost",
    "provider_unavailable",
    "connect_access_unavailable",
    "execution_runtime_unavailable",
    "execution_failed",
    "execution_timed_out",
    "cancelled",
    "lease_lost",
    "internal_error",
  ]),
  message: z.string().trim().min(1).max(2_000),
  retryable: z.boolean(),
})
export type AutomationError = z.infer<typeof automationErrorSchema>

export const automationUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costMicros: z.number().int().nonnegative().nullable(),
})
export type AutomationUsage = z.infer<typeof automationUsageSchema>

export const automationCloudThreadSchema = z.object({
  id: idSchema,
  threadKind: z.literal("automation"),
  executionLocation: z.literal("cloud"),
  automationId: idSchema,
  automationRunId: idSchema,
  engineKind: idSchema,
})
export type AutomationCloudThread = z.infer<typeof automationCloudThreadSchema>

export const automationRunSchema = z.object({
  id: idSchema,
  automationId: idSchema,
  revisionId: idSchema,
  trigger: automationRunTriggerSchema,
  scheduledFor: nullableTimestampSchema,
  idempotencyKey: z.string().trim().min(1).max(512),
  status: automationRunStatusSchema,
  leaseOwner: z.string().trim().min(1).max(240).nullable(),
  leaseExpiresAt: nullableTimestampSchema,
  heartbeatAt: nullableTimestampSchema,
  attemptCount: z.number().int().min(0).max(2),
  cloudThread: automationCloudThreadSchema.nullable(),
  providerId: idSchema,
  modelId: idSchema,
  startedAt: nullableTimestampSchema,
  finishedAt: nullableTimestampSchema,
  error: automationErrorSchema.nullable(),
  resultSummary: z.string().max(20_000).nullable(),
  usage: automationUsageSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
export type AutomationRun = z.infer<typeof automationRunSchema>

export const automationRunEventTypeSchema = z.enum([
  "user", "assistant", "capability_search", "capability_execution", "usage", "warning", "terminal",
])
export type AutomationRunEventType = z.infer<typeof automationRunEventTypeSchema>

export const automationRunEventSchema = z.object({
  id: idSchema,
  runId: idSchema,
  sequence: z.number().int().positive(),
  type: automationRunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
})
export type AutomationRunEvent = z.infer<typeof automationRunEventSchema>

export const createAutomationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(100_000),
  schedule: automationScheduleSchema,
  model: automationModelSchema,
})
export type CreateAutomation = z.infer<typeof createAutomationSchema>

export const updateAutomationSchema = createAutomationSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "At least one behavior-changing field is required",
)
export type UpdateAutomation = z.infer<typeof updateAutomationSchema>

export const automationListSchema = z.object({
  items: z.array(z.object({
    automation: automationSchema,
    revision: automationRevisionSchema,
    latestRun: automationRunSchema.nullable(),
  })),
  nextCursor: z.string().nullable(),
})
export type AutomationList = z.infer<typeof automationListSchema>

export const automationDetailSchema = z.object({
  automation: automationSchema,
  revision: automationRevisionSchema,
  latestRun: automationRunSchema.nullable(),
})
export type AutomationDetail = z.infer<typeof automationDetailSchema>

export const automationRunReceiptSchema = z.object({
  run: automationRunSchema,
  automation: automationSchema,
  revision: automationRevisionSchema,
  events: z.array(automationRunEventSchema),
})
export type AutomationRunReceipt = z.infer<typeof automationRunReceiptSchema>

export const AUTOMATION_MAXIMUM_ATTEMPTS = 2
export const AUTOMATION_RETRY_DELAY_MS = 30_000
export const AUTOMATION_DEFAULT_MAXIMUM_RUNTIME_MS = 15 * 60_000
export const AUTOMATION_MAXIMUM_RUNTIME_MS = 60 * 60_000
