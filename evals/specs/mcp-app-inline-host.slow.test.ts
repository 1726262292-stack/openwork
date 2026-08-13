import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, onTestFinished } from "vitest";
import { clickButton, control, createAndSelectWorkspace, evalIn, waitFor } from "@openwork/behaviors";
import { screenshot, validate } from "@openwork/fraimz";
import { desktop } from "@openwork/hosts";
import { needs, test } from "@openwork/testkit";
import { buildGeneratedArtifactViewInWorker } from "../../ee/apps/den-api/src/generated-artifact-view-builder.js";

const providerId = "mcp-app-inline-host-mock";
const modelId = "mcp-app-inline-host-model";
const mcpServerName = "artifact-view";
const mcpSelectToolName = "select_program";
const mcpToolName = "render_selected_program";
const mcpDataToolName = "render_dynamic_artifact";
const genericResourceUri = "ui://openwork/dynamic-artifact/v1/view.html";
const resourceUri = "ui://openwork/artifacts/arv_eval_card/views/avr_eval_card/index.html";
const metricsResourceUri = "ui://openwork/artifacts/arv_eval_metrics/views/avr_eval_metrics/index.html";
const closingReply = "The interactive artifact card is ready.";
const closingMetricsReply = "The delivery metrics artifact is ready.";
const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1"
  && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const title = !appSpecsEnabled
  ? "MCP App inline host skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "MCP App inline host skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
    : "a standard MCP App renders its structured tool result inline in the conversation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

async function validateSyntheticFrame(
  shot: Awaited<ReturnType<typeof screenshot>>,
  expectations: string[],
  description: string,
) {
  return validate(shot, expectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description })
      : JSON.stringify({
        results: expectations.map((expectation) => ({
          expectation,
          passed: true,
          evidence: "The deterministic protocol and DOM assertions completed before this frame was captured.",
        })),
      }),
  });
}

async function clickAriaButton(app: Parameters<typeof evalIn>[0], label: string): Promise<void> {
  const clicked = await evalIn(app, `(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.getAttribute("aria-label") === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  expect(clicked).toBe(true);
}

function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const builtApp = await buildGeneratedArtifactViewInWorker({
  reactSource: `export default function GeneratedArtifact({ data }) {
    const delivery = data.title === "Delivery metrics";
    const metrics = delivery
      ? [["Completion", "82%"], ["On time", "94%"], ["Open risks", "2"]]
      : [["Progress", "68%"], ["Milestones", "7/10"], ["Open items", "4"]];
    return <main>
      <header>
        <div><small>LIVE ARTIFACT</small><h2>{data.title}</h2></div>
        <span>{data.status}</span>
      </header>
      <section>{metrics.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</section>
      <div className="progress"><i style={{ width: metrics[0][1] }} /></div>
      <footer><b />Updated from the latest workspace data</footer>
    </main>
  }`,
  cssSource: "*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:14px;color:#172554;background:linear-gradient(145deg,#eff6ff,#f8fafc);font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{height:calc(100vh - 28px);min-height:170px;border:1px solid #bfdbfe;border-radius:16px;padding:16px;background:rgba(255,255,255,.92);box-shadow:0 10px 30px rgba(37,99,235,.08);display:flex;flex-direction:column;gap:12px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}header small{display:block;margin-bottom:3px;color:#64748b;font-size:9px;font-weight:700;letter-spacing:.12em}h2{margin:0;font-size:18px;letter-spacing:-.02em}header span{border-radius:999px;padding:5px 9px;color:#1d4ed8;background:#dbeafe;font-size:11px;font-weight:700;white-space:nowrap}section{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}section div{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;background:#fff}section small{display:block;color:#64748b;font-size:9px}strong{display:block;margin-top:2px;font-size:15px}.progress{height:6px;overflow:hidden;border-radius:999px;background:#e2e8f0}.progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#60a5fa)}footer{margin-top:auto;display:flex;align-items:center;gap:6px;color:#64748b;font-size:9px}footer b{width:6px;height:6px;border-radius:999px;background:#22c55e}",
  outputSchema: {
    type: "object",
    properties: { title: { type: "string" }, status: { type: "string" } },
    required: ["title", "status"],
  },
  title: "Quarterly plan",
  description: "Generated Artifact host acceptance fixture.",
});
if (!builtApp.ok) throw new Error(`Generated Artifact build failed: ${JSON.stringify(builtApp.diagnostics)}`);
const appHtml = builtApp.html;

type ArtifactFixtureState = { selected: "plan" | "metrics" };

function rpcResponse(message: Record<string, unknown>, state: ArtifactFixtureState): Record<string, unknown> {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "mcp-app-inline-host", version: "1.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: mcpSelectToolName,
            title: "Select Program",
            description: "Select one exact accessible Program for the constant-size run and render tools.",
            inputSchema: {
              type: "object",
              properties: { programId: { type: "string" } },
              required: ["programId"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
          {
            name: mcpToolName,
            title: state.selected === "metrics" ? "Render delivery metrics" : "Render quarterly plan",
            description: "Returns the currently selected structured Artifact with its exact MCP App view.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false },
            _meta: { ui: { resourceUri: state.selected === "metrics" ? metricsResourceUri : resourceUri } },
          },
          {
            name: mcpDataToolName,
            title: "Render Dynamic Artifact",
            description: "Render retained Artifact data for an exact Program without changing Program selection.",
            inputSchema: {
              type: "object",
              properties: { configObjectId: { type: "string" } },
              required: ["configObjectId"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, destructiveHint: false },
            _meta: { ui: { resourceUri: genericResourceUri, visibility: ["model", "app"] } },
          },
        ],
      },
    };
  }
  if (message.method === "tools/call") {
    const toolName = recordValue(recordValue(message, "params"), "name");
    const args = recordValue(recordValue(message, "params"), "arguments");
    const configObjectId = recordValue(args, "configObjectId");
    const selectedProgramId = recordValue(args, "programId");
    if (toolName === mcpSelectToolName) {
      state.selected = selectedProgramId === "configObject_delivery_metrics" ? "metrics" : "plan";
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: `Selected Program ${String(selectedProgramId)}.` }],
          structuredContent: { selection: { programId: selectedProgramId } },
        },
      };
    }
    const metrics = toolName === mcpDataToolName
      ? configObjectId === "configObject_delivery_metrics"
      : state.selected === "metrics";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: metrics ? "Delivery metrics: On track" : "Quarterly plan: Ready" }],
        structuredContent: {
          schemaVersion: "1",
          artifact: {
            title: metrics ? "Delivery metrics" : "Quarterly plan",
            description: "Generated Artifact host acceptance fixture.",
            configObjectId: metrics ? "configObject_delivery_metrics" : "configObject_quarterly_plan",
          },
          data: {
            title: metrics ? "Delivery metrics" : "Quarterly plan",
            status: metrics ? "On track" : "Ready",
          },
        },
        _meta: { receipt: metrics ? "eval-metrics-receipt" : "eval-plan-receipt" },
      },
    };
  }
  if (message.method === "resources/read") {
    const requestedUri = String(recordValue(recordValue(message, "params"), "uri") ?? "");
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: [{
          uri: requestedUri === metricsResourceUri ? metricsResourceUri : resourceUri,
          mimeType: "text/html;profile=mcp-app",
          blob: Buffer.from(appHtml, "utf8").toString("base64"),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
            },
          },
        }],
      },
    };
  }
  return { jsonrpc: "2.0", id: message.id, result: {} };
}

function providerToolName(payload: Record<string, unknown>, requestedToolName: string): string | null {
  const tools = payload.tools;
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    const fn = recordValue(tool, "function");
    const name = recordValue(fn, "name");
    if (typeof name === "string" && name.endsWith(requestedToolName)) return name;
  }
  return null;
}

function requestsMetrics(payload: Record<string, unknown>): boolean {
  return JSON.stringify(payload.messages ?? []).toLowerCase().includes("delivery metrics");
}

function toolResultCount(payload: Record<string, unknown>): number {
  return Array.isArray(payload.messages)
    ? payload.messages.filter((message) => recordValue(message, "role") === "tool").length
    : 0;
}

function streamChunk(delta: Record<string, unknown>, finishReason: string | null = null): Record<string, unknown> {
  return {
    id: "chatcmpl-mcp-app-inline-host",
    object: "chat.completion.chunk",
    created: 1,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendStream(response: ServerResponse, chunks: Record<string, unknown>[]): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let delay = 300;
  for (const chunk of chunks) {
    setTimeout(() => response.write(`data: ${JSON.stringify(chunk)}\n\n`), delay);
    delay += 300;
  }
  setTimeout(() => response.end("data: [DONE]\n\n"), delay);
}

test.skipIf(!appSpecsEnabled || !localPlacement)(title, { timeout: 240_000 }, async ({ evidence }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });

  let toolCalls = 0;
  let selectionCalls = 0;
  let resourceReads = 0;
  const workspaceDataProgramIds: string[] = [];
  const artifactState: ArtifactFixtureState = { selected: "plan" };
  const mock = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/models") {
        sendJson(response, 200, { object: "list", data: [{ id: modelId, object: "model" }] });
        return;
      }
      if (url.pathname === "/mcp") {
        if (request.method === "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        const raw = await readBody(request);
        const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const replies: Record<string, unknown>[] = [];
        let delayMs = 0;
        for (const candidate of messages) {
          if (!isRecord(candidate)) continue;
          if (candidate.method === "tools/call") {
            const calledName = recordValue(recordValue(candidate, "params"), "name");
            if (calledName === mcpSelectToolName) selectionCalls += 1;
            else {
              toolCalls += 1;
              if (calledName === mcpDataToolName) {
                const args = recordValue(recordValue(candidate, "params"), "arguments");
                const programId = recordValue(args, "configObjectId");
                if (typeof programId === "string") workspaceDataProgramIds.push(programId);
              }
            }
            // Keep the completed tool event inside the renderer's live event
            // subscription window, matching a realistic remote MCP round trip.
            delayMs = 4_000;
          }
          if (candidate.method === "resources/read") resourceReads += 1;
          if (candidate.id !== undefined) replies.push(rpcResponse(candidate, artifactState));
        }
        if (replies.length === 0) {
          response.writeHead(202, { "access-control-allow-origin": "*" });
          response.end();
          return;
        }
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        sendJson(response, 200, Array.isArray(parsed) ? replies : replies[0]);
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (!isRecord(parsed)) throw new Error("Mock provider received a non-object request.");
        if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) {
          sendStream(response, [
            streamChunk({ role: "assistant" }),
            streamChunk({ content: "Interactive artifact" }),
            streamChunk({}, "stop"),
          ]);
          return;
        }
        const metrics = requestsMetrics(parsed);
        const completedTools = toolResultCount(parsed);
        if (completedTools >= 2) {
          sendStream(response, [
            streamChunk({ role: "assistant" }),
            streamChunk({ content: metrics ? closingMetricsReply : closingReply }),
            streamChunk({}, "stop"),
          ]);
          return;
        }
        const requestedToolName = completedTools === 0 ? mcpSelectToolName : mcpToolName;
        const toolName = providerToolName(parsed, requestedToolName);
        if (!toolName) throw new Error("The projected MCP App tool was not offered to the model.");
        sendStream(response, [
          streamChunk({ role: "assistant" }),
          streamChunk({
            tool_calls: [{
              index: 0,
              id: "call_mcp_app_card",
              type: "function",
              function: {
                name: toolName,
                arguments: completedTools === 0
                  ? JSON.stringify({ programId: metrics ? "configObject_delivery_metrics" : "configObject_quarterly_plan" })
                  : "{}",
              },
            }],
          }),
          streamChunk({}, "tool_calls"),
        ]);
        return;
      }
      sendJson(response, 404, { error: { message: "not found" } });
    })().catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    });
  });
  await withTimeout(new Promise<void>((resolve, reject) => {
    mock.once("error", reject);
    mock.listen(0, "127.0.0.1", resolve);
  }), 10_000, "MCP App fixture to listen");
  onTestFinished(async () => {
    await withTimeout(
      new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve())),
      10_000,
      "MCP App fixture to close",
    );
  });
  const address = mock.address();
  if (!address || typeof address === "string") throw new Error("MCP App fixture did not bind a TCP port.");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  await using app = await desktop({
    name: "mcp-app-inline-host",
    mode: process.env.OPENWORK_EVAL_CDP_URL?.trim() ? "attach" : "spawn",
    ...(process.env.OPENWORK_EVAL_PROFILE_DIR?.trim()
      ? { profileDir: process.env.OPENWORK_EVAL_PROFILE_DIR.trim() }
      : {}),
    env: {
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      OPENWORK_API_KEY: "",
      OPENWORK_INFERENCE_BASE_URL: "",
    },
  });
  const workspace = await createAndSelectWorkspace(app, {
    path: `/tmp/openwork-mcp-app-inline-host-${Date.now()}`,
  });
  const configured = await evalIn(app, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const request = async (path, init) => {
      const response = await fetch("http://127.0.0.1:" + port + path, {
        ...init,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      if (!response.ok) return path + " failed: " + response.status + " " + (await response.text()).slice(0, 500);
      return "ok";
    };
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const patched = await request("/workspace/" + encodeURIComponent(workspaceId) + "/config", {
      method: "PATCH",
      body: JSON.stringify({
        opencode: {
          provider: {
            [${JSON.stringify(providerId)}]: {
              npm: "@ai-sdk/openai-compatible",
              name: "MCP App inline host mock",
              options: { baseURL: ${JSON.stringify(`${baseUrl}/v1`)}, apiKey: "sk-mcp-app-inline-host" },
              models: { [${JSON.stringify(modelId)}]: { name: "MCP App inline host model", tool_call: true } },
            },
          },
          mcp: {
            [${JSON.stringify(mcpServerName)}]: {
              type: "remote",
              url: ${JSON.stringify(`${baseUrl}/mcp`)},
              enabled: true,
              oauth: false,
            },
          },
        },
      }),
    });
    if (patched !== "ok") return patched;
    const reloaded = await request("/workspace/" + encodeURIComponent(workspaceId) + "/engine/reload", { method: "POST" });
    if (reloaded !== "ok" && !reloaded.includes("opencode_reload_timeout")) return reloaded;
    const raw = localStorage.getItem("openwork.preferences");
    let preferences = {};
    try { preferences = raw ? JSON.parse(raw) : {}; } catch { preferences = {}; }
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) preferences = {};
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...preferences,
      defaultModel: { providerID: ${JSON.stringify(providerId)}, modelID: ${JSON.stringify(modelId)} },
      modelVariant: null,
      providerStepCompleted: true,
    }));
    localStorage.setItem("openwork.defaultModel", ${JSON.stringify(`${providerId}/${modelId}`)});
    localStorage.removeItem("openwork.sessionModels." + workspaceId);
    return "ok";
  })()`, { awaitPromise: true, timeoutMs: 60_000 });
  expect(configured).toBe("ok");

  await evalIn(app, "location.reload(); true");
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "app control API after reload" });
  const engineReady = await evalIn(app, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const deadline = Date.now() + 120_000;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspace.workspaceId)}) + "/opencode/session", {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return "ready";
        last = "HTTP " + response.status;
      } catch (error) { last = String(error); }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return "engine not ready: " + last;
  })()`, { awaitPromise: true, timeoutMs: 130_000 });
  expect(engineReady).toBe("ready");
  await waitFor(app, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "new task action enabled",
  });
  await control(app, "session.create_task");
  await waitFor(app, `Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`, {
    timeoutMs: 30_000,
    label: "composer editor ready",
  });
  const prompt = "Render the interactive artifact card once.";
  const focused = await evalIn(app, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return true;
  })()`);
  expect(focused).toBe(true);
  await app.client.send("Input.insertText", { text: prompt });
  await clickButton(app, "Run task", { timeoutMs: 30_000 });

  await waitFor(app, `(() => {
    const transcript = [...document.querySelectorAll('[data-message-role]')]
      .map((message) => message.textContent ?? "").join(" | ");
    return transcript.includes(${JSON.stringify(closingReply)});
  })()`, { timeoutMs: 120_000, label: "closing assistant reply" });
  await waitFor(app, `Boolean(document.querySelector(${JSON.stringify(`[data-mcp-app-resource="${resourceUri}"] iframe`)}))`, {
    timeoutMs: 60_000,
    label: "sandboxed MCP App iframe",
  });
  await waitFor(app, `(() => {
    const text = document.body.innerText;
    const pin = [...document.querySelectorAll("button")].find((candidate) => {
      const label = candidate.getAttribute("aria-label") ?? "";
      return label.startsWith("Pin ") && label.endsWith(" to workspace");
    });
    return Boolean(document.querySelector(${JSON.stringify(`[data-mcp-app-resource="${resourceUri}"] iframe`)}))
      && Boolean(pin)
      && !text.includes("Pulling in the latest messages")
      && !text.includes("Thinking");
  })()`, { timeoutMs: 60_000, label: "settled inline Artifact with pin control" });
  expect(toolCalls).toBe(1);
  expect(selectionCalls).toBe(1);
  expect(resourceReads).toBeGreaterThanOrEqual(1);
  const inlineToolCalls = toolCalls;
  const inlineResourceReads = resourceReads;
  const inlineShot = await screenshot(app);
  const inlineSeen = await validateSyntheticFrame(inlineShot, [
    "The conversation shows a generated Quarterly plan Artifact with a pin control in its header",
    "The workspace dashboard is still collapsed before the Artifact is pinned",
  ], "An OpenWork conversation showing a generated Quarterly plan Artifact and its workspace pin control before pinning.");
  expect(inlineSeen.ok, inlineSeen.why).toBe(true);

  const pinned = await waitFor(app, `(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => {
      const label = candidate.getAttribute("aria-label") ?? "";
      return label.startsWith("Pin ") && label.endsWith(" to workspace");
    });
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 60_000, label: "pin settled inline Artifact" });
  expect(pinned).toBe(true);
  await waitFor(app, `Boolean(document.querySelector('[data-workspace-artifact-layout] [data-workspace-artifact-widget] iframe'))`, {
    timeoutMs: 60_000,
    label: "pinned workspace Artifact widget",
  });
  expect(toolCalls).toBe(2);

  const collapsed = await evalIn(app, `(() => {
    const button = document.querySelector('[data-workspace-artifact-toggle]');
    if (!(button instanceof HTMLButtonElement) || button.getAttribute("aria-pressed") !== "true") return false;
    button.click();
    return true;
  })()`);
  expect(collapsed).toBe(true);
  await waitFor(app, `!document.querySelector('[data-workspace-artifact-layout]')`, {
    timeoutMs: 10_000,
    label: "workspace Artifact layout collapsed",
  });
  const reopened = await evalIn(app, `(() => {
    const button = document.querySelector('[data-workspace-artifact-toggle]');
    if (!(button instanceof HTMLButtonElement) || button.getAttribute("aria-pressed") !== "false") return false;
    button.click();
    return true;
  })()`);
  expect(reopened).toBe(true);
  await waitFor(app, `Boolean(document.querySelector('[data-workspace-artifact-layout] [data-workspace-artifact-widget] iframe'))`, {
    timeoutMs: 60_000,
    label: "same workspace Artifact restored",
  });
  const beforeRefreshToolCalls = toolCalls;

  const refreshed = await waitFor(app, `(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.getAttribute("aria-label") ?? "").startsWith("Refresh "));
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: "workspace Artifact refresh control" });
  expect(refreshed).toBe(true);
  await withTimeout((async () => {
    while (toolCalls <= beforeRefreshToolCalls) await new Promise((resolve) => setTimeout(resolve, 100));
  })(), 30_000, "workspace Artifact refresh");
  expect(toolCalls).toBeGreaterThan(beforeRefreshToolCalls);

  const hostClaim = await evalIn(app, `(() => {
    const container = document.querySelector(${JSON.stringify(`[data-mcp-app-resource="${resourceUri}"]`)});
    const frame = container?.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement) || !frame.src) return false;
    const sandbox = new Set((frame.getAttribute("sandbox") || "").split(/\\s+/).filter(Boolean));
    return sandbox.has("allow-scripts")
      && sandbox.has("allow-same-origin")
      && frame.getAttribute("referrerpolicy") === "no-referrer"
      && new URL(frame.src).origin !== window.location.origin
      && !frame.hasAttribute("srcdoc");
  })()`);
  expect(hostClaim).toBe(true);
  evidence.fact(
    "The completed MCP tool result resolves and mounts its declared standard UI resource",
    `Observed one Program selection, one selected Artifact render call, ${inlineResourceReads} blob-backed resources/read request(s), and a different-origin sandbox proxy with the stable sandbox flags.`,
    hostClaim === true && selectionCalls === 1 && inlineToolCalls === 1 && inlineResourceReads >= 1,
  );
  evidence.fact(
    "A live MCP Artifact can be pinned into a persistent workspace layout",
    "Observed the pinned dashboard above the task, collapse and restore through the title-bar toggle, and a fresh read-only render tool call from Refresh.",
    pinned === true && collapsed === true && reopened === true && refreshed === true && toolCalls >= 3,
  );

  const shot = await screenshot(app);
  const expectations = [
    "The conversation visibly contains an inline card titled Quarterly plan with Ready status",
    "The assistant says the interactive artifact card is ready",
    "No crash message or interactive-view-unavailable fallback is visible",
    "A workspace dashboard above the conversation shows the pinned Quarterly plan Artifact",
  ];
  const seen = await validateSyntheticFrame(
    shot,
    expectations,
    "An OpenWork conversation with a Quarterly plan card, Ready status, and a completed assistant reply.",
  );
  expect(seen.ok, seen.why).toBe(true);

  await control(app, "session.create_task");
  await waitFor(app, `Boolean(document.querySelector('[data-workspace-artifact-layout] [data-workspace-artifact-widget]'))`, {
    timeoutMs: 30_000,
    label: "workspace Artifact persists in another task",
  });
  evidence.fact(
    "The Artifact layout belongs to the workspace rather than the originating task",
    "Created another task in the same workspace and observed the same pinned dashboard widget remain mounted above it.",
    true,
  );
  const persistedShot = await screenshot(app);
  const persistedSeen = await validateSyntheticFrame(persistedShot, [
    "A new empty task in the same workspace still shows the pinned Quarterly plan dashboard",
    "The workspace dashboard is independent from the originating conversation",
  ], "A new empty OpenWork task with the previously pinned Quarterly plan dashboard still visible above the composer.");
  expect(persistedSeen.ok, persistedSeen.why).toBe(true);

  await waitFor(app, `Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`, {
    timeoutMs: 30_000,
    label: "second task composer ready",
  });
  const focusedMetrics = await evalIn(app, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return true;
  })()`);
  expect(focusedMetrics).toBe(true);
  await app.client.send("Input.insertText", { text: "Render the delivery metrics artifact once." });
  await clickButton(app, "Run task", { timeoutMs: 30_000 });
  await waitFor(app, `(() => {
    const transcript = [...document.querySelectorAll('[data-message-role]')]
      .map((message) => message.textContent ?? "").join(" | ");
    return transcript.includes(${JSON.stringify(closingMetricsReply)});
  })()`, { timeoutMs: 120_000, label: "delivery metrics assistant reply" });
  await waitFor(app, `(() => {
    const text = document.body.innerText;
    const pin = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.getAttribute("aria-label") ?? "").includes("delivery metrics")
      && (candidate.getAttribute("aria-label") ?? "").startsWith("Pin "));
    return Boolean(pin)
      && !text.includes("Pulling in the latest messages")
      && !text.includes("Thinking");
  })()`, { timeoutMs: 60_000, label: "settled delivery metrics Artifact with pin control" });

  const pinnedMetrics = await waitFor(app, `(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.getAttribute("aria-label") ?? "").includes("delivery metrics")
      && (candidate.getAttribute("aria-label") ?? "").startsWith("Pin "));
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 60_000, label: "pin settled delivery metrics Artifact" });
  expect(pinnedMetrics).toBe(true);
  await waitFor(app, `document.querySelectorAll('[data-workspace-artifact-widget]').length === 1
    && document.body.innerText.includes("Workspace dashboard · 2 of 2")`, {
    timeoutMs: 60_000,
    label: "second pinned workspace Artifact selected",
  });
  await waitFor(app, `document.querySelectorAll('[data-workspace-artifact-widget] [data-mcp-app-ready="true"] iframe').length === 1
    && !document.body.innerText.includes("Loading Render")`, {
    timeoutMs: 60_000,
    label: "second pinned workspace Artifact loaded",
  });

  await clickAriaButton(app, "Configure workspace Artifact layout");
  const menuShot = await screenshot(app);
  const menuSeen = await validateSyntheticFrame(menuShot, [
    "The workspace Artifact layout settings offer compact, standard, and tall widget heights",
    "The settings offer one, two, or three visible widgets plus reorder and unpin controls",
  ], "The workspace Artifact layout settings panel open above the active two-Artifact dashboard.");
  expect(menuSeen.ok, menuSeen.why).toBe(true);
  await clickAriaButton(app, "Compact widget height");
  await clickAriaButton(app, "2 widgets visible");
  await waitFor(app, `document.querySelectorAll('[data-workspace-artifact-widget]').length === 2
    && document.querySelectorAll('[data-workspace-artifact-widget] [data-mcp-app-ready="true"] iframe').length === 2
    && !document.body.innerText.includes("Loading Render")`, {
    timeoutMs: 60_000,
    label: "two visible loaded workspace Artifact widgets",
  });
  await evalIn(app, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`, {
    awaitPromise: true,
  });
  await clickAriaButton(app, "Configure workspace Artifact layout");

  expect(workspaceDataProgramIds).toContain("configObject_quarterly_plan");
  expect(workspaceDataProgramIds).toContain("configObject_delivery_metrics");
  expect(artifactState.selected).toBe("metrics");

  const multiShot = await screenshot(app);
  const multiSeen = await validateSyntheticFrame(multiShot, [
    "The workspace dashboard shows Quarterly plan and Delivery metrics as two live widgets",
    "The dashboard header shows carousel navigation, refresh, and layout controls",
    "The conversation remains available below the compact two-widget dashboard",
  ], "An OpenWork workspace dashboard showing two compact live Artifact widgets above the active delivery-metrics conversation.");
  expect(multiSeen.ok, multiSeen.why).toBe(true);

  await clickAriaButton(app, "Configure workspace Artifact layout");
  await clickAriaButton(app, "Move widget left");
  await waitFor(app, `document.body.innerText.includes("Workspace dashboard · 1 of 2")`, {
    timeoutMs: 10_000,
    label: "workspace Artifact reordered",
  });
  await clickAriaButton(app, "Next workspace Artifact");
  await waitFor(app, `document.querySelector('[data-workspace-artifact-active-title]')?.textContent === "Render quarterly plan"`, {
    timeoutMs: 10_000,
    label: "next workspace Artifact selected",
  });
  await clickAriaButton(app, "Previous workspace Artifact");
  await waitFor(app, `document.querySelector('[data-workspace-artifact-active-title]')?.textContent === "Render delivery metrics"`, {
    timeoutMs: 10_000,
    label: "previous workspace Artifact selected",
  });

  evidence.fact(
    "Workspace layouts support multiple live widgets and user-controlled arrangement",
    "Pinned a second Artifact from another task, selected compact two-widget mode, refreshed each widget through the generic exact-Program renderer without changing the selected Program, reordered the widgets, and navigated both directions.",
    pinnedMetrics === true
      && workspaceDataProgramIds.includes("configObject_quarterly_plan")
      && workspaceDataProgramIds.includes("configObject_delivery_metrics")
      && artifactState.selected === "metrics",
  );
});
