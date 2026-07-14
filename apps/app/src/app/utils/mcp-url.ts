function normalizedMcpOrigin(url: URL) {
  url.hostname = url.hostname.replace(/\.+$/, "");
  return `${url.protocol}//${url.host}`;
}

function rawUrlSuffix(value: string) {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/.exec(value);
  if (!match) return "";
  return value.slice(match[0].length);
}

export function normalizeMcpRemoteUrl(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return `${normalizedMcpOrigin(url)}${rawUrlSuffix(trimmed)}`;
  } catch {
    return trimmed;
  }
}
