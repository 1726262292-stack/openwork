import { execSync } from "node:child_process";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "owner-desktop-policy-api";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const DEN_API_URL = (process.env.OPENWORK_EVAL_DEN_API_URL ?? "").trim().replace(/\/+$/, "");
const DEN_WEB_URL = (process.env.OPENWORK_EVAL_DEN_WEB_URL ?? DEN_API_URL.replace("127.0.0.1", "localhost")).trim().replace(/\/+$/, "");
const OWNER_SESSION = process.env.OPENWORK_EVAL_DEN_TOKEN?.trim() || null;
const MARK_VERIFIED_CMD = process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim() || "";
const INVITED_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const ORG_SCOPE_HEADER = "x-openwork-org-id";
const SEEDED_ORG_SLUG = "acme-robotics-demo";
const RUN_TAG = Date.now();
const POLICY_PREFIX = "Owner Desktop Policy API ";
const POLICY_NAME = `${POLICY_PREFIX}${RUN_TAG}`;
const UPDATED_POLICY_NAME = `${POLICY_NAME} Updated`;

function emailDomain() {
  const demoEmail = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || process.env.DEN_DEMO_OWNER_EMAIL?.trim() || "alex@acme.test";
  const domain = demoEmail.includes("@") ? demoEmail.slice(demoEmail.lastIndexOf("@") + 1).trim().toLowerCase() : "acme.test";
  return domain || "acme.test";
}

const INVITE_DOMAIN = emailDomain();
const ADMIN_EMAIL = `owner-policy-admin-${RUN_TAG}@${INVITE_DOMAIN}`;
const MEMBER_EMAIL = `owner-policy-member-${RUN_TAG}@${INVITE_DOMAIN}`;

const CREATE_SETTINGS = {
  allowCustomProviders: false,
  allowControlSettings: false,
  allowManageExtensions: true,
  showWelcomePage: true,
  onboardingPrompts: [
    "Review desktop policy changes",
    "Summarize assigned team controls",
  ],
  onboardingPromptDescriptions: [
    "Owner-created policy proof",
    "Team assignment proof",
  ],
};

const UPDATE_SETTINGS = {
  allowCustomProviders: true,
  allowControlSettings: false,
  allowManageExtensions: false,
  showWelcomePage: false,
  onboardingPrompts: [
    "Confirm updated desktop restrictions",
    "Report the assigned team's saved policy",
  ],
  onboardingPromptDescriptions: [
    "Owner-updated policy proof",
    "Persisted assignment proof",
  ],
};

const state = {
  ownerSession: OWNER_SESSION,
  ownerMcpToken: null,
  organizationId: null,
  organizationName: null,
  ownerMemberId: null,
  team: null,
  listCapability: null,
  createCapability: null,
  updateCapability: null,
  desktopConfigCapability: null,
  directTools: [],
  initialPolicies: [],
  staleCleanup: [],
  policyId: null,
  createdPolicy: null,
  createdListPolicy: null,
  updatedPolicy: null,
  updatedListPolicy: null,
  adminSession: null,
  adminMemberId: null,
  adminMcpToken: null,
  memberSession: null,
  memberMemberId: null,
  memberMcpToken: null,
  adminDeniedCreate: null,
  memberDeniedUpdate: null,
  memberDesktopConfig: null,
  finalCleanup: null,
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value) {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual,
  });
  ctx.assert(condition, assertion + (actual === undefined ? "" : ` (actual: ${safeJson(actual).slice(0, 700)})`));
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseToolJson(result) {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return { raw: result };
  }

  const textEntry = result.content.find((entry) => isRecord(entry) && typeof entry.text === "string");
  return parseJsonText(textEntry?.text ?? "{}");
}

function scopedHeaders(sessionToken, extra = {}) {
  return {
    authorization: `Bearer ${sessionToken}`,
    ...(state.organizationId ? { [ORG_SCOPE_HEADER]: state.organizationId } : {}),
    ...extra,
  };
}

function policySummary(policy) {
  if (!isRecord(policy)) return null;
  const assignments = Array.isArray(policy.assignments) ? policy.assignments : [];
  return {
    id: policy.id,
    policyName: policy.policyName,
    isDefault: policy.isDefault,
    isEnabled: policy.isEnabled,
    priority: policy.priority,
    policy: policy.policy,
    assignments: assignments.map((assignment) => ({
      orgMemberId: isRecord(assignment) ? assignment.orgMemberId ?? null : null,
      teamId: isRecord(assignment) ? assignment.teamId ?? null : null,
    })),
  };
}

function policySummaries(policies) {
  return policies.map(policySummary).filter(Boolean);
}

function policyById(policies, id) {
  return policies.find((policy) => isRecord(policy) && policy.id === id) ?? null;
}

function teamAssignmentIds(policy) {
  if (!isRecord(policy) || !Array.isArray(policy.assignments)) return [];
  return policy.assignments
    .map((assignment) => isRecord(assignment) && typeof assignment.teamId === "string" ? assignment.teamId : null)
    .filter((teamId) => typeof teamId === "string");
}

function policySettingsMatch(policy, expected) {
  if (!isRecord(policy) || !isRecord(policy.policy)) return false;
  return Object.entries(expected).every(([key, value]) => safeJson(policy.policy[key]) === safeJson(value));
}

async function denApiFetch(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: DEN_WEB_URL,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, body: text ? parseJsonText(text) : null };
}

async function signIn(email) {
  const { response, body } = await denApiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password: INVITED_PASSWORD }),
  });
  if (!response.ok || !isRecord(body) || typeof body.token !== "string") return null;
  return body.token;
}

async function ensureAccount(ctx, email, name) {
  const existingSession = await signIn(email);
  if (existingSession) return existingSession;

  const signUp = await denApiFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, name, password: INVITED_PASSWORD }),
  });
  witness(ctx, signUp.response.ok, `Sign-up succeeds for ${email}`, { status: signUp.response.status, body: signUp.body });

  const session = await signIn(email);
  witness(ctx, typeof session === "string", `Sign-in succeeds for ${email} after sign-up`);
  return session;
}

async function ownerOrg(ctx) {
  witness(ctx, typeof state.ownerSession === "string", "The seeded owner session token is present");
  const orgs = await denApiFetch("/v1/me/orgs", {
    headers: { authorization: `Bearer ${state.ownerSession}` },
  });
  witness(ctx, orgs.response.ok, "The seeded owner session can list organizations", { status: orgs.response.status, body: orgs.body });
  const visibleOrgs = isRecord(orgs.body) && Array.isArray(orgs.body.orgs) ? orgs.body.orgs : [];
  const selected = visibleOrgs.find((org) => isRecord(org) && org.slug === SEEDED_ORG_SLUG)
    ?? visibleOrgs.find((org) => isRecord(org) && org.name === "Acme Robotics")
    ?? visibleOrgs.find((org) => isRecord(org) && org.isActive === true)
    ?? visibleOrgs[0]
    ?? null;
  witness(ctx, isRecord(selected) && typeof selected.id === "string", "A seeded organization is selected for the owner proof", visibleOrgs.map((org) => ({ id: org.id, name: org.name, slug: org.slug, role: org.role, isActive: org.isActive })));

  state.organizationId = selected.id;
  state.organizationName = selected.name ?? null;

  const org = await denApiFetch("/v1/org", {
    headers: scopedHeaders(state.ownerSession),
  });
  witness(ctx, org.response.ok, "The owner session resolves the selected organization", { status: org.response.status, body: org.body });
  const currentMember = isRecord(org.body) && isRecord(org.body.currentMember) ? org.body.currentMember : null;
  witness(ctx, currentMember?.isOwner === true || currentMember?.role === "owner", "The seeded session is an owner in the selected organization", currentMember);
  state.ownerMemberId = currentMember?.id ?? null;

  const teams = isRecord(org.body) && Array.isArray(org.body.teams) ? org.body.teams : [];
  const selectedTeam = teams.find((team) => isRecord(team) && team.name === "Product") ?? teams.find((team) => isRecord(team) && typeof team.id === "string") ?? null;
  witness(ctx, isRecord(selectedTeam) && typeof selectedTeam.id === "string", "A real seeded team is available for assignment", teams.map((team) => ({ id: team.id, name: team.name, memberCount: Array.isArray(team.memberIds) ? team.memberIds.length : null })));
  state.team = {
    id: selectedTeam.id,
    name: selectedTeam.name,
    memberIds: Array.isArray(selectedTeam.memberIds) ? selectedTeam.memberIds : [],
  };
}

async function mcpAgentCall(ctx, mcpToken, method, params = {}) {
  const response = await fetch(`${DEN_API_URL}/mcp/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${mcpToken}`,
      ...(state.organizationId ? { [ORG_SCOPE_HEADER]: state.organizationId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${RUN_TAG}-${Date.now()}`, method, params }),
  });
  const raw = await response.text();
  witness(ctx, response.ok, `MCP /mcp/agent ${method} returned HTTP 200`, raw.slice(0, 300));
  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
  witness(ctx, typeof dataLine === "string", `MCP /mcp/agent ${method} returned an SSE data frame`, raw.slice(0, 300));
  const payload = parseJsonText(dataLine.slice(5));
  witness(ctx, isRecord(payload) && !payload.error, `MCP /mcp/agent ${method} returned no JSON-RPC error`, isRecord(payload) ? payload.error ?? null : payload);
  return payload.result;
}

async function mintMcpToken(ctx, sessionToken, label) {
  const minted = await denApiFetch("/v1/mcp/token", {
    method: "POST",
    headers: scopedHeaders(sessionToken),
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  const body = isRecord(minted.body) ? minted.body : {};
  witness(ctx, minted.response.ok && typeof body.token === "string", `${label} can mint a read+write MCP token scoped to the seeded org`, {
    status: minted.response.status,
    organizationId: body.organizationId,
    scopes: body.scopes,
  });
  witness(ctx, body.organizationId === state.organizationId, `${label} MCP token is pinned to the seeded organization`, { expected: state.organizationId, actual: body.organizationId });
  witness(ctx, Array.isArray(body.scopes) && body.scopes.includes("mcp:read") && body.scopes.includes("mcp:write"), `${label} MCP token includes read and write scopes`, body.scopes);
  return body.token;
}

async function findCapability(ctx, mcpToken, input) {
  const result = await mcpAgentCall(ctx, mcpToken, "tools/call", {
    name: "search_capabilities",
    arguments: { query: input.query, limit: 20, type: "api" },
  });
  const parsed = parseToolJson(result);
  const matches = isRecord(parsed) && Array.isArray(parsed.matches) ? parsed.matches : [];
  const match = matches.find((candidate) => isRecord(candidate) && candidate.method === input.method && candidate.path === input.path) ?? null;
  witness(ctx, isRecord(match), `search_capabilities discovers ${input.method} ${input.path}`, {
    query: input.query,
    matches: matches.map((candidate) => isRecord(candidate) ? { name: candidate.name, method: candidate.method, path: candidate.path } : candidate),
  });
  return match;
}

async function executeCapability(ctx, mcpToken, capabilityName, args = {}) {
  return mcpAgentCall(ctx, mcpToken, "tools/call", {
    name: "execute_capability",
    arguments: { name: capabilityName, ...args },
  });
}

async function listPoliciesViaMcp(ctx, mcpToken, label) {
  const result = await executeCapability(ctx, mcpToken, state.listCapability.name, {});
  const body = parseToolJson(result);
  const hasPoliciesArray = isRecord(body) && Array.isArray(body.desktopPolicies);
  const policies = hasPoliciesArray ? body.desktopPolicies : [];
  witness(ctx, result?.isError !== true, `${label} list execute_capability succeeds`, body);
  witness(ctx, hasPoliciesArray, `${label} returns a desktopPolicies array`, body);
  return { body, policies };
}

async function cleanupStalePolicies(ctx) {
  const listed = await denApiFetch("/v1/desktop-policies", {
    headers: scopedHeaders(state.ownerSession),
  });
  witness(ctx, listed.response.ok, "Owner REST setup can list policies before stale cleanup", { status: listed.response.status, body: listed.body });
  const policies = isRecord(listed.body) && Array.isArray(listed.body.desktopPolicies) ? listed.body.desktopPolicies : [];
  const stalePolicies = policies.filter((policy) => isRecord(policy) && policy.isDefault !== true && typeof policy.policyName === "string" && policy.policyName.startsWith(POLICY_PREFIX));
  const removed = [];
  for (const policy of stalePolicies) {
    const deleted = await denApiFetch(`/v1/desktop-policies/${encodeURIComponent(policy.id)}`, {
      method: "DELETE",
      headers: scopedHeaders(state.ownerSession),
    });
    witness(ctx, deleted.response.ok, `Removed stale policy ${policy.policyName}`, { status: deleted.response.status, id: policy.id });
    removed.push({ id: policy.id, policyName: policy.policyName });
  }
  state.staleCleanup = removed;
}

async function cleanupCreatedPolicy(ctx) {
  if (!state.policyId) return;
  const deleted = await denApiFetch(`/v1/desktop-policies/${encodeURIComponent(state.policyId)}`, {
    method: "DELETE",
    headers: scopedHeaders(state.ownerSession),
  });
  state.finalCleanup = { status: deleted.response.status, policyId: state.policyId };
  witness(ctx, deleted.response.ok || deleted.response.status === 404, "Created policy is cleaned up through the owner REST session", state.finalCleanup);
  state.policyId = null;
}

async function inviteAndAccept(ctx, input) {
  const session = await ensureAccount(ctx, input.email, input.name);
  const invitation = await denApiFetch("/v1/invitations", {
    method: "POST",
    headers: scopedHeaders(state.ownerSession),
    body: JSON.stringify({ email: input.email, role: input.role }),
  });
  const persisted = invitation.response.ok || (invitation.response.status === 502 && isRecord(invitation.body) && invitation.body.error === "invitation_email_failed");
  witness(ctx, persisted, `Owner invitation is persisted for ${input.role} ${input.email}`, { status: invitation.response.status, body: invitation.body });

  let inviteToken = isRecord(invitation.body) && typeof invitation.body.inviteToken === "string" ? invitation.body.inviteToken : null;
  if (!inviteToken) {
    const refreshedOrg = await denApiFetch("/v1/org", {
      headers: scopedHeaders(state.ownerSession),
    });
    const invitations = isRecord(refreshedOrg.body) && Array.isArray(refreshedOrg.body.invitations) ? refreshedOrg.body.invitations : [];
    const match = invitations.find((entry) => isRecord(entry) && entry.email === input.email && entry.status === "pending" && typeof entry.inviteToken === "string") ?? null;
    inviteToken = isRecord(match) ? match.inviteToken : null;
  }
  witness(ctx, typeof inviteToken === "string" && inviteToken.length > 0, `Invite token is available for ${input.email}`, { inviteTokenLength: inviteToken?.length ?? 0 });

  if (MARK_VERIFIED_CMD) {
    execSync(MARK_VERIFIED_CMD.replaceAll("{email}", input.email), { stdio: "ignore" });
  }

  const accepted = await denApiFetch("/v1/orgs/invitations/accept", {
    method: "POST",
    headers: { authorization: `Bearer ${session}` },
    body: JSON.stringify({ id: inviteToken }),
  });
  if (!accepted.response.ok && isRecord(accepted.body) && accepted.body.error === "email_verification_required" && !MARK_VERIFIED_CMD) {
    witness(ctx, false, "Invitation acceptance requires OPENWORK_EVAL_MARK_VERIFIED_CMD in this environment", accepted.body);
  }
  witness(ctx, accepted.response.ok && isRecord(accepted.body) && accepted.body.accepted === true && accepted.body.organizationId === state.organizationId, `${input.email} accepts the invitation into the seeded organization`, { status: accepted.response.status, body: accepted.body });

  const freshSession = await signIn(input.email);
  witness(ctx, typeof freshSession === "string", `${input.email} can sign in after joining the seeded organization`);
  const memberOrg = await denApiFetch("/v1/org", {
    headers: scopedHeaders(freshSession),
  });
  const currentMember = isRecord(memberOrg.body) && isRecord(memberOrg.body.currentMember) ? memberOrg.body.currentMember : null;
  witness(ctx, memberOrg.response.ok && currentMember?.role === input.role, `${input.email} has the expected ${input.role} org role`, { status: memberOrg.response.status, currentMember });
  return { session: freshSession, memberId: currentMember?.id ?? null };
}

function policyBody(policyName, policy, priority) {
  return {
    policyName,
    policy,
    priority,
    isEnabled: true,
    memberIds: [],
    teamIds: [state.team.id],
  };
}

function assertPolicy(ctx, policy, expected) {
  witness(ctx, isRecord(policy) && policy.policyName === expected.policyName, `${expected.label} has the expected policy name`, policySummary(policy));
  witness(ctx, isRecord(policy) && policy.isEnabled === true, `${expected.label} is enabled`, policySummary(policy));
  witness(ctx, isRecord(policy) && policy.priority === expected.priority, `${expected.label} has the expected priority`, policySummary(policy));
  witness(ctx, policySettingsMatch(policy, expected.policy), `${expected.label} stores the expected settings`, policySummary(policy));
  const teamIds = teamAssignmentIds(policy);
  witness(ctx, teamIds.length === 1 && teamIds[0] === state.team.id, `${expected.label} is assigned only to the seeded team`, { expectedTeam: state.team, actualTeamIds: teamIds, policy: policySummary(policy) });
}

function forbiddenBody(body) {
  return isRecord(body) && (body.error === "forbidden" || String(body.message ?? "").toLowerCase().includes("owner"));
}

export default {
  id: FLOW_ID,
  title: "Workspace owners can manage desktop policies through the connected agent API while admins and members remain guarded",
  kind: "internal",
  requiresApp: false,
  spec: "evals/voiceovers/owner-desktop-policy-api.md",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The owner uses /mcp/agent to discover and list desktop policies", {
          voiceover: vo[0],
          action: async () => {
            await ownerOrg(ctx);
            await cleanupStalePolicies(ctx);
            state.ownerMcpToken = await mintMcpToken(ctx, state.ownerSession, "Owner");

            const tools = await mcpAgentCall(ctx, state.ownerMcpToken, "tools/list", {});
            state.directTools = (Array.isArray(tools?.tools) ? tools.tools : []).map((tool) => tool.name).sort();
            state.listCapability = await findCapability(ctx, state.ownerMcpToken, {
              query: "GET /v1/desktop-policies list desktop policies names settings assignments",
              method: "GET",
              path: "/v1/desktop-policies",
            });
            const listed = await listPoliciesViaMcp(ctx, state.ownerMcpToken, "Owner MCP");
            state.initialPolicies = listed.policies;
          },
          assert: async () => {
            witness(ctx, state.directTools.join(",") === "execute_capability,search_capabilities", "The connected agent endpoint exposes only search_capabilities and execute_capability as direct tools", state.directTools);
            witness(ctx, isRecord(state.listCapability), "GET /v1/desktop-policies is discovered before execution", state.listCapability);
            witness(ctx, state.initialPolicies.length > 0, "The owner lists current desktop policies through execute_capability", policySummaries(state.initialPolicies));
            ctx.output("frame-1-owner-list.json", JSON.stringify({
              organization: { id: state.organizationId, name: state.organizationName },
              directTools: state.directTools,
              staleCleanup: state.staleCleanup,
              listCapability: { name: state.listCapability.name, method: state.listCapability.method, path: state.listCapability.path },
              desktopPolicies: policySummaries(state.initialPolicies),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The owner creates a team-assigned desktop policy through execute_capability and reads it back live", {
          voiceover: vo[1],
          action: async () => {
            state.createCapability = await findCapability(ctx, state.ownerMcpToken, {
              query: "POST /v1/desktop-policies create desktop policy assigned team settings",
              method: "POST",
              path: "/v1/desktop-policies",
            });
            const created = await executeCapability(ctx, state.ownerMcpToken, state.createCapability.name, {
              body: policyBody(POLICY_NAME, CREATE_SETTINGS, 40),
            });
            const createdBody = parseToolJson(created);
            state.createdPolicy = isRecord(createdBody) && isRecord(createdBody.desktopPolicy) ? createdBody.desktopPolicy : null;
            state.policyId = state.createdPolicy?.id ?? null;
            witness(ctx, created?.isError !== true, "execute_capability creates the desktop policy", createdBody);

            const listed = await listPoliciesViaMcp(ctx, state.ownerMcpToken, "Owner MCP follow-up after create");
            state.createdListPolicy = policyById(listed.policies, state.policyId);
          },
          assert: async () => {
            witness(ctx, typeof state.policyId === "string", "The created policy id is present", state.createdPolicy);
            assertPolicy(ctx, state.createdPolicy, { label: "Created policy response", policyName: POLICY_NAME, priority: 40, policy: CREATE_SETTINGS });
            assertPolicy(ctx, state.createdListPolicy, { label: "Follow-up MCP list policy", policyName: POLICY_NAME, priority: 40, policy: CREATE_SETTINGS });
            ctx.output("frame-2-create-policy.json", JSON.stringify({
              createCapability: { name: state.createCapability.name, method: state.createCapability.method, path: state.createCapability.path },
              seededTeam: state.team,
              createdPolicy: policySummary(state.createdPolicy),
              followUpListPolicy: policySummary(state.createdListPolicy),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The owner updates the policy through MCP and the saved settings and team assignment persist", {
          voiceover: vo[2],
          action: async () => {
            state.updateCapability = await findCapability(ctx, state.ownerMcpToken, {
              query: "PATCH /v1/desktop-policies/{desktopPolicyId} update desktop policy settings team assignment",
              method: "PATCH",
              path: "/v1/desktop-policies/{desktopPolicyId}",
            });
            const updated = await executeCapability(ctx, state.ownerMcpToken, state.updateCapability.name, {
              path: { desktopPolicyId: state.policyId },
              body: policyBody(UPDATED_POLICY_NAME, UPDATE_SETTINGS, 90),
            });
            const updatedBody = parseToolJson(updated);
            state.updatedPolicy = isRecord(updatedBody) && isRecord(updatedBody.desktopPolicy) ? updatedBody.desktopPolicy : null;
            witness(ctx, updated?.isError !== true, "execute_capability updates the desktop policy", updatedBody);

            const listed = await listPoliciesViaMcp(ctx, state.ownerMcpToken, "Owner MCP follow-up after update");
            state.updatedListPolicy = policyById(listed.policies, state.policyId);
          },
          assert: async () => {
            assertPolicy(ctx, state.updatedPolicy, { label: "Updated policy response", policyName: UPDATED_POLICY_NAME, priority: 90, policy: UPDATE_SETTINGS });
            assertPolicy(ctx, state.updatedListPolicy, { label: "Follow-up MCP list after update", policyName: UPDATED_POLICY_NAME, priority: 90, policy: UPDATE_SETTINGS });
            ctx.output("frame-3-update-policy.json", JSON.stringify({
              updateCapability: { name: state.updateCapability.name, method: state.updateCapability.method, path: state.updateCapability.path },
              updatedPolicy: policySummary(state.updatedPolicy),
              followUpListPolicy: policySummary(state.updatedListPolicy),
            }, null, 2));
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Admins and members are forbidden from desktop policy writes through MCP, while members can still read effective config", {
          voiceover: vo[3],
          action: async () => {
            const admin = await inviteAndAccept(ctx, { email: ADMIN_EMAIL, name: "Owner Policy Admin", role: "admin" });
            state.adminSession = admin.session;
            state.adminMemberId = admin.memberId;
            const member = await inviteAndAccept(ctx, { email: MEMBER_EMAIL, name: "Owner Policy Member", role: "member" });
            state.memberSession = member.session;
            state.memberMemberId = member.memberId;

            state.adminMcpToken = await mintMcpToken(ctx, state.adminSession, "Admin");
            state.memberMcpToken = await mintMcpToken(ctx, state.memberSession, "Member");

            const adminDenied = await executeCapability(ctx, state.adminMcpToken, state.createCapability.name, {
              body: policyBody(`${POLICY_PREFIX}Admin Denied ${RUN_TAG}`, CREATE_SETTINGS, 10),
            });
            state.adminDeniedCreate = { isError: adminDenied?.isError === true, body: parseToolJson(adminDenied) };

            const memberDenied = await executeCapability(ctx, state.memberMcpToken, state.updateCapability.name, {
              path: { desktopPolicyId: state.policyId },
              body: policyBody(`${POLICY_PREFIX}Member Denied ${RUN_TAG}`, CREATE_SETTINGS, 11),
            });
            state.memberDeniedUpdate = { isError: memberDenied?.isError === true, body: parseToolJson(memberDenied) };

            state.desktopConfigCapability = await findCapability(ctx, state.memberMcpToken, {
              query: "GET /v1/me/desktop-config current user effective desktop config restrictions",
              method: "GET",
              path: "/v1/me/desktop-config",
            });
            const memberConfig = await executeCapability(ctx, state.memberMcpToken, state.desktopConfigCapability.name, {});
            state.memberDesktopConfig = { isError: memberConfig?.isError === true, body: parseToolJson(memberConfig) };
          },
          assert: async () => {
            witness(ctx, state.adminDeniedCreate?.isError === true && forbiddenBody(state.adminDeniedCreate.body), "Admin create through execute_capability is forbidden", state.adminDeniedCreate);
            witness(ctx, state.memberDeniedUpdate?.isError === true && forbiddenBody(state.memberDeniedUpdate.body), "Member update through execute_capability is forbidden", state.memberDeniedUpdate);
            witness(ctx, isRecord(state.desktopConfigCapability), "Member discovers GET /v1/me/desktop-config through search_capabilities", state.desktopConfigCapability);
            const config = state.memberDesktopConfig?.body;
            witness(ctx, state.memberDesktopConfig?.isError === false && isRecord(config), "Member execute_capability can read effective desktop config", state.memberDesktopConfig);
            witness(ctx, typeof config?.connectEnabled === "boolean" && typeof config?.allowCustomProviders === "boolean", "Member desktop config includes read-only effective policy fields", config);
            ctx.output("frame-4-role-guards-and-member-config.json", JSON.stringify({
              admin: { email: ADMIN_EMAIL, memberId: state.adminMemberId },
              member: { email: MEMBER_EMAIL, memberId: state.memberMemberId },
              adminCreateAttempt: state.adminDeniedCreate,
              memberUpdateAttempt: state.memberDeniedUpdate,
              desktopConfigCapability: { name: state.desktopConfigCapability.name, method: state.desktopConfigCapability.method, path: state.desktopConfigCapability.path },
              memberDesktopConfig: state.memberDesktopConfig,
            }, null, 2));
            await cleanupCreatedPolicy(ctx);
          },
        });
      },
    },
  ],
};
