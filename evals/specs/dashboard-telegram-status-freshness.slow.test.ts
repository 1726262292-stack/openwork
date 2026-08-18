import { denFetch } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { expect } from "vitest";
import { localMysqlIsRunning, needs, queryDenDatabase, server, test } from "@openwork/testkit";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1" && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !appSpecsEnabled
  ? "dashboard Telegram status freshness skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "dashboard Telegram status freshness skipped — needs a real local Den"
    : !mysqlOpen
      ? "dashboard Telegram status freshness skipped — needs MySQL on 127.0.0.1:3306"
      : "opening the dashboard reads redacted Telegram status without requiring fresh authentication";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auth(session: DenSession, orgId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${session.token}`,
    ...(orgId ? { "x-openwork-org-id": orgId } : {}),
  };
}

test.skipIf(!appSpecsEnabled || !localPlacement || !mysqlOpen)(title, async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });

  await using den = await server({ place, org: { name: `Dashboard Telegram ${Date.now().toString(36)}` } });
  const databaseUrl = den.database?.url;
  if (!databaseUrl) throw new Error("dashboard Telegram freshness requires the local isolated database handle");

  const orgs = await denFetch(den.admin, "/v1/me/orgs", { headers: auth(den.admin) });
  expect(orgs.response.status).toBe(200);
  const organizations = isRecord(orgs.body) && Array.isArray(orgs.body.orgs) ? orgs.body.orgs.filter(isRecord) : [];
  const orgId = organizations.length === 1 && typeof organizations[0]?.id === "string" ? organizations[0].id : "";
  expect(orgId).toMatch(/^org_/);

  await queryDenDatabase(
    databaseUrl,
    "UPDATE `session` SET created_at = DATE_SUB(NOW(3), INTERVAL 25 HOUR) WHERE token = ?",
    [den.admin.token],
  );

  const passiveStatus = await denFetch(den.admin, "/v1/capabilities/telegram/status", {
    headers: auth(den.admin, orgId),
  });
  expect(passiveStatus.response.status).toBe(200);
  expect(passiveStatus.body).toEqual({ connection: null });
  evidence.fact(
    "The dashboard can read redacted Telegram status without reauthentication",
    "A session older than the 24-hour connection-management window received HTTP 200 and no credential material from the capability status endpoint.",
    passiveStatus.response.status === 200
      && isRecord(passiveStatus.body)
      && passiveStatus.body.connection === null,
  );

  const managementDetail = await denFetch(den.admin, "/v1/telegram/connection", {
    headers: auth(den.admin, orgId),
  });
  expect(managementDetail.response.status).toBe(403);
  expect(managementDetail.body).toEqual({
    error: "reauth",
    reason: "fresh_auth_required",
    message: "For security, confirm it's you before changing workspace settings.",
  });
  evidence.fact(
    "Detailed Telegram management remains step-up protected",
    "The same stale session received exact HTTP 403 reauth/fresh_auth_required from the management endpoint.",
    managementDetail.response.status === 403
      && isRecord(managementDetail.body)
      && managementDetail.body.reason === "fresh_auth_required",
  );
});
