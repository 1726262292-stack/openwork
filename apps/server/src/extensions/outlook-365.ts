import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";

export const OUTLOOK_365_EXTENSION_ID = "outlook-365";

const OUTLOOK_365_CLIENT_ID_ENV = "OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID";
const OUTLOOK_365_TENANT_ENV = "OPENWORK_OUTLOOK_365_TENANT";
const OUTLOOK_365_TOKEN_BROKER_URL_ENV = "OPENWORK_OUTLOOK_365_TOKEN_BROKER_URL";
const OUTLOOK_365_GRAPH_BASE_URL_ENV = "OPENWORK_OUTLOOK_365_GRAPH_BASE_URL";
const OUTLOOK_365_AUTH_BASE_URL_ENV = "OPENWORK_OUTLOOK_365_AUTH_BASE_URL";
const OUTLOOK_365_ALLOW_PLAINTEXT_VAULT_ENV = "OPENWORK_OUTLOOK_365_ALLOW_PLAINTEXT_VAULT";
const OUTLOOK_365_MOCK_ENV = "OPENWORK_OUTLOOK_365_MOCK";
const OUTLOOK_365_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OUTLOOK_365_API_TIMEOUT_MS = 30_000;
const OUTLOOK_365_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];

export const OUTLOOK_365_EXTENSION_ACTIONS = [
  {
    extensionId: OUTLOOK_365_EXTENSION_ID,
    action: "status",
    title: "Outlook 365 status",
    description: "Check whether Outlook 365 is connected and ready for OpenWork extension actions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

type Outlook365Flow = {
  flowId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  status: "pending" | "connected" | "failed" | "expired";
  authUrl: string;
  account: unknown;
  error: string | null;
  server: Server | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function configDir(config: ServerConfig): string {
  return dirname(config.configPath?.trim() || resolve(homedir(), ".config", "openwork", "server.json"));
}

function outlook365MockEnabled() {
  return process.env[OUTLOOK_365_MOCK_ENV] === "1";
}

function outlook365Tenant() {
  return process.env[OUTLOOK_365_TENANT_ENV]?.trim() || "common";
}

function outlook365GraphBaseUrl() {
  return (process.env[OUTLOOK_365_GRAPH_BASE_URL_ENV]?.trim() || "https://graph.microsoft.com/v1.0").replace(/\/+$/, "");
}

function outlook365AuthBaseUrl() {
  return (process.env[OUTLOOK_365_AUTH_BASE_URL_ENV]?.trim() || "https://login.microsoftonline.com").replace(/\/+$/, "");
}

function outlook365Credentials() {
  const clientId = process.env[OUTLOOK_365_CLIENT_ID_ENV]?.trim() || process.env.MICROSOFT_365_OAUTH_CLIENT_ID?.trim() || "";
  const tokenBrokerUrl = process.env[OUTLOOK_365_TOKEN_BROKER_URL_ENV]?.trim() || process.env.MICROSOFT_365_TOKEN_BROKER_URL?.trim() || "";
  const missing: string[] = [];
  if (!clientId && !outlook365MockEnabled()) missing.push(OUTLOOK_365_CLIENT_ID_ENV);
  return { clientId, tokenBrokerUrl, tenant: outlook365Tenant(), missing };
}

function outlook365Dir(config: ServerConfig): string {
  return join(configDir(config), "extensions", OUTLOOK_365_EXTENSION_ID);
}

function outlook365VaultPath(config: ServerConfig): string {
  return join(outlook365Dir(config), "oauth.vault");
}

function outlook365PlainTextVaultPath(config: ServerConfig): string {
  return join(outlook365Dir(config), "oauth.dev-plaintext.json");
}

function outlook365VaultKeyPath(config: ServerConfig): string {
  return join(configDir(config), "vault-key");
}

function outlook365PlainTextVaultEnabled() {
  return process.env.OPENWORK_DEV_MODE === "1" && process.env[OUTLOOK_365_ALLOW_PLAINTEXT_VAULT_ENV] === "1";
}

function outlook365VaultMode() {
  return outlook365PlainTextVaultEnabled() ? "plaintext-dev" : "encrypted";
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createOutlook365Pkce() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function outlook365VaultKey(config: ServerConfig): Promise<Buffer> {
  const envKey = process.env.OPENWORK_ENCRYPTION_KEY?.trim();
  if (envKey) return createHash("sha256").update(envKey).digest();

  const keyPath = outlook365VaultKeyPath(config);
  try {
    const raw = await readFile(keyPath, "utf8");
    const key = Buffer.from(raw.trim(), "base64");
    if (key.byteLength === 32) return key;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  return key;
}

async function readOutlook365Vault(config: ServerConfig): Promise<Record<string, unknown> | null> {
  const vaultMode = outlook365VaultMode();
  const target = vaultMode === "plaintext-dev" ? outlook365PlainTextVaultPath(config) : outlook365VaultPath(config);
  try {
    const raw = await readFile(target, "utf8");
    if (!raw.trim()) return null;
    if (vaultMode === "plaintext-dev") {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    }
    const envelope: unknown = JSON.parse(raw);
    if (!isRecord(envelope) || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") return null;
    const key = await outlook365VaultKey(config);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(decrypted);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function writeOutlook365Vault(config: ServerConfig, value: Record<string, unknown>): Promise<void> {
  const vaultMode = outlook365VaultMode();
  const target = vaultMode === "plaintext-dev" ? outlook365PlainTextVaultPath(config) : outlook365VaultPath(config);
  await mkdir(dirname(target), { recursive: true });
  if (vaultMode === "plaintext-dev") {
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(target, 0o600).catch(() => undefined);
    return;
  }
  const key = await outlook365VaultKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope = { schemaVersion: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  await writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600).catch(() => undefined);
}

async function removeOutlook365Vault(config: ServerConfig): Promise<void> {
  await Promise.all([
    rm(outlook365VaultPath(config), { force: true }),
    rm(outlook365PlainTextVaultPath(config), { force: true }),
  ]);
}

function outlook365SafeAccount(account: unknown) {
  if (!isRecord(account)) return null;
  return {
    id: typeof account.id === "string" ? account.id : null,
    displayName: typeof account.displayName === "string" ? account.displayName : null,
    mail: typeof account.mail === "string" ? account.mail : null,
    userPrincipalName: typeof account.userPrincipalName === "string" ? account.userPrincipalName : null,
  };
}

function outlook365StatusPayload(record: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}) {
  const credentials = outlook365Credentials();
  const token = isRecord(record?.token) ? record.token : null;
  return {
    configured: credentials.missing.length === 0,
    missing: credentials.missing,
    vault: outlook365VaultMode(),
    connected: Boolean(token?.refreshToken || token?.accessToken),
    account: outlook365SafeAccount(record?.account),
    scopes: Array.isArray(record?.scopes) ? record.scopes.filter((item): item is string => typeof item === "string") : [],
    connectedAt: typeof record?.connectedAt === "string" ? record.connectedAt : null,
    error: null,
    testStatus: null,
    mock: outlook365MockEnabled(),
    ...extra,
  };
}

async function fetchOutlook365Json(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OUTLOOK_365_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Microsoft Graph request timed out. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text.trim()) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    const graphError = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const details = typeof graphError?.message === "string" ? graphError.message : response.statusText;
    throw new Error(`Microsoft Graph request failed (${response.status}): ${details}`);
  }
  return payload;
}

async function fetchOutlook365Me(accessToken: string) {
  return fetchOutlook365Json(`${outlook365GraphBaseUrl()}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function fetchOutlook365TokenBrokerJson(tokenBrokerUrl: string, body: Record<string, unknown>) {
  return fetchOutlook365Json(tokenBrokerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function exchangeOutlook365Code(input: { code: string; redirectUri: string; verifier: string }) {
  const { clientId, tokenBrokerUrl, tenant, missing } = outlook365Credentials();
  if (missing.length > 0) throw new Error(`Missing Outlook 365 OAuth configuration: ${missing.join(", ")}`);
  if (tokenBrokerUrl) {
    return fetchOutlook365TokenBrokerJson(tokenBrokerUrl, {
      grantType: "authorization_code",
      provider: OUTLOOK_365_EXTENSION_ID,
      clientId,
      tenant,
      code: input.code,
      codeVerifier: input.verifier,
      redirectUri: input.redirectUri,
    });
  }
  return fetchOutlook365Json(`${outlook365AuthBaseUrl()}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
  });
}

async function refreshOutlook365Vault(config: ServerConfig, record: Record<string, unknown>) {
  const token = isRecord(record.token) ? record.token : null;
  const expiresAt = Number(token?.expiresAt ?? 0);
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : "";
  const refreshToken = typeof token?.refreshToken === "string" ? token.refreshToken : "";
  if (accessToken && expiresAt > Date.now() + 60_000) return record;
  if (!refreshToken) throw new Error("Outlook 365 refresh token is missing. Reconnect Outlook 365.");
  if (outlook365MockEnabled() && refreshToken === "mock-refresh-token") return record;

  const { clientId, tokenBrokerUrl, tenant, missing } = outlook365Credentials();
  if (missing.length > 0) throw new Error(`Missing Outlook 365 OAuth configuration: ${missing.join(", ")}`);
  const refreshed = tokenBrokerUrl
    ? await fetchOutlook365TokenBrokerJson(tokenBrokerUrl, { grantType: "refresh_token", provider: OUTLOOK_365_EXTENSION_ID, clientId, tenant, refreshToken })
    : await fetchOutlook365Json(`${outlook365AuthBaseUrl()}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: OUTLOOK_365_SCOPES.join(" ") }),
    });
  if (!isRecord(refreshed) || typeof refreshed.access_token !== "string") throw new Error("Outlook 365 OAuth refresh did not return an access token.");
  const next = {
    ...record,
    scopes: typeof refreshed.scope === "string" ? refreshed.scope.split(/\s+/).filter(Boolean) : record.scopes,
    token: {
      accessToken: refreshed.access_token,
      refreshToken: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : refreshToken,
      expiresAt: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeOutlook365Vault(config, next);
  return next;
}

async function outlook365AccessToken(config: ServerConfig): Promise<{ record: Record<string, unknown>; accessToken: string }> {
  const record = await readOutlook365Vault(config);
  if (!record) throw new ApiError(400, "outlook_365_not_connected", "Connect Outlook 365 in OpenWork Settings to use this tool.");
  const refreshed = await refreshOutlook365Vault(config, record);
  const token = isRecord(refreshed.token) ? refreshed.token : null;
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : "";
  if (!accessToken) throw new Error("Outlook 365 access token is unavailable. Reconnect Outlook 365.");
  return { record: refreshed, accessToken };
}

export async function callOutlook365ExtensionAction(config: ServerConfig, action: string, _args: Record<string, unknown>, context: Record<string, unknown>) {
  if (action === "status") {
    return {
      ok: true,
      extensionId: OUTLOOK_365_EXTENSION_ID,
      action,
      result: await outlook365Status(config),
      context,
    };
  }
  return null;
}

export async function outlook365Status(config: ServerConfig) {
  try {
    const record = await readOutlook365Vault(config);
    return outlook365StatusPayload(record);
  } catch (error) {
    return outlook365StatusPayload(null, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function outlook365TestConnection(config: ServerConfig) {
  const { record, accessToken } = await outlook365AccessToken(config);
  if (!outlook365MockEnabled() || accessToken !== "mock-access-token") await fetchOutlook365Me(accessToken);
  return outlook365StatusPayload(record, { testStatus: "Microsoft profile access verified with the minimal User.Read permission." });
}

export async function outlook365Disconnect(config: ServerConfig) {
  await removeOutlook365Vault(config);
  return outlook365StatusPayload(null, { testStatus: "Outlook 365 local tokens removed. To fully revoke access, remove OpenWork from your Microsoft account or tenant app permissions." });
}

async function writeMockConnection(config: ServerConfig) {
  const account = {
    id: "mock-user-id",
    displayName: "Mock Outlook User",
    mail: "mock.user@example.com",
    userPrincipalName: "mock.user@example.com",
  };
  const record = {
    version: 1,
    account,
    scopes: OUTLOOK_365_SCOPES,
    token: {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
    },
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeOutlook365Vault(config, record);
  return account;
}

function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function outlook365CallbackPage(status: number, title: string, body: string) {
  return new Response(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body style="font-family: system-ui, sans-serif; padding: 32px;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><script>setTimeout(() => window.close(), 800);</script></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", Connection: "close" },
  });
}

export function createOutlook365ConnectFlowManager(config: ServerConfig) {
  const flows = new Map<string, Outlook365Flow>();

  const cleanup = (flowId: string) => {
    const flow = flows.get(flowId);
    if (!flow) return;
    flow.server?.closeAllConnections?.();
    flow.server?.close(() => undefined);
    flows.delete(flowId);
  };

  const start = async () => {
    const credentials = outlook365Credentials();
    if (credentials.missing.length > 0) {
      throw new ApiError(400, "outlook_365_oauth_not_configured", `Missing Outlook 365 OAuth configuration: ${credentials.missing.join(", ")}`);
    }
    const flowId = base64Url(randomBytes(18));
    const expiresAt = Date.now() + OUTLOOK_365_AUTH_TIMEOUT_MS;

    if (outlook365MockEnabled()) {
      await writeMockConnection(config);
      flows.set(flowId, {
        flowId,
        state: "mock-state",
        verifier: "mock-verifier",
        redirectUri: "mock://outlook-365/callback",
        expiresAt,
        status: "connected",
        authUrl: "mock://outlook-365/authorize",
        account: null,
        error: null,
        server: null,
      });
      return { flowId, authUrl: "mock://outlook-365/authorize", expiresAt };
    }

    const state = base64Url(randomBytes(24));
    const pkce = createOutlook365Pkce();
    let callbackServer: Server | null = null;
    const port = await new Promise<number>((resolvePort, reject) => {
      callbackServer = createServer(async (request, response) => {
        const finish = async (page: Response) => {
          response.writeHead(page.status, Object.fromEntries(page.headers.entries()));
          response.end(await page.text());
        };
        try {
          const flow = flows.get(flowId);
          if (!flow) {
            await finish(outlook365CallbackPage(410, "Outlook 365 connection expired", "Return to OpenWork and start connection again."));
            return;
          }
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== "/" && url.pathname !== "/oauth/outlook-365/callback") {
            response.writeHead(404);
            response.end("Not found");
            return;
          }
          const error = url.searchParams.get("error");
          if (error) {
            flow.status = "failed";
            flow.error = `Microsoft OAuth returned error: ${error}`;
            await finish(outlook365CallbackPage(400, "Outlook 365 connection failed", error));
            return;
          }
          const returnedState = url.searchParams.get("state") ?? "";
          const code = url.searchParams.get("code") ?? "";
          if (returnedState !== flow.state || !code) {
            flow.status = "failed";
            flow.error = "Invalid Outlook 365 OAuth callback.";
            await finish(outlook365CallbackPage(400, "Outlook 365 connection failed", "Invalid OAuth callback."));
            return;
          }
          await finish(outlook365CallbackPage(200, "Outlook 365 authorization received", "You can return to OpenWork while it finishes connecting."));
          try {
            const token = await exchangeOutlook365Code({ code, redirectUri: flow.redirectUri, verifier: flow.verifier });
            if (!isRecord(token) || typeof token.access_token !== "string") throw new Error("Microsoft OAuth response did not include an access token.");
            const account = await fetchOutlook365Me(token.access_token);
            const record = {
              version: 1,
              account,
              scopes: typeof token.scope === "string" ? token.scope.split(/\s+/).filter(Boolean) : OUTLOOK_365_SCOPES,
              token: {
                accessToken: token.access_token,
                refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
                expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
              },
              connectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await writeOutlook365Vault(config, record);
            flow.status = "connected";
            flow.account = account;
          } catch (exchangeError) {
            flow.status = "failed";
            flow.error = `Microsoft authorized OpenWork, but token exchange failed: ${exchangeError instanceof Error ? exchangeError.message : String(exchangeError)}`;
          }
        } catch (callbackError) {
          const flow = flows.get(flowId);
          if (flow) flow.error = callbackError instanceof Error ? callbackError.message : String(callbackError);
          if (!response.headersSent) {
            await finish(outlook365CallbackPage(500, "Outlook 365 connection failed", callbackError instanceof Error ? callbackError.message : String(callbackError)));
          }
        }
      });
      callbackServer.once("error", reject);
      callbackServer.listen(0, "127.0.0.1", () => {
        const address = callbackServer?.address();
        const resolvedPort = typeof address === "object" && address ? address.port : null;
        if (!resolvedPort) reject(new Error("Could not start Outlook 365 OAuth callback server."));
        else resolvePort(resolvedPort);
      });
    });
    if (!callbackServer) throw new Error("Could not start Outlook 365 OAuth callback server.");
    const redirectUri = `http://127.0.0.1:${port}/`;
    const authorizationUrl = new URL(`${outlook365AuthBaseUrl()}/${encodeURIComponent(credentials.tenant)}/oauth2/v2.0/authorize`);
    authorizationUrl.searchParams.set("client_id", credentials.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", OUTLOOK_365_SCOPES.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    flows.set(flowId, {
      flowId,
      state,
      verifier: pkce.verifier,
      redirectUri,
      expiresAt,
      status: "pending",
      authUrl: authorizationUrl.toString(),
      account: null,
      error: null,
      server: callbackServer,
    });
    setTimeout(() => {
      const flow = flows.get(flowId);
      if (!flow || flow.status !== "pending") return;
      flow.status = "expired";
      flow.error = "Outlook 365 OAuth timed out.";
      flow.server?.closeAllConnections?.();
      flow.server?.close(() => undefined);
    }, OUTLOOK_365_AUTH_TIMEOUT_MS + 1000).unref?.();
    return { flowId, authUrl: authorizationUrl.toString(), expiresAt };
  };

  const status = async (flowId: string) => {
    const flow = flows.get(flowId);
    if (!flow) throw new ApiError(404, "outlook_365_oauth_flow_not_found", "Outlook 365 connection flow not found");
    if (flow.status === "pending" && flow.expiresAt <= Date.now()) {
      flow.status = "expired";
      flow.error = "Outlook 365 OAuth timed out.";
    }
    const outlook365 = flow.status === "connected" ? await outlook365Status(config) : null;
    const payload = {
      flowId: flow.flowId,
      status: flow.status,
      expiresAt: flow.expiresAt,
      error: flow.error,
      outlook365,
    };
    if (flow.status !== "pending") setTimeout(() => cleanup(flow.flowId), 1000).unref?.();
    return payload;
  };

  return { start, status };
}
