import type {
  ScheduledTaskExecutionEvent,
  ScheduledTaskExecutionRequest,
  ScheduledTaskExecutionResult,
  ScheduledTaskTypedError,
} from "@openwork/types/scheduled-tasks";

export const SCHEDULED_TASK_WORKSPACE_READ_CAPABILITY_ID =
  "workspace.files.read" as const;
export const SCHEDULED_TASK_WORKSPACE_WRITE_CAPABILITY_ID =
  "workspace.files.write" as const;
export const SCHEDULED_TASK_SAFE_WRITE_TOOL_ID =
  "openwork_workspace_write_file" as const;

export const SCHEDULED_TASK_SAFE_LOCAL_CAPABILITY_IDS = [
  SCHEDULED_TASK_WORKSPACE_READ_CAPABILITY_ID,
  SCHEDULED_TASK_WORKSPACE_WRITE_CAPABILITY_ID,
] as const;

const scheduledTaskSafeLocalCapabilityIds = new Set<string>(
  SCHEDULED_TASK_SAFE_LOCAL_CAPABILITY_IDS,
);

export type ScheduledTaskCapabilityGrantValidation =
  | { ok: true }
  | { ok: false; unsupportedCapabilityIds: string[] };

export function validateScheduledTaskCapabilityGrant(
  capabilityIds: readonly string[],
): ScheduledTaskCapabilityGrantValidation {
  const unsupportedCapabilityIds = [
    ...new Set(
      capabilityIds.filter(
        (capabilityId) => !scheduledTaskSafeLocalCapabilityIds.has(capabilityId),
      ),
    ),
  ].sort();
  return unsupportedCapabilityIds.length === 0
    ? { ok: true }
    : { ok: false, unsupportedCapabilityIds };
}

export interface ScheduledTaskExecutionOptions {
  signal: AbortSignal;
  onEvent?: (event: ScheduledTaskExecutionEvent) => void | Promise<void>;
}

export type ScheduledTaskCancellationReason =
  | "user"
  | "timeout"
  | "shutdown"
  | "grant-revoked"
  | "workspace-removed"
  | "capability-lost";

export interface ScheduledTaskCancellationRequest {
  runId: string;
  attemptId: string;
  sessionId: string;
  reason: ScheduledTaskCancellationReason;
}

export type ScheduledTaskCancellationResult =
  | {
      status: "cancelled";
      sessionId: string;
    }
  | {
      status: "not-running";
      sessionId: string;
    }
  | {
      status: "unsupported";
      sessionId: string;
      error: ScheduledTaskTypedError;
    }
  | {
      status: "ambiguous";
      sessionId: string;
      error: ScheduledTaskTypedError;
    };

export interface ScheduledTaskExecutionAdapter {
  execute(
    request: ScheduledTaskExecutionRequest,
    options: ScheduledTaskExecutionOptions,
  ): Promise<ScheduledTaskExecutionResult>;

  cancel(request: ScheduledTaskCancellationRequest): Promise<ScheduledTaskCancellationResult>;
}
