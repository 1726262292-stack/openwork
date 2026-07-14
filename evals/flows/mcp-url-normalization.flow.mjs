/**
 * User-facing demo: MCP connection URLs are normalized on save (PR #2759).
 *
 * The field failure: a PostHog MCP URL carrying an invisible trailing period
 * in its hostname (`https://us.posthog.com./mcp`) — a legal URL that passes
 * validation, gets stored verbatim, and then breaks OAuth issuer/resource
 * comparisons with a provider-side "invalid argument".
 *
 * Frame 1 drives the real desktop Add Custom App modal with a dotted URL to a
 * live public MCP server and witnesses the saved workspace config. Frame 2
 * witnesses the same normalization on the Den API create path (requires the
 * local den stack).
 */
import http from "node:http";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "mcp-url-normalization";
const MCP_NAME = "dotted-url-proof";
const DOTTED_URL = "https://mcp.context7.com./mcp";
const NORMALIZED_URL = "https://mcp.context7.com/mcp";
const DEN_CONNECTION_PREFIX = "Dotted URL normalization proof";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const state = { server: null, denConnectionId: "" };

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : JSON.stringify(actual).slice(0, 1_200),
  });
  ctx.assert(condition, `${assertion}${actual === undefined ? "" : `. Actual: ${JSON.stringify(actual).slice(0, 600)}`}`);
}

const serverCallExpr = (pathTemplate) => `(async () => {
  const port = localStorage.getItem("openwork.server.port");
  const token = localStorage.getItem("openwork.server.token");
  if (!port || !token) return { ok: false, error: "no server port/token in localStorage" };
  const base = "http://127.0.0.1:" + port;
  const headers = { Authorization: "Bearer " + token };
  const wsResponse = await fetch(base + "/workspaces", { headers });
  if (!wsResponse.ok) return { ok: false, error: "workspaces " + wsResponse.status };
  const wsPayload = await wsResponse.json();
  const workspaces = Array.isArray(wsPayload) ? wsPayload : wsPayload.items ?? [];
  const fromHash = (window.location.hash.match(/workspace\\/(ws_[a-z0-9]+)/) ?? [])[1];
  const active = localStorage.getItem("openwork.react.activeWorkspace");
  const workspace = workspaces.find((entry) => entry.id === (fromHash || active)) ?? workspaces[0];
  if (!workspace) return { ok: false, error: "no workspace" };
  const response = await fetch(base + ${JSON.stringify(pathTemplate)}.replace(":id", workspace.id), { headers });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { ok: response.ok, status: response.status, workspaceId: workspace.id, payload, raw: text };
})()`;

async function openExtensions(ctx) {
  await ctx.eval(`(() => {
    const hash = window.location.hash;
    const workspace = hash.match(/#\\/workspace\\/[^/]+/);
    window.location.hash = workspace
      ? workspace[0].slice(1) + "/settings/extensions/mcp"
      : "/settings/extensions/mcp";
    return true;
  })()`);
  await ctx.waitForText("Add Custom App", { timeoutMs: 30_000 });
}

async function removeEntryIfPresent(ctx, name) {
  const present = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(name)})`);
  if (!present) return;
  await ctx.clickText(name, { timeoutMs: 10_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  await ctx.clickText("Remove", { timeoutMs: 5_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  // Confirm modal ("Remove app") — click its confirming Remove button.
  await ctx.eval(`(() => {
    const dialog = document.querySelector("[role=dialog]");
    if (!dialog) return false;
    const confirm = [...dialog.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Remove");
    if (confirm) confirm.click();
    return Boolean(confirm);
  })()`);
  await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(name)})`, { timeoutMs: 15_000, label: `${name} removed` }).catch(() => {});
}

function json(response, status, body) {
  response.writeHead(status, { "access-control-allow-origin": "*", "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

/** Minimal MCP responder listening on the IPv6+IPv4 loopback so the dotted
 * hostname `localhost.` (an absolute FQDN) resolves and connects to it. */
async function startDualStackMock() {
  if (state.server) return;
  state.server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp" || request.method !== "POST") {
        json(response, 404, { error: "not_found" });
        return;
      }
      const body = await readJson(request);
      const messages = Array.isArray(body) ? body : [body];
      const replies = [];
      for (const message of messages) {
        if (message && typeof message === "object" && message.id !== undefined) {
          const result = message.method === "initialize"
            ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dotted-url-proof", version: "1.0.0" } }
            : message.method === "tools/list"
              ? { tools: [] }
              : {};
          replies.push({ jsonrpc: "2.0", id: message.id, result });
        }
      }
      if (replies.length === 0) {
        response.writeHead(202, { "access-control-allow-origin": "*" });
        response.end();
        return;
      }
      json(response, 200, Array.isArray(body) ? replies : replies[0]);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    state.server.once("error", reject);
    state.server.listen(0, resolve);
  });
  state.server.unref();
}

function mockPort() {
  const address = state.server?.address();
  if (!address || typeof address === "string") throw new Error("Mock MCP server has no TCP address.");
  return address.port;
}

async function denFetch(ctx, path, options = {}) {
  const base = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

export default {
  id: FLOW_ID,
  title: "MCP connection URLs are normalized on save — trailing hostname dots can't poison OAuth",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 120_000 });
      },
    },
    {
      name: "Adding a custom app with a dotted URL saves the cleaned address",
      run: async (ctx) => {
        await ctx.prove("The desktop stores and shows the normalized URL for a dotted-hostname custom app", {
          voiceover: vo[0],
          action: async () => {
            await openExtensions(ctx);
            await removeEntryIfPresent(ctx, MCP_NAME);
            await ctx.clickText("Add Custom App", { timeoutMs: 20_000 });
            await ctx.waitForText("Server URL", { timeoutMs: 15_000 });
            await ctx.fill('input[placeholder="github-copilot"]', MCP_NAME);
            await ctx.fill('input[placeholder="https://api.githubcopilot.com/mcp/"]', DOTTED_URL);
            await ctx.clickText("Add App", { timeoutMs: 10_000 });
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            // A sign-in modal can auto-open for fresh remote entries; close it.
            await ctx.eval(`(() => {
              const dialog = document.querySelector("[role=dialog]");
              const cancel = dialog && [...dialog.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Cancel");
              if (cancel) cancel.click();
              return true;
            })()`);
            await ctx.waitForText(MCP_NAME, { timeoutMs: 30_000 });
            // Expand the row, then open its "Technical details" disclosure so
            // the saved URL is visible in the frame.
            await ctx.clickText(MCP_NAME, { timeoutMs: 10_000 }).catch(() => {});
            await ctx.waitForText("Technical details", { timeoutMs: 10_000 });
            await ctx.clickText("Technical details", { timeoutMs: 10_000 });
            await ctx.waitFor(
              `document.body.innerText.includes(${JSON.stringify(NORMALIZED_URL)})`,
              { timeoutMs: 10_000, label: "saved URL visible" },
            );
          },
          assert: async () => {
            const mcp = await ctx.eval(serverCallExpr("/workspace/:id/mcp"), { awaitPromise: true });
            witness(ctx, mcp?.ok, "The workspace MCP config is readable through the real OpenWork server API.", { status: mcp?.status });
            const entry = (mcp.payload.items ?? []).find((item) => item.name === MCP_NAME);
            witness(ctx, Boolean(entry), "The custom app was saved.", (mcp.payload.items ?? []).map((item) => item.name));
            witness(ctx, entry.config?.url === NORMALIZED_URL, "The SAVED config URL has no trailing hostname dot.", entry.config?.url);
            const bodyHasNormalized = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(NORMALIZED_URL)})`);
            const bodyHasDotted = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(DOTTED_URL)})`);
            witness(ctx, bodyHasNormalized, "The app's row shows the normalized URL.");
            witness(ctx, !bodyHasDotted, "The dotted URL appears nowhere in the UI.");
          },
          screenshot: {
            name: "desktop-normalized-url",
            requireText: [MCP_NAME, NORMALIZED_URL],
            rejectText: ["mcp.context7.com./mcp", "Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "The Den API create path normalizes the same way",
      run: async (ctx) => {
        await ctx.prove("Creating an org connection with a dotted URL stores the normalized address and still connects", {
          voiceover: vo[1],
          action: async () => {
            await startDualStackMock();
            const token = ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();
            const existing = await denFetch(ctx, "/v1/mcp-connections?scope=manageable", {
              headers: { authorization: `Bearer ${token}` },
            });
            for (const connection of existing.body.connections ?? []) {
              if (connection.name.startsWith(DEN_CONNECTION_PREFIX)) {
                await denFetch(ctx, `/v1/mcp-connections/${connection.id}`, {
                  method: "DELETE",
                  headers: { authorization: `Bearer ${token}` },
                });
              }
            }
            ctx.denCreate = await denFetch(ctx, "/v1/mcp-connections", {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
              body: JSON.stringify({
                name: `${DEN_CONNECTION_PREFIX} ${Date.now()}`,
                url: `http://localhost.:${mockPort()}/mcp`,
                authType: "none",
                credentialMode: "shared",
                access: { orgWide: true, memberIds: [], teamIds: [] },
              }),
            });
            state.denConnectionId = ctx.denCreate.body?.id ?? "";
          },
          assert: async () => {
            const { response, body } = ctx.denCreate;
            witness(ctx, response.ok, "The dotted-URL connection request is accepted.", { status: response.status });
            witness(ctx, body?.url === `http://localhost:${mockPort()}/mcp`, "The STORED cloud connection URL has no trailing hostname dot.", body?.url);
            witness(ctx, body?.connected === true, "The connection still initializes against the live server after normalization.", body?.connected);
            ctx.output("den create response (url + connected)", JSON.stringify({ url: body?.url, connected: body?.connected, id: body?.id }, null, 2));
            if (state.denConnectionId) {
              await denFetch(ctx, `/v1/mcp-connections/${state.denConnectionId}`, {
                method: "DELETE",
                headers: { authorization: `Bearer ${ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim()}` },
              });
            }
          },
        });
      },
    },
    {
      name: "Cleanup: remove the desktop proof app",
      run: async (ctx) => {
        await openExtensions(ctx);
        await removeEntryIfPresent(ctx, MCP_NAME);
      },
    },
  ],
};
