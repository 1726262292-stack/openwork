/**
 * Staged-rollout gate for member-facing org MCP connections.
 *
 * When a deployment enables gating (DEN_MCP_CONNECTIONS_GATING_ENABLED=true,
 * see env.ts), members of an organization only discover connections once the
 * org opted in via `metadata.connectEnabled: true` (canonical) or
 * `metadata.mcpConnectionsEnabled: true` (honored legacy alias). That per-org
 * opt-in is controlled from the /admin backoffice, not a script. Non-opted-in orgs get
 * an empty list — byte-identical to an org with no published connections, on
 * every desktop version in the field. Admin management (scope=manageable,
 * create, access grants) stays available so orgs can stage connections before
 * the capability flips.
 *
 * Gating is off by default so local dev, evals, and self-hosted deployments
 * keep the feature working out of the box.
 */

type MetadataInput = Record<string, unknown> | string | null | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseMetadata(input: MetadataInput): Record<string, unknown> {
  if (!input) {
    return {}
  }

  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  return isRecord(input) ? input : {}
}

export function memberFacingMcpConnectionsEnabled(
  metadata: MetadataInput,
  options: { gatingEnabled: boolean },
): boolean {
  if (!options.gatingEnabled) {
    return true
  }
  const parsed = parseMetadata(metadata)
  return parsed.connectEnabled === true || parsed.mcpConnectionsEnabled === true
}
