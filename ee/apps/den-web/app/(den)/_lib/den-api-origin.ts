export function denApiOriginForWebOrigin(webOrigin: string): string | null {
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

  const origin = denApiOriginForWebOrigin(webOrigin);
  if (!origin) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
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
