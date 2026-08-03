import { z } from "zod"
import {
  scheduledTaskExecutionEventSchema,
  scheduledTaskExecutionRequestSchema,
  scheduledTaskExecutionResultSchema,
  scheduledTaskRunSchema,
} from "@openwork/scheduled-tasks"

const timestampSchema = z.number().int().nonnegative()
const idSchema = z.string().trim().min(1).max(240)

export const scheduledTaskWorkerLeaseSchema = z.object({
  runId: idSchema,
  attemptId: idSchema,
  generation: z.number().int().positive(),
  expiresAt: timestampSchema,
  token: z.string().trim().min(32).max(512),
})
export type ScheduledTaskWorkerLease = z.infer<
  typeof scheduledTaskWorkerLeaseSchema
>

export const scheduledTaskWorkerClaimResponseSchema = z.object({
  lease: scheduledTaskWorkerLeaseSchema,
  request: scheduledTaskExecutionRequestSchema,
})
export type ScheduledTaskWorkerClaimResponse = z.infer<
  typeof scheduledTaskWorkerClaimResponseSchema
>

export const scheduledTaskWorkerHeartbeatRequestSchema = z.object({
  sessionId: idSchema.nullable().optional(),
})

export const scheduledTaskWorkerHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  leaseExpiresAt: timestampSchema,
  cancelRequestedAt: timestampSchema.nullable(),
})

export const scheduledTaskWorkerEventRequestSchema = z.object({
  sequence: z.number().int().positive(),
  event: scheduledTaskExecutionEventSchema,
})

export const scheduledTaskWorkerEventResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
})

export const scheduledTaskWorkerCompletionRequestSchema = z.object({
  result: scheduledTaskExecutionResultSchema,
})

export const scheduledTaskWorkerCompletionResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  run: scheduledTaskRunSchema,
})

export const DEN_SCHEDULED_TASK_LEASE_HEADER =
  "x-openwork-scheduled-task-lease" as const
