import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { expect, onTestFinished } from "vitest";
import { screenshot, validate } from "@openwork/fraimz";
import { daytonaSandbox } from "@openwork/hosts";
import {
  denFetch,
  evalIn,
  readAvailableModels,
  readCurrentOrganizationMemberId,
  selectModel,
  sendComposerMessage,
} from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { app, needs, server, test, unmetNeeds } from "@openwork/testkit";
import type { App, NeedsSpec } from "@openwork/testkit";

const requirements: NeedsSpec = { optIn: ["OPENWORK_EVAL_APP_SPECS"], vision: true };
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `org provider sharing skipped — needs: ${missingRequirements.join(", ")}`
  : "organization providers appear live, authenticate directly, and respect member revocation";

const providerName = "Organization BYO Eval";
const providerKey = "org-byo-eval";
const modelId = "org-byo-eval-model";
const sandboxA = process.env.OPENWORK_EVAL_DAYTONA_SANDBOX_A?.trim() ?? "";
const sandboxB = process.env.OPENWORK_EVAL_DAYTONA_SANDBOX_B?.trim() ?? "";
const requestTimeoutMs = 10_000;

type RequestLog = { method: string; path: string; authorization: string | null };

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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function providerIds(value: unknown): string[] {
  return records(record(value).llmProviders).flatMap((provider) =>
    typeof provider.id === "string" ? [provider.id] : []
  );
}

function auth(session: DenSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

async function denRequest(session: DenSession, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.token}`);
  headers.set("content-type", "application/json");
  const result = await denFetch(session, path, {
    ...init,
    headers,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!result.response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return result.body;
}

async function closeModelPicker(memberApp: App): Promise<void> {
  const closed = await evalIn(memberApp, `(() => {
    const dialog = document.querySelector('[data-slot="dialog-content"]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((entry) => (entry.textContent ?? '').trim() === 'Done');
    button?.click();
    return Boolean(button);
  })()`);
  if (closed !== true) throw new Error("Could not close the model picker.");
}

async function runtimeConfig(memberApp: App): Promise<unknown> {
  return evalIn(memberApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return { error: "missing local server credentials" };
    const response = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(memberApp.workspaceId)}) + "/runtime-config",
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!response.ok) return { error: "runtime config HTTP " + response.status, body: await response.text() };
    return response.json();
  })()`, { awaitPromise: true, timeoutMs: 10_000 });
}

async function providerSyncState(memberApp: App): Promise<unknown> {
  return evalIn(memberApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const hostToken = localStorage.getItem("openwork.server.hostToken");
    if (!port || !hostToken) return { error: "missing local server host credentials" };
    const response = await fetch(
      "http://127.0.0.1:" + port + "/experimental/provider-sync/state",
      { headers: { "X-OpenWork-Host-Token": hostToken } },
    );
    if (!response.ok) return { error: "provider sync state HTTP " + response.status, body: await response.text() };
    return response.json();
  })()`, { awaitPromise: true, timeoutMs: 10_000 });
}

async function validateShot(memberApp: App, claims: string[]): Promise<void> {
  const shot = await screenshot(memberApp);
  const seen = await validate(shot, claims);
  expect(seen.ok, seen.why).toBe(true);
}

async function waitForModel(memberApp: App, expected: boolean): Promise<void> {
  await expect.poll(
    async () => (await readAvailableModels(memberApp)).some((model) => model.id === modelId && model.selectable),
    { timeout: 30_000, interval: 1_000 },
  ).toBe(expected);
}

async function chat(memberApp: App, marker: string, localProviderId: string): Promise<void> {
  await selectModel(memberApp, modelId);
  const previousSyncAt = stringField(record(await providerSyncState(memberApp)).lastSyncAt);
  await expect.poll(async () => {
    const syncState = await providerSyncState(memberApp);
    const lastSyncAt = stringField(record(syncState).lastSyncAt);
    return Boolean(
      lastSyncAt
      && lastSyncAt !== previousSyncAt
      && strings(record(syncState).appliedProviderIds).includes(localProviderId),
    );
  }, { timeout: 30_000, interval: 1_000 }).toBe(true);
  await sendComposerMessage(memberApp, `Reply with exactly ${marker}`);
  await expect.poll(async () => stringField(await evalIn(memberApp, `(() => {
    const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
    return messages[messages.length - 1]?.innerText?.trim() ?? "";
  })()`)), { timeout: 60_000, interval: 500 }).toContain(marker);
}

test(title, async ({ evidence, place }) => {
  needs(requirements);
  if (Boolean(sandboxA) !== Boolean(sandboxB)) {
    throw new Error("Set both OPENWORK_EVAL_DAYTONA_SANDBOX_A and _B (or neither).");
  }
  if (sandboxA) expect(sandboxA).not.toBe(sandboxB);
  const dualDesktopLane = Boolean(sandboxA && sandboxB);
  const runId = `${Date.now().toString(36)}-${process.pid}`;
  const orgApiKey = `sk-org-byo-eval-${runId}`;
  const requestLog: RequestLog[] = [];

  const upstream = createServer((request, response) => {
    const path = request.url ?? "";
    requestLog.push({
      method: request.method ?? "",
      path,
      authorization: typeof request.headers.authorization === "string" ? request.headers.authorization : null,
    });
    if (request.method === "GET" && path.startsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model" }] }));
      return;
    }
    if (request.method === "POST" && (path.endsWith("/v1/chat/completions") || path.endsWith("/chat/completions"))) {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        let marker = "missing-marker";
        try {
          const payload: unknown = JSON.parse(body);
          const messages = records(record(payload).messages);
          const lastUserText = [...messages].reverse().find((message) => message.role === "user")?.content;
          const match = typeof lastUserText === "string" ? /Reply with exactly\s+([^\s"']+)/.exec(lastUserText) : null;
          marker = match?.[1] ?? marker;
        } catch {
          marker = "invalid-request-body";
        }
        const chunks = [
          { id: `chatcmpl-${runId}`, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
          { id: `chatcmpl-${runId}`, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: `MARKER:${marker}` }, finish_reason: null }] },
          { id: `chatcmpl-${runId}`, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ];
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        response.end("data: [DONE]\n\n");
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  });
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("Mock upstream did not bind a TCP port.");
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/v1`;

  await using den = await server({
    place,
    env: {
      DEN_ORG_PROVIDER_SYNC_DEFAULT: "1",
    },
    org: {
      name: `Org Provider Sharing ${runId}`,
      admin: { name: "Provider Sharing Admin" },
      members: {
        a: { name: "Provider Member A" },
        b: { name: "Provider Member B" },
      },
    },
  });

  const memberA = den.members.a;
  const memberB = den.members.b;
  if (!memberA || !memberB) throw new Error("The testkit did not provision both provider members.");
  const memberAId = await readCurrentOrganizationMemberId(memberA);
  const memberBId = await readCurrentOrganizationMemberId(memberB);

  await using appA = await app({
    den,
    as: "a",
    place,
    host: sandboxA ? daytonaSandbox(sandboxA) : undefined,
  });
  // Frame 1: A was already signed in before this provider existed. The
  // member-scoped API and engine runtime both exclude the future org model.
  const initialRuntime = await runtimeConfig(appA);
  expect(JSON.stringify(initialRuntime)).not.toContain(modelId);
  const initialList = await denRequest(memberA, "/v1/llm-providers");
  expect(
    records(record(initialList).llmProviders).some((provider) =>
      provider.name === providerName || records(provider.models).some((model) => model.id === modelId)
    ),
  ).toBe(false);

  // Frame 2: the admin grants this provider to A and B, never org-wide.
  const createdBody = record(await denRequest(den.admin, "/v1/llm-providers", {
    method: "POST",
    body: JSON.stringify({
      name: providerName,
      source: "custom",
      customConfig: {
        id: providerKey,
        name: providerName,
        npm: "@ai-sdk/openai-compatible",
        env: ["ORG_BYO_EVAL_API_KEY"],
        api: upstreamBaseUrl,
        models: [{ id: modelId, name: "Organization BYO Eval Model" }],
      },
      apiKey: orgApiKey,
      memberIds: [memberAId, memberBId],
      teamIds: [],
      allMembers: false,
    }),
  }));
  const providerId = stringField(record(createdBody.llmProvider).id);
  if (!providerId) throw new Error("Provider creation did not return an id.");
  const localProviderId = providerId;

  // Frame 3: no refresh or settings action — the idle renderer delivers the
  // entitlement to openwork-server and its already-open chat model catalog.
  let sharedRuntime: unknown = null;
  let syncState: unknown = null;
  await expect.poll(async () => {
    sharedRuntime = await runtimeConfig(appA);
    syncState = await providerSyncState(appA);
    const provider = record(record(sharedRuntime).effectiveRuntime).provider;
    const localProvider = record(record(provider)[localProviderId]);
    return stringField(record(localProvider.options).baseURL) === upstreamBaseUrl
      && record(syncState).enabled === true
      && record(syncState).hasToken === true
      && strings(record(syncState).appliedProviderIds).includes(localProviderId);
  }, { timeout: 30_000, interval: 1_000 }).toBe(true);
  const serializedRuntime = JSON.stringify(sharedRuntime);
  const managedRedacted = stringField(record(sharedRuntime).managedFileContentRedacted);
  expect(serializedRuntime).not.toContain("sk-org-byo-eval");
  expect(managedRedacted).not.toContain("sk-org-byo-eval");
  const providerSyncHasToken = record(syncState).hasToken === true;
  expect(record(syncState).enabled).toBe(true);
  expect(providerSyncHasToken).toBe(true);
  expect(record(syncState).appliedProviderIds).toContain(localProviderId);
  expect(JSON.stringify(syncState)).not.toContain("sk-org-byo-eval");
  const rendererVisibleState = stringField(await evalIn(appA, `(() => JSON.stringify({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    visibleText: document.body.innerText,
  }))()`));
  expect(rendererVisibleState).not.toContain(orgApiKey);
  evidence.fact(
    "The organization credential reaches openwork-server without transiting renderer-visible state",
    `Host-scoped state reports enabled=true, hasToken=true, and appliedProviderIds includes ${localProviderId}; runtime config, managed redaction, sync status, renderer storage, and visible DOM contain no sk-org-byo-eval value.`,
    true,
  );
  await waitForModel(appA, true);
  // readAvailableModels expands groups and returns model buttons in rendered
  // DOM order, so this observes picker ordering without re-sorting test data.
  const modelsInDomOrder = await Promise.race([
    readAvailableModels(appA),
    delay(15_000).then(() => { throw new Error("Timed out reading ordered model-picker entries."); }),
  ]);
  const firstOrganizationModelIndex = modelsInDomOrder.findIndex((model) => model.providerName === providerName);
  const firstOtherModelIndex = modelsInDomOrder.findIndex((model) => model.providerName !== providerName);
  expect(firstOrganizationModelIndex).toBeGreaterThanOrEqual(0);
  expect(firstOtherModelIndex).toBeGreaterThan(firstOrganizationModelIndex);
  evidence.fact(
    "The model picker orders the organization-shared provider before non-organization providers",
    `Rendered provider order began ${modelsInDomOrder.map((model) => model.providerName).join(" → ")}.`,
    true,
  );
  evidence.fact(
    "Member A's idle model picker received the organization model",
    `${modelId} became selectable within 30 seconds without opening settings or refreshing the app.`,
    true,
  );
  await validateShot(appA, [
    "The Models picker visibly contains the Organization BYO Eval model as a selectable model",
    "No settings page, error dialog, or 'Something went wrong' crash message is visible",
  ]);

  // The local Den harness is self-hosted, so hosted-control-plane promo gating
  // cannot establish the no-provider Subscribe baseline. Observe Rule 2 in the
  // AI provider inventory instead: the org provider is present and the hosted
  // OpenWork Models offer is absent.
  await closeModelPicker(appA);
  const memberASessionHash = stringField(await evalIn(appA, "window.location.hash"));
  expect(await evalIn(appA, `(() => {
    window.__OPENWORK_EVAL_DESKTOP_REQUEST_URLS__ = [];
    return true;
  })()`)).toBe(true);
  const openedProviderSettings = await evalIn(
    appA,
    `window.__openworkControl.execute("route.settings.providers", null)`,
    { awaitPromise: true },
  );
  expect(record(openedProviderSettings).ok).toBe(true);
  await expect.poll(async () => evalIn(appA, `(() => {
    const providerNameNode = [...document.querySelectorAll("span")]
      .find((entry) => (entry.textContent ?? "").trim() === ${JSON.stringify(providerName)});
    const providerRow = providerNameNode?.parentElement?.parentElement?.parentElement?.parentElement;
    const providerText = providerRow?.textContent ?? "";
    const pageReady = [...document.querySelectorAll("h1, h2")]
      .some((entry) => (entry.textContent ?? "").trim() === "AI Providers");
    return pageReady
      && providerText.includes(${JSON.stringify(localProviderId)})
      && providerText.includes("Organization")
      && !document.body.innerText.includes("OpenWork Models");
  })()`), { timeout: 15_000, interval: 500 }).toBe(true);
  evidence.fact(
    "AI provider settings do not offer OpenWork Models when the organization provider is available",
    `${providerName} is visibly listed with its Organization badge and ${localProviderId}; no OpenWork Models offer is rendered.`,
    true,
  );
  await expect.poll(async () => evalIn(appA, `(() => {
    return [...document.querySelectorAll("button")].some((button) => {
      if ((button.textContent ?? "").trim() !== "Import" || button.disabled) return false;
      let ancestor = button.parentElement;
      for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
        if ((ancestor.textContent ?? "").includes(${JSON.stringify(providerName)})) return true;
      }
      return false;
    });
  })()`), { timeout: 15_000, interval: 500 }).toBe(true);
  const requestedServerManagedImport = await evalIn(appA, `(() => {
    const button = [...document.querySelectorAll("button")].find((entry) => {
      if ((entry.textContent ?? "").trim() !== "Import" || entry.disabled) return false;
      let ancestor = entry.parentElement;
      for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
        if ((ancestor.textContent ?? "").includes(${JSON.stringify(providerName)})) return true;
      }
      return false;
    });
    button?.click();
    return Boolean(button);
  })()`);
  expect(requestedServerManagedImport).toBe(true);
  await expect.poll(async () => evalIn(
    appA,
    `document.body.innerText.includes(${JSON.stringify(`${providerName} is managed by OpenWork server.`)})`,
  ), { timeout: 10_000, interval: 250 }).toBe(true);
  await evalIn(appA, `window.location.hash = ${JSON.stringify(memberASessionHash)}`);
  await expect.poll(
    async () => evalIn(
      appA,
      `window.__openworkControl?.listActions().some((entry) => entry.id === "session.model_picker.open" && entry.disabled === false)`,
    ),
    { timeout: 15_000, interval: 500 },
  ).toBe(true);

  // Frame 4: the engine authenticates directly to the provider upstream. The
  // renderer observes metadata but never requests Den's credential payload.
  const markerA = `member-a-${runId}`;
  await chat(appA, markerA, localProviderId);
  const aChatRequest = [...requestLog].reverse().find((entry) => entry.method === "POST" && entry.path.includes("chat/completions"));
  const upstreamUsedOrgKey = aChatRequest?.authorization === `Bearer ${orgApiKey}`;
  const observedRendererRequestUrls = strings(await evalIn(
    appA,
    `window.__OPENWORK_EVAL_DESKTOP_REQUEST_URLS__ ?? []`,
  ));
  const credentialConnectionPath = `/v1/llm-providers/${encodeURIComponent(providerId)}/connect`;
  const credentialConnectionRequests = observedRendererRequestUrls.filter((url) =>
    url.includes(credentialConnectionPath)
  );
  expect(observedRendererRequestUrls.some((url) =>
    url.includes("/v1/llm-providers") && !url.includes("/connect")
  )).toBe(true);
  expect(credentialConnectionRequests).toEqual([]);
  evidence.fact(
    "In server-managed mode, the renderer never requests the credential-bearing provider connection endpoint",
    `Renderer request instrumentation observed credential-free provider metadata traffic, zero ${credentialConnectionPath} requests, provider ${localProviderId} materialization, and completed chat ${markerA}.`,
    true,
  );
  evidence.fact(
    "The engine authenticates directly to the provider upstream with the organization credential",
    `Mock upstream received ${aChatRequest?.path ?? "no chat request"} with the expected Authorization value while renderer-visible sync state exposed only hasToken=${providerSyncHasToken}.`,
    upstreamUsedOrgKey && providerSyncHasToken,
  );
  expect(upstreamUsedOrgKey).toBe(true);
  await validateShot(appA, [
    `The completed chat visibly contains the member A marker ${markerA}`,
    "No error dialog or 'Something went wrong' crash message is visible",
  ]);

  // In the local sequential lane A is stopped before B boots to stay within
  // one desktop's resource budget. In the Daytona dual-desktop lane, setting
  // OPENWORK_EVAL_DAYTONA_SANDBOX_A and _B keeps both isolated apps alive for
  // frames 1–7 and proves A's live picker loses the model after revocation.
  if (!dualDesktopLane) await appA.stop();

  // Frames 5–6: B signs in after publication and can use the model immediately.
  await using appB = await app({
    den,
    as: "b",
    place,
    host: sandboxB ? daytonaSandbox(sandboxB) : undefined,
  });
  await expect.poll(async () => evalIn(
    appB,
    `window.__openworkControl?.listActions().some((entry) => entry.id === "session.create_task" && entry.disabled === false)`,
  ), { timeout: 30_000, interval: 500 }).toBe(true);
  const createdBlankTask = await evalIn(
    appB,
    `window.__openworkControl.execute("session.create_task", null)`,
    { awaitPromise: true },
  );
  expect(record(createdBlankTask).ok).toBe(true);
  await expect.poll(
    async () => {
      const onSession = await evalIn(appB, `Boolean(/\\/session\\/[^/?#]+/.test(window.location.hash))`);
      if (onSession === true) return true;
      await evalIn(appB, `window.__openworkControl.execute("session.create_task", null)`, { awaitPromise: true });
      return false;
    },
    { timeout: 30_000, interval: 500 },
  ).toBe(true);
  await expect.poll(async () => {
    const memberBRuntime = await runtimeConfig(appB);
    const memberBSyncState = await providerSyncState(appB);
    const provider = record(record(memberBRuntime).effectiveRuntime).provider;
    const localProvider = record(record(provider)[localProviderId]);
    return stringField(record(localProvider.options).baseURL) === upstreamBaseUrl
      && record(memberBSyncState).lastError === null
      && strings(record(memberBSyncState).appliedProviderIds).includes(localProviderId);
  }, { timeout: 30_000, interval: 1_000 }).toBe(true);
  await waitForModel(appB, true);
  await validateShot(appB, [
    "The Models picker visibly contains the Organization BYO Eval model and member B's account is shown",
    "No settings page, error dialog, or 'Something went wrong' crash message is visible",
  ]);
  const markerB = `member-b-${runId}`;
  await chat(appB, markerB, localProviderId);
  await validateShot(appB, [
    `The completed chat visibly contains the member B marker ${markerB}`,
    "No error dialog or 'Something went wrong' crash message is visible",
  ]);

  // Frame 7: revoke A only. B's open desktop remains entitled and undisturbed.
  const manageable = records(record(await denRequest(den.admin, "/v1/llm-providers?scope=manageable")).llmProviders);
  const providerDetail = manageable.find((provider) => provider.id === providerId);
  const memberAccess = records(record(record(providerDetail).access).members);
  const memberAAccessId = stringField(memberAccess.find((entry) => entry.orgMembershipId === memberAId)?.id);
  if (!memberAAccessId) throw new Error("Could not find member A's provider access row.");
  await denRequest(
    den.admin,
    `/v1/llm-providers/${encodeURIComponent(providerId)}/access/${encodeURIComponent(memberAAccessId)}`,
    { method: "DELETE" },
  );
  expect(providerIds(await denRequest(memberA, "/v1/llm-providers"))).not.toContain(providerId);
  expect(providerIds(await denRequest(memberB, "/v1/llm-providers"))).toContain(providerId);
  await waitForModel(appB, true);
  await closeModelPicker(appB);
  const markerBAfterRevocation = `member-b-after-revocation-${runId}`;
  await chat(appB, markerBAfterRevocation, localProviderId);
  evidence.fact(
    "Revoking member A leaves member B's open desktop undisturbed",
    `A's API list excludes ${providerId}; B's includes it, keeps ${modelId} selectable, and completed ${markerBAfterRevocation}.`,
    true,
  );

  if (dualDesktopLane) {
    await waitForModel(appA, false);
    evidence.fact(
      "Member A's live picker removes the revoked organization model",
      `${modelId} disappeared from A's isolated desktop within 30 seconds while B retained it.`,
      true,
    );
  }

  const cleanup = await denFetch(den.admin, `/v1/llm-providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: auth(den.admin),
  });
  if (![204, 404].includes(cleanup.response.status)) {
    throw new Error(`Provider cleanup failed: HTTP ${cleanup.response.status} ${cleanup.text.slice(0, 500)}`);
  }
});
