import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("visible-conversation-context");
const SURFACE = "[data-session-surface-id]";
const WITNESS_ACTION = "eval.visible_context.last_outbound_context";
const runLabel = `Visible Context ${Date.now().toString(36)}`;

let leftSession = null;
let rightSession = null;
let leftTitle = `${runLabel} Left`;
let rightTitle = `${runLabel} Right`;
let leftWitness = null;
let rightWitness = null;
let utilityWitness = null;
let leftCapture = null;
let rightCapture = null;
let utilityCapture = null;
const transcriptCanary = `VISIBLE_CONTEXT_TRANSCRIPT_CANARY_${Date.now().toString(36)}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function preparePrefsAndReload(ctx) {
  await ctx.eval(`(() => {
    const key = "openwork.preferences";
    const raw = localStorage.getItem(key);
    let prefs = {};
    try { prefs = raw ? JSON.parse(raw) : {}; } catch { prefs = {}; }
    prefs.providerStepCompleted = true;
    localStorage.setItem(key, JSON.stringify(prefs));
    return true;
  })()`);
  await ctx.eval("window.location.reload(); true");
  await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API after prefs reload" });
  await ctx.waitFor("window.__openworkControl.listActions().some((a) => a.id === 'session.create_task' && !a.disabled)", {
    timeoutMs: 60_000,
    label: "session.create_task after prefs reload",
  });
}

async function installPromptInterceptor(ctx) {
  await ctx.eval(`(() => {
    const existing = window.__visibleContextEval;
    if (existing?.installed) return true;
    const originalFetch = window.fetch.bind(window);
    window.__visibleContextEval = { installed: true, promptRequests: [] };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/prompt_async")) {
        window.__visibleContextEval.promptRequests.push({
          at: Date.now(),
          url,
          body: typeof init?.body === "string" ? init.body : "",
          responseStatus: 204,
        });
        return new Response(null, { status: 204 });
      }
      return originalFetch(input, init);
    };
    return true;
  })()`);
}

async function currentRouteSessionId(ctx) {
  return ctx.eval(`(() => {
    const route = window.__openworkControl.snapshot().route || "";
    const match = route.match(/ses_[A-Za-z0-9]+/);
    return match ? match[0] : null;
  })()`);
}

async function waitForNewRouteSessionId(ctx, previousId, label, timeoutMs = 45_000) {
  return ctx.waitFor(
    `(() => {
      const route = window.__openworkControl.snapshot().route || "";
      const match = route.match(/ses_[A-Za-z0-9]+/);
      if (!match) return null;
      return match[0] === ${JSON.stringify(previousId)} ? null : match[0];
    })()`,
    { timeoutMs, label },
  );
}

async function createNamedSession(ctx, title) {
  const previous = await currentRouteSessionId(ctx);
  const created = await ctx.control("session.create_task");
  ctx.assert(created === true || created?.ok === true, `Could not create session for ${title}: ${JSON.stringify(created)}`);
  let sessionId = await waitForNewRouteSessionId(ctx, previous, `route id for ${title}`, 10_000).catch(() => null);
  if (!sessionId) {
    const retried = await ctx.control("session.create_task");
    ctx.assert(retried === true || retried?.ok === true, `Could not retry session creation for ${title}: ${JSON.stringify(retried)}`);
    sessionId = await waitForNewRouteSessionId(ctx, previous, `retried route id for ${title}`);
  }
  await ctx.control("session.rename", { sessionId, title });
  await ctx.waitFor(
    `document.body.innerText.includes(${JSON.stringify(title)})`,
    { timeoutMs: 30_000, label: `renamed session title ${title}` },
  );
  return sessionId;
}

async function closeStaleSplit(ctx) {
  const closed = await ctx.eval(`(() => {
    const button = document.querySelector('button[aria-label="Close split"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (closed) {
    await ctx.waitFor(`document.querySelectorAll(${JSON.stringify(SURFACE)}).length === 1`, {
      timeoutMs: 15_000,
      label: "stale split to close",
    });
  }
}

async function openRightSessionInSplit(ctx) {
  const clicked = await ctx.waitFor(`(() => {
    const tab = document.querySelector('[data-session-tab-id=${JSON.stringify(rightSession)}]');
    const button = tab?.querySelector('button[aria-label="Open in split view"]');
    if (!button || button.disabled) return null;
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: "right session split button" });
  ctx.assert(clicked === true, "Could not open the right session in split view.");
}

function surfacesExpression() {
  return `(() => Array.from(document.querySelectorAll(${JSON.stringify(SURFACE)})).map((root) => {
    const rect = root.getBoundingClientRect();
    return {
      id: root.getAttribute("data-session-surface-id"),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }))()`;
}

async function sendFromSurface(ctx, sessionId, text) {
  const sendStartedAt = await ctx.eval("Date.now()");
  const pasted = await ctx.eval(`(() => {
    const root = document.querySelector('[data-session-surface-id=${JSON.stringify(sessionId)}]');
    const editor = root?.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || root?.querySelector('[contenteditable="true"]');
    if (!root || !editor) return { ok: false, reason: "composer not found" };
    editor.focus();
    const data = new DataTransfer();
    data.setData("text/plain", ${JSON.stringify(text)});
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    return { ok: true, text: editor.innerText };
  })()`);
  ctx.assert(pasted?.ok, `Composer paste failed for ${sessionId}: ${pasted?.reason ?? "unknown"}`);

  const submitted = await ctx.eval(`(() => {
    const root = document.querySelector('[data-session-surface-id=${JSON.stringify(sessionId)}]');
    if (!root) return "missing-root";
    const button = Array.from(root.querySelectorAll("button"))
      .find((candidate) => /run task|send|run/i.test((candidate.textContent || "").trim()) && !candidate.disabled);
    if (button) { button.click(); return "clicked"; }
    const editor = root.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return "enter";
    }
    return "none";
  })()`);
  ctx.assert(submitted !== "none" && submitted !== "missing-root", `Could not submit prompt for ${sessionId}: ${submitted}`);
  return sendStartedAt;
}

async function waitForWitness(ctx, sessionId, after) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const witness = await ctx.control(WITNESS_ACTION);
    if (witness?.sessionId === sessionId && typeof witness.visibleContext === "string" && witness.at >= after) {
      return witness;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for visible-context witness for ${sessionId}.`);
}

async function waitForPromptRequest(ctx, sessionId, after) {
  return ctx.waitFor(`(() => {
    const requests = window.__visibleContextEval?.promptRequests ?? [];
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const request = requests[index];
      if (request.at >= ${JSON.stringify(after)} && request.url.includes(${JSON.stringify(`/session/${sessionId}/prompt_async`)})) {
        return request;
      }
    }
    return null;
  })()`, { timeoutMs: 20_000, label: `intercepted prompt request for ${sessionId}` });
}

async function sendAndCapture(ctx, sessionId, text) {
  const sentAt = await sendFromSurface(ctx, sessionId, text);
  const witness = await waitForWitness(ctx, sessionId, sentAt);
  const request = await waitForPromptRequest(ctx, sessionId, sentAt);
  const body = request.body ? JSON.parse(request.body) : {};
  const system = typeof body.system === "string" ? body.system : "";
  ctx.assert(request.responseStatus === 204, `Expected intercepted prompt response status 204, got ${request.responseStatus}.`);
  ctx.assert(system.includes(witness.visibleContext), "Actual outbound system context did not include the DEV witness context.");
  return { sentAt, witness, request, body, system };
}

async function showProofPanel(ctx, title, rows) {
  await ctx.eval(`(() => {
    const id = "openwork-visible-context-proof";
    document.getElementById(id)?.remove();
    const panel = document.createElement("section");
    panel.id = id;
    panel.style.cssText = [
      "position:fixed",
      "inset:24px",
      "z-index:2147483647",
      "background:#fff",
      "color:#111827",
      "border:2px solid #2563eb",
      "border-radius:18px",
      "box-shadow:0 24px 80px rgba(15,23,42,.28)",
      "font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "padding:28px",
      "overflow:auto"
    ].join(";");
    const heading = document.createElement("h1");
    heading.textContent = ${JSON.stringify(title)};
    heading.style.cssText = "margin:0 0 18px;font-size:30px;line-height:1.1";
    panel.appendChild(heading);
    for (const row of ${JSON.stringify(rows)}) {
      const item = document.createElement("div");
      item.style.cssText = "margin:12px 0;padding:14px 16px;border:1px solid #d1d5db;border-radius:12px;background:#f9fafb";
      const label = document.createElement("div");
      label.textContent = row.label;
      label.style.cssText = "font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#2563eb;margin-bottom:6px";
      const value = document.createElement("div");
      value.textContent = row.value;
      value.style.cssText = "font-size:16px;font-weight:600;white-space:pre-wrap";
      item.appendChild(label);
      item.appendChild(value);
      panel.appendChild(item);
    }
    document.body.appendChild(panel);
    return true;
  })()`);
}

export default {
  id: "visible-conversation-context",
  title: "Visible context identifies neighboring conversations and the right utility panel",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API" });
    const state = await ctx.waitFor(`(() => {
      const control = window.__openworkControl;
      const route = control.snapshot().route;
      if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
      const create = control.listActions().find((action) => action.id === "session.create_task");
      if (create && !create.disabled) return "ready";
      return null;
    })()`, { timeoutMs: 30_000, label: "visible context session prerequisites" });
    if (state === "blocked") return "Profile is not onboarded (welcome/signin); visible context requires a workspace.";
    const prerequisites = await ctx.eval(`(() => {
      const actions = window.__openworkControl.listActions();
      const witness = actions.find((action) => action.id === ${JSON.stringify(WITNESS_ACTION)});
      const browser = actions.find((action) => action.id === "browser.open_url");
      if (!witness || witness.disabled) return "missing-witness";
      if (!browser || browser.disabled) return "missing-browser";
      return "ready";
    })()`);
    if (prerequisites === "missing-witness") return "Visible context witness requires a development build.";
    if (prerequisites === "missing-browser") return "Built-in browser panel is not available for this eval target.";
    await preparePrefsAndReload(ctx);
    return null;
  },
  steps: [
    {
      name: "Open two conversations side by side",
      run: async (ctx) => {
        await ctx.prove("Two live conversations are visible in a real horizontal split", {
          claim: "The user can open two conversations side by side, with a distinct left conversation and right conversation.",
          voiceover: vo[0],
          action: async () => {
            await installPromptInterceptor(ctx);
            await closeStaleSplit(ctx);
            rightSession = await createNamedSession(ctx, rightTitle);
            leftSession = await createNamedSession(ctx, leftTitle);
            await openRightSessionInSplit(ctx);
          },
          assert: async () => {
            const surfaces = await ctx.waitFor(`(() => {
              const items = ${surfacesExpression()};
              return items.length === 2 ? items : null;
            })()`, { timeoutMs: 30_000, label: "two visible session surfaces" });
            const left = surfaces.find((surface) => surface.id === leftSession);
            const right = surfaces.find((surface) => surface.id === rightSession);
            ctx.assert(Boolean(left), `Left session ${leftSession} is not visible: ${JSON.stringify(surfaces)}`);
            ctx.assert(Boolean(right), `Right session ${rightSession} is not visible: ${JSON.stringify(surfaces)}`);
            ctx.assert(left.left < right.left, `Expected ${leftSession} left of ${rightSession}: ${JSON.stringify(surfaces)}`);
            ctx.assert(left.width > 250 && right.width > 250, `Expected both panes to have usable width: ${JSON.stringify(surfaces)}`);
          },
          screenshot: { name: "visible-context-two-conversations", requireText: [leftTitle, rightTitle] },
        });
      },
    },
    {
      name: "Send from either composer with natural left/right references",
      run: async (ctx) => {
        await ctx.prove("Each composer gets an unambiguous visible-position map", {
          claim: "A normal prompt from the left composer identifies the right conversation, and a normal prompt from the right composer identifies the left conversation, without the user copying IDs.",
          voiceover: vo[1],
          action: async () => {
            rightCapture = await sendAndCapture(ctx, rightSession, `Summarize the conversation on my left. Transcript canary: ${transcriptCanary}`);
            rightWitness = rightCapture.witness;
            leftCapture = await sendAndCapture(ctx, leftSession, "Compare this with the conversation on my right.");
            leftWitness = leftCapture.witness;
            ctx.log(`left outbound body: ${JSON.stringify(leftCapture.body)}`);
            ctx.log(`right outbound body: ${JSON.stringify(rightCapture.body)}`);
          },
          assert: async () => {
            ctx.assert(leftCapture.system.includes(`"originSessionId": "${leftSession}"`), "Left composer request did not identify the left origin session.");
            ctx.assert(leftCapture.system.includes(`"position": "left"`), "Left composer request did not include the left position.");
            ctx.assert(leftCapture.system.includes(`"title": "${leftTitle}"`), "Left composer request did not include the left title.");
            ctx.assert(leftCapture.system.includes(`"position": "right"`), "Left composer request did not include the right position.");
            ctx.assert(leftCapture.system.includes(`"title": "${rightTitle}"`), "Left composer request did not include the right title.");
            ctx.assert(rightCapture.system.includes(`"originSessionId": "${rightSession}"`), "Right composer request did not identify the right origin session.");
            ctx.assert(rightCapture.system.includes(`"position": "right"`), "Right composer request did not include the right position.");
            ctx.assert(rightCapture.system.includes(`"position": "left"`), "Right composer request did not include the left position.");
            ctx.assert(leftWitness.at >= leftCapture.sentAt, "Left DEV witness was older than the send.");
            ctx.assert(rightWitness.at >= rightCapture.sentAt, "Right DEV witness was older than the send.");
          },
          screenshot: { name: "visible-context-either-composer", requireText: [leftTitle, rightTitle] },
        });
      },
    },
    {
      name: "Witness bounded private context without neighbor transcripts",
      run: async (ctx) => {
        await ctx.prove("The outbound system context is bounded and contains no neighboring transcript", {
          claim: "The dev-only witness shows OpenWork sends a compact visible-context map and an instruction to read referenced conversations only when needed, not the neighboring transcript itself.",
          voiceover: vo[2],
          action: async () => {
            await showProofPanel(ctx, "Visible Context Witness", [
              { label: "Actual outbound system context", value: leftCapture.system },
              { label: "Bounded length", value: `${leftCapture.system.length} characters` },
              { label: "Neighbor transcript", value: "Not included in the system context" },
            ]);
          },
          assert: async () => {
            ctx.assert(leftCapture.system.includes("no transcripts or page contents included"), "Actual system context did not declare transcript/page contents are excluded.");
            ctx.assert(leftCapture.system.includes("read referenced conversations only when needed"), "Actual system context did not instruct deferred reading.");
            ctx.assert(leftCapture.system.includes("untrusted UI metadata only"), "Actual system context did not mark metadata as untrusted.");
            ctx.assert(leftCapture.system.length < 1_800, `Visible context was not bounded: ${leftCapture.system.length}`);
            ctx.assert(!leftCapture.system.includes(transcriptCanary), "Actual system context included the neighbor transcript canary.");
            ctx.assert(!leftCapture.system.includes("Summarize the conversation on my left"), "Actual system context included the user prompt text.");
            ctx.assert(!leftCapture.system.includes("Compare this with the conversation on my right"), "Actual system context included the other prompt text.");
          },
          screenshot: { name: "visible-context-bounded-witness", requireText: ["Visible Context Witness", "Not included"] },
        });
      },
    },
    {
      name: "Right utility panel is distinct from the right conversation",
      run: async (ctx) => {
        await ctx.prove("A browser page in the right utility panel is named separately from the right conversation", {
          claim: "When a browser page is open in the right sidebar, the outbound context includes a separate right utility panel entry and says it is not the right conversation.",
          voiceover: vo[3],
          action: async () => {
            await ctx.eval("window.__OPENWORK_ELECTRON__?.browser?.closeAllTabs?.(); true", { awaitPromise: true });
            await ctx.control("browser.open_url", {
              provider: "builtin",
              url: "https://example.com/visible-context?token=secret#hidden",
            });
            await ctx.waitFor(`(() => document.querySelectorAll('button[aria-label^="Select tab:"]').length > 0)()`, {
              timeoutMs: 20_000,
              label: "browser tab in right panel",
            });
            utilityCapture = await sendAndCapture(ctx, leftSession, "Compare this with the conversation on my right and the browser page in the right sidebar.");
            utilityWitness = utilityCapture.witness;
            await showProofPanel(ctx, "Right Utility Panel Witness", [
              { label: "Right conversation", value: `right conversation "${rightTitle}" (session ${rightSession})` },
              { label: "Separate utility panel", value: utilityCapture.system },
            ]);
          },
          assert: async () => {
            ctx.assert(utilityCapture.system.includes(`"position": "right"`), "Utility request lost the right conversation position.");
            ctx.assert(utilityCapture.system.includes(`"title": "${rightTitle}"`), "Utility request lost the right conversation title.");
            ctx.assert(utilityCapture.system.includes("\"rightUtilityPanel\""), "Utility request did not include the separate utility panel.");
            ctx.assert(utilityCapture.system.includes("\"kind\": \"browser\""), "Utility request did not identify the browser panel.");
            ctx.assert(utilityCapture.system.includes("https://example.com/visible-context"), "Utility request did not include the bounded browser URL.");
            ctx.assert(utilityCapture.system.includes("separate from any conversation"), "Utility request did not distinguish panel from right conversation.");
            ctx.assert(!utilityCapture.system.includes("token=secret"), "Utility request exposed browser query secrets.");
            ctx.assert(!utilityCapture.system.includes("#hidden"), "Utility request exposed browser hash content.");
            ctx.assert(!utilityCapture.system.includes("Example Domain"), "Utility request included an externally controlled browser page title.");
            ctx.assert(utilityWitness.at >= utilityCapture.sentAt, "Utility DEV witness was older than the send.");
          },
          screenshot: { name: "visible-context-utility-panel", requireText: ["Right Utility Panel Witness", "SEPARATE UTILITY PANEL"] },
        });
      },
    },
  ],
};
