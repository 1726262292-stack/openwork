import { denFetch } from "@openwork/behaviors";
import { expect } from "vitest";
import { localMysqlIsRunning, needs, server, test } from "@openwork/testkit";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1" && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !appSpecsEnabled
  ? "shared-domain login rate limit skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "shared-domain login rate limit skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
    : !mysqlOpen
      ? "shared-domain login rate limit skipped — needs MySQL on 127.0.0.1:3306"
      : "coworkers sharing an email domain keep independent login-option rate limits";

function statusDistribution(statuses: number[]): string {
  const counts = new Map<number, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([first], [second]) => first - second)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
}

test.skipIf(!appSpecsEnabled || !localPlacement || !mysqlOpen)(title, async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });

  await using den = await server({ place });
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const domain = `shared-${unique}.example.test`;
  const coworkerStatuses: number[] = [];

  // The route uses the first forwarded address, so give each coworker a stable IP to isolate the former domain bucket.
  for (let request = 0; request < 25; request += 1) {
    const coworker = request % 5;
    const result = await denFetch(
      den.ref,
      `/v1/auth/login-options?email=${encodeURIComponent(`coworker-${coworker}@${domain}`)}`,
      { headers: { "x-forwarded-for": `198.51.100.${coworker + 1}` } },
    );
    coworkerStatuses.push(result.response.status);
  }

  expect(coworkerStatuses).not.toContain(429);
  expect(coworkerStatuses.every((status) => status === 200)).toBe(true);
  evidence.fact(
    "Coworkers at one domain do not exhaust a shared domain bucket",
    `Observed 25 requests across 5 emails with status distribution ${statusDistribution(coworkerStatuses)}.`,
    !coworkerStatuses.includes(429),
  );

  const singleEmail = `single-${unique}@positive-control.test`;
  const singleEmailStatuses: number[] = [];
  // Vary the forwarded address so only the per-email bucket can trigger this positive control.
  for (let request = 0; request < 25; request += 1) {
    const result = await denFetch(
      den.ref,
      `/v1/auth/login-options?email=${encodeURIComponent(singleEmail)}`,
      { headers: { "x-forwarded-for": `203.0.113.${request + 1}` } },
    );
    singleEmailStatuses.push(result.response.status);
  }

  expect(singleEmailStatuses).toContain(429);
  evidence.fact(
    "The per-email abuse limiter remains active",
    `Observed 25 requests for one email from distinct forwarded addresses with status distribution ${statusDistribution(singleEmailStatuses)}.`,
    singleEmailStatuses.includes(429),
  );
});
