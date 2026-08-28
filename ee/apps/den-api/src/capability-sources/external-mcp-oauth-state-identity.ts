import type {
  ExternalMcpAuthType,
  ExternalMcpConnectionKind,
  ExternalMcpCredentialMode,
} from "@openwork-ee/den-db/schema"

export type ExternalMcpOAuthStateIdentitySource = {
  id: string
  kind: ExternalMcpConnectionKind
  url: string
  authType: ExternalMcpAuthType
  credentialMode: ExternalMcpCredentialMode
}

type NonSecretExternalMcpOAuthStateIdentity =
  | readonly [url: string, authType: ExternalMcpAuthType, credentialMode: ExternalMcpCredentialMode]
  | readonly [nativeProviderId: string, url: string, authType: ExternalMcpAuthType, credentialMode: ExternalMcpCredentialMode]

export function normalizeExternalMcpIdentityUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    url.hash = ""
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname
    return `${url.protocol}//${url.host}${pathname}${url.search}`
  } catch {
    return value.trim().replace(/\/+$/, "")
  }
}

function nonSecretOAuthStateIdentity(source: ExternalMcpOAuthStateIdentitySource): NonSecretExternalMcpOAuthStateIdentity {
  const url = normalizeExternalMcpIdentityUrl(source.url)
  if (source.kind === "native_provider") {
    return [source.id, url, source.authType, source.credentialMode]
  }
  return [url, source.authType, source.credentialMode]
}

/**
 * Binds signed OAuth state to non-secret connection identity fields. Credential
 * values are deliberately outside this input type. The signed OAuth state owns
 * integrity, so this value only needs a stable URL-safe representation.
 */
export function externalMcpIdentityBinding(source: ExternalMcpOAuthStateIdentitySource): string {
  return Buffer.from(JSON.stringify(nonSecretOAuthStateIdentity(source))).toString("base64url")
}
