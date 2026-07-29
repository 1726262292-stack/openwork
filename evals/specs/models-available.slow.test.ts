import { expect, onTestFinished, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import type { Surface } from "@openwork/cdp";
import { fraimz } from "@openwork/fraimz";
import {
  denFetch,
  ensureFreshWorkspace,
  evalIn,
  go,
  readAvailableModels,
  readComposerState,
  readModelRecoveryState,
  retryOrganizationModels,
  seedUnavailableModel,
  selectModel,
  signIn,
  signInDesktopAs,
  waitFor,
  waitForText,
} from "@openwork/behaviors";
import type { DenRef, DenSession } from "@openwork/behaviors";

const cdpUrl = process.env.OPENWORK_EVAL_CDP_URL?.trim() ?? "";
const apiUrl = process.env.OPENWORK_EVAL_DEN_API_URL?.trim().replace(/\/+$/, "") ?? "";
const appTitle = cdpUrl
  ? "available models are selectable and a disappeared model blocks until recovery"
  : "models available skipped: set OPENWORK_EVAL_CDP_URL to attach a running app";
const managedTitle = !cdpUrl
  ? "managed models empty recovery skipped: set OPENWORK_EVAL_CDP_URL to attach a running app"
  : !apiUrl
    ? "managed models empty recovery skipped: set OPENWORK_EVAL_DEN_API_URL"
    : "managed organization models recover from empty without an app restart";
const emptyMessage = "Your organization hasn't published any models for you yet.";
const guidance = "The model you were using is no longer available, please select a different model for this session.";
const readyDraft = "Ready with the assigned model.";
const providerName = "Composer Model Refresh Proof";
const modelId = "gpt-5.4";
const adminExceptionPolicyName = "Admins may add providers";

interface ManagedModelState {
  orgId: string;
  ownerMemberId: string;
  providerId: string;
  defaultPolicy: Record<string, unknown> | null;
  adminExceptionPolicies: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function executeControl(app: Surface, action: string, args?: unknown): Promise<unknown> {
  const value = await evalIn(
    app,
    `window.__openworkControl.execute(${JSON.stringify(action)}, ${JSON.stringify(args ?? null)})`,
    { awaitPromise: true },
  );
  if (!isRecord(value) || value.ok !== true) throw new Error(`Control action ${action} failed: ${JSON.stringify(value)}`);
  return value.result;
}

async function ensureSession(app: Surface, path: string): Promise<string> {
  const workspaceId = await ensureFreshWorkspace(app, { path });
  await go(app, `/workspace/${workspaceId}/session`);
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "session.create_task enabled",
  });
  await executeControl(app, "session.create_task");
  await waitFor(app, `window.location.hash.includes("/session/")`, { timeoutMs: 60_000, label: "created model test session" });
  return workspaceId;
}

async function setComposerText(app: Surface, text: string): Promise<void> {
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "composer.set_text" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "composer.set_text enabled",
  });
  await executeControl(app, "composer.set_text", { text });
  await waitForText(app, text, { timeoutMs: 30_000 });
}

async function createManagedSession(app: Surface, path: string): Promise<void> {
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "workspace.create" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "workspace.create enabled for managed model test",
  });
  await executeControl(app, "workspace.create", { path });
  await waitFor(app, `/^#\\/workspace\\/[^/?#]+\\/session\\/ses_[^/?#]+/.test(window.location.hash)`, {
    timeoutMs: 120_000,
    label: "managed model workspace session route",
  });
  await waitForText(app, "Run task", { timeoutMs: 60_000 });
}

async function denRequest(
  session: DenSession,
  path: string,
  init: RequestInit = {},
  allowedStatuses: number[] = [],
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.token}`);
  const result = await denFetch(session, path, { ...init, headers });
  if (!result.response.ok && !allowedStatuses.includes(result.response.status)) {
    throw new Error(`${init.method ?? "GET"} ${path} failed with ${result.response.status}: ${result.text.slice(0, 500)}`);
  }
  return result.body;
}

function policyUpdateBody(
  policy: Record<string, unknown>,
  input: { policy?: Record<string, unknown>; enabled?: boolean } = {},
): Record<string, unknown> {
  const assignments = records(policy.assignments);
  return {
    policyName: stringField(policy.policyName),
    policy: input.policy ?? record(policy.policy),
    priority: numberField(policy.priority),
    isEnabled: input.enabled ?? policy.isEnabled === true,
    memberIds: assignments.flatMap((assignment) => typeof assignment.memberId === "string" ? [assignment.memberId] : []),
    teamIds: assignments.flatMap((assignment) => typeof assignment.teamId === "string" ? [assignment.teamId] : []),
    roles: Array.isArray(policy.roles) ? policy.roles : [],
  };
}

async function selectOrganization(admin: DenSession, state: ManagedModelState): Promise<void> {
  const body = record(await denRequest(admin, "/v1/me/orgs"));
  const organizations = records(body.orgs);
  const organization = organizations.find((entry) => entry.slug === "default") ?? organizations[0];
  const orgId = stringField(organization?.id);
  if (!orgId) throw new Error("The eval admin has no organization.");
  state.orgId = orgId;
  await denRequest(admin, "/v1/me/active-organization", {
    method: "POST",
    body: JSON.stringify({ organizationId: orgId }),
  });
}

async function deleteProofProviders(admin: DenSession, state: ManagedModelState): Promise<void> {
  const body = record(await denRequest(admin, "/v1/llm-providers?scope=manageable"));
  const providers = records(body.llmProviders);
  for (const provider of providers) {
    if (provider.name !== providerName || typeof provider.id !== "string") continue;
    await denRequest(admin, `/v1/llm-providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" }, [204, 404]);
  }
  state.providerId = "";
}

async function configureManagedEmpty(admin: DenSession, state: ManagedModelState): Promise<void> {
  const orgBody = record(await denRequest(admin, "/v1/org"));
  const organization = record(orgBody.organization);
  const members = records(organization.members);
  const owner = members.find((member) => {
    const user = record(member.user);
    return member.role === "owner" || stringField(user.email).toLowerCase() === admin.email.toLowerCase();
  });
  state.ownerMemberId = stringField(owner?.id);
  if (!state.ownerMemberId) throw new Error(`Could not find ${admin.email}'s organization membership.`);

  const policiesBody = record(await denRequest(admin, "/v1/desktop-policies"));
  const policies = records(policiesBody.desktopPolicies);
  const defaultPolicy = policies.find((policy) => policy.isDefault === true);
  if (!defaultPolicy || typeof defaultPolicy.id !== "string") throw new Error("The organization has no default desktop policy.");
  state.defaultPolicy = defaultPolicy;
  state.adminExceptionPolicies = policies.filter(
    (policy) => policy.isDefault !== true && policy.policyName === adminExceptionPolicyName,
  );
  await denRequest(admin, `/v1/desktop-policies/${encodeURIComponent(defaultPolicy.id)}`, {
    method: "PATCH",
    body: JSON.stringify(policyUpdateBody(defaultPolicy, {
      policy: {
        ...record(defaultPolicy.policy),
        allowCustomProviders: false,
        allowZenModel: false,
      },
    })),
  });
  for (const policy of state.adminExceptionPolicies) {
    if (policy.isEnabled !== true || typeof policy.id !== "string") continue;
    await denRequest(admin, `/v1/desktop-policies/${encodeURIComponent(policy.id)}`, {
      method: "PATCH",
      body: JSON.stringify(policyUpdateBody(policy, { enabled: false })),
    });
  }
  await deleteProofProviders(admin, state);
}

async function createProofProvider(admin: DenSession, state: ManagedModelState): Promise<void> {
  const body = record(await denRequest(admin, "/v1/llm-providers", {
    method: "POST",
    body: JSON.stringify({
      name: providerName,
      source: "models_dev",
      providerId: "openai",
      modelIds: [modelId],
      apiKey: "sk-openwork-local-eval-only",
      memberIds: [state.ownerMemberId],
      teamIds: [],
    }),
  }));
  const provider = record(body.llmProvider);
  state.providerId = stringField(provider.id);
  if (!state.providerId) throw new Error("The assigned organization provider was not created.");
}

async function restoreManagedState(admin: DenSession, state: ManagedModelState): Promise<void> {
  await deleteProofProviders(admin, state);
  const defaultPolicy = state.defaultPolicy;
  if (defaultPolicy && typeof defaultPolicy.id === "string") {
    await denRequest(admin, `/v1/desktop-policies/${encodeURIComponent(defaultPolicy.id)}`, {
      method: "PATCH",
      body: JSON.stringify(policyUpdateBody(defaultPolicy)),
    });
  }
  for (const policy of state.adminExceptionPolicies) {
    if (typeof policy.id !== "string") continue;
    await denRequest(admin, `/v1/desktop-policies/${encodeURIComponent(policy.id)}`, {
      method: "PATCH",
      body: JSON.stringify(policyUpdateBody(policy)),
    });
  }
}

test.skipIf(!cdpUrl)(appTitle, async ({ annotate }) => {
  await using app = await attachSurface({ name: "running-app", kind: "electron", hostKind: "attached", cdpUrl });
  const frame = fraimz((message, attachment) => annotate(message, typeof attachment === "string" ? attachment : undefined));
  await ensureSession(app, `/tmp/openwork-models-available-${Date.now()}`);

  const models = await readAvailableModels(app);
  expect(models.length).toBeGreaterThan(0);
  expect(models.some((model) => model.selectable)).toBe(true);
  await frame(app, "models-1-populated");

  const model = models.find((candidate) => candidate.selectable);
  expect(model).toBeTruthy();
  if (!model) throw new Error("No selectable model was returned.");
  const selected = await selectModel(app, model.id);
  expect(selected.id).toBe(model.id);
  expect(selected.selected).toBe(true);
  await frame(app, "models-2-selected");

  const seeded = await seedUnavailableModel(app);
  expect(seeded.unavailableModelId).toBeTruthy();
  expect(seeded.availableModelId).toBeTruthy();
  await waitForText(app, "Model no longer available", { timeoutMs: 30_000 });
  await waitForText(app, seeded.unavailableModelId, { timeoutMs: 30_000 });
  let recovery = await readModelRecoveryState(app);
  expect(recovery.warningVisible).toBe(true);
  await frame(app, "models-3-unavailable-block");

  await waitForText(app, "Models", { timeoutMs: 30_000 });
  await waitForText(app, "Done", { timeoutMs: 30_000 });
  await waitForText(app, guidance, { timeoutMs: 30_000 });
  recovery = await readModelRecoveryState(app);
  expect(recovery.pickerOpen).toBe(true);
  expect(recovery.guidanceVisible).toBe(true);
  await frame(app, "models-4-recovery-guidance");

  await selectModel(app, seeded.availableModelId);
  await setComposerText(app, "Model recovery can continue.");
  recovery = await readModelRecoveryState(app);
  const composer = await readComposerState(app);
  expect(recovery.guidanceVisible).toBe(false);
  expect(recovery.warningVisible).toBe(false);
  expect(composer.draftText).toContain("Model recovery can continue.");
  expect(composer.runTaskEnabled).toBe(true);
  await frame(app, "models-5-recovered-composer-ready");
});

test.skipIf(!cdpUrl || !apiUrl)(managedTitle, async ({ annotate }) => {
  const den: DenRef = {
    apiUrl,
    webUrl: (process.env.OPENWORK_EVAL_DEN_WEB_URL?.trim() || apiUrl.replace("127.0.0.1", "localhost")).replace(/\/+$/, ""),
  };
  const admin = await signIn(den, {
    email: process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test",
    password: process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!",
  });
  const state: ManagedModelState = {
    orgId: "",
    ownerMemberId: "",
    providerId: "",
    defaultPolicy: null,
    adminExceptionPolicies: [],
  };
  await selectOrganization(admin, state);
  onTestFinished(async () => restoreManagedState(admin, state));
  await configureManagedEmpty(admin, state);

  await using app = await attachSurface({ name: "running-app", kind: "electron", hostKind: "attached", cdpUrl });
  const frame = fraimz((message, attachment) => annotate(message, typeof attachment === "string" ? attachment : undefined));
  await signInDesktopAs(app, den, admin);
  await createManagedSession(app, `/tmp/openwork-managed-models-${Date.now()}`);
  await waitForText(app, emptyMessage, { timeoutMs: 120_000 });

  let recovery = await readModelRecoveryState(app);
  expect(recovery.emptyMessageVisible).toBe(true);
  expect(recovery.retryVisible).toBe(true);
  expect(recovery.connectProviderVisible).toBe(false);
  expect(recovery.noticeHeight).not.toBeNull();
  expect(recovery.noticeHeight).toBeLessThanOrEqual(30);
  expect(recovery.noticeWhiteSpace).toBe("nowrap");
  expect((await readComposerState(app)).runTaskVisible).toBe(true);
  await frame(app, "models-6-managed-empty-retry");

  await createProofProvider(admin, state);
  expect((await readModelRecoveryState(app)).emptyMessageVisible).toBe(true);
  await retryOrganizationModels(app);
  await waitFor(app, `!document.body.innerText.includes(${JSON.stringify(emptyMessage)})`, {
    timeoutMs: 120_000,
    label: "managed model empty state cleared",
  });
  await waitFor(app, `document.body.innerText.includes("GPT-5.4") || document.body.innerText.includes(${JSON.stringify(modelId)})`, {
    timeoutMs: 120_000,
    label: "assigned GPT-5.4 model",
  });
  await setComposerText(app, readyDraft);

  recovery = await readModelRecoveryState(app);
  const composer = await readComposerState(app);
  expect(recovery.emptyMessageVisible).toBe(false);
  expect(composer.runTaskEnabled).toBe(true);
  expect(composer.draftText).toContain(readyDraft);
  expect(await evalIn(app, `document.body.innerText.includes("GPT-5.4") || document.body.innerText.includes(${JSON.stringify(modelId)})`)).toBe(true);
  expect(await evalIn(app, `document.body.innerText.includes("Refreshing…")`)).toBe(false);
  await frame(app, "models-7-managed-recovered-without-restart");
});
