import type { DenTypeId } from "@openwork-ee/utils/typeid"
import { NATIVE_OAUTH_PROVIDERS, type NativeOAuthProviderConfig } from "./provider-registry.js"
import { getConnectedAccount, getOrgOAuthClient } from "./oauth-credentials.js"

/**
 * Native providers (google-workspace, ...) surface in the SAME member-facing
 * list as external MCP connections, so the desktop app renders and connects
 * them with zero client changes: once an org admin saves an OAuth client for
 * a provider, every granted surface that lists usable connections shows a
 * per-member card for it. These entries are synthetic — they exist in
 * OrgOAuthClientTable + ConnectedAccountTable, never in
 * ExternalMcpConnectionTable — which also keeps them out of the agent MCP
 * client merge (external-capabilities reads the DB table directly).
 */

export type NativeProviderConnectionEntry = {
  id: string
  name: string
  url: string
  authType: "oauth"
  credentialMode: "per_member"
  connected: boolean
  connectedAt: null
  connectedForMe: boolean
  access: null
}

export function buildNativeProviderEntry(
  provider: NativeOAuthProviderConfig,
  state: { clientConfigured: boolean; connectedForMe: boolean },
): NativeProviderConnectionEntry | null {
  if (!state.clientConfigured) {
    return null
  }
  return {
    id: provider.providerId,
    name: provider.displayName,
    url: provider.websiteUrl,
    authType: "oauth",
    credentialMode: "per_member",
    connected: true,
    connectedAt: null,
    connectedForMe: state.connectedForMe,
    access: null,
  }
}

export async function listNativeProviderUsableEntries(input: {
  organizationId: DenTypeId<"organization">
  orgMembershipId: DenTypeId<"member">
}): Promise<NativeProviderConnectionEntry[]> {
  const entries: NativeProviderConnectionEntry[] = []
  for (const provider of Object.values(NATIVE_OAUTH_PROVIDERS)) {
    const client = await getOrgOAuthClient(input.organizationId, provider.providerId)
    if (!client) continue
    const account = await getConnectedAccount({
      organizationId: input.organizationId,
      orgMembershipId: input.orgMembershipId,
      providerId: provider.providerId,
    })
    const entry = buildNativeProviderEntry(provider, {
      clientConfigured: true,
      connectedForMe: Boolean(account?.accessToken),
    })
    if (entry) entries.push(entry)
  }
  return entries
}
