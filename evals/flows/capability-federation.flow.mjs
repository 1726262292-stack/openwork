/**
 * Federated search + execute, agent-driven:
 *
 *   1. UI shard — asked in plain words to "open the Extensions settings
 *      screen", the agent searches, finds a ui-origin card, and executes it
 *      through the gateway. The witness is unfakeable: the app's route
 *      actually changes to /settings/extensions.
 *   2. Share plan — asked to plan sharing a skill + OAuth connection to a
 *      marketplace, the agent discovers marketplace.share_plan and executes
 *      it. Its reply must echo the executed id, the plan's step count, and
 *      the secretsExcluded entries — values that exist only in the execute
 *      result, so the line cannot be produced without running the plan.
 *      The OAuth client secret must never appear anywhere.
 *
 * Run: pnpm fraimz --flow capability-federation --cdp-url http://127.0.0.1:9826
 */

const SKILL_NAME = "fed-eval-skill";
const MCP_NAME = "fed-eval-mcp";
const SECRET = "fed-eval-oauth-secret-8899";
const MARKETPLACE = "BY IT Marketplace";

const UI_MESSAGE = [
  "Open the Extensions settings screen of the OpenWork app for me.",
  "Use openwork_search to find the right capability and run it with openwork_execute.",
  "After it executes, reply with exactly one line: UI-RESULT <the capability id you executed>.",
  "Do not run any other tools.",
].join(" ");

const PLAN_MESSAGE = [
  `Plan sharing the skill "${SKILL_NAME}" and the connection "${MCP_NAME}" to the marketplace "${MARKETPLACE}".`,
  "Use openwork_search to find the right capability and run it with openwork_execute. Do not run the plan's cloud steps.",
  "Reply with exactly one line: SHARE-PLAN <the capability id you executed> <the plan's stepCount> <the secretsExcluded entries joined with commas>.",
  "Write values verbatim without quotes or angle brackets.",
].join(" ");

// The step count and excluded-secret key are only in the execute result.
const PLAN_REPLY_RE = "SHARE-PLAN\\s+marketplace\\.share_plan\\s+9\\s+oauth\\.clientSecret";

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

async function sendAgentMessage(ctx, message) {
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
  const pasted = await ctx.eval(
    `(() => {
      const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!editor) return { ok: false, reason: 'composer not found' };
      editor.focus();
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(message)});
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      return { ok: true };
    })()`,
  );
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
}

export default {
  id: "capability-federation",
  title: "Agent uses federated search to drive the UI and compile a share plan",
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
      name: "Fixtures installed (skill + OAuth MCP with secret)",
      run: async (ctx) => {
        await ctx.prove("Workspace holds the components to be shared", {
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API" });
            await ctx.navigateHash("/");
            await ctx.waitFor("document.body.innerText.trim().length > 40", { label: "rendered body" });
            await serverCall(ctx, `/workspace/:id/skills/${SKILL_NAME}`, { method: "DELETE" }, { tolerate: true });
            await serverCall(ctx, "/workspace/:id/skills", {
              method: "POST",
              body: JSON.stringify({ name: SKILL_NAME, content: "Federation eval fixture.", description: "Federation eval fixture skill." }),
            });
            await serverCall(ctx, "/workspace/:id/mcp", {
              method: "POST",
              body: JSON.stringify({
                name: MCP_NAME,
                config: {
                  type: "remote",
                  url: "https://mcp.eval.example/fed",
                  enabled: false,
                  oauth: { clientId: "fed-eval-client", clientSecret: SECRET, scope: "fed.read" },
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
      name: "Agent drives the app UI through a federated ui-origin card",
      run: async (ctx) => {
        await ctx.prove("Executing the discovered ui card actually changes the app route", {
          action: async () => {
            await sendAgentMessage(ctx, UI_MESSAGE);
          },
          assert: async () => {
            // Unfakeable witness: the renderer route really navigates.
            await ctx.waitFor(
              "(window.__openworkControl.snapshot().route || '').includes('/settings/extensions')",
              { timeoutMs: 180_000, label: "route changed to /settings/extensions" },
            );
            await ctx.expectNoText(SECRET);
          },
          screenshot: {
            name: "ui-card-navigated",
            requireText: ["Extensions"],
            rejectText: [SECRET],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Agent compiles a secret-free share plan by intent",
      run: async (ctx) => {
        await ctx.prove("Reply carries plan-result-only values; secret never appears", {
          action: async () => {
            await sendAgentMessage(ctx, PLAN_MESSAGE);
          },
          assert: async () => {
            await ctx.waitFor(
              `Boolean(document.body.innerText.match(new RegExp(${JSON.stringify(PLAN_REPLY_RE)})))`,
              { timeoutMs: 180_000, label: "agent SHARE-PLAN reply" },
            );
            await ctx.expectNoText(SECRET);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "share-plan-proof",
            requireText: ["SHARE-PLAN", "oauth.clientSecret"],
            rejectText: [SECRET],
          },
        });
      },
    },
  ],
};
