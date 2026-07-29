import { expect, onTestFinished, test } from "vitest";
import { attachSurface } from "@openwork/cdp";
import type { Surface } from "@openwork/cdp";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import {
  denFetch,
  deleteEvalWorkspace,
  ensureFreshWorkspace,
  ensureReadyWorkspace,
  evalIn,
  go,
  readAvailableModels,
  readComposerState,
  readCurrentOrganizationMemberId,
  readModelRecoveryState,
  recoverInvalidModelSelection,
  retryOrganizationModels,
  seedUnavailableModel,
  selectModel,
  signIn,
  signInDesktopAs,
  waitFor,
  waitForText,
  writeComposerText,
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

async function ensureSession(app: Surface, path: string, workspaceIds: string[]): Promise<string> {
  const workspaceId = await ensureFreshWorkspace(app, { path });
  if (!workspaceIds.includes(workspaceId)) workspaceIds.push(workspaceId);
  await go(app, `/workspace/${workspaceId}/session`);
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "session.create_task enabled",
  });
  await executeControl(app, "session.create_task");
  await waitFor(app, `/^#\\/workspace\\/[^/?#]+\\/session\\/ses_[^/?#]+/.test(window.location.hash)`, {
    timeoutMs: 60_000,
    label: "created model test session id route",
  });
  return workspaceId;
}

async function setComposerText(app: Surface, text: string): Promise<void> {
  await writeComposerText(app, text);
}

async function createManagedSession(app: Surface, path: string, workspaceIds: string[]): Promise<string> {
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "workspace.create" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "workspace.create enabled for managed model test",
  });
  const previousRoute = await evalIn(app, "window.location.hash");
  const previousWorkspaceId = typeof previousRoute === "string"
    ? /\/workspace\/([^/?#]+)/.exec(previousRoute)?.[1] ?? ""
    : "";
  await executeControl(app, "workspace.create", { path });
  await waitFor(app, `(() => {
    const match = /\\/workspace\\/([^/?#]+)/.exec(window.location.hash);
    return Boolean(match?.[1] && match[1] !== ${JSON.stringify(previousWorkspaceId)});
  })()`, { timeoutMs: 60_000, label: "managed model workspace route" });
  const createdRoute = await evalIn(app, "window.location.hash");
  const createdWorkspaceId = typeof createdRoute === "string"
    ? /\/workspace\/([^/?#]+)/.exec(createdRoute)?.[1] ?? ""
    : "";
  if (!createdWorkspaceId) throw new Error(`Managed model workspace route had no workspace ID: ${JSON.stringify(createdRoute)}`);
  if (!workspaceIds.includes(createdWorkspaceId)) workspaceIds.push(createdWorkspaceId);
  const ready = await ensureReadyWorkspace(app, { path });
  await waitForText(app, "Run task", { timeoutMs: 60_000 });
  return ready.workspaceId;
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
  state.ownerMemberId = await readCurrentOrganizationMemberId(admin);

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

test.skipIf(!cdpUrl)(appTitle, async () => {
  await using app = await attachSurface({ name: "running-app", kind: "electron", hostKind: "attached", cdpUrl });
  await using roll = photoRoll("models-available");
  const workspacePath = `/tmp/openwork-models-available-${Date.now()}`;
  await ensureReadyWorkspace(app, { path: workspacePath });
  const workspaceIds: string[] = [];
  let restoreModelId = "";
  onTestFinished(async () => {
    await using cleanupApp = await attachSurface({ name: "models-available-cleanup", kind: "electron", hostKind: "attached", cdpUrl });
    try {
      const invalidBeforeCleanup = await evalIn(cleanupApp, `(() => {
        const text = document.body.innerText;
        return text.includes("Model no longer available")
          || text.includes("The selected provider/model was not found in OpenCode provider catalog");
      })()`);
      if (invalidBeforeCleanup === true) {
        const restored = await recoverInvalidModelSelection(cleanupApp, restoreModelId);
        if (restoreModelId) expect(restored?.id).toBe(restoreModelId);
      }
      expect(await evalIn(cleanupApp, `(() => {
        const text = document.body.innerText;
        return text.includes("Model no longer available")
          || text.includes("The selected provider/model was not found in OpenCode provider catalog");
      })()`)).toBe(false);
      if (restoreModelId) {
        expect(await evalIn(cleanupApp, `(() => {
          try {
            return JSON.parse(localStorage.getItem("openwork.preferences") || "{}").defaultModel?.modelID;
          } catch {
            return "";
          }
        })()`)).toBe(restoreModelId);
      }
    } finally {
      for (const workspaceId of workspaceIds) await deleteEvalWorkspace(cleanupApp, workspaceId);
    }
  });
  await ensureSession(app, workspacePath, workspaceIds);

  const models = await readAvailableModels(app);
  expect(models.length).toBeGreaterThan(0);
  expect(models.some((model) => model.selectable)).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The Models picker visibly contains selectable models",
      "No empty-model failure or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const model = models.find((candidate) => candidate.selectable);
  expect(model).toBeTruthy();
  if (!model) throw new Error("No selectable model was returned.");
  const selected = await selectModel(app, model.id);
  expect(selected.id).toBe(model.id);
  expect(selected.selected).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The composer is visibly ready after a model is selected",
      "No unavailable-model warning or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const seeded = await seedUnavailableModel(app);
  restoreModelId = seeded.availableModelId;
  expect(seeded.unavailableModelId).toBeTruthy();
  expect(seeded.availableModelId).toBeTruthy();
  await waitForText(app, "Model no longer available", { timeoutMs: 30_000 });
  await waitForText(app, seeded.unavailableModelId, { timeoutMs: 30_000 });
  let recovery = await readModelRecoveryState(app);
  expect(recovery.warningVisible).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "A Model no longer available warning visibly blocks use of the disappeared model",
      "No unrelated generic error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  await executeControl(app, "session.model_picker.open");
  await waitFor(app, `Boolean(document.querySelector('[data-slot="dialog-content"]'))`, {
    timeoutMs: 30_000,
    label: "opened Models picker dialog",
  });
  await waitForText(app, "Models", { timeoutMs: 30_000 });
  await waitForText(app, "Done", { timeoutMs: 30_000 });
  await waitForText(app, guidance, { timeoutMs: 30_000 });
  recovery = await readModelRecoveryState(app);
  expect(recovery.pickerOpen).toBe(true);
  expect(recovery.guidanceVisible).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The open Models picker visibly explains that a different model must be selected",
      "No unrelated generic error or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  await selectModel(app, seeded.availableModelId);
  await setComposerText(app, "Model recovery can continue.");
  recovery = await readModelRecoveryState(app);
  const composer = await readComposerState(app);
  expect(recovery.guidanceVisible).toBe(false);
  expect(recovery.warningVisible).toBe(false);
  expect(composer.draftText).toContain("Model recovery can continue.");
  expect(composer.runTaskEnabled).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The recovered composer visibly contains the Model recovery can continue draft",
      "No unavailable-model warning or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }
});

test.skipIf(!cdpUrl || !apiUrl)(managedTitle, async () => {
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
  let desktopStateChanged = false;
  const workspaceIds: string[] = [];
  await selectOrganization(admin, state);
  onTestFinished(async () => {
    try {
      await restoreManagedState(admin, state);
    } finally {
      if (desktopStateChanged) {
        await using cleanupApp = await attachSurface({ name: "models-managed-cleanup", kind: "electron", hostKind: "attached", cdpUrl });
        try {
          await ensureReadyWorkspace(cleanupApp);
          expect(await evalIn(cleanupApp, `(() => {
            const text = document.body.innerText;
            return text.includes("Model no longer available")
              || text.includes("The selected provider/model was not found in OpenCode provider catalog");
          })()`)).toBe(false);
        } finally {
          for (const workspaceId of workspaceIds) await deleteEvalWorkspace(cleanupApp, workspaceId);
        }
      }
    }
  });
  await configureManagedEmpty(admin, state);

  await using app = await attachSurface({ name: "running-app", kind: "electron", hostKind: "attached", cdpUrl });
  await using roll = photoRoll("models-managed-recovery");
  await signInDesktopAs(app, den, admin);
  desktopStateChanged = true;
  const workspacePath = `/tmp/openwork-managed-models-${Date.now()}`;
  await ensureReadyWorkspace(app, { path: workspacePath });
  await createManagedSession(app, workspacePath, workspaceIds);
  await waitForText(app, emptyMessage, { timeoutMs: 120_000 });

  let recovery = await readModelRecoveryState(app);
  expect(recovery.emptyMessageVisible).toBe(true);
  expect(recovery.retryVisible).toBe(true);
  expect(recovery.connectProviderVisible).toBe(false);
  expect(recovery.noticeHeight).not.toBeNull();
  expect(recovery.noticeHeight).toBeLessThanOrEqual(30);
  expect(recovery.noticeWhiteSpace).toBe("nowrap");
  expect((await readComposerState(app)).runTaskVisible).toBe(true);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "A compact organization-model empty notice with a Retry action is visible above the composer",
      "No Connect a provider action or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

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
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "GPT-5.4 and the Ready with the assigned model draft are visibly available without an app restart",
      "No empty-model notice, Refreshing state, or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }
});
