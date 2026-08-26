import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import {
  denFetch,
  evalIn,
} from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { electronProfilePaths } from "@openwork/hosts";
import {
  app,
  eventually,
  liteLlm,
  needs,
  SkipError,
  startWorld,
  test,
  unmetNeeds,
} from "@openwork/testkit";
import type { TestNeeds } from "@openwork/testkit";
import { azureByok } from "../../worlds/azure-byok.ts";

const ORGANIZATION_NAME = "Azure BYOK Repro";
const PROVIDER_NAME = "Azure Env Order Witness";
const PROVIDER_KEY = "azure-env-order-witness";
const MODEL_ID = "azure-env-order-witness-model";
const MODEL_NAME = "Azure Env Order Witness Model";
const RESOURCE_ENV = "AZURE_RESOURCE_NAME";
const API_KEY_ENV = "AZURE_API_KEY";
const RESOURCE_MARKER = "openwork-harmless-resource-marker";
const REQUEST_TIMEOUT_MS = 10_000;
const requirements: TestNeeds = { optIn: ["OPENWORK_EVAL_E2E_TESTS"], commands: ["docker"] };
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `Azure BYOK env-order reproduction skipped — needs: ${missingRequirements.join(", ")}`
  : "#4096: Azure-like env order delivers the API key to engine auth";

interface CapturedRequest {
  method: string;
  path: string;
  model: string;
  tokenId: string;
  status: number;
}

interface CaptureProxy extends AsyncDisposable {
  baseUrl: string;
  requests: CapturedRequest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auth(session: DenSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

function tokenId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(headers: IncomingHttpHeaders): string {
  const value = headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ")
    ? value.slice("Bearer ".length).trim()
    : "";
}

function requestModel(body: Buffer): string {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return isRecord(parsed) && typeof parsed.model === "string" ? parsed.model : "";
  } catch {
    return "";
  }
}

async function closeServer(serverInstance: Server): Promise<void> {
  if (!serverInstance.listening) return;
  await new Promise<void>((resolve, reject) => {
    serverInstance.close((error) => error ? reject(error) : resolve());
    serverInstance.closeAllConnections();
  });
}

async function captureProxy(upstreamBaseUrl: string): Promise<CaptureProxy> {
  const upstreamOrigin = new URL(upstreamBaseUrl).origin;
  const requests: CapturedRequest[] = [];
  const proxy = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const path = incoming.url ?? "/";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
        else if (typeof value === "string") headers.set(name, value);
      }
      for (const name of ["connection", "content-length", "host", "keep-alive", "transfer-encoding"]) {
        headers.delete(name);
      }
      const upstream = await fetch(new URL(path, upstreamOrigin), {
        method: incoming.method ?? "GET",
        headers,
        body: body.byteLength > 0 ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      requests.push({
        method: incoming.method ?? "GET",
        path,
        model: requestModel(body),
        tokenId: tokenId(bearerToken(incoming.headers)),
        status: upstream.status,
      });
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!["connection", "content-length", "keep-alive", "transfer-encoding"].includes(name)) {
          responseHeaders[name] = value;
        }
      });
      outgoing.writeHead(upstream.status, responseHeaders);
      outgoing.end(Buffer.from(await upstream.arrayBuffer()));
    })().catch(() => {
      if (outgoing.headersSent) {
        outgoing.destroy();
        return;
      }
      outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "capture_proxy_upstream_failed" }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  if (!address || typeof address === "string") {
    await closeServer(proxy);
    throw new Error("The credential capture proxy did not bind a TCP port.");
  }
  let disposed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await closeServer(proxy);
    },
  };
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: auth(session),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const organizations = isRecord(result.body) && Array.isArray(result.body.orgs)
    ? result.body.orgs.filter(isRecord)
    : [];
  const organization = organizations.find((entry) => entry.name === ORGANIZATION_NAME);
  const id = organization && typeof organization.id === "string" ? organization.id : "";
  if (!result.response.ok || !id) {
    throw new Error(`Finding the test organization failed with HTTP ${result.response.status}.`);
  }
  return id;
}

async function createProvider(
  admin: DenSession,
  orgId: string,
  api: string,
  apiKey: string,
): Promise<string> {
  const result = await denFetch(admin, "/v1/llm-providers", {
    method: "POST",
    headers: { ...auth(admin), "x-openwork-org-id": orgId },
    body: JSON.stringify({
      name: PROVIDER_NAME,
      source: "custom",
      // A custom provider block in models.dev/OpenCode shape. The order is the
      // reproduction: Azure's resource identifier precedes its API key.
      customConfig: {
        id: PROVIDER_KEY,
        name: PROVIDER_NAME,
        npm: "@ai-sdk/openai-compatible",
        env: [RESOURCE_ENV, API_KEY_ENV],
        api,
        models: [{ id: MODEL_ID, name: MODEL_NAME }],
      },
      apiKeys: {
        [RESOURCE_ENV]: RESOURCE_MARKER,
        [API_KEY_ENV]: apiKey,
      },
      allMembers: true,
      memberIds: [],
      teamIds: [],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const provider = isRecord(result.body) && isRecord(result.body.llmProvider)
    ? result.body.llmProvider
    : null;
  const id = provider && typeof provider.id === "string" ? provider.id : "";
  if (result.response.status !== 201 || !id) {
    throw new Error(`Creating the Azure env-order provider failed with HTTP ${result.response.status}.`);
  }
  return id;
}

async function deleteProvider(admin: DenSession, orgId: string, providerId: string): Promise<void> {
  await denFetch(admin, `/v1/llm-providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: { ...auth(admin), "x-openwork-org-id": orgId },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function credentialFacts(
  member: DenSession,
  orgId: string,
  providerId: string,
  resourceFingerprint: string,
  apiKeyFingerprint: string,
): Promise<Record<string, unknown>> {
  const result = await denFetch(member, `/v1/llm-providers/${encodeURIComponent(providerId)}/connect`, {
    headers: { ...auth(member), "x-openwork-org-id": orgId },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!result.response.ok || !isRecord(result.body) || !isRecord(result.body.llmProvider)) {
    throw new Error(`Reading the provider connect payload failed with HTTP ${result.response.status}.`);
  }
  const provider = result.body.llmProvider;
  const config = isRecord(provider.providerConfig) ? provider.providerConfig : {};
  const envOrder = Array.isArray(config.env)
    ? config.env.filter((value): value is string => typeof value === "string")
    : [];
  const apiKeys = isRecord(provider.apiKeys) ? provider.apiKeys : {};
  const resource = apiKeys[RESOURCE_ENV];
  const apiKey = apiKeys[API_KEY_ENV];
  return {
    envOrder,
    legacyApiKeyPresent: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
    exactlyTwoMappedValues: Object.keys(apiKeys).length === 2,
    resourceMatchesResourceFingerprint: typeof resource === "string" && tokenId(resource) === resourceFingerprint,
    resourceMatchesApiKeyFingerprint: typeof resource === "string" && tokenId(resource) === apiKeyFingerprint,
    apiKeyMatchesApiKeyFingerprint: typeof apiKey === "string" && tokenId(apiKey) === apiKeyFingerprint,
    apiKeyMatchesResourceFingerprint: typeof apiKey === "string" && tokenId(apiKey) === resourceFingerprint,
  };
}

async function localServerRequest(
  desktop: Parameters<typeof evalIn>[0],
  path: string,
  input: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; body: unknown }> {
  const value = await evalIn(desktop, `(async () => {
    const info = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("openworkServerInfo");
    const clientToken = localStorage.getItem("openwork.server.token") ?? "";
    if (!info?.running || !info.baseUrl || !info.hostToken || !clientToken) {
      return { status: 0, body: { error: "local_server_unavailable" } };
    }
    const response = await fetch(String(info.baseUrl).replace(/\\/+$/, "") + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(input.method ?? "GET")},
      headers: {
        Authorization: "Bearer " + clientToken,
        "Content-Type": "application/json",
        "x-openwork-host-token": String(info.hostToken),
      },
      body: ${input.body ? JSON.stringify(JSON.stringify(input.body)) : "undefined"},
    });
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { status: response.status, body };
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  if (!isRecord(value) || typeof value.status !== "number") {
    throw new Error("The local server returned an invalid response shape.");
  }
  return { status: value.status, body: value.body };
}

async function readManagedAuthFacts(
  profileDir: string,
  providerId: string,
  resourceFingerprint: string,
  apiKeyFingerprint: string,
): Promise<{ present: boolean; apiType: boolean; matchesResource: boolean; matchesApiKey: boolean }> {
  const paths = electronProfilePaths(profileDir);
  const candidates = [
    join(paths.userDataDir, "openwork-dev-data", "xdg", "data", "opencode", "auth.json"),
    join(paths.dataHome, "opencode", "auth.json"),
  ];
  let parsed: unknown = null;
  for (const authPath of candidates) {
    try {
      parsed = JSON.parse(await readFile(authPath, "utf8"));
      break;
    } catch {
      // The engine layout differs between source and packaged surfaces.
    }
  }
  const entry = isRecord(parsed) && isRecord(parsed[providerId]) ? parsed[providerId] : null;
  const key = entry && typeof entry.key === "string" ? entry.key : "";
  const keyFingerprint = key ? tokenId(key) : "";
  return {
    present: Boolean(entry && key),
    apiType: entry?.type === "api",
    matchesResource: keyFingerprint === resourceFingerprint,
    matchesApiKey: keyFingerprint === apiKeyFingerprint,
  };
}

test.skipIf(missingRequirements.length > 0)(title, { timeout: 20 * 60_000 }, async ({ evidence, place }) => {
  needs(requirements);
  if (process.env.OPENWORK_EVAL_DEN_API_URL?.trim()) {
    throw new SkipError("The Azure env-order reproduction requires a cold managed Den.");
  }

  await using gateway = await liteLlm({
    place,
    modelId: MODEL_ID,
    reply: "This reply must remain unreachable while the reproduction is present.",
  });
  await using proxy = await captureProxy(gateway.baseUrl);
  await using world = await startWorld(azureByok, {
    place,
    name: `azure-env-order-${Date.now().toString(36)}`,
  });
  const den = world.den;
  const orgId = await organizationId(den.admin);
  const providerId = await createProvider(
    den.admin,
    orgId,
    `${proxy.baseUrl}/v1`,
    gateway.apiKey,
  );
  onTestFinished(async () => {
    await deleteProvider(den.admin, orgId, providerId).catch(() => undefined);
  });

  const resourceFingerprint = gateway.tokenId(RESOURCE_MARKER);
  const apiKeyFingerprint = gateway.tokenId(gateway.apiKey);
  const denCredentialFacts = await credentialFacts(
    den.admin,
    orgId,
    providerId,
    resourceFingerprint,
    apiKeyFingerprint,
  );
  evidence.recordAssertionEvidence(
    "Real Den preserves both mapped values and the Azure-like env order",
    `Secret-safe connect facts: ${JSON.stringify(denCredentialFacts)}`,
    JSON.stringify(denCredentialFacts.envOrder) === JSON.stringify([RESOURCE_ENV, API_KEY_ENV])
      && denCredentialFacts.legacyApiKeyPresent === false
      && denCredentialFacts.exactlyTwoMappedValues === true
      && denCredentialFacts.resourceMatchesResourceFingerprint === true
      && denCredentialFacts.resourceMatchesApiKeyFingerprint === false
      && denCredentialFacts.apiKeyMatchesApiKeyFingerprint === true
      && denCredentialFacts.apiKeyMatchesResourceFingerprint === false,
  );
  expect(denCredentialFacts).toEqual({
    envOrder: [RESOURCE_ENV, API_KEY_ENV],
    legacyApiKeyPresent: false,
    exactlyTwoMappedValues: true,
    resourceMatchesResourceFingerprint: true,
    resourceMatchesApiKeyFingerprint: false,
    apiKeyMatchesApiKeyFingerprint: true,
    apiKeyMatchesResourceFingerprint: false,
  });

  await using desktop = await app({ den, as: "admin", place });
  const sessionSet = await localServerRequest(desktop, "/den-session", {
    method: "PUT",
    body: { baseUrl: den.ref.apiUrl, token: den.admin.token, orgId },
  });
  expect(sessionSet.status).toBe(204);
  const syncRun = await localServerRequest(desktop, "/cloud-provider-sync/run", {
    method: "POST",
    body: { reason: "eval_azure_byok_env_order" },
  });
  expect(syncRun.status).toBe(200);
  const syncStatus = await eventually(
    async () => localServerRequest(desktop, "/cloud-provider-sync/status"),
    {
      within: 120_000,
      intervalMs: 2_000,
      label: "terminal Azure env-order provider sync",
      until: (result) => {
        if (result.status !== 200 || !isRecord(result.body)) return false;
        const lastRun = isRecord(result.body.lastRun) ? result.body.lastRun : {};
        const providers = Array.isArray(result.body.providers) ? result.body.providers.filter(isRecord) : [];
        return (lastRun.status === "applied" || lastRun.status === "noop")
          && providers.some((provider) => provider.cloudProviderId === providerId);
      },
    },
  );
  const syncBody = isRecord(syncStatus.body) ? syncStatus.body : {};
  const syncLastRun = isRecord(syncBody.lastRun) ? syncBody.lastRun : {};
  const syncProviders = Array.isArray(syncBody.providers) ? syncBody.providers.filter(isRecord) : [];
  const synced = (syncLastRun.status === "applied" || syncLastRun.status === "noop")
    && syncProviders.some((provider) => provider.cloudProviderId === providerId);
  evidence.recordAssertionEvidence(
    "The real desktop local server materializes the Den provider",
    `Sync status=${String(syncLastRun.status)}; provider present=${String(synced)}.`,
    synced,
  );
  expect(synced).toBe(true);

  if (desktop.handle.hostKind !== "local" || !desktop.handle.profileDir) {
    throw new Error("The Azure env-order reproduction requires an isolated local Electron profile.");
  }
  const authFacts = await eventually(() => readManagedAuthFacts(
    desktop.handle.profileDir,
    providerId,
    resourceFingerprint,
    apiKeyFingerprint,
  ), {
    within: 60_000,
    intervalMs: 500,
    label: "managed Azure env-order auth entry",
    until: (facts) => facts.present,
  });
  evidence.recordAssertionEvidence(
    "The isolated Electron auth store delivers AZURE_API_KEY instead of positional env[0]",
    `Secret-safe auth facts: ${JSON.stringify(authFacts)}.`,
    authFacts.present && authFacts.apiType && !authFacts.matchesResource && authFacts.matchesApiKey,
  );
  expect(authFacts).toEqual({
    present: true,
    apiType: true,
    matchesResource: false,
    matchesApiKey: true,
  });
});
