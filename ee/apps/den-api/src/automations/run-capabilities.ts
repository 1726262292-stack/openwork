type AutomationRunCapability = {
  name: string
  path: string
}

const AUTOMATION_MANAGEMENT_PATHS = [
  "/v1/automations",
  "/v1/automation-runs",
] as const

function isNamespacedCapability(name: string, prefix: "native:" | "mcp:") {
  if (!name.startsWith(prefix)) return false
  const separator = name.indexOf(":", prefix.length)
  return separator > prefix.length && separator < name.length - 1
}

export function isAutomationManagementPath(path: string) {
  return AUTOMATION_MANAGEMENT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * An Automation run receives integrations only. Den REST/catalog operations
 * are deliberately absent, including Automations management itself. The
 * namespace check is repeated at execution time so callers cannot bypass
 * search and invoke an unadvertised catalog operation by name.
 */
export function isAutomationRunCapabilityNameAllowed(name: string) {
  return isNamespacedCapability(name, "native:") || isNamespacedCapability(name, "mcp:")
}

export function isAutomationRunCapabilityAllowed(capability: AutomationRunCapability) {
  return isAutomationRunCapabilityNameAllowed(capability.name)
    && !isAutomationManagementPath(capability.path)
}

export function filterAutomationRunCapabilities<T extends AutomationRunCapability>(capabilities: readonly T[]): T[] {
  return capabilities.filter(isAutomationRunCapabilityAllowed)
}
