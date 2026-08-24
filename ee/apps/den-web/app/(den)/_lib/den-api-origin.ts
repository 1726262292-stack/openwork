export function denApiOriginForWebOrigin(webOrigin: string): string | null {
  const configuredOrigin = process.env.DEN_API_BASE?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {}
  }

  let url: URL;
  try {
    url = new URL(webOrigin);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const apiHostname = hostname === "api" || hostname.startsWith("api.")
    ? hostname
    : `api.${hostname}`;

  url.hostname = apiHostname;
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function currentDenApiOrigin(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return denApiOriginForWebOrigin(window.location.origin);
}

export function denApiEndpointForWebOrigin(path: string, webOrigin: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  // Better Auth establishes sessions and OAuth callbacks through the Den Web
  // host. Keep those calls on the same-origin auth proxy so callback URLs stay
  // on app.* and Cloudflare's stricter API-host WAF does not inspect provider
  // callback query strings.
  if (path.startsWith("/api/auth/")) {
    return path;
  }

  const origin = denApiOriginForWebOrigin(webOrigin);
  if (!origin) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}

const PUBLIC_DEN_API_PATH_PREFIXES = ["/v1/orgs/sso/resolve"];

function isPublicDenApiPath(path: string): boolean {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return PUBLIC_DEN_API_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

export function denApiCredentialsForEndpoint(endpoint: string, webOrigin: string, path = endpoint): RequestCredentials {
  try {
    const endpointOrigin = new URL(endpoint).origin;
    const currentOrigin = new URL(webOrigin).origin;
    const apiOrigin = denApiOriginForWebOrigin(webOrigin);
    if (endpointOrigin === apiOrigin && isPublicDenApiPath(path)) {
      return "omit";
    }
    return endpointOrigin === currentOrigin || endpointOrigin === apiOrigin ? "include" : "omit";
  } catch {
    return "include";
  }
}

export function denApiCredentials(endpoint: string, path = endpoint): RequestCredentials {
  if (typeof window === "undefined") {
    return "include";
  }

  return denApiCredentialsForEndpoint(endpoint, window.location.origin, path);
}

export function denApiEndpoint(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (typeof window === "undefined") {
    return path;
  }

  return denApiEndpointForWebOrigin(path, window.location.origin);
}
