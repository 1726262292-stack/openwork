import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

type FieldsResult<T> =
  | ({ data: T; error?: undefined } & { request: Request; response: Response })
  | ({ data?: undefined; error: unknown } & { request: Request; response: Response });

export type OpencodeAuth = {
  username?: string;
  password?: string;
};

export function unwrap<T>(result: FieldsResult<T>): NonNullable<T> {
  if (result.data !== undefined) {
    return result.data as NonNullable<T>;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

export function createClient(baseUrl: string, directory?: string, auth?: OpencodeAuth) {
  const headers: Record<string, string> = {};
  if (auth?.username && auth?.password) {
    const token = `${auth.username}:${auth.password}`;
    const encoded = (() => {
      if (typeof btoa === "function") return btoa(token);
      const buffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } } }).Buffer;
      return buffer ? buffer.from(token, "utf8").toString("base64") : null;
    })();
    if (encoded) {
      headers.Authorization = `Basic ${encoded}`;
    }
  }
  return createOpencodeClient({
    baseUrl,
    directory,
    headers: Object.keys(headers).length ? headers : undefined,
  });
}

export async function waitForHealthy(
  client: ReturnType<typeof createClient>,
  options?: { timeoutMs?: number; pollMs?: number },
) {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const pollMs = options?.pollMs ?? 250;

  const start = Date.now();
  let lastError: string | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const health = unwrap(await client.global.health());
      if (health.healthy) {
        return health;
      }
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(lastError ?? "Timed out waiting for server health");
}
