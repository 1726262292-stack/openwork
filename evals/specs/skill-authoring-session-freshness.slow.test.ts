import { denFetch } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { expect } from "vitest";
import { localMysqlIsRunning, needs, queryDenDatabase, server, test } from "@openwork/testkit";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1" && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !appSpecsEnabled
  ? "skill authoring session freshness skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "skill authoring session freshness skipped — needs a real local Den"
    : !mysqlOpen
      ? "skill authoring session freshness skipped — needs MySQL on 127.0.0.1:3306"
      : "a stale admin session can author a private plugin and skill but cannot expand its audience org-wide";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireItem(body: unknown, label: string): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.item)) {
    throw new Error(`${label} returned no item: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body.item;
}

function auth(session: DenSession, orgId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${session.token}`,
    ...(orgId ? { "x-openwork-org-id": orgId } : {}),
  };
}

test.skipIf(!appSpecsEnabled || !localPlacement || !mysqlOpen)(title, async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });

  const unique = `${Date.now().toString(36)}${process.pid.toString(36)}`;
  const organizationName = `Skill Freshness ${unique}`;
  await using den = await server({ place, org: { name: organizationName } });
  const databaseUrl = den.database?.url;
  if (!databaseUrl) throw new Error("skill authoring freshness requires the local isolated database handle");

  const orgsResult = await denFetch(den.admin, "/v1/me/orgs", { headers: auth(den.admin) });
  expect(orgsResult.response.status).toBe(200);
  const organizations = isRecord(orgsResult.body) && Array.isArray(orgsResult.body.orgs)
    ? orgsResult.body.orgs.filter(isRecord)
    : [];
  const organization = organizations.find((entry) => entry.name === organizationName);
  const orgId = organization && typeof organization.id === "string" ? organization.id : "";
  expect(orgId).toMatch(/^org_/);

  await queryDenDatabase(
    databaseUrl,
    "UPDATE `session` SET created_at = DATE_SUB(NOW(3), INTERVAL 20 MINUTE) WHERE token = ?",
    [den.admin.token],
  );
  const sessionRows = await queryDenDatabase(
    databaseUrl,
    "SELECT created_at, TIMESTAMPDIFF(SECOND, created_at, NOW(3)) AS age_seconds FROM `session` WHERE token = ?",
    [den.admin.token],
  );
  expect(sessionRows).toHaveLength(1);
  const sessionRow = sessionRows[0];
  const ageSeconds = isRecord(sessionRow) && typeof sessionRow.age_seconds === "number" ? sessionRow.age_seconds : 0;
  expect(ageSeconds).toBeGreaterThan(15 * 60);
  evidence.fact(
    "The admin credential is older than the privileged-session window",
    `The credential's database session is ${ageSeconds} seconds old, beyond the 900-second freshness limit.`,
    ageSeconds > 15 * 60,
  );

  const orgWidePlugin = await denFetch(den.admin, "/v1/plugins", {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({
      name: `Blocked Org-wide Plugin ${unique}`,
      orgWide: true,
    }),
  });
  expect(orgWidePlugin.response.status).toBe(403);
  expect(orgWidePlugin.body).toEqual({
    error: "reauth",
    reason: "fresh_auth_required",
    message: "For security, confirm it's you before changing workspace settings.",
  });
  evidence.fact(
    "Creating an org-wide plugin still requires fresh authentication",
    "The stale credential received exact HTTP 403 reauth/fresh_auth_required before creating an org-wide plugin.",
    orgWidePlugin.response.status === 403
      && isRecord(orgWidePlugin.body)
      && orgWidePlugin.body.error === "reauth"
      && orgWidePlugin.body.reason === "fresh_auth_required",
  );

  const skillName = `stale-session-skill-${unique}`;
  const initialSource = `---\nname: ${skillName}\ndescription: Proves stale-session private authoring.\n---\n\nReturn the initial private skill source.`;
  const pluginResult = await denFetch(den.admin, "/v1/plugins", {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({
      name: `Stale Session Plugin ${unique}`,
      orgWide: false,
    }),
  });
  expect(pluginResult.response.status).toBe(201);
  const plugin = requireItem(pluginResult.body, "Private plugin creation");
  const pluginId = typeof plugin.id === "string" ? plugin.id : "";
  expect(pluginId).toMatch(/^plg_/);
  evidence.fact(
    "The stale credential can create a private plugin",
    `POST /v1/plugins returned HTTP ${pluginResult.response.status} without expanding the plugin audience.`,
    pluginResult.response.status === 201 && pluginId.startsWith("plg_"),
  );

  const created = await denFetch(den.admin, "/v1/config-objects", {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({
      type: "skill",
      pluginIds: [pluginId],
      sourceMode: "cloud",
      input: { rawSourceText: initialSource },
    }),
  });
  expect(created.response.status).toBe(201);
  const skill = requireItem(created.body, "Private skill creation");
  const configObjectId = typeof skill.id === "string" ? skill.id : "";
  expect(configObjectId).toMatch(/^cob_/);
  evidence.fact(
    "The same stale credential can create private skill content",
    `POST /v1/config-objects returned HTTP ${created.response.status} while adding a private skill to the admin's plugin.`,
    created.response.status === 201 && configObjectId.startsWith("cob_"),
  );

  const updatedSource = `---\nname: ${skillName}\ndescription: Proves stale-session private authoring.\n---\n\nReturn the updated private skill source: ${unique}.`;
  const versioned = await denFetch(den.admin, `/v1/config-objects/${encodeURIComponent(configObjectId)}/versions`, {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({ input: { rawSourceText: updatedSource }, reason: "spec: stale-session skill edit" }),
  });
  expect(versioned.response.status).toBe(201);

  const detail = await denFetch(den.admin, `/v1/config-objects/${encodeURIComponent(configObjectId)}`, {
    headers: auth(den.admin, orgId),
  });
  expect(detail.response.status).toBe(200);
  const updatedItem = requireItem(detail.body, "Updated config object");
  const latestVersion = isRecord(updatedItem.latestVersion) ? updatedItem.latestVersion : null;
  const observedSource = latestVersion && typeof latestVersion.rawSourceText === "string"
    ? latestVersion.rawSourceText
    : "";
  expect(observedSource).toBe(updatedSource);
  expect(observedSource).not.toBe(initialSource);
  evidence.fact(
    "The stale credential can save and read a new private skill version",
    "The config object's latest immutable version exposes the exact updated SKILL.md source rather than the initial source.",
    versioned.response.status === 201 && observedSource === updatedSource && observedSource !== initialSource,
  );

  const audienceChange = await denFetch(den.admin, `/v1/plugins/${encodeURIComponent(pluginId)}/access`, {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({ orgWide: true, role: "viewer" }),
  });
  expect(audienceChange.response.status).toBe(403);
  expect(audienceChange.body).toEqual({
    error: "reauth",
    reason: "fresh_auth_required",
    message: "For security, confirm it's you before changing workspace settings.",
  });
  evidence.fact(
    "Expanding the plugin audience still requires fresh authentication",
    "The same stale credential received exact HTTP 403 reauth/fresh_auth_required when granting org-wide viewer access.",
    audienceChange.response.status === 403
      && isRecord(audienceChange.body)
      && audienceChange.body.error === "reauth"
      && audienceChange.body.reason === "fresh_auth_required",
  );
});
