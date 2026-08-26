import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "@openwork/testkit";
import { expect } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

test("rejected Automation runner credentials stay attributable and bounded", ({ evidence }) => {
  const reportDir = mkdtempSync(join(tmpdir(), "openwork-runner-rejection-"));
  const reportPath = join(reportDir, "bun-junit.xml");
  try {
    const result = spawnSync("pnpm", [
      "--filter",
      "@openwork-ee/den-api",
      "exec",
      "bun",
      "test",
      "test/automation-runner-auth.test.ts",
      "--reporter=junit",
      "--reporter-outfile",
      reportPath,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.error, output).toBeUndefined();
    expect(result.status, output).toBe(0);

    const junit = readFileSync(reportPath, "utf8");
    const summary = junit.match(/<testsuite\b[^>]*>/)?.[0] ?? "";
    expect(summary).toContain('tests="12"');
    expect(summary).toContain('failures="0"');
    expect(summary).toContain('skipped="0"');
    expect(junit).not.toContain("<failure");
    expect(junit).not.toContain("<skipped");

    evidence.recordAssertionEvidence(
      "Runner credential rejections retain safe attribution",
      "Malformed, bad-signature, expired, and audience-mismatched credentials are classified; claimed runner, organization, and member IDs are represented only by stable fingerprints with version and expiry.",
      true,
    );
    evidence.recordAssertionEvidence(
      "Repeated rejected credentials are bounded without affecting valid runners",
      "The focused protocol witness ignores caller-controlled leading X-Forwarded-For hops, separates changed trusted edge hops, returns 401 before the threshold, then 429 with Retry-After, keeps limiter memory bounded, and still accepts a valid credential sharing the same runner and address.",
      true,
    );
    evidence.recordAssertionEvidence(
      "Runner HTTP failures disclose no claimed identity or bearer material",
      "The rejection body remains the generic runner_unauthorized envelope and the diagnostics exclude the bearer token, signature, signing secret, and raw claimed IDs.",
      true,
    );
  } finally {
    rmSync(reportDir, { force: true, recursive: true });
  }
});
