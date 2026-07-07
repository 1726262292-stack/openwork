import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "invite-adoption-no-duplicates";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const DEN_API_URL = (process.env.OPENWORK_EVAL_DEN_API_URL ?? "").trim().replace(/\/+$/, "");
const DEN_WEB_URL = (process.env.OPENWORK_EVAL_DEN_WEB_URL ?? DEN_API_URL.replace("127.0.0.1", "localhost")).trim().replace(/\/+$/, "");
const MYSQL_CONTAINER = "openwork-web-local-mysql";
const MYSQL_ARGS = ["exec", MYSQL_CONTAINER, "mysql", "-uroot", "-ppassword", "openwork_den", "-N", "-e"];
const ADMIN_TOKEN = (process.env.OPENWORK_EVAL_DEN_TOKEN ?? "").trim();
const TYPE_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TYPE_ID_PREFIXES = {
  member: "om",
  orgSubscription: "osub",
};
const RUN_TAG = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
const RASHMI_EMAIL = `rashmi+${RUN_TAG}@acme.test`;
const RASHMI_JIT_EMAIL = `rashmi+jit-${RUN_TAG}@acme.test`;
const RASHMI_PASSWORD = `OpenWork-${RUN_TAG}!`;

const state = {
  organization: null,
  adminMemberId: null,
  orgMode: null,
  rashmiToken: null,
  rashmiUserId: null,
  reconcileEmail: null,
  reconcileUserId: null,
};

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : typeof actual === "string" ? actual : JSON.stringify(actual).slice(0, 900),
  });
  ctx.assert(condition, assertion + (actual === undefined ? "" : ` (actual: ${JSON.stringify(actual).slice(0, 500)})`));
}

function sqlString(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function createDenTypeId(name) {
  const prefix = TYPE_ID_PREFIXES[name];
  let value = BigInt(`0x${randomUUID().replace(/-/g, "")}`);
  let suffix = "";
  for (let index = 0; index < 26; index += 1) {
    suffix = TYPE_ID_ALPHABET[Number(value % 32n)] + suffix;
    value /= 32n;
  }
  return `${prefix}_${suffix}`;
}

function mysqlQuery(sql) {
  return execFileSync("docker", [...MYSQL_ARGS, sql], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();
}

function cleanupPriorEvalArtifacts() {
  return mysqlQuery("DELETE FROM org_subscriptions WHERE last_event_id = 'invite-adoption-no-duplicates';");
}

async function denFetch(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: DEN_WEB_URL || DEN_API_URL,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { response, body, text };
}

async function authed(path, options = {}) {
  return denFetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
}

function redactAuthResult(result) {
  const body = result.body && typeof result.body === "object" ? result.body : null;
  return {
    status: result.response.status,
    ok: result.response.ok,
    token: typeof body?.token === "string" ? "<present>" : undefined,
    user: body?.user
      ? {
          id: body.user.id,
          email: body.user.email,
          name: body.user.name,
          emailVerified: body.user.emailVerified,
        }
      : undefined,
    session: body?.session
      ? {
          id: body.session.id,
          activeOrganizationId: body.session.activeOrganizationId,
        }
      : undefined,
    body: body && !body.token ? body : undefined,
  };
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function membersForEmail(org, email) {
  const normalized = normalizeEmail(email);
  return (org.members ?? []).filter((member) => normalizeEmail(member.user?.email) === normalized);
}

function invitationsForEmail(org, email) {
  const normalized = normalizeEmail(email);
  return (org.invitations ?? []).filter((invitation) => normalizeEmail(invitation.email) === normalized);
}

function activeMembersForEmail(org, email) {
  return membersForEmail(org, email).filter((member) => typeof member.userId === "string" && member.userId.length > 0);
}

function invitedGhostsForEmail(org, email) {
  return membersForEmail(org, email).filter((member) => !member.userId && typeof member.inviteId === "string" && member.inviteId.length > 0);
}

function compactMember(member) {
  return {
    id: member.id,
    email: member.user?.email,
    userId: member.userId,
    inviteId: member.inviteId,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

function compactInvitation(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
}

function summarizeOrg(org, emails) {
  return {
    organization: {
      id: org.organization?.id,
      name: org.organization?.name,
      slug: org.organization?.slug,
    },
    currentMember: {
      id: org.currentMember?.id,
      role: org.currentMember?.role,
    },
    totalMembers: Array.isArray(org.members) ? org.members.length : null,
    totalInvitations: Array.isArray(org.invitations) ? org.invitations.length : null,
    focus: emails.map((email) => ({
      email,
      members: membersForEmail(org, email).map(compactMember),
      activeMembers: activeMembersForEmail(org, email).map(compactMember),
      invitedPlaceholders: invitedGhostsForEmail(org, email).map(compactMember),
      invitations: invitationsForEmail(org, email).map(compactInvitation),
    })),
  };
}

async function loadOrg(ctx) {
  const result = await authed("/v1/org");
  witness(ctx, result.response.ok, "Admin token can load the active organization", { status: result.response.status, body: result.body });
  state.organization = result.body.organization;
  state.adminMemberId = result.body.currentMember?.id ?? null;
  witness(ctx, typeof state.organization?.id === "string", "Organization id is present", state.organization);
  witness(ctx, typeof state.adminMemberId === "string", "Admin member id is present", result.body.currentMember);
  return result.body;
}

function ensureSeatSubscription(ctx) {
  const orgId = state.organization?.id;
  const memberId = state.adminMemberId;
  witness(ctx, typeof orgId === "string" && typeof memberId === "string", "Seat setup has an organization and admin member id", { orgId, memberId });
  const subscriptionId = createDenTypeId("orgSubscription");
  const quantity = 100;
  const sql = `INSERT INTO org_subscriptions (id, organization_id, created_by_org_membership_id, type, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_subscription_item_id, quantity, current_period_start, current_period_end, cancel_at_period_end, canceled_at, ended_at, last_event_id, created_at, updated_at) VALUES (${sqlString(subscriptionId)}, ${sqlString(orgId)}, ${sqlString(memberId)}, 'seat', 'active', ${sqlString(`cus_eval_${orgId}`)}, ${sqlString(`sub_eval_seats_${orgId}`)}, 'price_eval_seats', NULL, ${quantity}, CURRENT_TIMESTAMP(3), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY), false, NULL, NULL, 'invite-adoption-no-duplicates', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status='active', quantity=VALUES(quantity), current_period_end=VALUES(current_period_end), cancel_at_period_end=false, canceled_at=NULL, ended_at=NULL, updated_at=CURRENT_TIMESTAMP(3);`;
  mysqlQuery(sql);
  return sql;
}

async function inviteAsAdmin(ctx, email) {
  let result = await authed("/v1/invitations", {
    method: "POST",
    body: JSON.stringify({ email, role: "admin" }),
  });
  let seatSql = null;
  if (result.response.status === 402 && result.body?.error === "payment_required") {
    seatSql = ensureSeatSubscription(ctx);
    result = await authed("/v1/invitations", {
      method: "POST",
      body: JSON.stringify({ email, role: "admin" }),
    });
  }
  const persisted = result.response.ok || (result.response.status === 502 && result.body?.error === "invitation_email_failed");
  witness(ctx, persisted, `Admin invitation is persisted for ${email}`, { status: result.response.status, body: result.body });
  return { result, seatSql };
}

async function signUpEmail(ctx, email, name) {
  const result = await denFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, name, password: RASHMI_PASSWORD }),
  });
  witness(ctx, result.response.ok, `Sign-up succeeds for ${email}`, redactAuthResult(result));
  return result;
}

async function signInEmail(ctx, email) {
  const result = await denFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password: RASHMI_PASSWORD }),
  });
  witness(ctx, result.response.ok && typeof result.body?.token === "string", `Sign-in returns a session token for ${email}`, redactAuthResult(result));
  return result;
}

async function loadMe(ctx, token, label) {
  const result = await denFetch("/v1/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  witness(ctx, result.response.ok && typeof result.body?.user?.id === "string", `${label} profile exposes a user id`, { status: result.response.status, body: result.body });
  return result.body;
}

function userIdForEmail(ctx, email) {
  const sql = `SELECT id FROM user WHERE email = ${sqlString(normalizeEmail(email))} LIMIT 1;`;
  const userId = mysqlQuery(sql).split(/\s+/).filter(Boolean)[0] ?? "";
  witness(ctx, userId.startsWith("usr_"), `User id exists for ${email}`, { sql, userId });
  return userId;
}

function insertRawJitMember(ctx, input) {
  const memberId = createDenTypeId("member");
  const sql = `INSERT INTO member (id, organization_id, user_id, role, joined_at, created_at) VALUES (${sqlString(memberId)}, ${sqlString(input.organizationId)}, ${sqlString(input.userId)}, 'member', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));`;
  const output = mysqlQuery(sql);
  witness(ctx, true, `Raw SSO-style member row inserted for ${input.email}`, { memberId, output });
  return { memberId, sql, output };
}

function assertPendingInviteAndGhost(ctx, org, email) {
  const invitations = invitationsForEmail(org, email);
  const ghosts = invitedGhostsForEmail(org, email);
  witness(ctx, invitations.length === 1, `${email} has one invitation`, invitations.map(compactInvitation));
  witness(ctx, invitations[0]?.status === "pending", `${email} invitation is pending`, invitations.map(compactInvitation));
  witness(ctx, invitations[0]?.role === "admin", `${email} invitation carries admin role`, invitations.map(compactInvitation));
  witness(ctx, ghosts.length === 1, `${email} has one invited placeholder member`, ghosts.map(compactMember));
  witness(ctx, ghosts[0]?.role === "admin", `${email} invited placeholder carries admin role`, ghosts.map(compactMember));
}

function assertReconciled(ctx, org, email) {
  const active = activeMembersForEmail(org, email);
  const ghosts = invitedGhostsForEmail(org, email);
  const invitations = invitationsForEmail(org, email);
  witness(ctx, membersForEmail(org, email).length === 1, `${email} has exactly one visible member row`, membersForEmail(org, email).map(compactMember));
  witness(ctx, active.length === 1, `${email} has one active member`, active.map(compactMember));
  witness(ctx, active[0]?.role === "admin", `${email} active member has admin role`, active.map(compactMember));
  witness(ctx, ghosts.length === 0, `${email} has no invited placeholder ghost`, ghosts.map(compactMember));
  witness(ctx, invitations.length === 1, `${email} has one invitation record`, invitations.map(compactInvitation));
  witness(ctx, invitations[0]?.status === "accepted", `${email} invitation is accepted`, invitations.map(compactInvitation));
}

export default {
  id: FLOW_ID,
  title: "Pending invitations are adopted without duplicate organization members",
  kind: "internal",
  requiresApp: false,
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "Frame 1 — The admin invites Rashmi as an admin",
      run: async (ctx) => {
        await ctx.prove("The admin invite creates one pending admin invitation and one invited placeholder", {
          voiceover: vo[0],
          assert: async () => {
            await loadOrg(ctx);
            const cleanupOutput = cleanupPriorEvalArtifacts();
            const invite = await inviteAsAdmin(ctx, RASHMI_EMAIL);
            const org = await loadOrg(ctx);
            assertPendingInviteAndGhost(ctx, org, RASHMI_EMAIL);
            ctx.output("invite-response-and-org-listing", JSON.stringify({
              runTag: RUN_TAG,
              email: RASHMI_EMAIL,
              cleanup: cleanupOutput || "removed prior eval-only seat rows if present",
              inviteResponse: { status: invite.result.response.status, body: invite.result.body },
              seatSetupApplied: Boolean(invite.seatSql),
              org: summarizeOrg(org, [RASHMI_EMAIL]),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 2 — Rashmi signs up and the stack's org mode decides the first-sign-in boundary",
      run: async (ctx) => {
        await ctx.prove("Rashmi's first sign-in either stays outside the org or adopts the invite in single-org mode", {
          voiceover: vo[1],
          action: async () => {
            state.rashmiSignUp = await signUpEmail(ctx, RASHMI_EMAIL, "Rashmi Shah");
            const signedIn = await signInEmail(ctx, RASHMI_EMAIL);
            state.rashmiToken = signedIn.body.token;
            const me = await loadMe(ctx, state.rashmiToken, "Rashmi");
            state.rashmiUserId = me.user.id;
          },
          assert: async () => {
            const org = await loadOrg(ctx);
            const active = activeMembersForEmail(org, RASHMI_EMAIL);
            const invitations = invitationsForEmail(org, RASHMI_EMAIL);
            const ghosts = invitedGhostsForEmail(org, RASHMI_EMAIL);
            if (active.length === 1 && invitations[0]?.status === "accepted") {
              state.orgMode = "single_org";
              assertReconciled(ctx, org, RASHMI_EMAIL);
            } else {
              state.orgMode = "multi_org";
              witness(ctx, active.length === 0, "Rashmi is not yet an active member of the invited organization", active.map(compactMember));
              witness(ctx, invitations[0]?.status === "pending", "Rashmi's invitation is still pending", invitations.map(compactInvitation));
              witness(ctx, ghosts.length === 1, "Rashmi's invited placeholder still exists", ghosts.map(compactMember));
            }
            ctx.output("rashmi-first-signin-and-org-mode", JSON.stringify({
              runTag: RUN_TAG,
              inferredOrgMode: state.orgMode,
              auth: {
                signUp: redactAuthResult(state.rashmiSignUp),
                signInToken: state.rashmiToken ? "<present>" : null,
                userId: state.rashmiUserId,
              },
              org: summarizeOrg(org, [RASHMI_EMAIL]),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 3 — An SSO-style raw membership appears",
      run: async (ctx) => {
        await ctx.prove("The pre-fix duplicate state is observable before the next session is created", {
          voiceover: vo[2],
          action: async () => {
            if (state.orgMode === "single_org") {
              state.reconcileEmail = RASHMI_JIT_EMAIL;
              const invite = await inviteAsAdmin(ctx, state.reconcileEmail);
              const signUp = await signUpEmail(ctx, state.reconcileEmail, "Rashmi JIT");
              state.reconcileUserId = userIdForEmail(ctx, state.reconcileEmail);
              state.jitSetup = { invite, signUp };
            } else {
              state.reconcileEmail = RASHMI_EMAIL;
              state.reconcileUserId = state.rashmiUserId;
            }
            const orgId = state.organization?.id;
            witness(ctx, typeof orgId === "string", "Raw member insert has an organization id", state.organization);
            witness(ctx, typeof state.reconcileUserId === "string" && state.reconcileUserId.startsWith("usr_"), "Raw member insert has a Rashmi user id", state.reconcileUserId);
            state.rawInsert = insertRawJitMember(ctx, {
              email: state.reconcileEmail,
              organizationId: orgId,
              userId: state.reconcileUserId,
            });
          },
          assert: async () => {
            const org = await loadOrg(ctx);
            const active = activeMembersForEmail(org, state.reconcileEmail);
            const ghosts = invitedGhostsForEmail(org, state.reconcileEmail);
            const invitations = invitationsForEmail(org, state.reconcileEmail);
            witness(ctx, active.length === 1, `${state.reconcileEmail} has one active raw member`, active.map(compactMember));
            witness(ctx, active[0]?.role === "member", `${state.reconcileEmail} active raw member has the old wrong member role`, active.map(compactMember));
            witness(ctx, ghosts.length === 1, `${state.reconcileEmail} still has one invited placeholder ghost`, ghosts.map(compactMember));
            witness(ctx, invitations[0]?.status === "pending", `${state.reconcileEmail} invitation remains pending before reconcile`, invitations.map(compactInvitation));
            ctx.output("raw-jit-duplicate-state", JSON.stringify({
              inferredOrgMode: state.orgMode,
              email: state.reconcileEmail,
              singleOrgExtraInvite: state.orgMode === "single_org",
              rawInsertSql: state.rawInsert.sql,
              rawInsertOutput: state.rawInsert.output,
              setupInviteResponse: state.jitSetup
                ? { status: state.jitSetup.invite.result.response.status, body: state.jitSetup.invite.result.body }
                : undefined,
              setupSignUp: state.jitSetup ? redactAuthResult(state.jitSetup.signUp) : undefined,
              org: summarizeOrg(org, [state.reconcileEmail]),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 4 — Rashmi signs in again and the app reconciles",
      run: async (ctx) => {
        await ctx.prove("The next sign-in merges the active member with the invite and deletes the invited ghost", {
          voiceover: vo[3],
          action: async () => {
            const signedIn = await signInEmail(ctx, state.reconcileEmail);
            state.reconciledToken = signedIn.body.token;
            state.reconciledMe = await loadMe(ctx, state.reconciledToken, "Reconciled Rashmi");
          },
          assert: async () => {
            const org = await loadOrg(ctx);
            assertReconciled(ctx, org, state.reconcileEmail);
            ctx.output("reconciled-org-listing", JSON.stringify({
              inferredOrgMode: state.orgMode,
              email: state.reconcileEmail,
              auth: {
                token: state.reconciledToken ? "<present>" : null,
                userId: state.reconciledMe?.user?.id,
                sessionActiveOrganizationId: state.reconciledMe?.session?.activeOrganizationId,
              },
              org: summarizeOrg(org, [state.reconcileEmail]),
            }, null, 2));
          },
        });
      },
    },
  ],
};
