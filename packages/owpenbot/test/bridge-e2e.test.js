import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startBridge } from "../dist/bridge.js";

function createLoggerStub() {
  const base = {
    child() {
      return base;
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  return base;
}

test("bridge end-to-end: inbound -> prompt -> outbound", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owpenbot-e2e-"));
  const dbPath = path.join(dir, "owpenbot.db");

  const sent = [];
  const slackAdapter = {
    name: "slack",
    maxTextLength: 39_000,
    async start() {},
    async stop() {},
    async sendText(peerId, text) {
      sent.push({ peerId, text });
    },
  };

  const fakeClient = {
    global: {
      health: async () => ({ healthy: true, version: "test" }),
    },
    session: {
      create: async () => ({ id: "session-1" }),
      prompt: async () => ({ parts: [{ type: "text", text: "pong" }] }),
    },
  };

  const bridge = await startBridge(
    {
      configPath: path.join(dir, "owpenbot.json"),
      configFile: { version: 1 },
      opencodeUrl: "http://127.0.0.1:4096",
      opencodeDirectory: dir,
      telegramEnabled: false,
      whatsappEnabled: false,
      slackEnabled: false,
      whatsappAuthDir: dir,
      whatsappAccountId: "default",
      whatsappDmPolicy: "disabled",
      whatsappAllowFrom: new Set(),
      whatsappSelfChatMode: false,
      dataDir: dir,
      dbPath,
      logFile: path.join(dir, "owpenbot.log"),
      allowlist: {
        telegram: new Set(),
        whatsapp: new Set(),
        slack: new Set(),
      },
      toolUpdatesEnabled: false,
      groupsEnabled: false,
      permissionMode: "allow",
      toolOutputLimit: 1200,
      logLevel: "silent",
    },
    createLoggerStub(),
    undefined,
    {
      client: fakeClient,
      adapters: new Map([["slack", slackAdapter]]),
      disableEventStream: true,
      disableHealthServer: true,
    },
  );

  await bridge.dispatchInbound({ channel: "slack", peerId: "D123", text: "ping", raw: {} });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].peerId, "D123");
  assert.equal(sent[1].peerId, "D123");
  assert.ok(sent[0].text.includes("Session started."));
  assert.equal(sent[1].text, "pong");

  await bridge.stop();
});
