/**
 * Search + Execute: the agent discovers a capability by intent and runs it
 * through the single execute gateway — no bespoke tool name, no memorized
 * id, no internal file paths.
 *
 * Setup (as the user): a skill and an OAuth MCP (clientId + clientSecret)
 * exist in the workspace; the MCP is OpenWork-managed (runtime DB), so it
 * is invisible as a file. Then:
 *   1. Witness the index: capabilities/search ranks extensions.export first
 *      for the intent phrase "portable export of an mcp".
 *   2. The REAL agent is asked, in plain words, to find and run the right
 *      capability. Its reply must echo the executed capability id, the
 *      exported MCP url, and the redactedKeys — the url and key names exist
 *      only in the execute result, so the line cannot be produced without
 *      actually searching and executing. The OAuth client secret must never
 *      appear anywhere.
 *
 * Run: pnpm fraimz --flow capability-search-execute --cdp-url http://127.0.0.1:9826
 */

const SKILL_NAME = "cap-eval-skill";
const SKILL_DESCRIPTION = "Capability eval fixture skill.";
const MCP_NAME = "cap-eval-mcp";
const MCP_URL = "https://mcp.eval.example/cap";
const SECRET = "cap-eval-oauth-secret-4242";

const AGENT_MESSAGE = [
  `I need a portable definition of the MCP server "${MCP_NAME}" so I can inspect it and move it to another machine.`,
  "Use openwork_search to find the right capability, then run it with openwork_execute.",
  "Reply with exactly one line: CAPABILITY-RESULT <the capability id you executed> <the exported MCP config url> <the redactedKeys entries joined with commas>.",
  "Write values verbatim without quotes or angle brackets. Do not run any other tools.",
].join(" ");

// Unguessable from the prompt: the capability id, the MCP url, and the
// redacted key name all come from search/execute results only.
const AGENT_REPLY_RE = "CAPABILITY-RESULT\\s+extensions\\.export\\s+https:\\/\\/mcp\\.eval\\.example\\/cap\\s+oauth\\.clientSecret";

const serverCallExpr = (pathTemplate, init) => `(async () => {
  const port = localStorage.getItem("openwork.server.port");
  const token = localStorage.getItem("openwork.server.token");
  if (!port || !token) return { ok: false, error: "no server port/token in localStorage" };
  const base = "http://127.0.0.1:" + port;
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const wsResponse = await fetch(base + "/workspaces", { headers });
  if (!wsResponse.ok) return { ok: false, error: "workspaces " + wsResponse.status };
  const wsPayload = await wsResponse.json();
  const workspaces = Array.isArray(wsPayload) ? wsPayload : wsPayload.items ?? [];
  const fromHash = (window.location.hash.match(/workspace\\/(ws_[a-z0-9]+)/) ?? [])[1];
  const active = localStorage.getItem("openwork.react.activeWorkspace");
  const workspace = workspaces.find((entry) => entry.id === (fromHash || active)) ?? workspaces[0];
  if (!workspace) return { ok: false, error: "no workspace" };
  const response = await fetch(base + ${JSON.stringify(pathTemplate)}.replace(":id", workspace.id), {
    headers,
    ...${JSON.stringify(init ?? {})},
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  return { ok: response.ok, status: response.status, workspaceId: workspace.id, payload, raw: text };
})()`;

async function serverCall(ctx, pathTemplate, init, { tolerate = false } = {}) {
  const result = await ctx.eval(serverCallExpr(pathTemplate, init), { awaitPromise: true });
  if (!tolerate) {
    ctx.assert(result?.ok, `Server call ${pathTemplate} failed: ${result?.status ?? "?"} ${JSON.stringify(result?.payload ?? {}).slice(0, 300)}`);
  }
  return result;
}

async function pasteComposer(ctx, text) {
  return ctx.eval(
    `(() => {
      const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!editor) return { ok: false, reason: 'composer not found' };
      editor.focus();
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(text)});
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      return { ok: true };
    })()`,
  );
}

export default {
  id: "capability-search-execute",
  title: "Agent discovers a capability by intent and executes it through the gateway",
  spec: "apps/server/src/capabilities.ts",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API" });
    const route = await ctx.eval("window.__openworkControl.snapshot().route");
    return typeof route === "string" && (route.startsWith("/welcome") || route.startsWith("/signin"))
      ? "Profile is not onboarded (welcome/signin); flow requires a workspace."
      : null;
  },
  steps: [
    {
      name: "App boots; fixtures installed (skill + OAuth MCP with secret)",
      run: async (ctx) => {
        await ctx.prove("Workspace holds a skill and a runtime OAuth MCP", {
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API" });
            await ctx.navigateHash("/");
            await ctx.waitFor("document.body.innerText.trim().length > 40", { label: "rendered body" });
            await serverCall(ctx, `/workspace/:id/skills/${SKILL_NAME}`, { method: "DELETE" }, { tolerate: true });
            await serverCall(ctx, "/workspace/:id/skills", {
              method: "POST",
              body: JSON.stringify({ name: SKILL_NAME, content: "Capability eval fixture.", description: SKILL_DESCRIPTION }),
            });
            await serverCall(ctx, "/workspace/:id/mcp", {
              method: "POST",
              body: JSON.stringify({
                name: MCP_NAME,
                config: {
                  type: "remote",
                  url: MCP_URL,
                  enabled: false,
                  oauth: { clientId: "cap-eval-client", clientSecret: SECRET, scope: "eval.read" },
                },
              }),
            });
          },
          assert: async () => {
            const mcp = await serverCall(ctx, "/workspace/:id/mcp");
            ctx.assert((mcp.payload.items ?? []).some((item) => item.name === MCP_NAME), "Fixture MCP missing.");
          },
          screenshot: { name: "booted", rejectText: [SECRET, "Something went wrong"] },
        });
      },
    },
    {
      name: "Capability index ranks the right card for the intent",
      run: async (ctx) => {
        await ctx.prove("Search by intent returns extensions.export first, with teaching metadata", {
          action: async () => {},
          assert: async () => {
            const search = await serverCall(
              ctx,
              `/workspace/:id/capabilities/search?q=${encodeURIComponent("portable export of an mcp")}`,
            );
            const top = (search.payload.items ?? [])[0];
            ctx.assert(top?.id === "extensions.export", `Expected extensions.export first, got ${top?.id}.`);
            ctx.assert(typeof top.when === "string" && top.when.length > 10, "Card has no 'when' teaching.");
            ctx.assert(top.effects === "read", `Unexpected effects: ${top.effects}.`);
            ctx.assert(Boolean(top.argsSchema), "Card has no argsSchema.");
            ctx.log(`top card: ${top.id} — ${top.when}`);
          },
        });
      },
    },
    {
      name: "Agent discovers and executes the capability by intent",
      run: async (ctx) => {
        await ctx.prove("Agent reply carries execute-result-only values; secret never appears", {
          action: async () => {
            await ctx.navigateHash("/");
            await ctx.waitFor(
              "window.__openworkControl.listActions().some((a) => a.id === 'session.create_task' && !a.disabled)",
              { timeoutMs: 45_000, label: "session.create_task available" },
            );
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `(() => /ses_[A-Za-z0-9]+/.test(window.__openworkControl.snapshot().route || ""))()`,
              { timeoutMs: 30_000, label: "active session" },
            );
            const pasted = await pasteComposer(ctx, AGENT_MESSAGE);
            ctx.assert(pasted?.ok, `Composer not ready: ${pasted?.reason ?? "unknown"}`);
            const ran = await ctx.eval(`(() => {
              const byLabel = Array.from(document.querySelectorAll('button'))
                .find((b) => /run task|send|run/i.test((b.textContent || "").trim()) && !b.disabled);
              if (byLabel) { byLabel.click(); return "clicked"; }
              const editor = document.querySelector('[contenteditable="true"]');
              if (editor) {
                editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                return "enter";
              }
              return "none";
            })()`);
            ctx.assert(ran !== "none", "Could not submit the composer message.");
          },
          assert: async () => {
            await ctx.waitFor(
              `Boolean(document.body.innerText.match(new RegExp(${JSON.stringify(AGENT_REPLY_RE)})))`,
              { timeoutMs: 180_000, label: "agent CAPABILITY-RESULT reply" },
            );
            await ctx.expectNoText(SECRET);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "agent-capability-proof",
            requireText: ["CAPABILITY-RESULT", MCP_URL],
            rejectText: [SECRET],
          },
        });
      },
    },
  ],
};
