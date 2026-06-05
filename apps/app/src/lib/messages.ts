import type { SessionStatus } from "@opencode-ai/sdk/v2/client";

export type ThreadRetryAction = NonNullable<Extract<SessionStatus, { type: "retry" }>["action"]>;

export type ThreadStatus =
  | { type: "submitted" }
  | { type: "streaming" }
  | { type: "retrying"; attempt: number; message: string; action?: ThreadRetryAction }
  | { type: "ready" };
