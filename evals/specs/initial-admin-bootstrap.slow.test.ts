import { createHash } from "node:crypto";
import { expect } from "vitest";
import { clickButton, denFetch, evalIn, fill, signIn, visibleText, waitFor } from "@openwork/behaviors";
import { localMysqlIsRunning, localRedisIsRunning, queryDenDatabase, server, test } from "@openwork/testkit";
import { navigate } from "@openwork/cdp";
import { chrome } from "@openwork/hosts";

const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1" && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const redisOpen = await localRedisIsRunning();
const title = !localPlacement
  ? "Initial administrator bootstrap skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
  : !mysqlOpen
    ? "Initial administrator bootstrap skipped — needs MySQL on 127.0.0.1:3306"
    : !redisOpen
      ? "Initial administrator bootstrap skipped — needs Redis on 127.0.0.1:6379"
      : "a private zero-user Den deployment can be claimed once by a configured administrator with an operator code";

function codeDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function numberField(value: unknown, key: string): number {
  if (!isRecord(value)) return 0;
  const field = value[key];
  return typeof field === "number" ? field : 0;
}

async function readBootstrapFacts(databaseUrl: string, adminEmail: string) {
  const users = await queryDenDatabase(databaseUrl, "SELECT id, email FROM `user` ORDER BY created_at, id");
  const orgs = await queryDenDatabase(databaseUrl, "SELECT id, slug FROM organization ORDER BY created_at, id");
  const members = await queryDenDatabase(
    databaseUrl,
    "SELECT m.role, m.user_id, o.slug FROM member m INNER JOIN organization o ON o.id = m.organization_id WHERE lower((SELECT email FROM `user` WHERE id = m.user_id)) = ?",
    [adminEmail.toLowerCase()],
  );
  const claims = await queryDenDatabase(databaseUrl, "SELECT consumed_at, consumed_by_user_id FROM initial_admin_bootstrap_claim WHERE singleton_key = ?", ["initial_admin"]);
  const admins = await queryDenDatabase(databaseUrl, "SELECT email FROM admin_allowlist WHERE email = ?", [adminEmail.toLowerCase()]);
  return {
    users: users.length,
    orgs: orgs.length,
    members: members.length,
    claims: claims.length,
    adminAllowlistRows: admins.length,
    firstMemberRole: isRecord(members[0]) ? stringField(members[0], "role") : "",
    firstOrgSlug: isRecord(orgs[0]) ? stringField(orgs[0], "slug") : "",
    claimConsumed: isRecord(claims[0]) && Boolean(claims[0].consumed_at),
  };
}

test.skipIf(!localPlacement || !mysqlOpen || !redisOpen)(title, { timeout: 600_000 }, async ({ evidence, place }) => {
  const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
  const adminEmail = `Initial.Admin.${runId}@example.com`;
  const normalizedAdminEmail = adminEmail.toLowerCase();
  const otherAdminEmail = `second.${runId}@example.com`;
  const setupCode = `eval-initial-admin-code-${runId}`;
  const adminPassword = "OpenWorkEval123!";

  await using den = await server({
    place,
    provision: false,
    env: {
      DEN_ORG_MODE: "single_org",
      DEN_SINGLE_ORG_NAME: "Private OpenWork",
      DEN_SINGLE_ORG_SLUG: "private-openwork",
      DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP: "false",
      DEN_SINGLE_ORG_OWNER_EMAILS: `${adminEmail},${otherAdminEmail}`,
      DEN_BOOTSTRAP_ADMIN_EMAILS: adminEmail,
      DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256: codeDigest(setupCode),
    },
  });

  const databaseUrl = den.database?.url;
  if (!databaseUrl) throw new Error("initial admin bootstrap spec requires the local isolated database handle");

  const availability = await denFetch(den.ref, "/v1/auth/bootstrap/status");
  expect(availability.response.ok, `bootstrap status: HTTP ${availability.response.status} ${availability.text.slice(0, 300)}`).toBe(true);
  expect(stringField(availability.body, "status")).toBe("available");
  expect(availability.text).not.toContain(normalizedAdminEmail);
  evidence.fact(
    "A private zero-user deployment reports bootstrap availability without exposing configured administrator emails",
    `GET /v1/auth/bootstrap/status returned ${stringField(availability.body, "status")} and did not include the configured email.`,
    availability.response.ok && stringField(availability.body, "status") === "available" && !availability.text.includes(normalizedAdminEmail),
  );

  const unconfigured = await denFetch(den.ref, "/v1/auth/bootstrap/verify", {
    method: "POST",
    body: JSON.stringify({ email: `outsider.${runId}@example.com`, code: setupCode }),
  });
  expect(unconfigured.response.status).toBe(403);
  expect(unconfigured.text).not.toContain(normalizedAdminEmail);
  expect(unconfigured.text).not.toContain("owner");
  expect(unconfigured.text).not.toContain("allowlist");

  const invalidCode = await denFetch(den.ref, "/v1/auth/bootstrap/verify", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, code: "not-the-code" }),
  });
  expect(invalidCode.response.status).toBe(403);
  expect(invalidCode.text).not.toContain(normalizedAdminEmail);
  expect(invalidCode.text).toBe(unconfigured.text);
  evidence.fact(
    "Failed bootstrap verification gives a generic rejection for both unconfigured emails and invalid codes",
    `Unconfigured email and invalid code both returned the same HTTP 403 without privileged email, owner, or allowlist details.`,
    unconfigured.response.status === 403
      && invalidCode.response.status === 403
      && invalidCode.text === unconfigured.text
      && !unconfigured.text.includes(normalizedAdminEmail)
      && !invalidCode.text.includes(normalizedAdminEmail)
      && !unconfigured.text.includes("allowlist")
      && !invalidCode.text.includes("allowlist"),
  );

  const valid = await denFetch(den.ref, "/v1/auth/bootstrap/verify", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, code: setupCode }),
  });
  const grant = stringField(valid.body, "grant");
  expect(valid.response.ok, `valid setup verification: HTTP ${valid.response.status} ${valid.text.slice(0, 300)}`).toBe(true);
  expect(grant).toMatch(/^ow_bootstrap_/);

  const weakSignup = await denFetch(den.ref, "/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, name: "Initial Admin", password: "short", bootstrapGrant: grant }),
  });
  expect(weakSignup.response.status).toBe(400);
  expect(weakSignup.text).toMatch(/password/i);
  const factsAfterWeakPassword = await readBootstrapFacts(databaseUrl, adminEmail);
  expect(factsAfterWeakPassword.users).toBe(0);
  expect(factsAfterWeakPassword.claimConsumed).toBe(false);
  evidence.fact(
    "Bootstrap account creation still exercises password policy and does not consume the claim on failure",
    `Weak password signup returned HTTP ${weakSignup.response.status}; users=${factsAfterWeakPassword.users}; claimConsumed=${String(factsAfterWeakPassword.claimConsumed)}.` ,
    weakSignup.response.status === 400 && factsAfterWeakPassword.users === 0 && factsAfterWeakPassword.claimConsumed === false,
  );

  await using browser = await chrome({ name: "initial-admin-bootstrap", startUrl: den.ref.webUrl, headless: true });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(browser.client, `${den.ref.webUrl}/setup`);
  await waitFor(browser, `/set up your administrator account/i.test(document.body?.innerText ?? "")`, {
    timeoutMs: 90_000,
    label: "setup page title",
  });
  await waitFor(browser, `/one-time setup code/i.test(document.body?.innerText ?? "") && Boolean(document.querySelector('input[name="setupCode"]'))`, {
    timeoutMs: 30_000,
    label: "setup verification form",
  });

  let setupText = await visibleText(browser);
  expect(setupText).toMatch(/Set up your administrator account/i);
  expect(setupText).toMatch(/one-time setup code/i);
  expect(setupText).not.toContain(normalizedAdminEmail);
  expect(await evalIn(browser, `document.querySelector('input[name="setupCode"]')?.getAttribute("type")`)).toBe("password");
  evidence.fact(
    "The setup page explains first-admin setup without displaying configured privileged emails",
    `The setup page text includes the administrator title and one-time setup code prompt, and omits the configured email.`,
    /set up your administrator account/i.test(setupText)
      && /one-time setup code/i.test(setupText)
      && !setupText.includes(normalizedAdminEmail),
  );

  await fill(browser, 'input[name="email"]', adminEmail.toUpperCase());
  await fill(browser, 'input[name="setupCode"]', setupCode);
  await clickButton(browser, "Continue");
  await waitFor(browser, `/create your administrator account/i.test(document.body?.innerText ?? "")`, {
    timeoutMs: 60_000,
    label: "account creation step",
  });
  setupText = await visibleText(browser);
  expect(setupText).toMatch(/Create your administrator account/i);
  expect(setupText).not.toContain(setupCode);

  await fill(browser, 'input[name="name"]', "Initial Admin");
  await fill(browser, 'input[name="password"]', "short");
  await clickButton(browser, "Create administrator");
  await waitFor(browser, `/password/i.test(document.body?.innerText ?? "")`, {
    timeoutMs: 30_000,
    label: "password policy feedback",
  });
  await fill(browser, 'input[name="password"]', adminPassword);
  await clickButton(browser, "Create administrator");
  await waitFor(browser, `location.pathname === "/install" || location.pathname.startsWith("/dashboard") || /setup is complete/i.test(document.body?.innerText ?? "")`, {
    timeoutMs: 90_000,
    label: "signed in after bootstrap",
  });

  const factsAfterSetup = await readBootstrapFacts(databaseUrl, adminEmail);
  expect(factsAfterSetup.users).toBe(1);
  expect(factsAfterSetup.orgs).toBe(1);
  expect(factsAfterSetup.members).toBe(1);
  expect(factsAfterSetup.firstMemberRole).toBe("owner");
  expect(factsAfterSetup.firstOrgSlug).toBe("private-openwork");
  expect(factsAfterSetup.claimConsumed).toBe(true);
  expect(factsAfterSetup.adminAllowlistRows).toBe(1);
  evidence.fact(
    "Successful setup creates exactly one user, singleton organization, owner membership, platform-admin authorization, and consumed claim",
    `users=${factsAfterSetup.users}; orgs=${factsAfterSetup.orgs}; members=${factsAfterSetup.members}; role=${factsAfterSetup.firstMemberRole}; slug=${factsAfterSetup.firstOrgSlug}; platformAdminRows=${factsAfterSetup.adminAllowlistRows}; claimConsumed=${String(factsAfterSetup.claimConsumed)}.`,
    factsAfterSetup.users === 1
      && factsAfterSetup.orgs === 1
      && factsAfterSetup.members === 1
      && factsAfterSetup.firstMemberRole === "owner"
      && factsAfterSetup.firstOrgSlug === "private-openwork"
      && factsAfterSetup.claimConsumed
      && factsAfterSetup.adminAllowlistRows === 1,
  );

  const replayGrant = await denFetch(den.ref, "/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: otherAdminEmail, name: "Second Admin", password: adminPassword, bootstrapGrant: grant }),
  });
  expect(replayGrant.response.status).toBe(403);
  const replayCode = await denFetch(den.ref, "/v1/auth/bootstrap/verify", {
    method: "POST",
    body: JSON.stringify({ email: adminEmail, code: setupCode }),
  });
  expect(replayCode.response.status).toBe(409);
  evidence.fact(
    "The setup code and bootstrap grant cannot be replayed after setup completes",
    `grant replay returned HTTP ${replayGrant.response.status}; code replay returned HTTP ${replayCode.response.status}.`,
    replayGrant.response.status === 403 && replayCode.response.status === 409,
  );

  await navigate(browser.client, `${den.ref.webUrl}/setup`);
  await waitFor(browser, `/setup is complete/i.test(document.body?.innerText ?? "")`, {
    timeoutMs: 60_000,
    label: "setup complete page",
  });
  const completedText = await visibleText(browser);
  expect(completedText).toMatch(/Setup is complete/i);
  expect(completedText).toMatch(/Sign in/i);

  const publicSignup = await denFetch(den.ref, "/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email: `unknown.${runId}@example.com`, name: "Unknown User", password: adminPassword }),
  });
  expect(publicSignup.response.status).toBe(403);

  await denFetch(den.ref, "/api/auth/sign-out", { method: "POST" });
  const normalSignin = await signIn(den.ref, { email: normalizedAdminEmail, password: adminPassword });
  expect(normalSignin.token).toBeTruthy();
  evidence.fact(
    "After bootstrap, public signup remains disabled while the administrator uses normal password sign-in",
    `Unknown signup returned HTTP ${publicSignup.response.status}; normal admin signin produced a session token length ${normalSignin.token.length}.`,
    publicSignup.response.status === 403 && normalSignin.token.length > 0,
  );

  await using existingUsersDen = await server({
    place,
    web: false,
    org: { name: `Existing Users ${runId}`, admin: { email: `existing.${runId}@example.com` }, members: {} },
    env: {
      DEN_ORG_MODE: "multi_org",
      DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP: "true",
      DEN_SINGLE_ORG_OWNER_EMAILS: `existing.${runId}@example.com`,
      DEN_BOOTSTRAP_ADMIN_EMAILS: adminEmail,
      DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256: codeDigest(setupCode),
    },
  });
  const unavailable = await denFetch(existingUsersDen.ref, "/v1/auth/bootstrap/status");
  expect(stringField(unavailable.body, "status")).toBe("complete");
  evidence.fact(
    "An existing installation with users does not expose setup even if bootstrap configuration remains present",
    `GET /v1/auth/bootstrap/status on a provisioned Den returned ${stringField(unavailable.body, "status")}.`,
    stringField(unavailable.body, "status") === "complete",
  );

  const concurrentCode = `eval-concurrent-code-${runId}`;
  await using raceDen = await server({
    place,
    provision: false,
    web: false,
    env: {
      DEN_ORG_MODE: "single_org",
      DEN_SINGLE_ORG_NAME: "Race OpenWork",
      DEN_SINGLE_ORG_SLUG: "race-openwork",
      DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP: "false",
      DEN_SINGLE_ORG_OWNER_EMAILS: `${adminEmail},${otherAdminEmail}`,
      DEN_BOOTSTRAP_ADMIN_EMAILS: `${adminEmail},${otherAdminEmail}`,
      DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256: codeDigest(concurrentCode),
    },
  });
  if (!raceDen.database?.url) throw new Error("concurrency Den needs database handle");
  const [raceGrantOne, raceGrantTwo] = await Promise.all([
    denFetch(raceDen.ref, "/v1/auth/bootstrap/verify", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, code: concurrentCode }),
    }),
    denFetch(raceDen.ref, "/v1/auth/bootstrap/verify", {
      method: "POST",
      body: JSON.stringify({ email: otherAdminEmail, code: concurrentCode }),
    }),
  ]);
  const raceResponses = await Promise.all([
    denFetch(raceDen.ref, "/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, name: "Race One", password: adminPassword, bootstrapGrant: stringField(raceGrantOne.body, "grant") }),
    }),
    denFetch(raceDen.ref, "/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: otherAdminEmail, name: "Race Two", password: adminPassword, bootstrapGrant: stringField(raceGrantTwo.body, "grant") }),
    }),
  ]);
  const raceSuccesses = raceResponses.filter((result) => result.response.ok).length;
  const raceFailures = raceResponses.filter((result) => result.response.status === 403 || result.response.status === 409).length;
  const raceFacts = await readBootstrapFacts(raceDen.database.url, adminEmail);
  expect(raceSuccesses).toBe(1);
  expect(raceFailures).toBe(1);
  expect(raceFacts.users).toBe(1);
  expect(raceFacts.orgs).toBe(1);
  evidence.fact(
    "Concurrent setup attempts race safely and create exactly one administrator",
    `successes=${raceSuccesses}; expectedFailures=${raceFailures}; users=${raceFacts.users}; orgs=${raceFacts.orgs}.`,
    raceSuccesses === 1 && raceFailures === 1 && raceFacts.users === 1 && raceFacts.orgs === 1,
  );

  const log = await den.apiLog();
  expect(log).not.toContain(setupCode);
  expect(log).not.toContain(concurrentCode);
  evidence.fact(
    "Den API logs do not contain submitted setup codes",
    `The captured API log did not contain either submitted setup code.`,
    !log.includes(setupCode) && !log.includes(concurrentCode),
  );

  expect(numberField({ count: factsAfterSetup.users }, "count")).toBe(1);
});
