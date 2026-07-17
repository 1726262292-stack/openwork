import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "chat-select-all-scoped";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"]';
const PROMPT = "Reply with exactly: select-scope ok";
const REPLY = "select-scope ok";
const DRAFT = "draft only selection probe";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReadySession(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API",
  });
  return ctx.waitFor(
    `(() => {
      const control = window.__openworkControl;
      const route = control.snapshot().route;
      if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
      const action = control.listActions().find((item) => item.id === "session.create_task");
      if (action && !action.disabled) return "ready";
      return null;
    })()`,
    { timeoutMs: 30_000, label: "session.create_task enabled (or welcome/signin)" },
  );
}

async function closeStaleDialogs(ctx) {
  await ctx.eval(`(() => {
    for (let index = 0; index < 3; index += 1) {
      const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      (document.activeElement || document.body).dispatchEvent(event);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return true;
  })()`);
  await sleep(300);
}

async function pasteComposer(ctx, text) {
  const result = await ctx.eval(
    `(() => {
      const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
      if (!editor) return { ok: false, reason: "composer not found" };
      editor.focus();
      const data = new DataTransfer();
      data.setData("text/plain", ${JSON.stringify(text)});
      const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      editor.dispatchEvent(event);
      return { ok: true, text: editor.innerText };
    })()`,
  );
  ctx.assert(result?.ok === true, `Could not paste into composer: ${result?.reason ?? "unknown"}`);
  return result;
}

async function submitComposer(ctx) {
  const submitted = await ctx.eval(`(() => {
    const byLabel = Array.from(document.querySelectorAll("button"))
      .find((button) => /run task|send|run/i.test((button.textContent || "").trim()) && !button.disabled);
    if (byLabel) {
      byLabel.click();
      return "clicked";
    }
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (editor) {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      return "enter";
    }
    return "none";
  })()`);
  ctx.assert(submitted !== "none", "Could not submit the composer message.");
  ctx.log(`submit: ${submitted}`);
  return submitted;
}

async function currentRouteSessionId(ctx) {
  return ctx.eval(`(() => {
    const route = window.__openworkControl.snapshot().route || "";
    const match = route.match(/ses_[A-Za-z0-9]+/);
    return match ? match[0] : null;
  })()`);
}

async function waitForActiveSessionId(ctx, { previousId = null, timeoutMs = 30_000, label = "active session id in route" } = {}) {
  return ctx.waitFor(
    `(() => {
      const route = window.__openworkControl.snapshot().route || "";
      const match = route.match(/ses_[A-Za-z0-9]+/);
      if (!match) return null;
      if (${JSON.stringify(previousId)} && match[0] === ${JSON.stringify(previousId)}) return null;
      return match[0];
    })()`,
    { timeoutMs, label },
  );
}

async function createFreshTask(ctx) {
  const previousId = await currentRouteSessionId(ctx);
  await ctx.control("session.create_task");
  const sessionId = await waitForActiveSessionId(ctx, {
    previousId,
    timeoutMs: 30_000,
    label: "fresh active session id in route",
  });
  ctx.assert(Boolean(sessionId), "No active session id after create_task.");
  ctx.log(`active session: ${sessionId}`);
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
    timeoutMs: 30_000,
    label: "composer editor",
  });
  return sessionId;
}

async function dispatchCtrlA(ctx) {
  await ctx.client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await ctx.client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
}

async function clearSelectionAndBlur(ctx) {
  await ctx.eval(`(() => {
    window.getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return true;
  })()`);
}

async function clearComposer(ctx) {
  const result = await ctx.eval(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (!editor) return { ok: false, reason: "composer not found" };
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("delete");
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    window.getSelection()?.removeAllRanges();
    return { ok: true, text: editor.innerText };
  })()`);
  ctx.assert(result?.ok === true, `Could not clear composer: ${result?.reason ?? "unknown"}`);
  return result;
}

function selectAllReportExpression() {
  return `(() => {
    const bodyText = document.body.innerText || "";
    const preferredAnchors = ["Add workspace", "Ready for new tasks", "Search sessions"];
    const fallbackAnchors = ["Add workspace", "New session", "Docs", "Feedback"];
    const pickedAnchors = [];
    const substitutions = [];
    for (const preferred of preferredAnchors) {
      if (bodyText.includes(preferred)) {
        pickedAnchors.push(preferred);
        substitutions.push({ preferred, actual: preferred, fallback: false });
        continue;
      }
      const fallback = fallbackAnchors.find((candidate) => bodyText.includes(candidate) && !pickedAnchors.includes(candidate));
      if (fallback) {
        pickedAnchors.push(fallback);
        substitutions.push({ preferred, actual: fallback, fallback: true });
      } else {
        pickedAnchors.push(preferred);
        substitutions.push({ preferred, actual: preferred, fallback: true, missing: true });
      }
    }
    const reportSelection = (label) => {
      const selection = window.getSelection();
      const text = selection ? selection.toString() : "";
      return {
        label,
        text,
        length: text.length,
        includesPrompt: text.includes(${JSON.stringify(PROMPT)}),
        includesReply: text.includes(${JSON.stringify(REPLY)}),
        excludedHits: pickedAnchors.filter((anchor) => text.includes(anchor)),
      };
    };
    const shortcut = reportSelection("shortcut");
    const globalType = typeof window.__openworkChatSelectAll;
    window.getSelection()?.removeAllRanges();
    const directReturn = globalType === "function" ? window.__openworkChatSelectAll() : null;
    const direct = reportSelection("renderer-global");
    return {
      transcriptExists: Boolean(document.querySelector('[data-chat-transcript]')),
      globalType,
      directReturn,
      anchors: substitutions,
      missingAnchors: substitutions.filter((entry) => entry.missing).map((entry) => entry.preferred),
      shortcut,
      direct,
    };
  })()`;
}

function composerSelectionExpression() {
  return `(() => {
    const composer = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    const selection = window.getSelection();
    const text = selection ? selection.toString() : "";
    return {
      composerExists: Boolean(composer),
      text,
      anchorInsideComposer: Boolean(selection?.anchorNode && composer?.contains(selection.anchorNode)),
      focusInsideComposer: Boolean(selection?.focusNode && composer?.contains(selection.focusNode)),
      activeElementInsideComposer: Boolean(composer && (document.activeElement === composer || composer.contains(document.activeElement))),
    };
  })()`;
}

export default {
  id: FLOW_ID,
  title: "Select All is scoped to chat transcripts and editable composer drafts",
  kind: "user-facing",
  precondition: async (ctx) => {
    const state = await waitForReadySession(ctx);
    return state === "blocked"
      ? "Profile is not onboarded (welcome/signin); chat Select All proof requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Create a transcript with prompt and answer",
      run: async (ctx) => {
        await ctx.prove("A fresh chat contains the exact prompt and assistant reply", {
          voiceover: vo[0],
          action: async () => {
            await closeStaleDialogs(ctx);
            await createFreshTask(ctx);
            await clearComposer(ctx);
            await pasteComposer(ctx, PROMPT);
            await submitComposer(ctx);
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
                .some((element) => (element.innerText || "").includes(${JSON.stringify(REPLY)})))()`,
              { timeoutMs: 90_000, label: "assistant reply select-scope ok" },
            );
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "select-scope-transcript", requireText: [REPLY], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Select All outside the composer selects only chat messages",
      run: async (ctx) => {
        await ctx.prove("Plain Ctrl+A outside editable fields selects the visible chat transcript and excludes shell chrome", {
          voiceover: vo[1],
          action: async () => {
            await clearSelectionAndBlur(ctx);
            await dispatchCtrlA(ctx);
          },
          assert: async () => {
            const report = await ctx.eval(selectAllReportExpression());
            ctx.output("chat-select-all-selection", report.shortcut.text.slice(0, 300));
            ctx.output("chat-select-all-report", JSON.stringify({ ...report, shortcut: { ...report.shortcut, text: report.shortcut.text.slice(0, 300) }, direct: { ...report.direct, text: report.direct.text.slice(0, 300) } }, null, 2));
            ctx.assert(report.transcriptExists === true, "No [data-chat-transcript] root was visible.");
            ctx.assert(report.globalType === "function", `Expected window.__openworkChatSelectAll to be a function, got ${report.globalType}.`);
            ctx.assert(report.missingAnchors.length === 0, `No live shell anchor was available for: ${report.missingAnchors.join(", ")}`);
            ctx.assert(report.shortcut.includesReply === true, "Ctrl+A selection did not include the assistant reply.");
            // User bubbles are user-select:none on this base branch (a separate PR makes them selectable),
            // and Selection.toString() omits user-select:none text, so prompt inclusion is intentionally not asserted here.
            ctx.assert(report.shortcut.excludedHits.length === 0, `Ctrl+A selection leaked shell text: ${report.shortcut.excludedHits.join(", ")}`);
            ctx.assert(report.directReturn === true, `Renderer global returned ${JSON.stringify(report.directReturn)} instead of true.`);
            ctx.assert(report.direct.includesReply === true, "Renderer global selection did not include the assistant reply.");
            // User bubbles are user-select:none on this base branch (a separate PR makes them selectable),
            // and Selection.toString() omits user-select:none text, so prompt inclusion is intentionally not asserted here.
            ctx.assert(report.direct.excludedHits.length === 0, `Renderer global selection leaked shell text: ${report.direct.excludedHits.join(", ")}`);
          },
          screenshot: { name: "chat-transcript-selected", requireText: [REPLY], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Select All inside the composer stays scoped to draft text",
      run: async (ctx) => {
        await ctx.prove("Ctrl+A in the composer selects only the editable draft", {
          voiceover: vo[2],
          action: async () => {
            await clearComposer(ctx);
            await pasteComposer(ctx, DRAFT);
            await ctx.waitFor(
              `(() => {
                const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
                return Boolean(editor && (editor.innerText || "").includes(${JSON.stringify(DRAFT)}));
              })()`,
              { timeoutMs: 10_000, label: "draft text in composer" },
            );
            await dispatchCtrlA(ctx);
          },
          assert: async () => {
            const report = await ctx.eval(composerSelectionExpression());
            ctx.output("composer-select-all-report", JSON.stringify(report, null, 2));
            ctx.assert(report.composerExists === true, "Composer was not visible.");
            ctx.assert(report.text.trim() === DRAFT || report.text.includes(DRAFT), `Composer selection was ${JSON.stringify(report.text)}.`);
            ctx.assert(!report.text.includes(REPLY), "Composer Select All leaked transcript text into the selection.");
            ctx.assert(report.anchorInsideComposer === true, `Selection anchor was not inside the composer: ${JSON.stringify(report)}`);
          },
          screenshot: { name: "composer-draft-selected", requireText: [DRAFT], rejectText: ["Something went wrong"] },
        });
        await clearComposer(ctx);
        await clearSelectionAndBlur(ctx);
      },
    },
  ],
};
