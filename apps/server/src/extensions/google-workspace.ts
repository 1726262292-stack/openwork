import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";

export const GOOGLE_WORKSPACE_EXTENSION_ID = "google-workspace";

const GOOGLE_WORKSPACE_DESKTOP_CLIENT_ID = "929071212606-pmkqimjhm2tnp68kbklnout0irllj99h.apps.googleusercontent.com";
const GOOGLE_WORKSPACE_CLIENT_ID_ENV = "OPENWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_ID";
const GOOGLE_WORKSPACE_CLIENT_SECRET_ENV = "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET";
const LEGACY_GOOGLE_WORKSPACE_CLIENT_SECRET_ENV = "OPENWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET";
const GOOGLE_WORKSPACE_TOKEN_BROKER_URL_ENV = "OPENWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL";
const GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT_ENV = "OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT";
const GOOGLE_WORKSPACE_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const GOOGLE_WORKSPACE_API_TIMEOUT_MS = 30_000;
const GOOGLE_WORKSPACE_EXPERIMENTAL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.file",
  ...GOOGLE_WORKSPACE_EXPERIMENTAL_SCOPES,
];
const GMAIL_DEFAULT_BODY_CHARS = 20_000;
const GMAIL_MAX_BODY_CHARS = 100_000;
const GMAIL_DEFAULT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const GMAIL_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const GMAIL_DEFAULT_ATTACHMENT_COUNT = 5;
const GMAIL_MAX_ATTACHMENT_COUNT = 10;

export const GOOGLE_WORKSPACE_EXTENSION_ACTIONS = [
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "status",
    title: "Google Workspace status",
    description: "Check whether Google Workspace is connected and ready for OpenWork extension actions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "calendar_list_events",
    title: "List calendar events",
    description: "List events from the connected Google Calendar account for a requested time range.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "Inclusive ISO datetime lower bound." },
        timeMax: { type: "string", description: "Exclusive ISO datetime upper bound." },
        maxResults: { type: "number", description: "Maximum events to return." },
      },
      required: ["timeMin", "timeMax"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "calendar_create_event",
    title: "Create calendar event",
    description: "Experimentally create a Google Calendar event. Requires your own Google OAuth credentials for now and may be removed.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        start: { type: "string", description: "Event start as an ISO datetime." },
        end: { type: "string", description: "Event end as an ISO datetime." },
        timeZone: { type: "string", description: "Optional IANA time zone, such as America/Los_Angeles." },
        description: { type: "string", description: "Optional event description." },
        location: { type: "string", description: "Optional event location." },
        attendees: { type: "array", items: { type: "string" }, description: "Optional attendee email addresses." },
        sendUpdates: { type: "string", description: "Calendar notification behavior: all, externalOnly, or none." },
      },
      required: ["summary", "start", "end"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "gmail_create_draft",
    title: "Create Gmail draft",
    description: "Create a Gmail draft for the connected account. This does not send email.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
        cc: { type: "array", items: { type: "string" }, description: "Optional CC recipients." },
        bcc: { type: "array", items: { type: "string" }, description: "Optional BCC recipients." },
        subject: { type: "string", description: "Draft subject." },
        body: { type: "string", description: "Plain text draft body." },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "gmail_get_latest_message",
    title: "Get latest Gmail message",
    description: "Experimentally read the latest Gmail message, defaulting to the inbox. Requires your own Google OAuth credentials for now and may be removed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional Gmail search query. Defaults to in:inbox." },
        includeBody: { type: "boolean", description: "Include the message body. Defaults to true." },
        maxBodyChars: { type: "number", description: "Maximum body characters to return." },
        includeAttachments: { type: "boolean", description: "Download attachments into chat file cards when possible." },
        maxAttachmentBytes: { type: "number", description: "Maximum bytes per downloaded attachment." },
        maxAttachments: { type: "number", description: "Maximum number of attachments to download." },
      },
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "gmail_read_message",
    title: "Read Gmail message",
    description: "Experimentally read a Gmail message by id and optionally expose attachments as chat downloads. Requires your own Google OAuth credentials for now and may be removed.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        includeBody: { type: "boolean", description: "Include the message body. Defaults to true." },
        maxBodyChars: { type: "number", description: "Maximum body characters to return." },
        includeAttachments: { type: "boolean", description: "Download attachments into chat file cards when possible." },
        maxAttachmentBytes: { type: "number", description: "Maximum bytes per downloaded attachment." },
        maxAttachments: { type: "number", description: "Maximum number of attachments to download." },
      },
      required: ["messageId"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "gmail_download_attachment",
    title: "Download Gmail attachment",
    description: "Experimentally download a Gmail attachment and show it as a downloadable chat file. Requires your own Google OAuth credentials for now and may be removed.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        attachmentId: { type: "string", description: "Gmail attachment id from gmail_read_message or gmail_get_latest_message." },
        filename: { type: "string", description: "Suggested download filename." },
        mimeType: { type: "string", description: "Attachment MIME type." },
        maxAttachmentBytes: { type: "number", description: "Maximum bytes to download." },
      },
      required: ["messageId", "attachmentId"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "drive_search_files",
    title: "Search Drive files",
    description: "Search files available to OpenWork through the connected Google Drive scope.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text." },
        maxResults: { type: "number", description: "Maximum files to return." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    extensionId: GOOGLE_WORKSPACE_EXTENSION_ID,
    action: "drive_read_file",
    title: "Read Drive file",
    description: "Read a Drive file available to OpenWork by file id.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Google Drive file id." },
      },
      required: ["fileId"],
      additionalProperties: false,
    },
  },
];

type GoogleWorkspaceFlow = {
  flowId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  status: "pending" | "connected" | "failed" | "expired";
  authUrl: string;
  account: unknown;
  error: string | null;
  server: Server;
};

type GoogleWorkspaceToolAttachment = {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
};

type GmailCollectedAttachment = {
  messageId: string;
  partId: string | null;
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  size: number | null;
  data: string | null;
};

type GmailParsedMessage = {
  message: Record<string, unknown>;
  attachments: GmailCollectedAttachment[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function readRecordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return isRecord(field) ? field : null;
}

function readRecordArrayField(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field.filter(isRecord) : [];
}

function readOptionalNumberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function configDir(config: ServerConfig): string {
  return dirname(config.configPath?.trim() || resolve(homedir(), ".config", "openwork", "server.json"));
}

function googleWorkspaceCredentials() {
  const clientId = process.env[GOOGLE_WORKSPACE_CLIENT_ID_ENV]?.trim() || process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_ID?.trim() || GOOGLE_WORKSPACE_DESKTOP_CLIENT_ID;
  const clientSecret = process.env[GOOGLE_WORKSPACE_CLIENT_SECRET_ENV]?.trim() || process.env[LEGACY_GOOGLE_WORKSPACE_CLIENT_SECRET_ENV]?.trim() || "";
  const tokenBrokerUrl = process.env[GOOGLE_WORKSPACE_TOKEN_BROKER_URL_ENV]?.trim() || process.env.GOOGLE_WORKSPACE_TOKEN_BROKER_URL?.trim() || "";
  const missing: string[] = [];
  if (!clientId) missing.push(GOOGLE_WORKSPACE_CLIENT_ID_ENV);
  if (!clientSecret && !tokenBrokerUrl) missing.push(GOOGLE_WORKSPACE_CLIENT_SECRET_ENV);
  return { clientId, clientSecret, tokenBrokerUrl, missing };
}

function googleWorkspaceDir(config: ServerConfig): string {
  return join(configDir(config), "extensions", GOOGLE_WORKSPACE_EXTENSION_ID);
}

function googleWorkspaceVaultPath(config: ServerConfig): string {
  return join(googleWorkspaceDir(config), "oauth.vault");
}

function googleWorkspacePlainTextVaultPath(config: ServerConfig): string {
  return join(googleWorkspaceDir(config), "oauth.dev-plaintext.json");
}

function googleWorkspaceVaultKeyPath(config: ServerConfig): string {
  return join(configDir(config), "vault-key");
}

function googleWorkspacePlainTextVaultEnabled() {
  return process.env.OPENWORK_DEV_MODE === "1" && process.env[GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT_ENV] === "1";
}

function googleWorkspaceVaultMode() {
  return googleWorkspacePlainTextVaultEnabled() ? "plaintext-dev" : "encrypted";
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlString(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64");
}

function dataUrlFromBuffer(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
}

function decodeGmailText(data: string): string {
  return base64UrlToBuffer(data).toString("utf8");
}

function createGoogleWorkspacePkce() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function googleWorkspaceVaultKey(config: ServerConfig): Promise<Buffer> {
  const envKey = process.env.OPENWORK_ENCRYPTION_KEY?.trim();
  if (envKey) return createHash("sha256").update(envKey).digest();

  const keyPath = googleWorkspaceVaultKeyPath(config);
  try {
    const raw = await readFile(keyPath, "utf8");
    const key = Buffer.from(raw.trim(), "base64");
    if (key.byteLength === 32) return key;
  } catch (error) {
    if ((error as { code?: string })?.code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(keyPath, 0o600).catch(() => undefined);
  return key;
}

async function readGoogleWorkspaceVault(config: ServerConfig): Promise<Record<string, unknown> | null> {
  const vaultMode = googleWorkspaceVaultMode();
  const target = vaultMode === "plaintext-dev" ? googleWorkspacePlainTextVaultPath(config) : googleWorkspaceVaultPath(config);
  try {
    const raw = await readFile(target, "utf8");
    if (!raw.trim()) return null;
    if (vaultMode === "plaintext-dev") {
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? parsed : null;
    }
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") return null;
    const key = await googleWorkspaceVaultKey(config);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeGoogleWorkspaceVault(config: ServerConfig, value: Record<string, unknown>): Promise<void> {
  const vaultMode = googleWorkspaceVaultMode();
  const target = vaultMode === "plaintext-dev" ? googleWorkspacePlainTextVaultPath(config) : googleWorkspaceVaultPath(config);
  await mkdir(dirname(target), { recursive: true });
  if (vaultMode === "plaintext-dev") {
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(target, 0o600).catch(() => undefined);
    return;
  }
  const key = await googleWorkspaceVaultKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope = { schemaVersion: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  await writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600).catch(() => undefined);
}

async function removeGoogleWorkspaceVault(config: ServerConfig): Promise<void> {
  await Promise.all([
    rm(googleWorkspaceVaultPath(config), { force: true }),
    rm(googleWorkspacePlainTextVaultPath(config), { force: true }),
  ]);
}

function googleWorkspaceSafeAccount(account: unknown) {
  if (!isRecord(account)) return null;
  return {
    accountId: googleWorkspaceAccountId({ account }),
    email: typeof account.email === "string" ? account.email : null,
    name: typeof account.name === "string" ? account.name : null,
    picture: typeof account.picture === "string" ? account.picture : null,
    sub: typeof account.sub === "string" ? account.sub : null,
  };
}

function googleWorkspaceAccountId(record: unknown): string | null {
  if (!isRecord(record)) return null;
  const account = isRecord(record.account) ? record.account : null;
  const sub = typeof account?.sub === "string" && account.sub.trim() ? account.sub.trim() : null;
  const email = typeof account?.email === "string" && account.email.trim() ? account.email.trim().toLowerCase() : null;
  return sub ?? email;
}

function googleWorkspaceAccountRecords(record: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!record) return [];
  if (Array.isArray(record.accounts)) return record.accounts.filter(isRecord);
  return isRecord(record.token) ? [record] : [];
}

function googleWorkspacePrimaryRecord(record: Record<string, unknown> | null): Record<string, unknown> | null {
  const accounts = googleWorkspaceAccountRecords(record);
  if (accounts.length === 0) return null;
  const activeAccountId = typeof record?.activeAccountId === "string" ? record.activeAccountId : "";
  return accounts.find((account) => googleWorkspaceAccountId(account) === activeAccountId) ?? accounts[0] ?? null;
}

function googleWorkspacePublicAccounts(record: Record<string, unknown> | null) {
  return googleWorkspaceAccountRecords(record).map((entry) => ({
    ...googleWorkspaceSafeAccount(entry.account),
    accountId: googleWorkspaceAccountId(entry),
    scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((item): item is string => typeof item === "string") : [],
    connectedAt: typeof entry.connectedAt === "string" ? entry.connectedAt : null,
  })).filter((entry) => entry.accountId !== null);
}

async function writeGoogleWorkspaceAccountsVault(config: ServerConfig, accounts: Record<string, unknown>[], activeAccountId: string | null): Promise<void> {
  if (accounts.length === 0) {
    await removeGoogleWorkspaceVault(config);
    return;
  }
  await writeGoogleWorkspaceVault(config, {
    version: 2,
    accounts,
    activeAccountId,
    updatedAt: new Date().toISOString(),
  });
}

async function upsertGoogleWorkspaceAccount(config: ServerConfig, accountRecord: Record<string, unknown>): Promise<void> {
  const accountId = googleWorkspaceAccountId(accountRecord);
  if (!accountId) throw new Error("Google account identifier is unavailable.");
  const current = await readGoogleWorkspaceVault(config);
  const accounts = googleWorkspaceAccountRecords(current);
  const nextAccounts = [accountRecord, ...accounts.filter((entry) => googleWorkspaceAccountId(entry) !== accountId)];
  await writeGoogleWorkspaceAccountsVault(config, nextAccounts, accountId);
}

function googleWorkspaceStatusPayload(record: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}) {
  const credentials = googleWorkspaceCredentials();
  const primary = googleWorkspacePrimaryRecord(record);
  const scopes = Array.isArray(primary?.scopes) ? primary.scopes.filter((item): item is string => typeof item === "string") : [];
  return {
    configured: credentials.missing.length === 0,
    missing: credentials.missing,
    vault: googleWorkspaceVaultMode(),
    connected: googleWorkspaceAccountRecords(record).length > 0,
    account: googleWorkspaceSafeAccount(primary?.account),
    accounts: googleWorkspacePublicAccounts(record),
    activeAccountId: googleWorkspaceAccountId(primary),
    scopes,
    experimentalScopes: GOOGLE_WORKSPACE_EXPERIMENTAL_SCOPES,
    experimentalScopesGranted: GOOGLE_WORKSPACE_EXPERIMENTAL_SCOPES.every((scope) => scopes.includes(scope)),
    connectedAt: typeof primary?.connectedAt === "string" ? primary.connectedAt : null,
    error: null,
    testStatus: null,
    smokeTest: null,
    ...extra,
  };
}

async function fetchGoogleJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_WORKSPACE_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new Error("Google request timed out. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text.trim()) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    const details = isRecord(payload)
      ? isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : typeof payload.error_description === "string"
          ? payload.error_description
          : typeof payload.error === "string"
            ? payload.error
            : response.statusText
      : response.statusText;
    throw new Error(`Google request failed (${response.status}): ${details}`);
  }
  return payload;
}

async function fetchGoogleUserInfo(accessToken: string) {
  return fetchGoogleJson("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function fetchGoogleWorkspaceTokenBrokerJson(tokenBrokerUrl: string, body: Record<string, unknown>) {
  return fetchGoogleJson(tokenBrokerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function exchangeGoogleWorkspaceCode(input: { code: string; redirectUri: string; verifier: string }) {
  const { clientId, clientSecret, tokenBrokerUrl, missing } = googleWorkspaceCredentials();
  if (missing.length > 0) throw new Error(`Missing Google OAuth configuration: ${missing.join(", ")}`);
  if (tokenBrokerUrl) {
    return fetchGoogleWorkspaceTokenBrokerJson(tokenBrokerUrl, {
      grantType: "authorization_code",
      provider: GOOGLE_WORKSPACE_EXTENSION_ID,
      clientId,
      code: input.code,
      codeVerifier: input.verifier,
      redirectUri: input.redirectUri,
    });
  }
  return fetchGoogleJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
  });
}

async function refreshGoogleWorkspaceVault(record: Record<string, unknown>) {
  const token = isRecord(record.token) ? record.token : null;
  const expiresAt = Number(token?.expiresAt ?? 0);
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : "";
  const refreshToken = typeof token?.refreshToken === "string" ? token.refreshToken : "";
  if (accessToken && expiresAt > Date.now() + 60_000) return record;
  if (!refreshToken) throw new Error("Google Workspace refresh token is missing. Reconnect Google Workspace.");
  const { clientId, clientSecret, tokenBrokerUrl, missing } = googleWorkspaceCredentials();
  if (missing.length > 0) throw new Error(`Missing Google OAuth configuration: ${missing.join(", ")}`);
  const refreshed = tokenBrokerUrl
    ? await fetchGoogleWorkspaceTokenBrokerJson(tokenBrokerUrl, { grantType: "refresh_token", provider: GOOGLE_WORKSPACE_EXTENSION_ID, clientId, refreshToken })
    : await fetchGoogleJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
    });
  if (!isRecord(refreshed) || typeof refreshed.access_token !== "string") throw new Error("Google OAuth refresh did not return an access token.");
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
  return next;
}

async function googleWorkspaceAccessToken(config: ServerConfig): Promise<{ record: Record<string, unknown>; accessToken: string }> {
  const vault = await readGoogleWorkspaceVault(config);
  const record = googleWorkspacePrimaryRecord(vault);
  if (!record) throw new ApiError(400, "google_workspace_not_connected", "Connect Google Workspace in OpenWork Settings to use this tool.");
  const refreshed = await refreshGoogleWorkspaceVault(record);
  const refreshedAccountId = googleWorkspaceAccountId(refreshed);
  if (refreshedAccountId) {
    const nextAccounts = googleWorkspaceAccountRecords(vault).map((entry) => googleWorkspaceAccountId(entry) === refreshedAccountId ? refreshed : entry);
    await writeGoogleWorkspaceAccountsVault(config, nextAccounts, refreshedAccountId);
  }
  const token = isRecord(refreshed.token) ? refreshed.token : null;
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : "";
  if (!accessToken) throw new Error("Google Workspace access token is unavailable. Reconnect Google Workspace.");
  return { record: refreshed, accessToken };
}

function multipartRelatedBody(metadata: Record<string, unknown>, content: string, boundary: string): string {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function gmailRawMessage(input: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string }): string {
  return [
    `To: ${input.to.join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.join(", ")}` : null,
    input.bcc?.length ? `Bcc: ${input.bcc.join(", ")}` : null,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body,
  ].filter((line): line is string => typeof line === "string").join("\r\n");
}

async function googleWorkspaceListEvents(config: ServerConfig, args: Record<string, unknown>) {
  const timeMin = readStringField(args, "timeMin");
  const timeMax = readStringField(args, "timeMax");
  if (!timeMin || !timeMax) throw new ApiError(400, "invalid_payload", "timeMin and timeMax are required");
  const maxResults = Math.min(Math.max(Number(args.maxResults ?? 10), 1), 50);
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  return fetchGoogleJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function googleWorkspaceCreateEvent(config: ServerConfig, args: Record<string, unknown>) {
  const summary = readStringField(args, "summary");
  const start = readStringField(args, "start");
  const end = readStringField(args, "end");
  if (!summary || !start || !end) throw new ApiError(400, "invalid_payload", "summary, start, and end are required");

  const timeZone = readStringField(args, "timeZone");
  const sendUpdates = readStringField(args, "sendUpdates") || "none";
  if (!["all", "externalOnly", "none"].includes(sendUpdates)) {
    throw new ApiError(400, "invalid_payload", "sendUpdates must be all, externalOnly, or none");
  }

  const event: Record<string, unknown> = {
    summary,
    start: timeZone ? { dateTime: start, timeZone } : { dateTime: start },
    end: timeZone ? { dateTime: end, timeZone } : { dateTime: end },
  };
  const description = readStringField(args, "description");
  const location = readStringField(args, "location");
  const attendees = stringArrayField(args.attendees).map((email) => ({ email }));
  if (description) event.description = description;
  if (location) event.location = location;
  if (attendees.length) event.attendees = attendees;

  const { accessToken } = await googleWorkspaceAccessToken(config);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("sendUpdates", sendUpdates);
  return fetchGoogleJson(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

async function googleWorkspaceCreateDraft(config: ServerConfig, args: Record<string, unknown>) {
  const to = stringArrayField(args.to);
  const cc = stringArrayField(args.cc);
  const bcc = stringArrayField(args.bcc);
  const subject = readStringField(args, "subject");
  const body = typeof args.body === "string" ? args.body : "";
  if (!to.length || !subject || !body.trim()) throw new ApiError(400, "invalid_payload", "to, subject, and body are required");
  const { accessToken } = await googleWorkspaceAccessToken(config);
  return fetchGoogleJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: base64UrlString(gmailRawMessage({ to, cc, bcc, subject, body })) } }),
  });
}

function gmailHeaderValue(headers: Record<string, unknown>[], name: string): string {
  const target = name.toLowerCase();
  for (const header of headers) {
    if (readStringField(header, "name").toLowerCase() === target) return readStringField(header, "value");
  }
  return "";
}

function gmailHtmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function gmailPayloadParts(payload: Record<string, unknown>): Record<string, unknown>[] {
  const children = readRecordArrayField(payload, "parts");
  return [payload, ...children.flatMap(gmailPayloadParts)];
}

function gmailBodyText(payload: Record<string, unknown>): string {
  let html = "";
  for (const part of gmailPayloadParts(payload)) {
    const body = readRecordField(part, "body");
    const data = readStringField(body, "data");
    if (!data) continue;
    const mimeType = readStringField(part, "mimeType");
    if (mimeType === "text/plain") return decodeGmailText(data);
    if (mimeType === "text/html" && !html) html = decodeGmailText(data);
  }
  return html ? gmailHtmlToText(html) : "";
}

function gmailAttachments(messageId: string, payload: Record<string, unknown>): GmailCollectedAttachment[] {
  return gmailPayloadParts(payload).flatMap((part): GmailCollectedAttachment[] => {
    const filename = readStringField(part, "filename");
    const body = readRecordField(part, "body");
    if (!filename || !body) return [];
    const attachmentId = readStringField(body, "attachmentId") || null;
    const data = readStringField(body, "data") || null;
    if (!attachmentId && !data) return [];
    return [{
      messageId,
      partId: readStringField(part, "partId") || null,
      attachmentId,
      filename,
      mimeType: readStringField(part, "mimeType") || "application/octet-stream",
      size: readOptionalNumberField(body, "size"),
      data,
    }];
  });
}

async function fetchGmailMessage(accessToken: string, messageId: string): Promise<GmailParsedMessage> {
  const message = await fetchGoogleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!isRecord(message)) throw new Error("Gmail message response was invalid.");
  const payload = readRecordField(message, "payload");
  return { message, attachments: payload ? gmailAttachments(messageId, payload) : [] };
}

function gmailMessageResult(parsed: GmailParsedMessage, includeBody: boolean, maxBodyChars: number) {
  const message = parsed.message;
  const payload = readRecordField(message, "payload");
  const headers = payload ? readRecordArrayField(payload, "headers") : [];
  const body = includeBody && payload ? gmailBodyText(payload) : "";
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds.filter((item): item is string => typeof item === "string") : [];
  return {
    id: readStringField(message, "id"),
    threadId: readStringField(message, "threadId"),
    labelIds,
    snippet: readStringField(message, "snippet"),
    internalDate: readStringField(message, "internalDate"),
    subject: gmailHeaderValue(headers, "subject"),
    from: gmailHeaderValue(headers, "from"),
    to: gmailHeaderValue(headers, "to"),
    cc: gmailHeaderValue(headers, "cc"),
    date: gmailHeaderValue(headers, "date"),
    body: includeBody ? body.slice(0, maxBodyChars) : null,
    bodyTruncated: includeBody ? body.length > maxBodyChars : false,
    attachments: parsed.attachments.map((attachment) => ({
      messageId: attachment.messageId,
      partId: attachment.partId,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      downloadable: Boolean(attachment.attachmentId || attachment.data),
    })),
  };
}

async function fetchGmailAttachmentData(accessToken: string, messageId: string, attachmentId: string): Promise<string> {
  const attachment = await fetchGoogleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!isRecord(attachment) || typeof attachment.data !== "string") throw new Error("Gmail attachment response did not include data.");
  return attachment.data;
}

async function downloadGmailAttachments(accessToken: string, attachments: GmailCollectedAttachment[], maxBytes: number, maxCount: number) {
  const toolAttachments: GoogleWorkspaceToolAttachment[] = [];
  const details: Record<string, unknown>[] = [];
  for (const attachment of attachments.slice(0, maxCount)) {
    const detail = {
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
    if (attachment.size !== null && attachment.size > maxBytes) {
      details.push({ ...detail, downloaded: false, skippedReason: `Attachment is larger than ${maxBytes} bytes.` });
      continue;
    }
    const data = attachment.data ?? (attachment.attachmentId ? await fetchGmailAttachmentData(accessToken, attachment.messageId, attachment.attachmentId) : "");
    if (!data) {
      details.push({ ...detail, downloaded: false, skippedReason: "Attachment data is unavailable." });
      continue;
    }
    const buffer = base64UrlToBuffer(data);
    if (buffer.byteLength > maxBytes) {
      details.push({ ...detail, downloaded: false, skippedReason: `Attachment is larger than ${maxBytes} bytes.` });
      continue;
    }
    toolAttachments.push({
      type: "file",
      mime: attachment.mimeType,
      url: dataUrlFromBuffer(buffer, attachment.mimeType),
      filename: attachment.filename,
    });
    details.push({ ...detail, size: buffer.byteLength, downloaded: true });
  }
  return { toolAttachments, details };
}

async function googleWorkspaceReadGmailMessage(config: ServerConfig, args: Record<string, unknown>) {
  const messageId = readStringField(args, "messageId");
  if (!messageId) throw new ApiError(400, "invalid_payload", "messageId is required");
  const includeBody = args.includeBody !== false;
  const includeAttachments = args.includeAttachments !== false;
  const maxBodyChars = clampNumber(args.maxBodyChars, GMAIL_DEFAULT_BODY_CHARS, 0, GMAIL_MAX_BODY_CHARS);
  const maxAttachmentBytes = clampNumber(args.maxAttachmentBytes, GMAIL_DEFAULT_ATTACHMENT_BYTES, 1, GMAIL_MAX_ATTACHMENT_BYTES);
  const maxAttachments = clampNumber(args.maxAttachments, GMAIL_DEFAULT_ATTACHMENT_COUNT, 0, GMAIL_MAX_ATTACHMENT_COUNT);
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const parsed = await fetchGmailMessage(accessToken, messageId);
  const downloaded = includeAttachments
    ? await downloadGmailAttachments(accessToken, parsed.attachments, maxAttachmentBytes, maxAttachments)
    : { toolAttachments: [], details: [] };
  return {
    result: {
      message: gmailMessageResult(parsed, includeBody, maxBodyChars),
      downloadedAttachments: downloaded.details,
    },
    attachments: downloaded.toolAttachments,
  };
}

async function googleWorkspaceGetLatestGmailMessage(config: ServerConfig, args: Record<string, unknown>) {
  const query = readStringField(args, "query") || "in:inbox";
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);
  const listed = await fetchGoogleJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const messages = readRecordArrayField(listed, "messages");
  const first = messages[0];
  if (!first) {
    return {
      result: {
        query,
        resultSizeEstimate: readOptionalNumberField(listed, "resultSizeEstimate"),
        message: null,
        downloadedAttachments: [],
      },
      attachments: [],
    };
  }
  const messageId = readStringField(first, "id");
  if (!messageId) throw new Error("Gmail latest message response did not include a message id.");
  const readResult = await googleWorkspaceReadGmailMessage(config, { ...args, messageId });
  return { result: { query, ...readResult.result }, attachments: readResult.attachments };
}

async function googleWorkspaceDownloadGmailAttachment(config: ServerConfig, args: Record<string, unknown>) {
  const messageId = readStringField(args, "messageId");
  const attachmentId = readStringField(args, "attachmentId");
  if (!messageId || !attachmentId) throw new ApiError(400, "invalid_payload", "messageId and attachmentId are required");
  const filename = readStringField(args, "filename") || "gmail-attachment";
  const mimeType = readStringField(args, "mimeType") || "application/octet-stream";
  const maxAttachmentBytes = clampNumber(args.maxAttachmentBytes, GMAIL_DEFAULT_ATTACHMENT_BYTES, 1, GMAIL_MAX_ATTACHMENT_BYTES);
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const data = await fetchGmailAttachmentData(accessToken, messageId, attachmentId);
  const buffer = base64UrlToBuffer(data);
  if (buffer.byteLength > maxAttachmentBytes) {
    throw new ApiError(400, "attachment_too_large", `Attachment is larger than ${maxAttachmentBytes} bytes.`);
  }
  const attachment: GoogleWorkspaceToolAttachment = { type: "file", mime: mimeType, url: dataUrlFromBuffer(buffer, mimeType), filename };
  return {
    result: { messageId, attachmentId, filename, mimeType, size: buffer.byteLength, downloaded: true },
    attachments: [attachment],
  };
}

async function googleWorkspaceSearchFiles(config: ServerConfig, args: Record<string, unknown>) {
  const query = readStringField(args, "query");
  if (!query) throw new ApiError(400, "invalid_payload", "query is required");
  const maxResults = Math.min(Math.max(Number(args.maxResults ?? 10), 1), 50);
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`);
  url.searchParams.set("pageSize", String(maxResults));
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,modifiedTime,size)");
  return fetchGoogleJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function googleWorkspaceReadFile(config: ServerConfig, args: Record<string, unknown>) {
  const fileId = readStringField(args, "fileId");
  if (!fileId) throw new ApiError(400, "invalid_payload", "fileId is required");
  const { accessToken } = await googleWorkspaceAccessToken(config);
  const metadata = await fetchGoogleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const mimeType = isRecord(metadata) && typeof metadata.mimeType === "string" ? metadata.mimeType : "";
  const exportMime = mimeType === "application/vnd.google-apps.document" ? "text/plain" : "";
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const content = await response.text();
  if (!response.ok) throw new Error(`Google Drive read failed (${response.status}): ${content}`);
  return { metadata, content };
}

function googleWorkspaceActionResponse(action: string, result: unknown, context: Record<string, unknown>, attachments: GoogleWorkspaceToolAttachment[] = []) {
  const response = { ok: true, extensionId: GOOGLE_WORKSPACE_EXTENSION_ID, action, result, context };
  return attachments.length ? { ...response, attachments } : response;
}

export async function callGoogleWorkspaceExtensionAction(config: ServerConfig, action: string, args: Record<string, unknown>, context: Record<string, unknown>) {
  if (action === "status") return googleWorkspaceActionResponse(action, await googleWorkspaceStatus(config), context);
  if (action === "calendar_list_events") return googleWorkspaceActionResponse(action, await googleWorkspaceListEvents(config, args), context);
  if (action === "calendar_create_event") return googleWorkspaceActionResponse(action, await googleWorkspaceCreateEvent(config, args), context);
  if (action === "gmail_create_draft") return googleWorkspaceActionResponse(action, await googleWorkspaceCreateDraft(config, args), context);
  if (action === "gmail_get_latest_message") {
    const result = await googleWorkspaceGetLatestGmailMessage(config, args);
    return googleWorkspaceActionResponse(action, result.result, context, result.attachments);
  }
  if (action === "gmail_read_message") {
    const result = await googleWorkspaceReadGmailMessage(config, args);
    return googleWorkspaceActionResponse(action, result.result, context, result.attachments);
  }
  if (action === "gmail_download_attachment") {
    const result = await googleWorkspaceDownloadGmailAttachment(config, args);
    return googleWorkspaceActionResponse(action, result.result, context, result.attachments);
  }
  if (action === "drive_search_files") return googleWorkspaceActionResponse(action, await googleWorkspaceSearchFiles(config, args), context);
  if (action === "drive_read_file") return googleWorkspaceActionResponse(action, await googleWorkspaceReadFile(config, args), context);
  return null;
}

export async function googleWorkspaceStatus(config: ServerConfig) {
  try {
    const record = await readGoogleWorkspaceVault(config);
    return googleWorkspaceStatusPayload(record);
  } catch (error) {
    return googleWorkspaceStatusPayload(null, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function googleWorkspaceTestConnection(config: ServerConfig) {
  const { record, accessToken } = await googleWorkspaceAccessToken(config);
  await fetchGoogleUserInfo(accessToken);
  await fetchGoogleJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", { headers: { Authorization: `Bearer ${accessToken}` } });
  return googleWorkspaceStatusPayload(record, { testStatus: "Google profile and Calendar read access verified." });
}

export async function googleWorkspaceRunScopeSmokeTest(config: ServerConfig) {
  const { record, accessToken } = await googleWorkspaceAccessToken(config);
  const account = await fetchGoogleUserInfo(accessToken);
  const email = isRecord(account) && typeof account.email === "string" ? account.email : googleWorkspaceSafeAccount(record.account)?.email;
  if (!email) throw new Error("Google account email is unavailable.");
  await fetchGoogleJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", { headers: { Authorization: `Bearer ${accessToken}` } });
  const createdAt = new Date().toISOString();
  const eventStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  const calendarEvent = await fetchGoogleJson("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: "OpenWork Google Workspace smoke test event",
      description: `Created by OpenWork to verify Calendar write access at ${createdAt}. This event is deleted by the diagnostic.`,
      start: { dateTime: eventStart },
      end: { dateTime: eventEnd },
    }),
  });
  const calendarEventId = isRecord(calendarEvent) && typeof calendarEvent.id === "string" ? calendarEvent.id : null;
  if (calendarEventId) {
    await fetchGoogleJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(calendarEventId)}?sendUpdates=none`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  const gmailRead = await fetchGoogleJson("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1", { headers: { Authorization: `Bearer ${accessToken}` } });
  const driveBoundary = `openwork_${randomBytes(8).toString("hex")}`;
  const driveFile = await fetchGoogleJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${driveBoundary}` },
    body: multipartRelatedBody({ name: "OpenWork Google Workspace smoke test.txt", mimeType: "text/plain" }, `OpenWork Google Workspace smoke test created at ${createdAt}.`, driveBoundary),
  });
  if (isRecord(driveFile) && typeof driveFile.id === "string") {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFile.id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Google Drive smoke read failed (${response.status}): ${await response.text()}`);
  }
  const draft = await fetchGoogleJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: base64UrlString(gmailRawMessage({ to: [email], subject: "OpenWork Google Workspace smoke test draft", body: `This draft was created by OpenWork to verify Gmail draft access at ${createdAt}.\nOpenWork does not send this email automatically.` })) } }),
  });
  return googleWorkspaceStatusPayload(record, {
    testStatus: "Calendar read/write, Gmail read/draft, and Drive file create/read verified.",
    smokeTest: {
      calendarEventId,
      calendarEventDeleted: Boolean(calendarEventId),
      driveFileId: isRecord(driveFile) && typeof driveFile.id === "string" ? driveFile.id : null,
      driveFileName: isRecord(driveFile) && typeof driveFile.name === "string" ? driveFile.name : null,
      gmailDraftId: isRecord(draft) && typeof draft.id === "string" ? draft.id : null,
      gmailReadResultSizeEstimate: readOptionalNumberField(gmailRead, "resultSizeEstimate"),
    },
  });
}

export async function googleWorkspaceDisconnect(config: ServerConfig, accountId: string | null = null) {
  const vault = await readGoogleWorkspaceVault(config);
  const accounts = googleWorkspaceAccountRecords(vault);
  const selectedAccounts = accountId
    ? accounts.filter((entry) => googleWorkspaceAccountId(entry) === accountId)
    : accounts;
  let revokeError: Error | null = null;
  for (const record of selectedAccounts) {
    const token = isRecord(record.token) ? record.token : null;
    const revokeToken = typeof token?.refreshToken === "string" ? token.refreshToken : typeof token?.accessToken === "string" ? token.accessToken : "";
    if (!revokeToken) continue;
    try {
      await fetchGoogleJson("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: revokeToken }),
      });
    } catch (error) {
      revokeError = error instanceof Error ? error : new Error(String(error));
    }
  }
  const remainingAccounts = accountId
    ? accounts.filter((entry) => googleWorkspaceAccountId(entry) !== accountId)
    : [];
  const activeAccountId = remainingAccounts.length > 0 ? googleWorkspaceAccountId(remainingAccounts[0]) : null;
  await writeGoogleWorkspaceAccountsVault(config, remainingAccounts, activeAccountId);
  const nextVault = await readGoogleWorkspaceVault(config);
  return googleWorkspaceStatusPayload(nextVault, revokeError ? { error: `Local Google Workspace tokens were removed, but Google token revocation failed: ${revokeError.message}` } : { testStatus: "Google Workspace access revoked and local tokens removed." });
}

function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function googleWorkspaceCallbackPage(status: number, title: string, body: string) {
  return new Response(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body style="font-family: system-ui, sans-serif; padding: 32px;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><script>setTimeout(() => window.close(), 800);</script></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", Connection: "close" },
  });
}

export function createGoogleWorkspaceConnectFlowManager(config: ServerConfig) {
  const flows = new Map<string, GoogleWorkspaceFlow>();

  const cleanup = (flowId: string) => {
    const flow = flows.get(flowId);
    if (!flow) return;
    flow.server.closeAllConnections?.();
    flow.server.close(() => undefined);
    flows.delete(flowId);
  };

  const start = async () => {
    const credentials = googleWorkspaceCredentials();
    if (credentials.missing.length > 0) {
      throw new ApiError(400, "google_oauth_not_configured", `Missing Google OAuth configuration: ${credentials.missing.join(", ")}`);
    }
    const flowId = base64Url(randomBytes(18));
    const state = base64Url(randomBytes(24));
    const pkce = createGoogleWorkspacePkce();
    const expiresAt = Date.now() + GOOGLE_WORKSPACE_AUTH_TIMEOUT_MS;
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
            await finish(googleWorkspaceCallbackPage(410, "Google Workspace connection expired", "Return to OpenWork and start connection again."));
            return;
          }
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== "/" && url.pathname !== "/oauth/google-workspace/callback") {
            response.writeHead(404);
            response.end("Not found");
            return;
          }
          const error = url.searchParams.get("error");
          if (error) {
            flow.status = "failed";
            flow.error = `Google OAuth returned error: ${error}`;
            await finish(googleWorkspaceCallbackPage(400, "Google Workspace connection failed", error));
            return;
          }
          const returnedState = url.searchParams.get("state") ?? "";
          const code = url.searchParams.get("code") ?? "";
          if (returnedState !== flow.state || !code) {
            flow.status = "failed";
            flow.error = "Invalid Google OAuth callback.";
            await finish(googleWorkspaceCallbackPage(400, "Google Workspace connection failed", "Invalid OAuth callback."));
            return;
          }
          await finish(googleWorkspaceCallbackPage(200, "Google Workspace authorization received", "You can return to OpenWork while it finishes connecting."));
          try {
            const token = await exchangeGoogleWorkspaceCode({ code, redirectUri: flow.redirectUri, verifier: flow.verifier });
            if (!isRecord(token) || typeof token.access_token !== "string") throw new Error("Google OAuth response did not include an access token.");
            const account = await fetchGoogleUserInfo(token.access_token);
            const record = {
              version: 1,
              account,
              scopes: typeof token.scope === "string" ? token.scope.split(/\s+/).filter(Boolean) : GOOGLE_WORKSPACE_SCOPES,
              token: {
                accessToken: token.access_token,
                refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
                expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
              },
              connectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await upsertGoogleWorkspaceAccount(config, record);
            flow.status = "connected";
            flow.account = account;
          } catch (exchangeError) {
            flow.status = "failed";
            flow.error = `Google authorized OpenWork, but token exchange failed: ${exchangeError instanceof Error ? exchangeError.message : String(exchangeError)}`;
          }
        } catch (callbackError) {
          const flow = flows.get(flowId);
          if (flow) {
            flow.status = "failed";
            flow.error = callbackError instanceof Error ? callbackError.message : String(callbackError);
          }
          if (!response.headersSent) {
            await finish(googleWorkspaceCallbackPage(500, "Google Workspace connection failed", callbackError instanceof Error ? callbackError.message : String(callbackError)));
          }
        }
      });
      callbackServer.once("error", reject);
      callbackServer.listen(0, "127.0.0.1", () => {
        const address = callbackServer?.address();
        const resolvedPort = typeof address === "object" && address ? address.port : null;
        if (!resolvedPort) reject(new Error("Could not start Google Workspace OAuth callback server."));
        else resolvePort(resolvedPort);
      });
    });
    if (!callbackServer) throw new Error("Could not start Google Workspace OAuth callback server.");
    const redirectUri = `http://127.0.0.1:${port}/`;
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", credentials.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", GOOGLE_WORKSPACE_SCOPES.join(" "));
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "consent");
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
      flow.error = "Google Workspace OAuth timed out.";
      flow.server.closeAllConnections?.();
      flow.server.close(() => undefined);
    }, GOOGLE_WORKSPACE_AUTH_TIMEOUT_MS + 1000).unref?.();
    return { flowId, authUrl: authorizationUrl.toString(), expiresAt };
  };

  const status = async (flowId: string) => {
    const flow = flows.get(flowId);
    if (!flow) throw new ApiError(404, "google_oauth_flow_not_found", "Google Workspace connection flow not found");
    if (flow.status === "pending" && flow.expiresAt <= Date.now()) {
      flow.status = "expired";
      flow.error = "Google Workspace OAuth timed out.";
    }
    const googleWorkspace = flow.status === "connected" ? await googleWorkspaceStatus(config) : null;
    const payload = {
      flowId: flow.flowId,
      status: flow.status,
      expiresAt: flow.expiresAt,
      error: flow.error,
      googleWorkspace,
    };
    if (flow.status !== "pending") setTimeout(() => cleanup(flow.flowId), 1000).unref?.();
    return payload;
  };

  return { start, status };
}
