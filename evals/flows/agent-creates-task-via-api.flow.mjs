import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/agent-creates-task-via-api.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("agent-creates-task-via-api");

const PROMPT = "Create a new task called Plan the offsite";
const TASK_TITLE = "Plan the offsite";

async function closeStaleDialogs(ctx) {
  await ctx.eval(`(() => {
    for (let index = 0; index < 3; index += 1) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
    return true;
  })()`);
}

async function bootPrecondition(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API",
  });
  await closeStaleDialogs(ctx);
  const state = await ctx.waitFor(
    `(() => {
      const control = window.__openworkControl;
      const route = String(control.snapshot().route || "");
      if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
      const action = control.listActions().find((item) => item.id === "session.create_task");
      if (action && !action.disabled) return "ready";
      return null;
    })()`,
    { timeoutMs: 30_000, label: "session.create_task enabled (or welcome/signin)" },
  );
  return state === "blocked"
    ? "Profile is not onboarded (welcome/signin); agent API task flow requires a workspace."
    : null;
}

async function waitForActiveSessionId(ctx) {
  return ctx.waitFor(
    `(() => {
      const route = String(window.__openworkControl.snapshot().route || "");
      const match = route.match(/ses_[A-Za-z0-9]+/);
      return match ? match[0] : null;
    })()`,
    { timeoutMs: 30_000, label: "active session id in route" },
  );
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
      return { ok: true, text: editor.innerText };
    })()`,
  );
}

async function submitComposer(ctx) {
  const ran = await ctx.eval(`(() => {
    const byLabel = Array.from(document.querySelectorAll('button'))
      .find((button) => /run task|send|run/i.test((button.textContent || "").trim()) && !button.disabled);
    if (byLabel) { byLabel.click(); return "clicked"; }
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return "enter";
    }
    return "none";
  })()`);
  ctx.assert(ran !== "none", "Could not submit the composer message.");
  ctx.log(`submit: ${ran}`);
  return ran;
}

async function waitForPromptBubble(ctx) {
  await ctx.waitForText(PROMPT, { timeoutMs: 30_000 });
  return ctx.waitFor(
    `(() => Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .some((message) => message.innerText.includes(${JSON.stringify(PROMPT)})))()`,
    { timeoutMs: 30_000, label: "submitted create-task user bubble" },
  );
}

async function sidebarTaskMatches(ctx) {
  return ctx.eval(`(() => Array.from(document.querySelectorAll('body *'))
    .filter((element) => (element.textContent || "").trim() === ${JSON.stringify(TASK_TITLE)})
    .map((element) => ({
      tagName: element.tagName,
      className: typeof element.className === "string" ? element.className : "",
      inMessage: Boolean(element.closest('[data-message-role]')),
      rect: (() => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
      })(),
    })))()`);
}

async function waitForSidebarTask(ctx) {
  await ctx.waitForText(TASK_TITLE, { timeoutMs: 60_000 });
  await ctx.waitFor(
    `(() => Array.from(document.querySelectorAll('body *'))
      .some((element) => (element.textContent || "").trim() === ${JSON.stringify(TASK_TITLE)}
        && !element.closest('[data-message-role]')))()`,
    { timeoutMs: 60_000, label: "sidebar task title outside transcript" },
  );
}

async function hoverSidebarTask(ctx) {
  const point = await ctx.eval(`(() => {
    const target = Array.from(document.querySelectorAll('body *'))
      .filter((element) => (element.textContent || "").trim() === ${JSON.stringify(TASK_TITLE)}
        && !element.closest('[data-message-role]'))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (!target) return null;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (point) {
    await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  }
}

async function fetchSessionsWitness(ctx) {
  return ctx.eval(
    `(async () => {
      const routeSlice = window.__openwork?.slice ? window.__openwork.slice("route") : null;
      const snapshot = window.__openwork?.snapshot ? window.__openwork.snapshot() : null;
      const route = routeSlice && typeof routeSlice === "object" ? routeSlice : snapshot?.route;
      const slices = window.__openwork?.listSlices ? window.__openwork.listSlices() : [];
      const baseUrl = typeof route?.baseUrl === "string" ? route.baseUrl.replace(/\\/+$/, "") : "";
      const selectedWorkspaceId = typeof route?.selectedWorkspaceId === "string"
        ? route.selectedWorkspaceId
        : Array.isArray(route?.workspaces) && typeof route.workspaces[0]?.id === "string"
          ? route.workspaces[0].id
          : "";
      const token = (window.localStorage.getItem("openwork.server.token") || "").trim();
      if (!baseUrl || !selectedWorkspaceId || !token) {
        return { ok: false, reason: "missing route API details", baseUrl, selectedWorkspaceId, tokenPresent: token.length > 0, route, slices };
      }
      const response = await fetch(
        baseUrl + "/workspace/" + encodeURIComponent(selectedWorkspaceId) + "/sessions?limit=200",
        { headers: { Authorization: "Bearer " + token } },
      );
      const body = await response.json().catch((error) => ({ parseError: error instanceof Error ? error.message : String(error) }));
      const items = Array.isArray(body?.items) ? body.items : [];
      const match = items.find((item) => String(item?.title || "").includes(${JSON.stringify(TASK_TITLE)})) || null;
      return {
        ok: response.ok && Boolean(match),
        status: response.status,
        baseUrl,
        selectedWorkspaceId,
        tokenPresent: token.length > 0,
        itemCount: items.length,
        match,
        bodyKeys: body && typeof body === "object" ? Object.keys(body) : [],
        route,
        slices,
      };
    })()`,
    { awaitPromise: true },
  );
}

export default {
  id: "agent-creates-task-via-api",
  title: "Agent creates a real task by calling the OpenWork sessions API",
  kind: "user-facing",
  precondition: bootPrecondition,
  steps: [
    {
      name: "Fresh task starts in a workspace",
      run: async (ctx) => {
        await ctx.prove("A normal chat session is active in a workspace", {
          voiceover: vo[0],
          action: async () => {
            await closeStaleDialogs(ctx);
            await ctx.control("session.create_task");
          },
          assert: async () => {
            const sessionId = await waitForActiveSessionId(ctx);
            ctx.assert(Boolean(sessionId), "No active session id after create_task.");
            ctx.log(`active session: ${sessionId}`);
          },
          screenshot: { name: "fresh-task", hashIncludes: "ses_", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Alex asks the agent to create a task",
      run: async (ctx) => {
        await ctx.prove("The create-task request is sent as a normal user message", {
          voiceover: vo[1],
          action: async () => {
            const pasted = await pasteComposer(ctx, PROMPT);
            ctx.assert(pasted?.ok, `Composer not ready: ${pasted?.reason ?? "unknown"}`);
            await submitComposer(ctx);
          },
          assert: async () => {
            await waitForPromptBubble(ctx);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "create-task-prompt-submitted", requireText: [PROMPT], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Agent invokes the session creation tool",
      run: async (ctx) => {
        await ctx.prove("The transcript shows the backend session-create tool call", {
          voiceover: vo[2],
          action: async () => {
            const toolLabel = await ctx.waitFor(
              `(() => {
                const match = document.body.innerText.match(/openwork_session_create|session_create/i);
                return match ? match[0] : null;
              })()`,
              { timeoutMs: 180_000, label: "openwork_session_create tool call" },
            );
            ctx.log(`tool call label: ${toolLabel}`);
          },
          assert: async () => {
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "session-create-tool-call", requireText: ["session_create"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Sidebar refreshes with the new task",
      run: async (ctx) => {
        await ctx.prove("The new task appears in the sidebar without the flow reloading the app", {
          voiceover: vo[3],
          action: async () => {
            // Do not reload here: this frame proves the session-sync listener
            // refreshed the sidebar in place after an untracked root session update.
            await waitForSidebarTask(ctx);
          },
          assert: async () => {
            const matches = await sidebarTaskMatches(ctx);
            const outsideTranscript = matches.filter((item) => !item.inMessage);
            ctx.assert(outsideTranscript.length > 0, `${TASK_TITLE} was only found inside transcript message containers.`);
            ctx.log(`sidebar task matches: ${JSON.stringify(matches)}`);
          },
          screenshot: { name: "sidebar-task-appeared", requireText: [TASK_TITLE], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Server API confirms the created session",
      run: async (ctx) => {
        await ctx.prove("The OpenWork server lists the new task through the sessions API", {
          voiceover: vo[4],
          action: async () => {
            await hoverSidebarTask(ctx);
          },
          assert: async () => {
            const witness = await fetchSessionsWitness(ctx);
            ctx.assert(witness?.ok, `Server sessions witness did not include ${TASK_TITLE}: ${JSON.stringify(witness)}`);
            ctx.output("sessions-api-match", JSON.stringify(witness.match, null, 2));
            ctx.log(`sessions API witness: ${JSON.stringify({ status: witness.status, itemCount: witness.itemCount, selectedWorkspaceId: witness.selectedWorkspaceId })}`);
          },
          screenshot: { name: "server-confirmed-created-task", requireText: [TASK_TITLE], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
