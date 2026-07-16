export const DEFAULT_STARTUP_HEALTH_TIMEOUT_MS = 60_000;
export const DEFAULT_HEALTH_ATTEMPT_TIMEOUT_MS = 2_000;
const DEFAULT_HEALTH_POLL_MS = 250;

type StartupFieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};

type StartupOpencodeHealth = {
  healthy?: boolean;
  degraded?: boolean;
  reason?: string;
};

type StartupOpencodeClient = {
  global: {
    health: () => Promise<StartupFieldsResult<StartupOpencodeHealth | undefined>>;
  };
  path: {
    get: () => Promise<StartupFieldsResult<unknown>>;
  };
};

type HealthResponse = Pick<Response, "ok" | "status">;
type HealthFetch = (
  url: string,
  init: { headers?: Record<string, string>; signal: AbortSignal },
) => Promise<HealthResponse>;

class StartupProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Probe timed out after ${timeoutMs}ms`);
    this.name = "StartupProbeTimeoutError";
  }
}

const defaultHealthFetch: HealthFetch = (url, init) => fetch(url, init);

function unwrapResult<T>(result: StartupFieldsResult<T>): T {
  if (result.data !== undefined) return result.data;
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTime(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function attemptTimeout(deadline: number, attemptTimeoutMs: number): number {
  const remainingMs = remainingTime(deadline);
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.min(attemptTimeoutMs, remainingMs));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new StartupProbeTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function timeoutError(message: string, lastError: string | null): Error {
  return new Error(lastError ? `${message}: ${lastError}` : message);
}

async function sleepUntilNextPoll(deadline: number, pollMs: number): Promise<void> {
  const sleepMs = Math.min(pollMs, remainingTime(deadline));
  if (sleepMs > 0) await wait(sleepMs);
}

export async function waitForHealthy(
  url: string,
  timeoutMs = DEFAULT_STARTUP_HEALTH_TIMEOUT_MS,
  pollMs = DEFAULT_HEALTH_POLL_MS,
  attemptTimeoutMs = DEFAULT_HEALTH_ATTEMPT_TIMEOUT_MS,
  fetchImpl: HealthFetch = defaultHealthFetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  const healthUrl = `${url.replace(/\/$/, "")}/health`;

  while (remainingTime(deadline) > 0) {
    const timeout = attemptTimeout(deadline, attemptTimeoutMs);
    try {
      const response = await withTimeout(
        fetchImpl(healthUrl, { signal: AbortSignal.timeout(timeout) }),
        timeout,
      );
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await sleepUntilNextPoll(deadline, pollMs);
  }

  throw timeoutError("Timed out waiting for health check", lastError);
}

export async function waitForOpencodeHealthy(
  client: StartupOpencodeClient,
  timeoutMs = DEFAULT_STARTUP_HEALTH_TIMEOUT_MS,
  pollMs = DEFAULT_HEALTH_POLL_MS,
  attemptTimeoutMs = DEFAULT_HEALTH_ATTEMPT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (remainingTime(deadline) > 0) {
    try {
      const health = unwrapResult(
        await withTimeout(
          client.global.health(),
          attemptTimeout(deadline, attemptTimeoutMs),
        ),
      );
      if (health?.healthy) return health;
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = errorMessage(error);
    }

    if (remainingTime(deadline) > 0) {
      try {
        // Some environments have a broken OpenCode /health probe even while the
        // core API surface is already usable. Accept a successful path lookup as
        // readiness so session APIs can come up in those runtimes.
        unwrapResult(
          await withTimeout(
            client.path.get(),
            attemptTimeout(deadline, attemptTimeoutMs),
          ),
        );
        return { healthy: true, degraded: true, reason: lastError ?? undefined };
      } catch (error) {
        if (!lastError) lastError = errorMessage(error);
      }
    }

    await sleepUntilNextPoll(deadline, pollMs);
  }

  throw timeoutError("Timed out waiting for OpenCode health", lastError);
}

export async function waitForHealthyViaProxy(
  proxyBaseUrl: string,
  token: string,
  timeoutMs = DEFAULT_STARTUP_HEALTH_TIMEOUT_MS,
  pollMs = DEFAULT_HEALTH_POLL_MS,
  attemptTimeoutMs = DEFAULT_HEALTH_ATTEMPT_TIMEOUT_MS,
  fetchImpl: HealthFetch = defaultHealthFetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  const healthUrl = `${proxyBaseUrl.replace(/\/$/, "")}/health`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  while (remainingTime(deadline) > 0) {
    const timeout = attemptTimeout(deadline, attemptTimeoutMs);
    try {
      const response = await withTimeout(
        fetchImpl(healthUrl, {
          headers,
          signal: AbortSignal.timeout(timeout),
        }),
        timeout,
      );
      if (response.ok) return;
      // Some older server versions may return 401/403 on the proxy but that
      // still proves the server is up and proxying. Accept any non-5xx as
      // "alive" — the real auth validation happens in verifyOpenworkServer.
      if (response.status < 500) return;
      lastError = `Proxy returned ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
    await sleepUntilNextPoll(deadline, pollMs);
  }

  throw timeoutError("Timed out waiting for OpenCode health via proxy", lastError);
}
