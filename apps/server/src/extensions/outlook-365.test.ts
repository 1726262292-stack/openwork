import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerConfig } from "../types.js";
import { listExperimentalExtensionActions } from "./index.js";
import {
  callOutlook365ExtensionAction,
  createOutlook365ConnectFlowManager,
  outlook365Disconnect,
  outlook365Status,
  outlook365TestConnection,
} from "./outlook-365.js";

function createTestConfig(): ServerConfig {
  const tempDir = join(
    tmpdir(),
    `openwork-outlook-365-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectedFlag(value: unknown) {
  return isRecord(value) && value.connected === true;
}

function accountMail(value: unknown) {
  if (!isRecord(value) || !isRecord(value.account)) return null;
  return typeof value.account.mail === "string" ? value.account.mail : null;
}

const previousEnv = {
  mock: process.env.OPENWORK_OUTLOOK_365_MOCK,
  dev: process.env.OPENWORK_DEV_MODE,
  plaintext: process.env.OPENWORK_OUTLOOK_365_ALLOW_PLAINTEXT_VAULT,
  clientId: process.env.OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID,
};

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === "string") process.env[key] = value;
  else delete process.env[key];
}

afterEach(() => {
  restoreEnv("OPENWORK_OUTLOOK_365_MOCK", previousEnv.mock);
  restoreEnv("OPENWORK_DEV_MODE", previousEnv.dev);
  restoreEnv("OPENWORK_OUTLOOK_365_ALLOW_PLAINTEXT_VAULT", previousEnv.plaintext);
  restoreEnv("OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID", previousEnv.clientId);
});

describe("Outlook 365 extension", () => {
  test("registers the minimal extension status action", () => {
    expect(listExperimentalExtensionActions("outlook-365")).toEqual([
      expect.objectContaining({ extensionId: "outlook-365", action: "status" }),
    ]);
  });

  test("reports missing OAuth client without mock mode", async () => {
    process.env.OPENWORK_OUTLOOK_365_MOCK = "0";
    process.env.OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID = "";
    const status = await outlook365Status(createTestConfig());
    expect(status.configured).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.missing).toContain("OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID");
  });

  test("mock connect flow exercises connect, status, test, and disconnect", async () => {
    process.env.OPENWORK_OUTLOOK_365_MOCK = "1";
    process.env.OPENWORK_DEV_MODE = "1";
    process.env.OPENWORK_OUTLOOK_365_ALLOW_PLAINTEXT_VAULT = "1";
    const config = createTestConfig();
    const flows = createOutlook365ConnectFlowManager(config);

    const started = await flows.start();
    expect(started.authUrl).toBe("mock://outlook-365/authorize");

    const flowStatus = await flows.status(started.flowId);
    expect(flowStatus.status).toBe("connected");
    expect(connectedFlag(flowStatus.outlook365)).toBe(true);

    const status = await outlook365Status(config);
    expect(status.connected).toBe(true);
    expect(accountMail(status)).toBe("mock.user@example.com");

    const tested = await outlook365TestConnection(config);
    expect(tested.connected).toBe(true);
    expect(String(tested.testStatus)).toContain("User.Read");

    const actionResult = await callOutlook365ExtensionAction(config, "status", {}, {});
    expect(isRecord(actionResult) && isRecord(actionResult.result) && actionResult.result.connected).toBe(true);

    const disconnected = await outlook365Disconnect(config);
    expect(disconnected.connected).toBe(false);
  });
});
