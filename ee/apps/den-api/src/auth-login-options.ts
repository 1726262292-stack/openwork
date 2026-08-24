export type LoginOptionKind = "sso" | "google" | "github" | "password" | "new_account"

export type LoginOptionAccount = {
  providerId: string
  hasPassword: boolean
}

export function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase()
}

export const BETTER_AUTH_SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
  "better-auth-session_token",
] as const

const EXPIRED_COOKIE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT"

function normalizeCookieDomain(domain: string | null | undefined) {
  const normalized = domain?.trim().toLowerCase().replace(/^\.+/, "") ?? ""
  return normalized || null
}

function expiredCookieHeader(name: string, domain: string | null) {
  const attributes = [
    `${name}=`,
    "Path=/",
    `Expires=${EXPIRED_COOKIE_DATE}`,
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ]

  if (domain) {
    attributes.push(`Domain=${domain}`)
  }

  return attributes.join("; ")
}

export function buildStaleBetterAuthSessionCookieClearHeaders(input: {
  cookieDomain?: string | null
  requestHost?: string | null
}) {
  const domains = new Set<string | null>([null])
  const cookieDomain = normalizeCookieDomain(input.cookieDomain)
  if (cookieDomain) {
    domains.add(cookieDomain)
  }

  const requestHost = normalizeCookieDomain(input.requestHost?.split(":", 1)[0])
  if (requestHost && requestHost !== cookieDomain) {
    domains.add(requestHost)
  }

  const headers: string[] = []
  for (const name of BETTER_AUTH_SESSION_COOKIE_NAMES) {
    for (const domain of domains) {
      headers.push(expiredCookieHeader(name, domain))
    }
  }
  return headers
}

function normalizeProviderId(providerId: string) {
  return providerId.trim().toLowerCase()
}

function isPasswordAccount(account: LoginOptionAccount) {
  const providerId = normalizeProviderId(account.providerId)
  return account.hasPassword || providerId === "credential" || providerId === "email" || providerId === "email-password"
}

function hasProvider(accounts: readonly LoginOptionAccount[], providerId: string) {
  return accounts.some((account) => normalizeProviderId(account.providerId) === providerId)
}

export function resolveLoginOptionKind(input: {
  requireSso: boolean
  accounts: readonly LoginOptionAccount[]
  allowNewAccount?: boolean
}): LoginOptionKind {
  if (input.requireSso) {
    return "sso"
  }

  if (hasProvider(input.accounts, "google")) {
    return "google"
  }

  if (input.accounts.some(isPasswordAccount)) {
    return "password"
  }

  if (hasProvider(input.accounts, "github")) {
    return "github"
  }

  return input.allowNewAccount === false ? "password" : "new_account"
}
