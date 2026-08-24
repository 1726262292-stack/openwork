import { denFetch, signIn } from "@openwork/behaviors";
import type { DenFetchResult, DenRef, DenSession } from "@openwork/behaviors";
import { needs, test } from "@openwork/testkit";
import { expect } from "vitest";

// Live lane: the production Den is attached and never owned by this spec. The
// timestamped user, organization, and invitations are launched onto it, so the
// spec owns their cleanup. den-api does not enable Better Auth's self-service
// account deletion endpoint, so the retained account is reported as residue.

interface LiveIdentity {
  owner: string;
  invitees: [string, string];
  neverInvited: string;
  timestamp: string;
}

interface OrganizationSummary {
  id: string;
  name: string;
}

interface OrganizationList {
  activeOrgId: string | null;
  activeOrgSlug: string | null;
  orgs: OrganizationSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return isRecord(field) ? field : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Unreachable after needs(): ${name} is missing.`);
  return value;
}

function liveIdentity(mailbox: string): LiveIdentity {
  const at = mailbox.lastIndexOf("@");
  if (at < 1 || at === mailbox.length - 1) {
    throw new Error("OPENWORK_EVAL_SECRET_LIVE_MAILBOX_EMAIL must be a complete email address.");
  }
  const local = mailbox.slice(0, at);
  const domain = mailbox.slice(at + 1);
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const prefix = `${local}+prod-${timestamp}`;
  return {
    owner: `${prefix}@${domain}`,
    invitees: [`${prefix}-m1@${domain}`, `${prefix}-m2@${domain}`],
    neverInvited: `${prefix}-never-invited@${domain}`,
    timestamp,
  };
}

function auth(session: DenSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

function responseFailure(label: string, result: DenFetchResult): Error {
  return new Error(`${label}: HTTP ${result.response.status} ${result.text.slice(0, 1_000)}`);
}

function parseOrganizationList(result: DenFetchResult, label: string): OrganizationList {
  if (result.response.status !== 200 || !isRecord(result.body) || !Array.isArray(result.body.orgs)) {
    throw responseFailure(label, result);
  }

  const orgs: OrganizationSummary[] = [];
  for (const value of result.body.orgs) {
    const id = stringField(value, "id");
    const name = stringField(value, "name");
    if (!id || !name) throw new Error(`${label}: malformed organization ${JSON.stringify(value).slice(0, 500)}`);
    orgs.push({ id, name });
  }

  const activeOrgId = result.body.activeOrgId;
  const activeOrgSlug = result.body.activeOrgSlug;
  if (activeOrgId !== null && typeof activeOrgId !== "string") {
    throw new Error(`${label}: activeOrgId was neither a string nor null.`);
  }
  if (activeOrgSlug !== null && typeof activeOrgSlug !== "string") {
    throw new Error(`${label}: activeOrgSlug was neither a string nor null.`);
  }

  return {
    activeOrgId,
    activeOrgSlug,
    orgs: orgs.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function listOrganizations(session: DenSession, label: string): Promise<OrganizationList> {
  const result = await denFetch(session, "/v1/me/orgs", { headers: auth(session) });
  return parseOrganizationList(result, label);
}

async function createOrganization(session: DenSession, name: string): Promise<string> {
  const result = await denFetch(session, "/v1/org", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ name }),
  });
  const id = stringField(recordField(result.body, "organization"), "id");
  if (result.response.status !== 201 || !id) throw responseFailure("Organization creation failed", result);
  return id;
}

async function invite(session: DenSession, email: string): Promise<void> {
  const result = await denFetch(session, "/v1/invitations", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ email, role: "member" }),
  });
  if (!result.response.ok) throw responseFailure(`Invitation failed for ${email}`, result);
}

function listedEmails(body: unknown, key: "invitations" | "members"): string[] {
  if (!isRecord(body) || !Array.isArray(body[key])) {
    throw new Error(`Organization listing had no ${key} array: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const emails: string[] = [];
  for (const value of body[key]) {
    const email = key === "invitations"
      ? stringField(value, "email")
      : stringField(recordField(value, "user"), "email");
    if (!email) throw new Error(`Organization ${key} entry had no email: ${JSON.stringify(value).slice(0, 500)}`);
    emails.push(email);
  }
  return emails.sort();
}

async function organizationEmails(session: DenSession): Promise<{ invitations: string[]; members: string[] }> {
  const result = await denFetch(session, "/v1/org", { headers: auth(session) });
  if (result.response.status !== 200) throw responseFailure("Organization invite/member listing failed", result);
  return {
    invitations: listedEmails(result.body, "invitations"),
    members: listedEmails(result.body, "members"),
  };
}

async function deleteCreatedOrganization(session: DenSession, organizationId: string): Promise<void> {
  const active = await signIn(session, { email: session.email, password: session.password });
  const selected = await denFetch(active, "/v1/me/active-organization", {
    method: "POST",
    headers: auth(active),
    body: JSON.stringify({ organizationId }),
  });
  if (selected.response.status === 404) return;
  if (!selected.response.ok) throw responseFailure("Organization cleanup selection failed", selected);

  const deleted = await denFetch(active, "/v1/org", { method: "DELETE", headers: auth(active) });
  if (!deleted.response.ok && deleted.response.status !== 404) {
    throw responseFailure("Organization cleanup failed", deleted);
  }
}

test("production Den supports fresh signup, organization invitations, and owned cleanup", async ({ evidence }) => {
  needs({
    optIn: ["OPENWORK_EVAL_LIVE"],
    env: ["OPENWORK_EVAL_LIVE_DEN_API_URL", "OPENWORK_EVAL_SECRET_LIVE_MAILBOX_EMAIL"],
  });

  const apiUrl = requiredEnv("OPENWORK_EVAL_LIVE_DEN_API_URL").replace(/\/+$/, "");
  const webUrl = apiUrl === "https://api.openworklabs.com" ? "https://app.openworklabs.com" : apiUrl;
  const den: DenRef = { apiUrl, webUrl };
  const identity = liveIdentity(requiredEnv("OPENWORK_EVAL_SECRET_LIVE_MAILBOX_EMAIL"));
  const password = `ProdLive-${identity.timestamp}!`;
  const organizationName = `Prod Live ${identity.timestamp}`;
  let session: DenSession | null = null;
  let organizationId: string | null = null;
  let organizationDeleted = false;
  let scenarioError: unknown = null;
  let cleanupError: unknown = null;

  try {
    const signUp = await denFetch(den, "/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: identity.owner, name: `Prod Live ${identity.timestamp}`, password }),
    });
    expect(signUp.response.ok, `Sign-up failed: HTTP ${signUp.response.status} ${signUp.text.slice(0, 1_000)}`).toBe(true);

    session = await signIn(den, { email: identity.owner, password });
    const baseline = await listOrganizations(session, "Authenticated baseline organization list failed");
    const wrongPassword = await denFetch(den, "/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: identity.owner, password: `${password}-wrong` }),
    });
    expect(wrongPassword.response.ok, `Wrong password unexpectedly returned HTTP ${wrongPassword.response.status}`).toBe(false);
    expect(wrongPassword.response.status).toBeGreaterThanOrEqual(400);
    evidence.recordAssertionEvidence(
      "C1: fresh production signup authenticates while a wrong password is rejected",
      `${identity.owner} signed up and GET /v1/me/orgs returned 200; the wrong-password sign-in returned HTTP ${wrongPassword.response.status}.`,
      true,
    );

    organizationId = await createOrganization(session, organizationName);
    await invite(session, identity.invitees[0]);
    await invite(session, identity.invitees[1]);

    const organizationList = await listOrganizations(session, "Post-creation organization list failed");
    expect(organizationList.orgs).toEqual([{ id: organizationId, name: organizationName }]);
    const emails = await organizationEmails(session);
    expect(emails.invitations).toEqual([...identity.invitees].sort());
    expect(emails.members).toEqual([identity.owner, ...identity.invitees].sort());
    expect(emails.invitations).not.toContain(identity.neverInvited);
    expect(emails.members).not.toContain(identity.neverInvited);
    evidence.recordAssertionEvidence(
      "C2: the new organization contains exactly both invitations and excludes a never-invited address",
      `${organizationName} is the user's only organization; its invitation and member listings contain ${identity.invitees.join(" and ")} and omit ${identity.neverInvited}.`,
      true,
    );

    await deleteCreatedOrganization(session, organizationId);
    organizationDeleted = true;
    session = await signIn(den, { email: identity.owner, password });
    const afterCleanup = await listOrganizations(session, "Post-cleanup organization list failed");
    expect(afterCleanup).toEqual(baseline);
    organizationId = null;
    evidence.recordAssertionEvidence(
      "C3: owned production organization data is deleted",
      `DELETE /v1/org removed ${organizationName}; the normalized organization list returned to its exact pre-creation baseline. den-api does not enable its self-service account deletion endpoint.`,
      true,
    );
  } catch (error) {
    scenarioError = error;
  } finally {
    if (organizationId && session) {
      try {
        await deleteCreatedOrganization(session, organizationId);
        organizationDeleted = true;
        organizationId = null;
      } catch (error) {
        cleanupError = error;
      }
    }
    console.info(
      `[live-lane] owner=${identity.owner} invitees=${identity.invitees.join(",")} neverInvited=${identity.neverInvited} org=${organizationName} orgDeleted=${String(organizationDeleted)} accountDeletion=self-service-disabled`,
    );
  }

  if (scenarioError) {
    if (cleanupError) {
      throw new Error(`${errorMessage(scenarioError)}; cleanup also failed: ${errorMessage(cleanupError)}`);
    }
    throw scenarioError;
  }
  if (cleanupError) throw cleanupError;
});
