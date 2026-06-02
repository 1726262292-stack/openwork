import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ServerConfig } from "../types.js";
import {
  callGoogleWorkspaceExtensionAction,
  GOOGLE_WORKSPACE_EXTENSION_ACTIONS,
  googleWorkspaceDisconnect,
  googleWorkspaceStatus,
} from "./google-workspace.js";

function createTestConfig(): ServerConfig {
  const tempDir = join(
    tmpdir(),
    `openwork-google-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return {
    host: "127.0.0.1",
    port: 8787,
    token: "test-client-token",
    hostToken: "test-host-token",
    configPath: join(tempDir, "server.json"),
    approval: { mode: "auto", timeoutMs: 30000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function plaintextVaultPath(config: ServerConfig) {
  return join(dirname(config.configPath ?? ""), "extensions", "google-workspace", "oauth.dev-plaintext.json");
}

async function writePlaintextVault(config: ServerConfig, value: Record<string, unknown>) {
  const target = plaintextVaultPath(config);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function accountRecord(email: string, sub: string) {
  return {
    account: { email, name: email, sub, picture: null },
    scopes: [
      "openid",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    token: { accessToken: `access-${sub}`, refreshToken: `refresh-${sub}`, expiresAt: Date.now() + 3600 * 1000 },
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const previousEnv = {
  devMode: process.env.OPENWORK_DEV_MODE,
  plaintextVault: process.env.OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT,
  clientSecret: process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET,
  legacyClientSecret: process.env.OPENWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET,
  brokerUrl: process.env.OPENWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL,
};
const previousFetch = globalThis.fetch;

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === "string") process.env[key] = value;
  else delete process.env[key];
}

afterEach(() => {
  restoreEnv("OPENWORK_DEV_MODE", previousEnv.devMode);
  restoreEnv("OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT", previousEnv.plaintextVault);
  restoreEnv("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", previousEnv.clientSecret);
  restoreEnv("OPENWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", previousEnv.legacyClientSecret);
  restoreEnv("OPENWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL", previousEnv.brokerUrl);
  globalThis.fetch = previousFetch;
});

describe("Google Workspace extension", () => {
  test("registers experimental Gmail read and Calendar write actions", () => {
    expect(GOOGLE_WORKSPACE_EXTENSION_ACTIONS.map((entry) => entry.action)).toContain("gmail_get_latest_message");
    expect(GOOGLE_WORKSPACE_EXTENSION_ACTIONS.map((entry) => entry.action)).toContain("gmail_read_message");
    expect(GOOGLE_WORKSPACE_EXTENSION_ACTIONS.map((entry) => entry.action)).toContain("gmail_download_attachment");
    expect(GOOGLE_WORKSPACE_EXTENSION_ACTIONS.map((entry) => entry.action)).toContain("calendar_create_event");
  });

  test("reports only the user-configurable OAuth secret as missing", async () => {
    process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "";
    process.env.OPENWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "";
    process.env.OPENWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL = "";
    const status = await googleWorkspaceStatus(createTestConfig());
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET"]);
  });

  test("reads multi-account vaults and exposes active account", async () => {
    process.env.OPENWORK_DEV_MODE = "1";
    process.env.OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT = "1";
    process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "secret";
    const config = createTestConfig();
    await writePlaintextVault(config, {
      version: 2,
      activeAccountId: "sub-two",
      accounts: [accountRecord("one@example.com", "sub-one"), accountRecord("two@example.com", "sub-two")],
    });

    const status = await googleWorkspaceStatus(config);
    expect(status.connected).toBe(true);
    expect(status.account?.email).toBe("two@example.com");
    expect(status.accounts.map((account) => account.email)).toEqual(["one@example.com", "two@example.com"]);
    expect(status.activeAccountId).toBe("sub-two");
    expect(status.experimentalScopesGranted).toBe(true);
  });

  test("reads latest Gmail message and exposes attachments", async () => {
    process.env.OPENWORK_DEV_MODE = "1";
    process.env.OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT = "1";
    process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "secret";
    const config = createTestConfig();
    await writePlaintextVault(config, {
      version: 2,
      activeAccountId: "sub-one",
      accounts: [accountRecord("one@example.com", "sub-one")],
    });
    globalThis.fetch = Object.assign(
      async (input: unknown) => {
        const url = input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?") && url.includes("maxResults=1")) {
          return new Response(JSON.stringify({ messages: [{ id: "msg-one" }], resultSizeEstimate: 1 }), { status: 200 });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-one?format=full") {
          return new Response(JSON.stringify({
            id: "msg-one",
            threadId: "thread-one",
            snippet: "Latest email snippet",
            labelIds: ["INBOX"],
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "Subject", value: "Latest email" },
                { name: "From", value: "sender@example.com" },
                { name: "To", value: "one@example.com" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: "SGVsbG8gZnJvbSBHbWFpbA" } },
                { partId: "1", filename: "notes.txt", mimeType: "text/plain", body: { attachmentId: "att-one", size: 11 } },
              ],
            },
          }), { status: 200 });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-one/attachments/att-one") {
          return new Response(JSON.stringify({ data: "YXR0YWNobWVudA", size: 10 }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: `Unexpected URL: ${url}` } }), { status: 404 });
      },
      { preconnect: previousFetch.preconnect },
    );

    const response = await callGoogleWorkspaceExtensionAction(config, "gmail_get_latest_message", {}, {});
    expect(response?.result).toMatchObject({
      query: "in:inbox",
      message: {
        id: "msg-one",
        subject: "Latest email",
        body: "Hello from Gmail",
      },
    });
    expect(response && "attachments" in response ? response.attachments : []).toEqual([
      {
        type: "file",
        mime: "text/plain",
        url: "data:text/plain;base64,YXR0YWNobWVudA==",
        filename: "notes.txt",
      },
    ]);
  });

  test("disconnect can remove one connected account", async () => {
    process.env.OPENWORK_DEV_MODE = "1";
    process.env.OPENWORK_GOOGLE_WORKSPACE_ALLOW_PLAINTEXT_VAULT = "1";
    process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "secret";
    globalThis.fetch = Object.assign(
      async () => new Response("{}", { status: 200 }),
      { preconnect: previousFetch.preconnect },
    );
    const config = createTestConfig();
    await writePlaintextVault(config, {
      version: 2,
      activeAccountId: "sub-one",
      accounts: [accountRecord("one@example.com", "sub-one"), accountRecord("two@example.com", "sub-two")],
    });

    const status = await googleWorkspaceDisconnect(config, "sub-one");
    expect(status.connected).toBe(true);
    expect(status.accounts.map((account) => account.email)).toEqual(["two@example.com"]);
    expect(status.activeAccountId).toBe("sub-two");
  });
});
