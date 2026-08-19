import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "@openwork/testkit";
import { expect } from "vitest";

const expectedDelays = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000];
const runnerUnitTest = fileURLToPath(new URL("../../apps/desktop/electron/automation-runner.test.mjs", import.meta.url));

function requestBudget(delays: number[], windowMs: number): number {
  let attempts = 0;
  let nextAttemptAt = 0;
  while (nextAttemptAt < windowMs) {
    nextAttemptAt += delays[Math.min(attempts, delays.length - 1)];
    attempts += 1;
  }
  return attempts * 2;
}

test("desktop Automation runners back off repeated HTTP failures", async ({ evidence }) => {
  const unit = spawnSync(process.execPath, [
    "--test",
    "--test-reporter=tap",
    runnerUnitTest,
  ], { encoding: "utf8" });
  expect(unit.status, unit.stderr || unit.stdout).toBe(0);
  expect(unit.stdout).toContain("repeated HTTP 502 responses retain exponential runner reconnect backoff");
  expect(unit.stdout).toContain("repeated HTTP 401 responses retain exponential runner reconnect backoff");
  expect(unit.stdout).toContain("a healthy SSE response resets runner reconnect backoff");
  expect(unit.stdout).toContain("a parsed SSE event resets backoff before an abrupt stream error");
  expect(unit.stdout).not.toContain("not ok");
  expect(unit.stdout).toMatch(/# tests 15\b/);
  expect(unit.stdout).toMatch(/# pass 15\b/);
  expect(unit.stdout).toMatch(/# fail 0\b/);
  expect(unit.stdout).toMatch(/# skipped 0\b/);
  expect(unit.stdout).toMatch(/# todo 0\b/);
  evidence.fact(
    "Repeated HTTP failures retain capped exponential backoff",
    "Both ten-response 502 and 401 sequences produced 500, 1000, 2000, 4000, 8000, 16000, then four 30000ms delays, with exactly one work and one SSE request per attempt. After three 502s, a parsed keepalive followed by an abrupt stream error reset the next delay to 500ms.",
    true,
  );

  const previousResetOnResponseDelays = Array(10).fill(500);
  expect(requestBudget(previousResetOnResponseDelays, 60_000)).toBe(240);
  expect(requestBudget(expectedDelays, 60_000)).toBe(14);
  expect(previousResetOnResponseDelays.reduce((total, delay) => total + delay, 0)).toBe(5_000);
  expect(expectedDelays.reduce((total, delay) => total + delay, 0)).toBe(151_500);
  evidence.fact(
    "Reconnect request budget is bounded during an outage",
    "At midpoint jitter, the pre-fix reset behavior budgets 240 work-plus-SSE requests in 60 seconds; capped exponential backoff budgets 14. Across ten failures, waiting rises from 5 seconds to 151.5 seconds.",
    true,
  );
});
