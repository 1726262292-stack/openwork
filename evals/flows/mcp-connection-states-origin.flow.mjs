/**
 * User-facing demo: distinct connection states + per-invocation connection
 * origin badges (PR #2760).
 *
 * Field defects: a working MCP read as "not connected" (state conflation), and
 * with two similar connectors enabled nobody could tell which one a chat tool
 * call used. This drives the real desktop: a healthy public MCP reads Ready, a
 * disabled one reads Paused, a dead endpoint reads Issue, and a chat tool
 * invocation carries a badge naming its connection.
 */
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "mcp-connection-states-origin";
const LIVE_NAME = "context7-live";
const LIVE_URL = "https://mcp.context7.com/mcp";
const LIVE_BADGE = "Context7 Live";
const DEAD_NAME = "dead-endpoint";
const DEAD_URL = "http://127.0.0.1:9/mcp";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : JSON.stringify(actual).slice(0, 1_200),
  });
  ctx.assert(condition, `${assertion}${actual === undefined ? "" : `. Actual: ${JSON.stringify(actual).slice(0, 600)}`}`);
}

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

/** Status chip text inside the row containing `name` (never page-wide). */
function rowStatusExpr(name) {
  return `(() => {
    const leaf = [...document.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && (element.textContent ?? "").trim() === ${JSON.stringify(name)},
    );
    if (!leaf) return null;
    let row = leaf;
    for (let depth = 0; depth < 10 && row; depth += 1) {
      const text = row.textContent ?? "";
      for (const status of ["Ready", "Sign in needed", "Paused", "Issue", "Offline"]) {
        if (text.includes(status)) return status;
      }
      row = row.parentElement;
    }
    return null;
  })()`;
}

async function waitForRowStatus(ctx, name, accepted, { timeoutMs = 60_000 } = {}) {
  const startedAt = Date.now();
  let status = null;
  while (Date.now() - startedAt < timeoutMs) {
    status = await ctx.eval(rowStatusExpr(name));
    if (status && accepted.includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${name} status in [${accepted.join(", ")}]; last: ${status}`);
}

async function restartEngine(ctx) {
  await ctx.eval('window.__OPENWORK_ELECTRON__.invokeDesktop("engineRestart", {})', { awaitPromise: true });
  ctx.log("Engine restarted.");
  await new Promise((resolve) => setTimeout(resolve, 8_000));
}

async function scrollRowIntoView(ctx, name) {
  await ctx.eval(`(() => {
    const leaf = [...document.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && (element.textContent ?? "").trim() === ${JSON.stringify(name)},
    );
    if (leaf) leaf.scrollIntoView({ block: "center" });
    return Boolean(leaf);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function dismissDialog(ctx) {
  await ctx.eval(`(() => {
    const dialog = document.querySelector("[role=dialog]");
    const cancel = dialog && [...dialog.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Cancel");
    if (cancel) cancel.click();
    return true;
  })()`);
}

async function addCustomApp(ctx, name, url) {
  await ctx.clickText("Add Custom App", { timeoutMs: 20_000 });
  await ctx.waitForText("Server URL", { timeoutMs: 15_000 });
  await ctx.fill('input[placeholder="github-copilot"]', name);
  await ctx.fill('input[placeholder="https://api.githubcopilot.com/mcp/"]', url);
  await ctx.clickText("Add App", { timeoutMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await dismissDialog(ctx);
  await ctx.waitForText(name, { timeoutMs: 30_000 });
}

/** Click an action button (Disable/Enable/Remove) inside the expanded row for `name`. */
async function clickRowAction(ctx, name, action) {
  await ctx.clickText(name, { timeoutMs: 10_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  const clicked = await ctx.eval(`(() => {
    const leaf = [...document.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && (element.textContent ?? "").trim() === ${JSON.stringify(name)},
    );
    let row = leaf;
    for (let depth = 0; depth < 12 && row; depth += 1) {
      const button = [...row.querySelectorAll("button")].find(
        (candidate) => (candidate.textContent ?? "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(action)},
      );
      if (button) { button.click(); return true; }
      row = row.parentElement;
    }
    return false;
  })()`);
  return clicked;
}

async function removeEntryIfPresent(ctx, name) {
  const present = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(name)})`);
  if (!present) return;
  await clickRowAction(ctx, name, "Remove");
  await new Promise((resolve) => setTimeout(resolve, 800));
  await ctx.eval(`(() => {
    const dialog = document.querySelector("[role=dialog]");
    if (!dialog) return false;
    const confirm = [...dialog.querySelectorAll("button")].find((button) => (button.textContent ?? "").trim() === "Remove");
    if (confirm) confirm.click();
    return Boolean(confirm);
  })()`);
  await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(name)})`, { timeoutMs: 15_000, label: `${name} removed` }).catch(() => {});
}

export default {
  id: FLOW_ID,
  title: "Connection rows show distinct truthful states; chat tool calls name their connection",
  kind: "user-facing",
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 120_000 });
      },
    },
    {
      name: "A healthy public MCP reads Ready",
      run: async (ctx) => {
        await ctx.prove("The connected custom app's row shows the distinct Ready state", {
          voiceover: vo[0],
          action: async () => {
            await openExtensions(ctx);
            await removeEntryIfPresent(ctx, LIVE_NAME);
            await removeEntryIfPresent(ctx, DEAD_NAME);
            await addCustomApp(ctx, LIVE_NAME, LIVE_URL);
            let status = await waitForRowStatus(ctx, LIVE_NAME, ["Ready", "Offline", "Issue"], { timeoutMs: 60_000 });
            if (status !== "Ready") {
              await restartEngine(ctx);
              await openExtensions(ctx);
              status = await waitForRowStatus(ctx, LIVE_NAME, ["Ready"], { timeoutMs: 90_000 });
            }
            await scrollRowIntoView(ctx, LIVE_NAME);
          },
          assert: async () => {
            const status = await ctx.eval(rowStatusExpr(LIVE_NAME));
            witness(ctx, status === "Ready", "The live app's row reads Ready — a real protocol session.", status);
          },
          screenshot: {
            name: "state-ready",
            requireText: [LIVE_NAME, "Ready"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "Turning the app off reads Paused",
      run: async (ctx) => {
        await ctx.prove("Disabling the app shows the distinct Paused state", {
          voiceover: vo[1],
          action: async () => {
            const clicked = await clickRowAction(ctx, LIVE_NAME, "Disable");
            witness(ctx, clicked, "The row exposes a Disable action.");
            await waitForRowStatus(ctx, LIVE_NAME, ["Paused"], { timeoutMs: 30_000 });
            await scrollRowIntoView(ctx, LIVE_NAME);
          },
          assert: async () => {
            const status = await ctx.eval(rowStatusExpr(LIVE_NAME));
            witness(ctx, status === "Paused", "The disabled app's row reads Paused.", status);
          },
          screenshot: {
            name: "state-paused",
            requireText: [LIVE_NAME, "Paused"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "A dead endpoint reads Issue",
      run: async (ctx) => {
        await ctx.prove("A connector pointing at a dead address shows the distinct Issue state", {
          voiceover: vo[2],
          action: async () => {
            await addCustomApp(ctx, DEAD_NAME, DEAD_URL);
            let status = await waitForRowStatus(ctx, DEAD_NAME, ["Issue", "Offline"], { timeoutMs: 60_000 });
            if (status !== "Issue") {
              await restartEngine(ctx);
              await openExtensions(ctx);
              status = await waitForRowStatus(ctx, DEAD_NAME, ["Issue"], { timeoutMs: 90_000 });
            }
            await scrollRowIntoView(ctx, DEAD_NAME);
          },
          assert: async () => {
            const status = await ctx.eval(rowStatusExpr(DEAD_NAME));
            witness(ctx, status === "Issue", "The dead endpoint's row reads Issue — distinct from Paused and Offline.", status);
            const liveStatus = await ctx.eval(rowStatusExpr(LIVE_NAME));
            witness(ctx, liveStatus === "Paused", "The paused app still reads Paused alongside it.", liveStatus);
          },
          screenshot: {
            name: "state-issue",
            requireText: [DEAD_NAME, "Issue", LIVE_NAME, "Paused"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/mcp",
          },
        });
      },
    },
    {
      name: "A chat tool call names its connection",
      run: async (ctx) => {
        await ctx.prove("The tool invocation row carries a badge naming the connection that executed it", {
          voiceover: vo[3],
          action: async () => {
            // Re-enable the live app and drop the dead one so the model has
            // exactly one healthy MCP to call.
            const clicked = await clickRowAction(ctx, LIVE_NAME, "Enable");
            witness(ctx, clicked, "The row exposes an Enable action.");
            await waitForRowStatus(ctx, LIVE_NAME, ["Ready"], { timeoutMs: 90_000 });
            await removeEntryIfPresent(ctx, DEAD_NAME);

            // New chat, ask for a context7 tool call by name.
            await ctx.navigateHash("/session");
            await ctx.waitFor(
              "Boolean(window.__openworkControl?.listActions().find((a) => a.id === 'session.create_task' && !a.disabled))",
              { timeoutMs: 30_000, label: "session.create_task available" },
            );
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `(() => /ses_[A-Za-z0-9]+/.test(window.__openworkControl.snapshot().route || ""))()`,
              { timeoutMs: 30_000, label: "new session active" },
            );

            const pasted = await ctx.eval(`(() => {
              const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
                || document.querySelector('[contenteditable="true"]');
              if (!editor) return { ok: false, reason: "composer not found" };
              editor.focus();
              const data = new DataTransfer();
              data.setData('text/plain', ${JSON.stringify(
                "Use the context7-live connection's resolve-library-id tool to find the library id for react. Call the tool.",
              )});
              editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
              return { ok: true };
            })()`);
            witness(ctx, pasted?.ok, "The composer accepted the prompt.");

            const submitted = await ctx.waitFor(`(() => {
              const byLabel = Array.from(document.querySelectorAll('button'))
                .find((b) => /run task|send|run/i.test((b.textContent || "").trim()) && !b.disabled);
              if (byLabel) { byLabel.click(); return "clicked"; }
              return null;
            })()`, { timeoutMs: 15_000, label: "submit button enabled" });
            ctx.log(`submit: ${submitted}`);
          },
          assert: async () => {
            // Real LLM + real MCP tool call: generous timeout, then assert the
            // origin badge next to the tool invocation.
            await ctx.waitForText(LIVE_BADGE, { timeoutMs: 120_000 });
            const badge = await ctx.eval(`(() => {
              const spans = [...document.querySelectorAll("span")];
              return spans.some((span) => (span.textContent ?? "").trim() === ${JSON.stringify(LIVE_BADGE)});
            })()`);
            witness(ctx, badge, "A badge span names the connection on the invocation row.", badge);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "tool-origin-badge",
            requireText: [LIVE_BADGE],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Cleanup: remove the proof apps",
      run: async (ctx) => {
        await openExtensions(ctx);
        await removeEntryIfPresent(ctx, LIVE_NAME);
        await removeEntryIfPresent(ctx, DEAD_NAME);
      },
    },
  ],
};
