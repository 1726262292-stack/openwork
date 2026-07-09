#!/usr/bin/env node
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3979);
const issuer = (process.env.ISSUER || `http://${host}:${port}`).replace(/\/+$/, "");
const autoApprove = process.env.AUTO_APPROVE !== "0";
const tokenTtlSeconds = Number(process.env.TOKEN_TTL_SECONDS || 1800);
const refreshTtlSeconds = Number(process.env.REFRESH_TTL_SECONDS || 8640000);

const MCP_PATHS = ["/mcp", "/sncapps/mcp-server/mcp/sn_openwork_it"];
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SCOPES = ["incidents.read", "incidents.write"];
const canonicalResource = `${issuer}/mcp`;
const resourceAudiences = new Set(MCP_PATHS.map((path) => `${issuer}${path}`));

const clients = new Map([
  [
    "acme-desktop-client",
    {
      clientId: "acme-desktop-client",
      clientSecret: "acme-oauth-secret-98765",
      name: "OpenWork Desktop",
      scopes: SCOPES,
      redirectUris: [],
    },
  ],
]);

const authorizationCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const mcpSessions = new Set();
const requests = [];
const incidents = [];
const incidentJournal = new Map();
let nextIncidentSequence = 10001;

const users = [
  { sys_id: "10000000000000000000000000000001", user_name: "abel.tuter", name: "Abel Tuter", email: "abel.tuter@acme.test" },
  { sys_id: "10000000000000000000000000000002", user_name: "beth.anglin", name: "Beth Anglin", email: "beth.anglin@acme.test" },
  { sys_id: "10000000000000000000000000000003", user_name: "alex.owner", name: "Alex Owner", email: "alex@acme.test" },
  { sys_id: "10000000000000000000000000000004", user_name: "rashmi.member", name: "Rashmi Member", email: "rashmi@acme.test" },
];

const groups = [
  { sys_id: "20000000000000000000000000000001", name: "Service Desk" },
  { sys_id: "20000000000000000000000000000002", name: "Hardware" },
  { sys_id: "20000000000000000000000000000003", name: "Network" },
];

const stateLabels = {
  1: "New",
  2: "In Progress",
  3: "On Hold",
  6: "Resolved",
  7: "Closed",
};

const priorityLabels = {
  1: "Critical",
  2: "High",
  3: "Moderate",
  4: "Low",
  5: "Planning",
};

const closeCodes = [
  "Solved (Work Around)",
  "Solved (Permanently)",
  "Solved Remotely (Work Around)",
  "Solved Remotely (Permanently)",
  "Not Solved (Not Reproducible)",
  "Not Solved (Too Costly)",
];

function baseHeaders(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "Mcp-Session-Id, X-Total-Count, WWW-Authenticate",
    ...headers,
  };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, baseHeaders({ "content-type": "application/json", ...headers }));
  res.end(JSON.stringify(body));
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, baseHeaders({ "content-type": "text/html; charset=utf-8", ...headers }));
  res.end(body);
}

function empty(res, status, headers = {}) {
  res.writeHead(status, baseHeaders(headers));
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function readForm(req) {
  const raw = await readBody(req);
  return Object.fromEntries(new URLSearchParams(raw));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function randomToken(prefix) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function serviceNowTime(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function incidentNumber(sequence) {
  return `INC${String(sequence).padStart(7, "0")}`;
}

function standardPriority(impact, urgency) {
  const matrix = {
    "1:1": 1,
    "1:2": 2,
    "1:3": 3,
    "2:1": 2,
    "2:2": 3,
    "2:3": 4,
    "3:1": 3,
    "3:2": 4,
    "3:3": 5,
  };
  return matrix[`${impact}:${urgency}`] || 5;
}

function integerIn(value, allowed, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && allowed.includes(parsed)) return parsed;
  return fallback;
}

function seedSysId(index) {
  return String(index).padStart(32, "0");
}

function appendJournal(sysId, type, value, author = "system") {
  if (!value) return null;
  const entries = incidentJournal.get(sysId) || [];
  const entry = { type, value: String(value), author, timestamp: serviceNowTime() };
  entries.push(entry);
  incidentJournal.set(sysId, entries);
  return entry;
}

function incidentView(incident, includeJournal = false) {
  const result = { ...incident };
  if (includeJournal) result.journal = [...(incidentJournal.get(incident.sys_id) || [])];
  return result;
}

function applyFields(record, fieldsParam) {
  if (!fieldsParam) return record;
  const fields = String(fieldsParam)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) return record;
  const filtered = {};
  for (const field of fields) {
    if (Object.hasOwn(record, field)) filtered[field] = record[field];
  }
  return filtered;
}

function createIncident(fields, options = {}) {
  const now = options.now || serviceNowTime();
  const impact = integerIn(fields.impact ?? 3, [1, 2, 3], 3);
  const urgency = integerIn(fields.urgency ?? 3, [1, 2, 3], 3);
  const priority = integerIn(fields.priority ?? standardPriority(impact, urgency), [1, 2, 3, 4, 5], standardPriority(impact, urgency));
  const state = integerIn(fields.state ?? 1, [1, 2, 3, 6, 7], 1);
  const sysId = fields.sys_id || randomBytes(16).toString("hex");
  const incident = {
    sys_id: sysId,
    number: fields.number || incidentNumber(nextIncidentSequence++),
    short_description: String(fields.short_description || ""),
    description: String(fields.description || ""),
    state,
    impact,
    urgency,
    priority,
    category: String(fields.category || "inquiry"),
    subcategory: String(fields.subcategory || "general"),
    assignment_group: String(fields.assignment_group || "Service Desk"),
    assigned_to: String(fields.assigned_to || ""),
    caller_id: String(fields.caller_id || "abel.tuter"),
    opened_at: fields.opened_at || now,
    resolved_at: fields.resolved_at || "",
    close_code: fields.close_code || "",
    close_notes: fields.close_notes || "",
    sys_created_on: fields.sys_created_on || now,
    sys_updated_on: fields.sys_updated_on || now,
  };
  incidents.push(incident);
  incidentJournal.set(sysId, []);
  for (const note of fields.journal || []) appendJournal(sysId, note.type, note.value, note.author);
  return incident;
}

function updateIncident(incident, updates, author = "api.user") {
  const changedPriorityInput = Object.hasOwn(updates, "priority");
  const allowedFields = [
    "short_description",
    "description",
    "state",
    "impact",
    "urgency",
    "priority",
    "category",
    "subcategory",
    "assignment_group",
    "assigned_to",
    "caller_id",
    "close_code",
    "close_notes",
    "resolved_at",
  ];
  for (const field of allowedFields) {
    if (!Object.hasOwn(updates, field)) continue;
    if (["state", "impact", "urgency", "priority"].includes(field)) {
      const bounds = field === "priority" ? [1, 2, 3, 4, 5] : field === "state" ? [1, 2, 3, 6, 7] : [1, 2, 3];
      incident[field] = integerIn(updates[field], bounds, incident[field]);
    } else {
      incident[field] = String(updates[field] ?? "");
    }
  }
  if ((Object.hasOwn(updates, "impact") || Object.hasOwn(updates, "urgency")) && !changedPriorityInput) {
    incident.priority = standardPriority(incident.impact, incident.urgency);
  }
  if (Object.hasOwn(updates, "comments")) appendJournal(incident.sys_id, "comments", updates.comments, author);
  if (Object.hasOwn(updates, "work_notes")) appendJournal(incident.sys_id, "work_notes", updates.work_notes, author);
  if (incident.state === 6 && !incident.resolved_at) incident.resolved_at = serviceNowTime();
  incident.sys_updated_on = serviceNowTime();
  return incident;
}

function seedData() {
  const seed = [
    {
      short_description: "Email delivery delayed for finance approvals",
      description: "Finance users report approval notifications arriving 30 minutes late after the mail relay upgrade.",
      state: 2,
      impact: 2,
      urgency: 2,
      category: "software",
      subcategory: "email",
      assignment_group: "Service Desk",
      assigned_to: "beth.anglin",
      caller_id: "alex.owner",
      opened_at: "2026-07-08 08:15:00",
      sys_created_on: "2026-07-08 08:15:00",
      sys_updated_on: "2026-07-08 09:05:00",
      journal: [{ type: "work_notes", value: "Checked Exchange queue depth; messages are draining slowly.", author: "beth.anglin" }],
    },
    {
      short_description: "VPN disconnects every five minutes from home Wi-Fi",
      description: "Several field engineers cannot keep the VPN tunnel active during customer escalations.",
      state: 1,
      impact: 1,
      urgency: 2,
      category: "network",
      subcategory: "vpn",
      assignment_group: "Network",
      assigned_to: "",
      caller_id: "rashmi.member",
      opened_at: "2026-07-08 07:40:00",
      sys_created_on: "2026-07-08 07:40:00",
      sys_updated_on: "2026-07-08 07:40:00",
      journal: [{ type: "comments", value: "I can reproduce on two laptops and a hotspot.", author: "rashmi.member" }],
    },
    {
      short_description: "Laptop battery swollen on assembly line kiosk",
      description: "Kiosk ACME-KIOSK-14 has a visibly swollen battery and must be removed from service.",
      state: 3,
      impact: 2,
      urgency: 1,
      priority: 2,
      category: "hardware",
      subcategory: "laptop",
      assignment_group: "Hardware",
      assigned_to: "abel.tuter",
      caller_id: "beth.anglin",
      opened_at: "2026-07-07 16:10:00",
      sys_created_on: "2026-07-07 16:10:00",
      sys_updated_on: "2026-07-07 17:22:00",
      journal: [{ type: "work_notes", value: "Put device in safety bag; waiting for replacement parts.", author: "abel.tuter" }],
    },
    {
      short_description: "Badge reader offline at south entrance",
      description: "Employees are tailgating because the south entrance badge reader is not accepting scans.",
      state: 2,
      impact: 2,
      urgency: 2,
      category: "hardware",
      subcategory: "facilities",
      assignment_group: "Hardware",
      assigned_to: "abel.tuter",
      caller_id: "alex.owner",
      opened_at: "2026-07-07 12:35:00",
      sys_created_on: "2026-07-07 12:35:00",
      sys_updated_on: "2026-07-07 13:20:00",
      journal: [{ type: "comments", value: "Security guard is posted until the reader is back online.", author: "alex.owner" }],
    },
    {
      short_description: "Printer queue stuck for shipping labels",
      description: "Shipping cannot print carrier labels from workstation SHIP-03.",
      state: 6,
      impact: 3,
      urgency: 2,
      category: "hardware",
      subcategory: "printer",
      assignment_group: "Service Desk",
      assigned_to: "beth.anglin",
      caller_id: "abel.tuter",
      opened_at: "2026-07-06 10:12:00",
      resolved_at: "2026-07-06 11:02:00",
      close_code: "Solved Remotely (Permanently)",
      close_notes: "Cleared stuck spooler job and reinstalled the Zebra driver.",
      sys_created_on: "2026-07-06 10:12:00",
      sys_updated_on: "2026-07-06 11:02:00",
      journal: [{ type: "work_notes", value: "Remote driver reinstall completed successfully.", author: "beth.anglin" }],
    },
    {
      short_description: "Robot telemetry dashboard returns 502",
      description: "Operations dashboard for robot telemetry intermittently returns 502 from the internal reverse proxy.",
      state: 1,
      impact: 1,
      urgency: 1,
      category: "software",
      subcategory: "monitoring",
      assignment_group: "Network",
      assigned_to: "",
      caller_id: "alex.owner",
      opened_at: "2026-07-08 09:55:00",
      sys_created_on: "2026-07-08 09:55:00",
      sys_updated_on: "2026-07-08 09:55:00",
      journal: [{ type: "comments", value: "This blocks the morning operations standup.", author: "alex.owner" }],
    },
    {
      short_description: "New hire cannot access CAD license server",
      description: "A new mechanical engineer receives license checkout denied when launching CAD tooling.",
      state: 7,
      impact: 3,
      urgency: 3,
      category: "software",
      subcategory: "license",
      assignment_group: "Service Desk",
      assigned_to: "beth.anglin",
      caller_id: "rashmi.member",
      opened_at: "2026-07-05 14:05:00",
      resolved_at: "2026-07-05 15:45:00",
      close_code: "Solved (Permanently)",
      close_notes: "Added user to the CAD license group and verified checkout.",
      sys_created_on: "2026-07-05 14:05:00",
      sys_updated_on: "2026-07-05 15:50:00",
      journal: [{ type: "comments", value: "Confirmed access works. Thank you!", author: "rashmi.member" }],
    },
    {
      short_description: "Conference room camera not detected",
      description: "Room Cortex-2 cannot detect the USB camera after the firmware update.",
      state: 1,
      impact: 3,
      urgency: 2,
      category: "hardware",
      subcategory: "conference room",
      assignment_group: "Hardware",
      assigned_to: "",
      caller_id: "abel.tuter",
      opened_at: "2026-07-08 06:30:00",
      sys_created_on: "2026-07-08 06:30:00",
      sys_updated_on: "2026-07-08 06:30:00",
      journal: [{ type: "work_notes", value: "Firmware rollback package staged.", author: "system" }],
    },
  ];

  seed.forEach((item, index) => {
    createIncident({ ...item, sys_id: seedSysId(index + 1), number: incidentNumber(nextIncidentSequence++) });
  });
}

function isMcpPath(pathname) {
  const normalized = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return MCP_PATHS.includes(normalized) ? normalized : null;
}

function protectedResourceMetadata(resource = canonicalResource) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "ServiceNow (Acme Robotics IT)",
  };
}

function authorizationServerMetadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth_auth.do`,
    token_endpoint: `${issuer}/oauth_token.do`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: SCOPES,
  };
}

function wellKnownMatches(pathname, kind) {
  const root = `/.well-known/${kind}`;
  if (pathname === root) return true;
  for (const mcpPath of MCP_PATHS) {
    if (pathname === `${root}${mcpPath}`) return true;
    if (pathname === `${mcpPath}/.well-known/${kind}`) return true;
  }
  return false;
}

function protectedResourceMcpPath(pathname) {
  const root = "/.well-known/oauth-protected-resource";
  if (pathname === root) return "/mcp";
  for (const mcpPath of MCP_PATHS) {
    if (pathname === `${root}${mcpPath}`) return mcpPath;
    if (pathname === `${mcpPath}/.well-known/oauth-protected-resource`) return mcpPath;
  }
  return null;
}

function basicClient(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return { clientId: decoded, clientSecret: "" };
  return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
}

function oauthError(res, status, error, description, headers = {}) {
  json(res, status, { error, ...(description ? { error_description: description } : {}) }, headers);
}

function redirectOauthError(res, redirectUri, state, error, description) {
  const callback = new URL(redirectUri);
  callback.searchParams.set("error", error);
  if (description) callback.searchParams.set("error_description", description);
  if (state) callback.searchParams.set("state", state);
  res.writeHead(302, baseHeaders({ location: callback.toString() }));
  res.end();
}

function parseScopes(scopeValue, client) {
  const requested = String(scopeValue || "").trim();
  const scopes = requested ? requested.split(/\s+/).filter(Boolean) : client.scopes;
  const invalid = scopes.filter((scope) => !client.scopes.includes(scope));
  if (invalid.length > 0) return { ok: false, scopes, invalid };
  return { ok: true, scopes: [...new Set(scopes)] };
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isAllowedRedirectUri(value, client) {
  if (client.redirectUris.includes(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function issueAuthorizationCode(res, params) {
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state") || "";
  if (!redirectUri) {
    oauthError(res, 400, "invalid_request", "redirect_uri is required");
    return;
  }

  const client = clients.get(params.get("client_id") || "");
  if (!client) {
    oauthError(res, 400, "invalid_client", "client_id is not registered in this ServiceNow instance");
    return;
  }
  if (!isAllowedRedirectUri(redirectUri, client)) {
    oauthError(res, 400, "invalid_request", "redirect_uri is not registered for this client");
    return;
  }
  if (!params.get("code_challenge")) {
    redirectOauthError(res, redirectUri, state, "invalid_request", "PKCE code_challenge is required");
    return;
  }
  if (params.get("code_challenge_method") !== "S256") {
    redirectOauthError(res, redirectUri, state, "invalid_request", "OAuth 2.1 requires code_challenge_method=S256");
    return;
  }
  const scopeResult = parseScopes(params.get("scope"), client);
  if (!scopeResult.ok) {
    redirectOauthError(res, redirectUri, state, "invalid_scope", `Client is not allowed to request ${scopeResult.invalid.join(" ")}`);
    return;
  }

  const code = randomToken("sn_code");
  authorizationCodes.set(code, {
    clientId: client.clientId,
    codeChallenge: params.get("code_challenge"),
    redirectUri,
    state,
    scope: scopeResult.scopes,
    resource: params.get("resource") || canonicalResource,
    expiresAt: Date.now() + 5 * 60 * 1000,
    used: false,
  });

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  if (state) callback.searchParams.set("state", state);
  res.writeHead(302, baseHeaders({ location: callback.toString() }));
  res.end();
}

function authorize(req, res, url) {
  const params = url.searchParams;
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri) {
    oauthError(res, 400, "invalid_request", "redirect_uri is required");
    return;
  }
  if (params.get("response_type") && params.get("response_type") !== "code") {
    redirectOauthError(res, redirectUri, params.get("state") || "", "invalid_request", "response_type must be code");
    return;
  }
  const client = clients.get(params.get("client_id") || "");
  if (!client) {
    oauthError(res, 400, "invalid_client", "client_id is not registered in this ServiceNow instance");
    return;
  }

  if (autoApprove && params.get("force_consent") !== "1") {
    issueAuthorizationCode(res, params);
    return;
  }

  const requestedScopes = (params.get("scope") || client.scopes.join(" ")).split(/\s+/).filter(Boolean);
  const hidden = [...params]
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n");
  html(res, 200, `<!doctype html>
<html>
  <head><title>ServiceNow — Acme Robotics IT</title></head>
  <body style="font-family: Arial, sans-serif; background: #f4f6f8; color: #1f2a33;">
    <main style="max-width: 640px; margin: 56px auto; padding: 32px; background: white; border-radius: 12px; box-shadow: 0 2px 18px rgba(0,0,0,.12);">
      <h1>ServiceNow — Acme Robotics IT</h1>
      <p><strong>${escapeHtml(client.name)}</strong> is requesting access to this ServiceNow developer instance.</p>
      <h2>Requested scopes</h2>
      <ul>${requestedScopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("")}</ul>
      <form method="post" action="/oauth_approve">
        ${hidden}
        <button style="font: inherit; padding: 10px 16px; background: #2e7d32; color: white; border: 0; border-radius: 6px;">Allow</button>
      </form>
    </main>
  </body>
</html>`);
}

async function approve(req, res) {
  const form = await readForm(req);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) params.set(key, value);
  issueAuthorizationCode(res, params);
}

function clientForTokenRequest(req, form, expectedClientId) {
  const basic = basicClient(req);
  const formHasSecret = Object.hasOwn(form, "client_secret");
  const clientId = basic?.clientId || form.client_id || expectedClientId || "";
  const client = clients.get(clientId);
  if (!client) {
    return { error: "invalid_client", description: "Unknown OAuth client", basicFailure: Boolean(basic) };
  }
  if (expectedClientId && client.clientId !== expectedClientId) {
    return { error: "invalid_grant", description: "Authorization code was issued to a different client" };
  }
  const suppliedSecret = basic ? basic.clientSecret : formHasSecret ? form.client_secret : undefined;
  if (suppliedSecret !== undefined && suppliedSecret !== client.clientSecret) {
    return { error: "invalid_client", description: "OAuth client secret is invalid", basicFailure: Boolean(basic) };
  }
  return { client };
}

function sendTokenClientError(res, result) {
  const headers = result.basicFailure ? { "www-authenticate": 'Basic realm="ServiceNow"' } : {};
  oauthError(res, result.error === "invalid_client" ? 401 : 400, result.error, result.description, headers);
}

function issueTokenPair(clientId, scopes, audience, existingRefreshToken = "") {
  const accessToken = randomToken("sn_at");
  const now = Date.now();
  accessTokens.set(accessToken, {
    clientId,
    scopes,
    audience,
    expiresAt: now + tokenTtlSeconds * 1000,
  });
  const refreshToken = existingRefreshToken || randomToken("sn_rt");
  if (!existingRefreshToken) {
    refreshTokens.set(refreshToken, {
      clientId,
      scopes,
      audience,
      expiresAt: now + refreshTtlSeconds * 1000,
    });
  }
  return { accessToken, refreshToken };
}

async function issueToken(req, res) {
  const form = await readForm(req);
  const grantType = form.grant_type || "authorization_code";

  if (grantType === "authorization_code") {
    const grant = authorizationCodes.get(form.code || "");
    if (!grant || grant.used || grant.expiresAt < Date.now()) {
      oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used");
      return;
    }
    const clientResult = clientForTokenRequest(req, form, grant.clientId);
    if (!clientResult.client) {
      sendTokenClientError(res, clientResult);
      return;
    }
    if (form.redirect_uri !== grant.redirectUri) {
      oauthError(res, 400, "invalid_grant", "redirect_uri does not match the authorization request");
      return;
    }
    if (form.resource && form.resource !== grant.resource) {
      oauthError(res, 400, "invalid_grant", "resource does not match the authorization request");
      return;
    }
    const expectedChallenge = createHash("sha256").update(form.code_verifier || "").digest("base64url");
    if (!form.code_verifier || expectedChallenge !== grant.codeChallenge) {
      oauthError(res, 400, "invalid_grant", "PKCE verification failed");
      return;
    }
    grant.used = true;
    authorizationCodes.delete(form.code);
    const pair = issueTokenPair(grant.clientId, grant.scope, grant.resource);
    json(res, 200, {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "Bearer",
      expires_in: tokenTtlSeconds,
      scope: grant.scope.join(" "),
    });
    return;
  }

  if (grantType === "refresh_token") {
    const refresh = refreshTokens.get(form.refresh_token || "");
    if (!refresh || refresh.expiresAt < Date.now()) {
      oauthError(res, 400, "invalid_grant", "Refresh token is invalid or expired");
      return;
    }
    const clientResult = clientForTokenRequest(req, form, refresh.clientId);
    if (!clientResult.client) {
      sendTokenClientError(res, clientResult);
      return;
    }
    if (form.resource && form.resource !== refresh.audience) {
      oauthError(res, 400, "invalid_grant", "resource does not match the refresh token audience");
      return;
    }
    let scopes = refresh.scopes;
    if (form.scope) {
      const requested = form.scope.split(/\s+/).filter(Boolean);
      const invalid = requested.filter((scope) => !refresh.scopes.includes(scope));
      if (invalid.length > 0) {
        oauthError(res, 400, "invalid_scope", `Refresh token cannot be expanded to ${invalid.join(" ")}`);
        return;
      }
      scopes = requested;
    }
    const pair = issueTokenPair(refresh.clientId, scopes, refresh.audience, form.refresh_token);
    json(res, 200, {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "Bearer",
      expires_in: tokenTtlSeconds,
      scope: scopes.join(" "),
    });
    return;
  }

  oauthError(res, 400, "unsupported_grant_type", `Unsupported grant_type ${grantType}`);
}

function normalizeResourceAudience(value) {
  return String(value || "").replace(/\/+$/, "");
}

function bearerFailureHeader(description, mcpPath = "") {
  const resourceMetadata = mcpPath
    ? `${issuer}/.well-known/oauth-protected-resource${mcpPath}`
    : `${issuer}/.well-known/oauth-protected-resource`;
  const error = description ? `, error="invalid_token", error_description="${description.replaceAll('"', "'")}"` : "";
  return `Bearer resource_metadata="${resourceMetadata}"${error}`;
}

function serviceNowAuthEnvelope(message = "User Not Authenticated", detail = "Required to provide Auth information") {
  return { error: { message, detail }, status: "failure" };
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, missing: true, description: "Bearer token is required" };
  const token = accessTokens.get(match[1]);
  if (!token) return { ok: false, description: "Access token is not recognized" };
  if (token.expiresAt < Date.now()) return { ok: false, description: "Access token is expired" };
  if (!resourceAudiences.has(normalizeResourceAudience(token.audience))) return { ok: false, description: "Access token audience does not match this ServiceNow MCP resource" };
  return { ok: true, token };
}

function rejectProtected(res, validation, serviceNowEnvelope = false, mcpPath = "") {
  const headers = { "www-authenticate": bearerFailureHeader(validation.missing ? "" : validation.description, mcpPath) };
  const body = serviceNowEnvelope
    ? serviceNowAuthEnvelope("User Not Authenticated", validation.missing ? "Required to provide Auth information" : validation.description)
    : { error: validation.missing ? "missing_token" : "invalid_token", error_description: validation.description };
  json(res, 401, body, headers);
}

function requireProtected(req, res, requiredScope, serviceNowEnvelope = false, mcpPath = "") {
  const validation = tokenFromRequest(req);
  if (!validation.ok) {
    rejectProtected(res, validation, serviceNowEnvelope, mcpPath);
    return null;
  }
  if (requiredScope && !validation.token.scopes.includes(requiredScope)) {
    json(res, 403, serviceNowAuthEnvelope("Insufficient scope", `Required OAuth scope ${requiredScope}`));
    return null;
  }
  return validation.token;
}

function matchesCondition(record, condition) {
  if (!condition || condition.startsWith("ORDERBY")) return true;
  const likeIndex = condition.indexOf("LIKE");
  if (likeIndex > 0) {
    const field = condition.slice(0, likeIndex);
    const value = condition.slice(likeIndex + 4).toLowerCase();
    return String(record[field] ?? "").toLowerCase().includes(value);
  }
  const inIndex = condition.indexOf("IN");
  if (inIndex > 0) {
    const field = condition.slice(0, inIndex);
    const values = condition.slice(inIndex + 2).split(",").map((value) => value.trim());
    return values.includes(String(record[field] ?? ""));
  }
  const notEqualsIndex = condition.indexOf("!=");
  if (notEqualsIndex > 0) {
    const field = condition.slice(0, notEqualsIndex);
    const value = condition.slice(notEqualsIndex + 2);
    return String(record[field] ?? "") !== value;
  }
  const equalsIndex = condition.indexOf("=");
  if (equalsIndex > 0) {
    const field = condition.slice(0, equalsIndex);
    const value = condition.slice(equalsIndex + 1);
    return String(record[field] ?? "") === value;
  }
  return true;
}

function queryIncidents(searchParams) {
  const query = searchParams.get("sysparm_query") || "";
  const parts = query.split("^").filter(Boolean);
  const orderPart = parts.find((part) => part.startsWith("ORDERBY"));
  let result = incidents.filter((incident) => parts.every((part) => matchesCondition(incident, part)));
  if (orderPart) {
    const descending = orderPart.startsWith("ORDERBYDESC");
    const field = descending ? orderPart.slice("ORDERBYDESC".length) : orderPart.slice("ORDERBY".length);
    result = [...result].sort((left, right) => {
      const a = String(left[field] ?? "");
      const b = String(right[field] ?? "");
      return descending ? b.localeCompare(a) : a.localeCompare(b);
    });
  }
  const total = result.length;
  const limit = Math.max(0, Number(searchParams.get("sysparm_limit") || 10));
  const offset = Math.max(0, Number(searchParams.get("sysparm_offset") || 0));
  return { total, rows: result.slice(offset, offset + limit) };
}

function findIncident(identifier) {
  if (!identifier) return null;
  return incidents.find((incident) => incident.sys_id === identifier || incident.number.toLowerCase() === String(identifier).toLowerCase()) || null;
}

async function handleIncidentList(req, res, url) {
  if (req.method === "GET") {
    const token = requireProtected(req, res, "incidents.read", true);
    if (!token) return;
    const { total, rows } = queryIncidents(url.searchParams);
    const result = rows.map((incident) => applyFields(incidentView(incident), url.searchParams.get("sysparm_fields")));
    json(res, 200, { result }, { "x-total-count": String(total) });
    return;
  }

  if (req.method === "POST") {
    const token = requireProtected(req, res, "incidents.write", true);
    if (!token) return;
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object" || !body.short_description) {
      json(res, 400, serviceNowAuthEnvelope("Invalid request", "short_description is required"));
      return;
    }
    const incident = createIncident(body);
    json(res, 201, { result: incidentView(incident, true) });
    return;
  }

  json(res, 405, { error: "method_not_allowed" });
}

async function handleIncidentRecord(req, res, sysId) {
  if (req.method === "GET") {
    const token = requireProtected(req, res, "incidents.read", true);
    if (!token) return;
    const incident = incidents.find((item) => item.sys_id === sysId);
    if (!incident) {
      json(res, 404, serviceNowAuthEnvelope("No Record found", `Incident ${sysId} was not found`));
      return;
    }
    json(res, 200, { result: incidentView(incident, true) });
    return;
  }

  if (req.method === "PATCH") {
    const token = requireProtected(req, res, "incidents.write", true);
    if (!token) return;
    const incident = incidents.find((item) => item.sys_id === sysId);
    if (!incident) {
      json(res, 404, serviceNowAuthEnvelope("No Record found", `Incident ${sysId} was not found`));
      return;
    }
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      json(res, 400, serviceNowAuthEnvelope("Invalid request", "PATCH body must be a JSON object"));
      return;
    }
    updateIncident(incident, body);
    json(res, 200, { result: incidentView(incident, true) });
    return;
  }

  json(res, 405, { error: "method_not_allowed" });
}

function isAllowedOriginHeader(origin) {
  if (!origin || origin === "null") return true;
  try {
    const parsed = new URL(origin);
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function jsonRpcError(id, code, message, status = 200) {
  return { status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

function jsonRpcResult(id, result, headers = {}) {
  return { status: 200, body: { jsonrpc: "2.0", id, result }, headers };
}

function parseJsonRpcMethod(raw) {
  try {
    const body = JSON.parse(raw || "{}");
    if (Array.isArray(body)) return "batch";
    if (body && typeof body === "object" && typeof body.method === "string") return body.method;
  } catch {}
  return undefined;
}

function toolSchemas() {
  const identifierProperties = {
    number: { type: "string", pattern: "^INC[0-9]{7}$", description: "ServiceNow incident number, for example INC0010001." },
    sys_id: { type: "string", pattern: "^[0-9a-f]{32}$", description: "ServiceNow sys_id for the incident." },
  };
  const incidentSummary = {
    type: "object",
    properties: {
      sys_id: { type: "string" },
      number: { type: "string" },
      short_description: { type: "string" },
      state: { type: "integer" },
      state_label: { type: "string" },
      priority: { type: "integer" },
      priority_label: { type: "string" },
      assignment_group: { type: "string" },
      assigned_to: { type: "string" },
      link: { type: "string" },
    },
    required: ["sys_id", "number", "short_description", "state", "state_label", "priority", "priority_label", "link"],
  };
  const fullIncident = {
    type: "object",
    properties: {
      incident: { type: "object" },
    },
    required: ["incident"],
  };
  return [
    {
      name: "search_incidents",
      title: "Search Incidents",
      description: "Use this ServiceNow Incident tool when you need to find one or more incidents by number, description, state, priority, assignment group, or assignee. It returns concise incident summaries with ServiceNow deep links.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text matched with LIKE against number, short_description, and description." },
          state: { type: "integer", enum: [1, 2, 3, 6, 7] },
          priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
          assignment_group: { type: "string", enum: groups.map((group) => group.name) },
          assigned_to: { type: "string", enum: users.map((user) => user.user_name) },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          offset: { type: "integer", minimum: 0, default: 0 },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "integer" },
          incidents: { type: "array", items: incidentSummary },
        },
        required: ["count", "incidents"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get_incident",
      title: "Get Incident",
      description: "Use this ServiceNow Incident tool when you know an incident number or sys_id and need the full record, including comments and work notes journal entries.",
      inputSchema: { type: "object", properties: identifierProperties, anyOf: [{ required: ["number"] }, { required: ["sys_id"] }] },
      outputSchema: fullIncident,
      annotations: { readOnlyHint: true },
    },
    {
      name: "create_incident",
      title: "Create Incident",
      description: "Use this ServiceNow Incident tool to open a new incident when a user reports an outage, access issue, hardware problem, or other IT service interruption. It returns the created incident and link.",
      inputSchema: {
        type: "object",
        properties: {
          short_description: { type: "string" },
          description: { type: "string" },
          caller_id: { type: "string", enum: users.map((user) => user.user_name) },
          category: { type: "string" },
          subcategory: { type: "string" },
          impact: { type: "integer", minimum: 1, maximum: 3, enum: [1, 2, 3] },
          urgency: { type: "integer", minimum: 1, maximum: 3, enum: [1, 2, 3] },
          priority: { type: "integer", minimum: 1, maximum: 5, enum: [1, 2, 3, 4, 5] },
          assignment_group: { type: "string", enum: groups.map((group) => group.name) },
        },
        required: ["short_description"],
      },
      outputSchema: fullIncident,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "update_incident",
      title: "Update Incident",
      description: "Use this ServiceNow Incident tool to update editable incident fields such as state, priority, assignment, category, or description while preserving the incident number and audit trail.",
      inputSchema: {
        type: "object",
        properties: {
          ...identifierProperties,
          short_description: { type: "string" },
          description: { type: "string" },
          state: { type: "integer", minimum: 1, maximum: 7, enum: [1, 2, 3, 6, 7] },
          impact: { type: "integer", minimum: 1, maximum: 3, enum: [1, 2, 3] },
          urgency: { type: "integer", minimum: 1, maximum: 3, enum: [1, 2, 3] },
          priority: { type: "integer", minimum: 1, maximum: 5, enum: [1, 2, 3, 4, 5] },
          category: { type: "string" },
          subcategory: { type: "string" },
          assignment_group: { type: "string", enum: groups.map((group) => group.name) },
          assigned_to: { type: "string", enum: users.map((user) => user.user_name) },
        },
        anyOf: [{ required: ["number"] }, { required: ["sys_id"] }],
      },
      outputSchema: fullIncident,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    {
      name: "add_comment",
      title: "Add Comment or Work Note",
      description: "Use this ServiceNow Incident tool to add a customer-visible comment or an internal work note to an incident journal without changing the main record fields.",
      inputSchema: {
        type: "object",
        properties: { ...identifierProperties, comment: { type: "string" }, work_note: { type: "boolean", default: false } },
        required: ["comment"],
        anyOf: [{ required: ["number"] }, { required: ["sys_id"] }],
      },
      outputSchema: {
        type: "object",
        properties: { incident: { type: "object" }, journalEntry: { type: "object" } },
        required: ["incident", "journalEntry"],
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    {
      name: "resolve_incident",
      title: "Resolve Incident",
      description: "Use this ServiceNow Incident tool when the restoration work is complete and the incident should move to Resolved with a close code and close notes for auditability.",
      inputSchema: {
        type: "object",
        properties: { ...identifierProperties, close_code: { type: "string", enum: closeCodes }, close_notes: { type: "string" } },
        required: ["close_code", "close_notes"],
        anyOf: [{ required: ["number"] }, { required: ["sys_id"] }],
      },
      outputSchema: fullIncident,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
  ];
}

const tools = toolSchemas();

function incidentLink(incident) {
  return `${issuer}/nav_to.do?uri=incident.do%3Fsys_id%3D${incident.sys_id}`;
}

function incidentSummary(incident) {
  return {
    sys_id: incident.sys_id,
    number: incident.number,
    short_description: incident.short_description,
    state: incident.state,
    state_label: stateLabels[incident.state],
    priority: incident.priority,
    priority_label: priorityLabels[incident.priority],
    assignment_group: incident.assignment_group,
    assigned_to: incident.assigned_to,
    link: incidentLink(incident),
  };
}

function formatIncident(incident) {
  const summary = incidentSummary(incident);
  return `${summary.number} — ${summary.short_description}\n` +
    `sys_id: ${summary.sys_id}\n` +
    `State: ${summary.state_label} (${summary.state})\n` +
    `Priority: ${summary.priority} - ${summary.priority_label}\n` +
    `Assignment group: ${summary.assignment_group}${summary.assigned_to ? ` / ${summary.assigned_to}` : ""}\n` +
    `Link: ${summary.link}`;
}

function toolError(message, structured = {}) {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { error: { message, ...structured } } };
}

function requireToolScope(token, scope, toolName) {
  if (token.scopes.includes(scope)) return null;
  return toolError(`ServiceNow ACL denied: tool ${toolName} requires missing OAuth scope ${scope}.`, { missing_scope: scope });
}

function argumentError(message) {
  return { protocolError: true, message };
}

function requireObjectArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return argumentError("tools/call arguments must be an object");
  return null;
}

function validateIdentifier(args) {
  if (typeof args.number === "string" && args.number.trim()) return null;
  if (typeof args.sys_id === "string" && args.sys_id.trim()) return null;
  return argumentError("number or sys_id is required");
}

function validateIntegerEnum(args, field, values) {
  if (!Object.hasOwn(args, field)) return null;
  if (!Number.isInteger(args[field]) || !values.includes(args[field])) {
    return argumentError(`${field} must be one of ${values.join(", ")}`);
  }
  return null;
}

function validateStringField(args, field, required = false) {
  if (!Object.hasOwn(args, field)) {
    return required ? argumentError(`${field} is required`) : null;
  }
  if (typeof args[field] !== "string" || (required && !args[field].trim())) return argumentError(`${field} must be a non-empty string`);
  return null;
}

function validateToolArguments(name, args) {
  const objectError = requireObjectArguments(args);
  if (objectError) return objectError;
  for (const field of ["state", "impact", "urgency", "priority"]) {
    const values = field === "state" ? [1, 2, 3, 6, 7] : field === "priority" ? [1, 2, 3, 4, 5] : [1, 2, 3];
    const error = validateIntegerEnum(args, field, values);
    if (error) return error;
  }
  if (name === "search_incidents") {
    if (Object.hasOwn(args, "limit") && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) return argumentError("limit must be an integer from 1 to 50");
    if (Object.hasOwn(args, "offset") && (!Number.isInteger(args.offset) || args.offset < 0)) return argumentError("offset must be a non-negative integer");
    return null;
  }
  if (name === "create_incident") return validateStringField(args, "short_description", true);
  const identifierError = validateIdentifier(args);
  if (identifierError) return identifierError;
  if (name === "add_comment") {
    const commentError = validateStringField(args, "comment", true);
    if (commentError) return commentError;
    if (Object.hasOwn(args, "work_note") && typeof args.work_note !== "boolean") return argumentError("work_note must be a boolean");
  }
  if (name === "resolve_incident") {
    const closeCodeError = validateStringField(args, "close_code", true);
    if (closeCodeError) return closeCodeError;
    if (!closeCodes.includes(args.close_code)) return argumentError(`close_code must be one of ${closeCodes.join(", ")}`);
    return validateStringField(args, "close_notes", true);
  }
  return null;
}

function searchIncidents(args) {
  const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
  let result = incidents.filter((incident) => {
    const matchesQuery = !query || [incident.number, incident.short_description, incident.description].some((value) => value.toLowerCase().includes(query));
    const matchesState = !Object.hasOwn(args, "state") || incident.state === args.state;
    const matchesPriority = !Object.hasOwn(args, "priority") || incident.priority === args.priority;
    const matchesGroup = !args.assignment_group || incident.assignment_group === args.assignment_group;
    const matchesAssignee = !args.assigned_to || incident.assigned_to === args.assigned_to;
    return matchesQuery && matchesState && matchesPriority && matchesGroup && matchesAssignee;
  });
  result = result.sort((left, right) => right.sys_created_on.localeCompare(left.sys_created_on));
  const limit = args.limit || 10;
  const offset = args.offset || 0;
  return result.slice(offset, offset + limit);
}

function callTool(name, args, token) {
  const validation = validateToolArguments(name, args);
  if (validation) return validation;
  if (name === "search_incidents") {
    const scopeError = requireToolScope(token, "incidents.read", name);
    if (scopeError) return scopeError;
    const rows = searchIncidents(args);
    const summaries = rows.map(incidentSummary);
    return {
      content: [{ type: "text", text: summaries.length ? summaries.map((incident) => `${incident.number}: ${incident.short_description} (${incident.state_label}, Priority ${incident.priority} - ${incident.priority_label})\n${incident.link}`).join("\n\n") : "No matching ServiceNow incidents found." }],
      structuredContent: { count: summaries.length, incidents: summaries },
    };
  }

  if (name === "get_incident") {
    const scopeError = requireToolScope(token, "incidents.read", name);
    if (scopeError) return scopeError;
    const incident = findIncident(args.sys_id || args.number);
    if (!incident) return toolError("ServiceNow Incident ACL/read failed: record not found.", { code: "record_not_found" });
    return { content: [{ type: "text", text: formatIncident(incident) }], structuredContent: { incident: incidentView(incident, true) } };
  }

  if (name === "create_incident") {
    const scopeError = requireToolScope(token, "incidents.write", name);
    if (scopeError) return scopeError;
    const incident = createIncident(args);
    return { content: [{ type: "text", text: `Created ${formatIncident(incident)}` }], structuredContent: { incident: incidentView(incident, true) } };
  }

  if (name === "update_incident") {
    const scopeError = requireToolScope(token, "incidents.write", name);
    if (scopeError) return scopeError;
    const incident = findIncident(args.sys_id || args.number);
    if (!incident) return toolError("ServiceNow Incident ACL/write failed: record not found.", { code: "record_not_found" });
    updateIncident(incident, args, "openwork.agent");
    return { content: [{ type: "text", text: `Updated ${formatIncident(incident)}` }], structuredContent: { incident: incidentView(incident, true) } };
  }

  if (name === "add_comment") {
    const scopeError = requireToolScope(token, "incidents.write", name);
    if (scopeError) return scopeError;
    const incident = findIncident(args.sys_id || args.number);
    if (!incident) return toolError("ServiceNow Incident ACL/write failed: record not found.", { code: "record_not_found" });
    const entry = appendJournal(incident.sys_id, args.work_note ? "work_notes" : "comments", args.comment, "openwork.agent");
    incident.sys_updated_on = serviceNowTime();
    return { content: [{ type: "text", text: `Added ${entry.type} to ${incident.number}.\n${formatIncident(incident)}` }], structuredContent: { incident: incidentView(incident, true), journalEntry: entry } };
  }

  if (name === "resolve_incident") {
    const scopeError = requireToolScope(token, "incidents.write", name);
    if (scopeError) return scopeError;
    const incident = findIncident(args.sys_id || args.number);
    if (!incident) return toolError("ServiceNow Incident ACL/write failed: record not found.", { code: "record_not_found" });
    updateIncident(incident, { state: 6, close_code: args.close_code, close_notes: args.close_notes, resolved_at: serviceNowTime(), work_notes: `Resolved by OpenWork: ${args.close_notes}` }, "openwork.agent");
    return { content: [{ type: "text", text: `Resolved ${formatIncident(incident)}` }], structuredContent: { incident: incidentView(incident, true) } };
  }

  return argumentError(`Unknown tool: ${name}`);
}

function handleMcpMessage(message, token) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return jsonRpcError(null, -32600, "Invalid Request", 400);
  if (!Object.hasOwn(message, "method")) return { status: 202, empty: true };
  if (!Object.hasOwn(message, "id")) return { status: 202, empty: true };

  if (message.method === "initialize") {
    const requested = message.params && typeof message.params === "object" ? message.params.protocolVersion : "";
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    const sessionId = randomBytes(18).toString("base64url");
    mcpSessions.add(sessionId);
    return jsonRpcResult(
      message.id,
      {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "servicenow-mcp", title: "ServiceNow MCP Server (Acme Robotics IT)", version: "1.0.0" },
        instructions: "Use search_incidents and get_incident to inspect ServiceNow incidents. Use create_incident, update_incident, add_comment, and resolve_incident for incident-management workflows when the OAuth token includes incidents.write.",
      },
      { "Mcp-Session-Id": sessionId },
    );
  }

  if (message.method === "ping") return jsonRpcResult(message.id, {});
  if (message.method === "tools/list") return jsonRpcResult(message.id, { tools });
  if (message.method === "tools/call") {
    const params = message.params && typeof message.params === "object" ? message.params : {};
    if (typeof params.name !== "string") return jsonRpcError(message.id, -32602, "tools/call params.name is required");
    const tool = tools.find((entry) => entry.name === params.name);
    if (!tool) return jsonRpcError(message.id, -32602, `Unknown tool: ${params.name}`);
    const result = callTool(params.name, params.arguments || {}, token);
    if (result.protocolError) return jsonRpcError(message.id, -32602, result.message);
    return jsonRpcResult(message.id, result);
  }
  return jsonRpcError(message.id, -32601, "Method not found");
}

async function handleMcp(req, res, path, rawBody = "") {
  if (!isAllowedOriginHeader(req.headers.origin || "")) {
    json(res, 403, { error: "forbidden_origin" });
    return;
  }

  if (req.method === "GET") {
    json(res, 405, { error: "method_not_allowed" }, { allow: "POST, DELETE", "www-authenticate": bearerFailureHeader("", path) });
    return;
  }

  const protocolHeader = req.headers["mcp-protocol-version"];
  if (protocolHeader && !SUPPORTED_PROTOCOL_VERSIONS.includes(String(protocolHeader))) {
    json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unsupported MCP-Protocol-Version" } });
    return;
  }

  const token = requireProtected(req, res, null, false, path);
  if (!token) return;
  if (!token.scopes.some((scope) => SCOPES.includes(scope))) {
    json(res, 403, { error: "insufficient_scope", error_description: "Token does not include a ServiceNow incident scope" });
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && !mcpSessions.has(String(sessionId))) {
    json(res, 404, { error: "unknown_mcp_session" });
    return;
  }

  if (req.method === "DELETE") {
    if (!sessionId || !mcpSessions.has(String(sessionId))) {
      json(res, 404, { error: "unknown_mcp_session" });
      return;
    }
    mcpSessions.delete(String(sessionId));
    empty(res, 204);
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed" }, { allow: "POST, DELETE", "www-authenticate": bearerFailureHeader("", path) });
    return;
  }

  let message;
  try {
    message = JSON.parse(rawBody || "{}");
  } catch {
    json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (Array.isArray(message)) {
    json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: JSON-RPC batching is not supported" } });
    return;
  }
  const result = handleMcpMessage(message, token, path);
  if (result.empty) {
    empty(res, 202);
    return;
  }
  json(res, result.status, result.body, result.headers || {});
}

function record(req, url, jsonrpcMethod) {
  const entry = {
    id: requests.length + 1,
    method: req.method,
    path: url.pathname,
    url: `${url.pathname}${url.search}`,
    at: new Date().toISOString(),
    ...(jsonrpcMethod ? { jsonrpcMethod } : {}),
  };
  requests.push(entry);
  console.log(`[servicenow-mcp] ${entry.method} ${entry.path}${jsonrpcMethod ? ` ${jsonrpcMethod}` : ""}`);
}

seedData();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", issuer);
    const mcpPath = isMcpPath(url.pathname);
    let rawMcpBody = "";
    let jsonrpcMethod;
    if (mcpPath && req.method === "POST") {
      rawMcpBody = await readBody(req);
      jsonrpcMethod = parseJsonRpcMethod(rawMcpBody);
    }
    record(req, url, jsonrpcMethod);

    if (req.method === "OPTIONS") {
      empty(res, 204);
      return;
    }

    if (url.pathname === "/health") {
      json(res, 200, { ok: true, product: "servicenow-mcp", issuer, autoApprove, requests: requests.length });
      return;
    }

    if (url.pathname === "/requests") {
      json(res, 200, { requests });
      return;
    }

    const prmMcpPath = protectedResourceMcpPath(url.pathname);
    if (prmMcpPath) {
      json(res, 200, protectedResourceMetadata(`${issuer}${prmMcpPath}`));
      return;
    }

    if (wellKnownMatches(url.pathname, "oauth-authorization-server")) {
      json(res, 200, authorizationServerMetadata());
      return;
    }

    if (url.pathname === "/oauth_auth.do" && req.method === "GET") {
      authorize(req, res, url);
      return;
    }

    if (url.pathname === "/oauth_approve" && req.method === "POST") {
      await approve(req, res);
      return;
    }

    if (url.pathname === "/oauth_token.do" && req.method === "POST") {
      await issueToken(req, res);
      return;
    }

    if (url.pathname === "/api/now/table/incident") {
      await handleIncidentList(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/now/table/incident/")) {
      const sysId = decodeURIComponent(url.pathname.slice("/api/now/table/incident/".length));
      await handleIncidentRecord(req, res, sysId);
      return;
    }

    if (mcpPath) {
      await handleMcp(req, res, mcpPath, rawMcpBody);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`[servicenow-mcp] listening on ${issuer}`);
  for (const path of MCP_PATHS) console.log(`[servicenow-mcp] MCP URL: ${issuer}${path}`);
  console.log(`[servicenow-mcp] OAuth authorization endpoint: ${issuer}/oauth_auth.do`);
  console.log(`[servicenow-mcp] OAuth token endpoint: ${issuer}/oauth_token.do`);
  console.log(`[servicenow-mcp] set AUTO_APPROVE=0 to show the ServiceNow consent page`);
});
