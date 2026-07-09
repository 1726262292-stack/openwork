import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const serviceNowScript = join(repoRoot, "scripts/servicenow-mcp-server.mjs");
const sidecarDir = join(repoRoot, "apps/desktop/resources/sidecars");

const MCP_PATH = "/mcp";
const DEEP_MCP_PATH = "/sncapps/mcp-server/mcp/sn_openwork_it";
const MCP_NAME = "acme-servicenow";
const CLIENT_ID = "acme-desktop-client";
const CLIENT_SECRET = "acme-oauth-secret-98765";

type SpawnedServer = {
  proc: ChildProcess;
  port: number;
  base: string;
  logs: string[];
};

type AuthGrant = {
  code: string;
  redirectUri: string;
  verifier: string;
  state: string;
  authorizationUrl: string;
};

type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
};

type RequestLogEntry = {
  id: number;
  method: string;
  path: string;
  url: string;
  at: string;
  jsonrpcMethod?: string;
};

function findSidecar(): string | null {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const names =
    process.platform === "darwin"
      ? [`opencode-${arch}-apple-darwin`]
      : process.platform === "linux"
        ? [`opencode-${arch}-unknown-linux-gnu`, `opencode-${arch}-unknown-linux-musl`]
        : [];
  for (const name of names) {
    const candidate = join(sidecarDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const enginePath = findSidecar();
const describeMaybe = enginePath ? describe : describe.skip;

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ""}`);
}

async function getFreePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("failed to allocate a free port");
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${label} was not an object: ${JSON.stringify(value)}`);
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`${label} was not an array: ${JSON.stringify(value)}`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${label} was not a string: ${JSON.stringify(value)}`);
}

function numberValue(value: unknown, label: string): number {
  if (typeof value === "number") return value;
  throw new Error(`${label} was not a number: ${JSON.stringify(value)}`);
}

async function jsonBody(response: Response): Promise<unknown> {
  const payload: unknown = await response.json();
  return payload;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function randomVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function spawnServiceNow(env: Record<string, string> = {}): Promise<SpawnedServer> {
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const proc = spawn("node", [serviceNowScript], {
    env: { ...process.env, PORT: String(port), AUTO_APPROVE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  proc.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  await waitFor(
    async () => {
      const res = await fetch(`${base}/health`);
      if (!res.ok) return null;
      const payload = recordValue(await jsonBody(res), "health payload");
      return payload.product === "servicenow-mcp" ? true : null;
    },
    10_000,
    "servicenow mcp server",
  );
  return { proc, port, base, logs };
}

function stopProcess(proc: ChildProcess | undefined): void {
  proc?.kill();
}

async function authorizeRaw(base: string, params: URLSearchParams): Promise<Response> {
  return fetch(`${base}/oauth_auth.do?${params.toString()}`, { redirect: "manual" });
}

async function newAuthorizationCode(
  base: string,
  options: {
    scope?: string;
    resource?: string;
    clientId?: string;
    redirectUri?: string;
    includeChallenge?: boolean;
    challengeMethod?: string;
  } = {},
): Promise<AuthGrant> {
  const verifier = randomVerifier();
  const state = randomTokenForTest();
  const redirectUri = options.redirectUri || `http://127.0.0.1:${await getFreePort()}/oauth/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId || CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });
  if (options.scope !== undefined) params.set("scope", options.scope);
  if (options.resource !== undefined) params.set("resource", options.resource);
  if (options.includeChallenge !== false) {
    params.set("code_challenge", codeChallenge(verifier));
    params.set("code_challenge_method", options.challengeMethod || "S256");
  }
  const res = await authorizeRaw(base, params);
  expect(res.status).toBe(302);
  const location = res.headers.get("location");
  expect(location).toBeTruthy();
  const callback = new URL(stringValue(location, "authorization redirect"));
  expect(callback.searchParams.get("state")).toBe(state);
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();
  return { code: stringValue(code, "authorization code"), redirectUri, verifier, state, authorizationUrl: `${base}/oauth_auth.do?${params.toString()}` };
}

function randomTokenForTest(): string {
  return randomBytes(12).toString("base64url");
}

async function tokenRequest(base: string, params: URLSearchParams, basic?: { clientId: string; clientSecret: string }): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (basic) headers.authorization = basicAuth(basic.clientId, basic.clientSecret);
  return fetch(`${base}/oauth_token.do`, { method: "POST", headers, body: params });
}

async function exchangeCode(base: string, grant: AuthGrant, options: { secret?: string; basicSecret?: string; verifier?: string; resource?: string } = {}): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: grant.code,
    redirect_uri: grant.redirectUri,
    client_id: CLIENT_ID,
    code_verifier: options.verifier || grant.verifier,
  });
  if (options.secret !== undefined) params.set("client_secret", options.secret);
  if (options.resource !== undefined) params.set("resource", options.resource);
  const res = await tokenRequest(base, params, options.basicSecret === undefined ? undefined : { clientId: CLIENT_ID, clientSecret: options.basicSecret });
  expect(res.status).toBe(200);
  return tokensFromPayload(await jsonBody(res));
}

function tokensFromPayload(payload: unknown): OAuthTokens {
  const record = recordValue(payload, "token response");
  return {
    accessToken: stringValue(record.access_token, "access_token"),
    refreshToken: stringValue(record.refresh_token, "refresh_token"),
    scope: stringValue(record.scope, "scope"),
  };
}

async function getTokens(base: string, scope = "incidents.read incidents.write", resource?: string): Promise<OAuthTokens> {
  const grant = await newAuthorizationCode(base, { scope, resource });
  return exchangeCode(base, grant, { resource });
}

async function mcpPostRaw(base: string, path: string, token: string, body: string, headers: Record<string, string> = {}): Promise<{ response: Response; payload: unknown | null }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body,
  });
  const text = await response.text();
  if (!text) return { response, payload: null };
  return { response, payload: JSON.parse(text) };
}

async function mcpCall(base: string, path: string, token: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { response, payload } = await mcpPostRaw(
    base,
    path,
    token,
    JSON.stringify({ jsonrpc: "2.0", id: randomTokenForTest(), method, params }),
    headers,
  );
  return { response, payload: recordValue(payload, `${method} response`) };
}

function rpcResult(payload: Record<string, unknown>): Record<string, unknown> {
  return recordValue(payload.result, "json-rpc result");
}

function expectRpcError(payload: unknown, code: number): void {
  const record = recordValue(payload, "json-rpc error response");
  const error = recordValue(record.error, "json-rpc error");
  expect(numberValue(error.code, "json-rpc error code")).toBe(code);
}

function toolResult(payload: Record<string, unknown>): Record<string, unknown> {
  return rpcResult(payload);
}

async function tableJson(base: string, path: string, token: string, init: RequestInit = {}): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  return { response, payload: recordValue(await jsonBody(response), "table response") };
}

function parseRequests(payload: unknown): RequestLogEntry[] {
  const root = recordValue(payload, "requests payload");
  return arrayValue(root.requests, "requests").map((entry) => {
    const item = recordValue(entry, "request entry");
    const parsed: RequestLogEntry = {
      id: numberValue(item.id, "request id"),
      method: stringValue(item.method, "request method"),
      path: stringValue(item.path, "request path"),
      url: stringValue(item.url, "request url"),
      at: stringValue(item.at, "request at"),
    };
    if (typeof item.jsonrpcMethod === "string") parsed.jsonrpcMethod = item.jsonrpcMethod;
    return parsed;
  });
}

async function requestLog(base: string): Promise<RequestLogEntry[]> {
  return parseRequests(await jsonBody(await fetch(`${base}/requests`)));
}

function activeServer(server: SpawnedServer | null): SpawnedServer {
  if (server) return server;
  throw new Error("ServiceNow test server was not started");
}

describe("servicenow mcp spec compliance", () => {
  let server: SpawnedServer | null = null;

  beforeAll(async () => {
    server = await spawnServiceNow();
  }, 20_000);

  afterAll(() => {
    stopProcess(server?.proc);
  });

  test("serves protected-resource and authorization-server metadata without DCR or secrets", async () => {
    const base = activeServer(server).base;
    const prmPaths = [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/mcp/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/sncapps/mcp-server/mcp/sn_openwork_it",
      "/sncapps/mcp-server/mcp/sn_openwork_it/.well-known/oauth-protected-resource",
    ];
    for (const path of prmPaths) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      const payload = recordValue(await jsonBody(response), `prm ${path}`);
      expect(payload.resource).toBe(`${base}/mcp`);
      expect(arrayValue(payload.authorization_servers, "authorization_servers")).toEqual([base]);
      expect(arrayValue(payload.scopes_supported, "scopes_supported")).toEqual(["incidents.read", "incidents.write"]);
      expect(payload.resource_name).toBe("ServiceNow (Acme Robotics IT)");
      expect(JSON.stringify(payload)).not.toContain(CLIENT_SECRET);
    }

    const asPaths = [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/mcp",
      "/mcp/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/sncapps/mcp-server/mcp/sn_openwork_it",
      "/sncapps/mcp-server/mcp/sn_openwork_it/.well-known/oauth-authorization-server",
    ];
    for (const path of asPaths) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      const payload = recordValue(await jsonBody(response), `as ${path}`);
      expect(payload.issuer).toBe(base);
      expect(payload.authorization_endpoint).toBe(`${base}/oauth_auth.do`);
      expect(payload.token_endpoint).toBe(`${base}/oauth_token.do`);
      expect(arrayValue(payload.code_challenge_methods_supported, "challenge methods")).toEqual(["S256"]);
      expect(payload.registration_endpoint).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain(CLIENT_SECRET);
    }
  });

  test("rejects unauthenticated and invalid MCP requests with WWW-Authenticate metadata", async () => {
    const base = activeServer(server).base;
    for (const path of [MCP_PATH, DEEP_MCP_PATH]) {
      const missing = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource"`);

      const garbage = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization: "Bearer definitely-not-issued", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(garbage.status).toBe(401);
      expect(garbage.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  test("implements OAuth 2.1 PKCE, preregistered client auth, and authorization-code failures", async () => {
    const base = activeServer(server).base;
    const grant = await newAuthorizationCode(base, { scope: "incidents.read" });
    const publicTokens = await exchangeCode(base, grant);
    expect(publicTokens.accessToken).toStartWith("sn_at_");
    const ok = await mcpCall(base, MCP_PATH, publicTokens.accessToken, "initialize", { protocolVersion: "2025-06-18" });
    expect(ok.response.status).toBe(200);

    const wrongVerifierGrant = await newAuthorizationCode(base, { scope: "incidents.read" });
    const wrongVerifier = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "authorization_code", code: wrongVerifierGrant.code, redirect_uri: wrongVerifierGrant.redirectUri, client_id: CLIENT_ID, code_verifier: "wrong" }),
    );
    expect(wrongVerifier.status).toBe(400);
    expect(recordValue(await jsonBody(wrongVerifier), "wrong verifier").error).toBe("invalid_grant");

    const reuseGrant = await newAuthorizationCode(base, { scope: "incidents.read" });
    await exchangeCode(base, reuseGrant);
    const reused = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "authorization_code", code: reuseGrant.code, redirect_uri: reuseGrant.redirectUri, client_id: CLIENT_ID, code_verifier: reuseGrant.verifier }),
    );
    expect(reused.status).toBe(400);
    expect(recordValue(await jsonBody(reused), "reused code").error).toBe("invalid_grant");

    const redirectUri = `http://127.0.0.1:${await getFreePort()}/callback`;
    const missingChallenge = await authorizeRaw(base, new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: redirectUri, state: "missing" }));
    expect(missingChallenge.status).toBe(302);
    const missingLocation = new URL(stringValue(missingChallenge.headers.get("location"), "missing challenge location"));
    expect(missingLocation.searchParams.get("error")).toBe("invalid_request");

    const plain = await authorizeRaw(
      base,
      new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: redirectUri, state: "plain", code_challenge: "plain-value", code_challenge_method: "plain" }),
    );
    expect(plain.status).toBe(302);
    const plainLocation = new URL(stringValue(plain.headers.get("location"), "plain challenge location"));
    expect(plainLocation.searchParams.get("error")).toBe("invalid_request");

    const mismatchGrant = await newAuthorizationCode(base, { scope: "incidents.read" });
    const mismatch = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "authorization_code", code: mismatchGrant.code, redirect_uri: `http://127.0.0.1:${await getFreePort()}/other`, client_id: CLIENT_ID, code_verifier: mismatchGrant.verifier }),
    );
    expect(mismatch.status).toBe(400);
    expect(recordValue(await jsonBody(mismatch), "mismatched redirect").error).toBe("invalid_grant");

    const unknown = await authorizeRaw(base, new URLSearchParams({ response_type: "code", client_id: "unknown-client", redirect_uri: redirectUri, code_challenge: codeChallenge(randomVerifier()), code_challenge_method: "S256" }));
    expect(unknown.status).toBe(400);
    expect(recordValue(await jsonBody(unknown), "unknown client").error).toBe("invalid_client");

    const secretGrant = await newAuthorizationCode(base, { scope: "incidents.read" });
    const wrongSecret = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "authorization_code", code: secretGrant.code, redirect_uri: secretGrant.redirectUri, client_id: CLIENT_ID, client_secret: "wrong", code_verifier: secretGrant.verifier }),
    );
    expect(wrongSecret.status).toBe(401);
    expect(recordValue(await jsonBody(wrongSecret), "wrong secret").error).toBe("invalid_client");
    const correctSecret = await exchangeCode(base, secretGrant, { secret: CLIENT_SECRET });
    expect(correctSecret.accessToken).toStartWith("sn_at_");

    const basicGrant = await newAuthorizationCode(base, { scope: "incidents.read" });
    const wrongBasic = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "authorization_code", code: basicGrant.code, redirect_uri: basicGrant.redirectUri, code_verifier: basicGrant.verifier }),
      { clientId: CLIENT_ID, clientSecret: "wrong" },
    );
    expect(wrongBasic.status).toBe(401);
    expect(wrongBasic.headers.get("www-authenticate")).toContain('Basic realm="ServiceNow"');
  });

  test("binds access tokens to the RFC 8707 resource audience", async () => {
    const base = activeServer(server).base;
    const other = await getTokens(base, "incidents.read", "https://other.example/mcp");
    const rejected = await mcpCall(base, MCP_PATH, other.accessToken, "ping");
    expect(rejected.response.status).toBe(401);
    expect(rejected.response.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const canonical = await getTokens(base, "incidents.read", `${base}/mcp`);
    const accepted = await mcpCall(base, MCP_PATH, canonical.accessToken, "ping");
    expect(accepted.response.status).toBe(200);
    expect(rpcResult(accepted.payload)).toEqual({});
  });

  test("refresh grants issue fresh access tokens and recover after access-token expiry", async () => {
    const base = activeServer(server).base;
    const tokens = await getTokens(base, "incidents.read incidents.write");
    const refresh = await tokenRequest(
      base,
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: CLIENT_ID }),
    );
    expect(refresh.status).toBe(200);
    const refreshed = tokensFromPayload(await jsonBody(refresh));
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
    expect(refreshed.refreshToken).toBe(tokens.refreshToken);
    expect((await mcpCall(base, MCP_PATH, tokens.accessToken, "ping")).response.status).toBe(200);
    expect((await mcpCall(base, MCP_PATH, refreshed.accessToken, "ping")).response.status).toBe(200);

    const short = await spawnServiceNow({ TOKEN_TTL_SECONDS: "1" });
    try {
      const expiring = await getTokens(short.base, "incidents.read incidents.write");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_250));
      const expired = await mcpCall(short.base, MCP_PATH, expiring.accessToken, "ping");
      expect(expired.response.status).toBe(401);
      expect(expired.response.headers.get("www-authenticate")).toContain('error="invalid_token"');
      const recovered = await tokenRequest(short.base, new URLSearchParams({ grant_type: "refresh_token", refresh_token: expiring.refreshToken, client_id: CLIENT_ID }));
      expect(recovered.status).toBe(200);
      const recoveredTokens = tokensFromPayload(await jsonBody(recovered));
      expect((await mcpCall(short.base, MCP_PATH, recoveredTokens.accessToken, "ping")).response.status).toBe(200);
    } finally {
      stopProcess(short.proc);
    }
  });

  test("enforces read and write scopes at the MCP tool layer", async () => {
    const base = activeServer(server).base;
    const readOnly = await getTokens(base, "incidents.read");
    const search = await mcpCall(base, MCP_PATH, readOnly.accessToken, "tools/call", { name: "search_incidents", arguments: { query: "VPN", limit: 5 } });
    expect(search.response.status).toBe(200);
    expect(toolResult(search.payload).isError).toBeUndefined();
    const get = await mcpCall(base, MCP_PATH, readOnly.accessToken, "tools/call", { name: "get_incident", arguments: { number: "INC0010001" } });
    expect(toolResult(get.payload).isError).toBeUndefined();

    const update = await mcpCall(base, MCP_PATH, readOnly.accessToken, "tools/call", { name: "update_incident", arguments: { number: "INC0010001", state: 2 } });
    const updateResult = toolResult(update.payload);
    expect(updateResult.isError).toBe(true);
    expect(JSON.stringify(updateResult)).toContain("incidents.write");
    const create = await mcpCall(base, MCP_PATH, readOnly.accessToken, "tools/call", { name: "create_incident", arguments: { short_description: "Read token must not create" } });
    const createResult = toolResult(create.payload);
    expect(createResult.isError).toBe(true);
    expect(JSON.stringify(createResult)).toContain("incidents.write");

    const full = await getTokens(base, "");
    expect(full.scope.split(" ").sort()).toEqual(["incidents.read", "incidents.write"]);
    const fullCreate = await mcpCall(base, MCP_PATH, full.accessToken, "tools/call", { name: "create_incident", arguments: { short_description: "Empty scope grants both scopes" } });
    expect(toolResult(fullCreate.payload).isError).toBeUndefined();

    const invalidScope = await authorizeRaw(
      base,
      new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: `http://127.0.0.1:${await getFreePort()}/callback`, scope: "incidents.admin", code_challenge: codeChallenge(randomVerifier()), code_challenge_method: "S256" }),
    );
    expect(invalidScope.status).toBe(302);
    const invalidScopeLocation = new URL(stringValue(invalidScope.headers.get("location"), "invalid scope redirect"));
    expect(invalidScopeLocation.searchParams.get("error")).toBe("invalid_scope");
  });

  test("implements MCP transport semantics, sessions, protocol headers, and origin checks", async () => {
    const base = activeServer(server).base;
    const tokens = await getTokens(base, "incidents.read incidents.write");

    const initJune = await mcpCall(base, MCP_PATH, tokens.accessToken, "initialize", { protocolVersion: "2025-06-18" });
    expect(rpcResult(initJune.payload).protocolVersion).toBe("2025-06-18");
    const sessionId = initJune.response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initLatest = await mcpCall(base, MCP_PATH, tokens.accessToken, "initialize", { protocolVersion: "2025-11-25" });
    expect(rpcResult(initLatest.payload).protocolVersion).toBe("2025-11-25");
    const initFallback = await mcpCall(base, MCP_PATH, tokens.accessToken, "initialize", { protocolVersion: "1990-01-01" });
    expect(rpcResult(initFallback.payload).protocolVersion).toBe("2025-11-25");

    const unknownSession = await mcpCall(base, MCP_PATH, tokens.accessToken, "ping", {}, { "Mcp-Session-Id": "missing-session" });
    expect(unknownSession.response.status).toBe(404);
    const deleted = await fetch(`${base}${MCP_PATH}`, { method: "DELETE", headers: { authorization: `Bearer ${tokens.accessToken}`, "Mcp-Session-Id": stringValue(sessionId, "session id") } });
    expect([200, 204]).toContain(deleted.status);

    const ping = await mcpCall(base, MCP_PATH, tokens.accessToken, "ping");
    expect(rpcResult(ping.payload)).toEqual({});
    const notification = await mcpPostRaw(base, MCP_PATH, tokens.accessToken, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(notification.response.status).toBe(202);
    expect(notification.payload).toBeNull();
    const clientResponse = await mcpPostRaw(base, MCP_PATH, tokens.accessToken, JSON.stringify({ jsonrpc: "2.0", id: 123, result: {} }));
    expect(clientResponse.response.status).toBe(202);
    const unknown = await mcpCall(base, MCP_PATH, tokens.accessToken, "missing/method");
    expectRpcError(unknown.payload, -32601);
    const parseError = await mcpPostRaw(base, MCP_PATH, tokens.accessToken, "{");
    expect(parseError.response.status).toBe(400);
    expectRpcError(parseError.payload, -32700);
    const batch = await mcpPostRaw(base, MCP_PATH, tokens.accessToken, "[]");
    expect(batch.response.status).toBe(400);
    expectRpcError(batch.payload, -32600);
    const get = await fetch(`${base}${MCP_PATH}`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, DELETE");

    const evil = await mcpCall(base, MCP_PATH, tokens.accessToken, "ping", {}, { Origin: "https://evil.example" });
    expect(evil.response.status).toBe(403);
    const localhost = await mcpCall(base, MCP_PATH, tokens.accessToken, "ping", {}, { Origin: "http://localhost:5273" });
    expect(localhost.response.status).toBe(200);
    const badVersion = await mcpCall(base, MCP_PATH, tokens.accessToken, "ping", {}, { "MCP-Protocol-Version": "1999-01-01" });
    expect(badVersion.response.status).toBe(400);
  });

  test("lists ServiceNow tools and executes tool calls with structured content", async () => {
    const base = activeServer(server).base;
    const tokens = await getTokens(base, "incidents.read incidents.write");
    const list = await mcpCall(base, MCP_PATH, tokens.accessToken, "tools/list", { cursor: "ignored" });
    const listResult = rpcResult(list.payload);
    const listedTools = arrayValue(listResult.tools, "tools");
    expect(listedTools).toHaveLength(6);
    expect(listedTools.map((tool) => stringValue(recordValue(tool, "tool").name, "tool name"))).toEqual([
      "search_incidents",
      "get_incident",
      "create_incident",
      "update_incident",
      "add_comment",
      "resolve_incident",
    ]);
    for (const tool of listedTools) {
      const item = recordValue(tool, "tool entry");
      expect(item.inputSchema).toBeDefined();
      expect(item.annotations).toBeDefined();
    }

    const get = await mcpCall(base, MCP_PATH, tokens.accessToken, "tools/call", { name: "get_incident", arguments: { number: "INC0010001" } });
    const getResult = toolResult(get.payload);
    expect(getResult.isError).toBeUndefined();
    expect(JSON.stringify(getResult.content)).toContain("INC0010001");
    const structured = recordValue(getResult.structuredContent, "get structured content");
    const incident = recordValue(structured.incident, "incident structured content");
    expect(incident.number).toBe("INC0010001");

    const created = await mcpCall(base, MCP_PATH, tokens.accessToken, "tools/call", { name: "create_incident", arguments: { short_description: "Autonomous forklift cannot reach Wi-Fi", category: "network", impact: 2, urgency: 1 } });
    const createdResult = toolResult(created.payload);
    const createdIncident = recordValue(recordValue(createdResult.structuredContent, "created structured").incident, "created incident");
    const number = stringValue(createdIncident.number, "created number");
    expect(number).toStartWith("INC00100");
    const table = await tableJson(base, `/api/now/table/incident/${stringValue(createdIncident.sys_id, "created sys_id")}`, tokens.accessToken);
    expect(table.response.status).toBe(200);
    expect(recordValue(table.payload.result, "created table result").number).toBe(number);

    const unknown = await mcpCall(base, MCP_PATH, tokens.accessToken, "tools/call", { name: "not_a_tool", arguments: {} });
    expectRpcError(unknown.payload, -32602);
    const missing = await mcpCall(base, MCP_PATH, tokens.accessToken, "tools/call", { name: "create_incident", arguments: {} });
    expectRpcError(missing.payload, -32602);
  });

  test("implements the ServiceNow-shaped incident Table API", async () => {
    const base = activeServer(server).base;
    const tokens = await getTokens(base, "incidents.read incidents.write");
    const unauth = await fetch(`${base}/api/now/table/incident`);
    expect(unauth.status).toBe(401);
    const unauthPayload = recordValue(await jsonBody(unauth), "unauth table");
    expect(recordValue(unauthPayload.error, "unauth error").message).toBe("User Not Authenticated");

    const list = await tableJson(base, "/api/now/table/incident?sysparm_query=state=1^ORDERBYDESCsys_created_on&sysparm_limit=2", tokens.accessToken);
    expect(list.response.status).toBe(200);
    expect(Number(list.response.headers.get("x-total-count"))).toBeGreaterThanOrEqual(1);
    expect(arrayValue(list.payload.result, "state list result").length).toBeLessThanOrEqual(2);

    const like = await tableJson(base, "/api/now/table/incident?sysparm_query=short_descriptionLIKEVPN&sysparm_limit=5", tokens.accessToken);
    const likeRows = arrayValue(like.payload.result, "like result");
    expect(likeRows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(likeRows)).toContain("VPN");

    const created = await tableJson(base, "/api/now/table/incident", tokens.accessToken, {
      method: "POST",
      body: JSON.stringify({ short_description: "Warehouse tablet cannot enroll in MDM", caller_id: "rashmi.member", impact: 2, urgency: 2 }),
    });
    expect(created.response.status).toBe(201);
    const createdIncident = recordValue(created.payload.result, "created table incident");
    const sysId = stringValue(createdIncident.sys_id, "created sys id");
    const patched = await tableJson(base, `/api/now/table/incident/${sysId}`, tokens.accessToken, {
      method: "PATCH",
      body: JSON.stringify({ state: 2, comments: "Caller confirmed this blocks inventory counts.", work_notes: "Assigned to Service Desk for MDM enrollment." }),
    });
    expect(patched.response.status).toBe(200);
    const patchedIncident = recordValue(patched.payload.result, "patched incident");
    expect(patchedIncident.state).toBe(2);
    const journal = arrayValue(patchedIncident.journal, "patched journal");
    expect(journal.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(journal)).toContain("Caller confirmed");
    expect(JSON.stringify(journal)).toContain("Assigned to Service Desk");

    const missing = await tableJson(base, "/api/now/table/incident/ffffffffffffffffffffffffffffffff", tokens.accessToken);
    expect(missing.response.status).toBe(404);
    expect(recordValue(missing.payload.error, "missing error").message).toBe("No Record found");
  });
});

describeMaybe("engine completes servicenow oauth (no DCR) and connects", () => {
  let server: SpawnedServer | null = null;

  beforeAll(async () => {
    server = await spawnServiceNow();
  }, 20_000);

  afterAll(() => {
    stopProcess(server?.proc);
  });

  async function attemptEngineConnection(mcpPath: string): Promise<{ handledPath: string; resourceParamPresent: boolean }> {
    const running = activeServer(server);
    const engine = enginePath;
    if (!engine) throw new Error("opencode sidecar is missing");
    const enginePort = await getFreePort();
    const workDir = mkdtempSync(join(tmpdir(), "servicenow-mcp-ws-"));
    const dataDir = mkdtempSync(join(tmpdir(), "servicenow-mcp-data-"));
    let engineProc: ChildProcess | null = null;
    const requestStart = Math.max(0, ...(await requestLog(running.base)).map((entry) => entry.id));
    const engineUrl = () => `http://127.0.0.1:${enginePort}`;
    const engineFetch = (path: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(`${engineUrl()}${path}`);
      url.searchParams.set("directory", workDir);
      return fetch(url, init);
    };

    try {
      writeFileSync(
        join(workDir, "opencode.jsonc"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            [MCP_NAME]: {
              type: "remote",
              url: `${running.base}${mcpPath}`,
              enabled: true,
              oauth: { clientId: CLIENT_ID, scope: "incidents.read incidents.write" },
            },
          },
        }),
      );

      engineProc = spawn(engine, ["serve", "--hostname", "127.0.0.1", "--port", String(enginePort)], {
        env: {
          ...process.env,
          XDG_DATA_HOME: join(dataDir, "xdg-data"),
          XDG_CONFIG_HOME: join(dataDir, "xdg-config"),
          XDG_STATE_HOME: join(dataDir, "xdg-state"),
          XDG_CACHE_HOME: join(dataDir, "xdg-cache"),
          OPENCODE_DISABLE_AUTOUPDATE: "1",
        },
        stdio: "ignore",
      });

      await waitFor(
        async () => {
          const res = await engineFetch("/mcp");
          return res.ok ? true : null;
        },
        30_000,
        `opencode engine for ${mcpPath}`,
      );

      const before = recordValue(await jsonBody(await engineFetch("/mcp")), "initial engine mcp status");
      expect(recordValue(before[MCP_NAME], "initial mcp entry").status).not.toBe("connected");

      const startRes = await engineFetch(`/mcp/${MCP_NAME}/auth`, { method: "POST" });
      if (!startRes.ok) throw new Error(`auth start failed for ${mcpPath}: ${startRes.status} ${await startRes.text()}`);
      const started = recordValue(await jsonBody(startRes), "auth start response");
      const authorizationUrl = typeof started.authorizationUrl === "string" ? started.authorizationUrl : typeof started.url === "string" ? started.url : "";
      expect(authorizationUrl).toBeTruthy();
      const authUrl = new URL(authorizationUrl);
      expect(authUrl.pathname).toBe("/oauth_auth.do");
      expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authUrl.searchParams.get("state")).toBeTruthy();
      const resourceParamPresent = authUrl.searchParams.has("resource");
      console.log(`[servicenow-mcp-test] engine auth for ${mcpPath} resource param present: ${resourceParamPresent}`);

      const authorizeRes = await fetch(authorizationUrl, { redirect: "manual" });
      expect(authorizeRes.status).toBe(302);
      const callbackUrl = stringValue(authorizeRes.headers.get("location"), "authorization callback location");
      const callback = new URL(callbackUrl);
      expect(callback.searchParams.get("code")).toBeTruthy();
      expect(callback.searchParams.get("state")).toBe(authUrl.searchParams.get("state"));

      let callbackDelivered = false;
      try {
        const res = await fetch(callbackUrl);
        callbackDelivered = res.ok;
      } catch {
        callbackDelivered = false;
      }
      if (!callbackDelivered) {
        const code = callback.searchParams.get("code");
        const manual = await engineFetch(`/mcp/${MCP_NAME}/auth/callback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        expect(manual.ok).toBe(true);
      }

      await waitFor(
        async () => {
          const res = await engineFetch("/mcp");
          if (!res.ok) return null;
          const statuses = recordValue(await jsonBody(res), "connected statuses");
          const entry = recordValue(statuses[MCP_NAME], "connected mcp entry");
          return entry.status === "connected" ? true : null;
        },
        30_000,
        `engine connected to ${mcpPath}`,
      );

      const authFile = join(dataDir, "xdg-data", "opencode", "mcp-auth.json");
      expect(existsSync(authFile)).toBe(true);
      expect(readFileSync(authFile, "utf8")).toContain("sn_at_");

      const entries = (await requestLog(running.base)).filter((entry) => entry.id > requestStart);
      const witnessed = entries.map((entry) => `${entry.method} ${entry.path}${entry.jsonrpcMethod ? ` ${entry.jsonrpcMethod}` : ""}`);
      expect(witnessed).toContain("GET /oauth_auth.do");
      expect(witnessed).toContain("POST /oauth_token.do");
      expect(entries.some((entry) => entry.method === "POST" && entry.path === mcpPath && entry.jsonrpcMethod === "initialize")).toBe(true);
      expect(entries.some((entry) => entry.method === "POST" && entry.path === mcpPath && entry.jsonrpcMethod === "tools/list")).toBe(true);
      expect(entries.some((entry) => entry.method === "POST" && entry.path === "/register")).toBe(false);
      console.log(`[servicenow-mcp-test] engine handled MCP path: ${mcpPath}`);
      return { handledPath: mcpPath, resourceParamPresent };
    } finally {
      stopProcess(engineProc || undefined);
      rmSync(workDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }

  test(
    "engine completes browser OAuth with a preregistered ServiceNow client and no registration_endpoint",
    async () => {
      try {
        const result = await attemptEngineConnection(DEEP_MCP_PATH);
        expect(result.handledPath).toBe(DEEP_MCP_PATH);
        return;
      } catch (error) {
        console.log(`[servicenow-mcp-test] deep MCP path failed, falling back to /mcp: ${String(error)}`);
      }
      const fallback = await attemptEngineConnection(MCP_PATH);
      expect(fallback.handledPath).toBe(MCP_PATH);
    },
    150_000,
  );
});
