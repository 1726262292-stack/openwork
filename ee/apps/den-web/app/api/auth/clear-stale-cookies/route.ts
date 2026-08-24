import { NextRequest, NextResponse } from "next/server";

import { readPublicWebOrigin } from "../../../_lib/public-web-origin";

export const dynamic = "force-dynamic";

const BETTER_AUTH_SESSION_COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
  "better-auth-session_token",
] as const;
const POSTHOG_COOKIE_PREFIX = "ph_phc_";
const EXPIRED_COOKIE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

function normalizeCookieDomain(domain: string | null | undefined): string | null {
  const normalized = domain?.trim().toLowerCase().replace(/^\.+/, "") ?? "";
  return normalized || null;
}

function requestPublicHostname(request: NextRequest): string | null {
  const configuredOrigin = readPublicWebOrigin();
  if (configuredOrigin) {
    try {
      return normalizeCookieDomain(new URL(configuredOrigin).hostname);
    } catch {}
  }

  return normalizeCookieDomain(new URL(request.url).hostname);
}

function expiredCookieHeader(name: string, domain: string | null): string {
  const attributes = [
    `${name}=`,
    "Path=/",
    `Expires=${EXPIRED_COOKIE_DATE}`,
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (domain) attributes.push(`Domain=${domain}`);
  return attributes.join("; ");
}

function staleCookieNames(request: NextRequest): string[] {
  const names = new Set<string>(BETTER_AUTH_SESSION_COOKIE_NAMES);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith(POSTHOG_COOKIE_PREFIX)) {
      names.add(cookie.name);
    }
  }
  return [...names];
}

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const domains = new Set<string | null>([null]);
  const hostname = requestPublicHostname(request);
  if (hostname) domains.add(hostname);

  for (const name of staleCookieNames(request)) {
    for (const domain of domains) {
      response.headers.append("Set-Cookie", expiredCookieHeader(name, domain));
    }
  }

  return response;
}
