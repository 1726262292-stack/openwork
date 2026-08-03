import type { AutomationCloudThread } from "@openwork/types/automations"

export type AutomationExecutionIdentity = {
  icon: "cloud"
  label: "Cloud"
}

export function automationExecutionIdentity(
  thread: Pick<AutomationCloudThread, "executionLocation">,
): AutomationExecutionIdentity {
  if (thread.executionLocation === "cloud") {
    return { icon: "cloud", label: "Cloud" }
  }
  return thread.executionLocation
}

export function automationCloudThreadRoute(
  thread: Pick<AutomationCloudThread, "id" | "automationId" | "automationRunId">,
) {
  const query = new URLSearchParams({
    automation: thread.automationId,
    run: thread.automationRunId,
    thread: thread.id,
  })
  return `/automations?${query.toString()}`
}
