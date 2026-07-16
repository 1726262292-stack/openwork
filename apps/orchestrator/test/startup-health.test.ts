import { expect, test } from "bun:test";
import {
  DEFAULT_STARTUP_HEALTH_TIMEOUT_MS,
  waitForHealthy,
  waitForHealthyViaProxy,
  waitForOpencodeHealthy,
} from "../src/startup-health";

test("delayed OpenWork health eventually succeeds within the startup window", async () => {
  const startedAt = Date.now();
  let attempts = 0;

  await waitForHealthy(
    "http://openwork.test",
    150,
    5,
    20,
    async () => {
      attempts += 1;
      const ready = Date.now() - startedAt >= 30;
      return { ok: ready, status: ready ? 200 : 503 };
    },
  );

  expect(attempts).toBeGreaterThan(1);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
});

test("never-resolving OpenCode SDK probes are bounded by the overall timeout", async () => {
  const startedAt = Date.now();
  const client = {
    global: { health: () => new Promise<never>(() => undefined) },
    path: { get: () => new Promise<never>(() => undefined) },
  };

  await expect(waitForOpencodeHealthy(client, 45, 5, 20)).rejects.toThrow(
    "Timed out waiting for OpenCode health",
  );

  expect(Date.now() - startedAt).toBeLessThan(200);
});

test("OpenCode path fallback still marks readiness as degraded", async () => {
  const health = await waitForOpencodeHealthy(
    {
      global: { health: async () => ({ data: { healthy: false } }) },
      path: { get: async () => ({ data: { cwd: "/workspace" } }) },
    },
    100,
    5,
    20,
  );

  expect(health).toEqual({
    healthy: true,
    degraded: true,
    reason: "Server reported unhealthy",
  });
});

test("proxy health accepts non-5xx readiness with an explicit short timeout", async () => {
  let attempts = 0;

  await waitForHealthyViaProxy(
    "http://openwork.test/opencode",
    "proxy-token",
    25,
    100,
    10,
    async (url, init) => {
      attempts += 1;
      expect(url).toBe("http://openwork.test/opencode/health");
      expect(init.headers?.Authorization).toBe("Bearer proxy-token");
      return { ok: false, status: 403 };
    },
  );

  expect(attempts).toBe(1);
});

test("explicit short timeouts remain honored and production default exceeds ten seconds", async () => {
  expect(DEFAULT_STARTUP_HEALTH_TIMEOUT_MS).toBeGreaterThan(10_000);

  const startedAt = Date.now();
  await expect(
    waitForHealthy(
      "http://openwork.test",
      25,
      100,
      1_000,
      () => new Promise<never>(() => undefined),
    ),
  ).rejects.toThrow("Timed out waiting for health check");

  expect(Date.now() - startedAt).toBeLessThan(200);
});
