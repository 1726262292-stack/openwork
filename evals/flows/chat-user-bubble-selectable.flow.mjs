import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/chat-user-bubble-selectable.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("chat-user-bubble-selectable");

const SENTENCE = "The quick brown fox jumps over the lazy dog";

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
    ? "Profile is not onboarded (welcome/signin); chat selection flow requires a workspace."
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

async function waitForUserBubble(ctx) {
  return ctx.waitFor(
    `(() => Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .some((message) => message.innerText.includes(${JSON.stringify(SENTENCE)})))()`,
    { timeoutMs: 30_000, label: "submitted user bubble" },
  );
}

async function userBubbleStyles(ctx) {
  return ctx.eval(`(() => {
    const message = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((candidate) => candidate.innerText.includes(${JSON.stringify(SENTENCE)}));
    if (!message) return { ok: false, reason: "user message not found" };
    const wrapper = message.querySelector('.group.flex.w-full.flex-col.items-end');
    const content = message.querySelector('.bg-muted.whitespace-pre-wrap')
      || Array.from(message.querySelectorAll('div')).find((candidate) => candidate.innerText.includes(${JSON.stringify(SENTENCE)}));
    if (!wrapper) return { ok: false, reason: "context menu trigger wrapper not found" };
    if (!content) return { ok: false, reason: "bubble content not found" };
    return {
      ok: true,
      wrapperUserSelect: getComputedStyle(wrapper).userSelect,
      contentUserSelect: getComputedStyle(content).userSelect,
      wrapperClassName: wrapper.className,
      contentClassName: content.className,
    };
  })()`);
}

async function bubblePoint(ctx) {
  return ctx.eval(`(() => {
    const message = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((candidate) => candidate.innerText.includes(${JSON.stringify(SENTENCE)}));
    const content = message?.querySelector('.bg-muted.whitespace-pre-wrap');
    if (!content) return null;
    content.scrollIntoView({ block: "center", inline: "center" });
    const rect = content.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function hoverUserBubble(ctx) {
  const point = await bubblePoint(ctx);
  ctx.assert(point, "Could not find the user bubble to hover.");
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
}

async function waitForUserBubbleActions(ctx) {
  await ctx.waitFor(
    `(() => {
      const message = Array.from(document.querySelectorAll('[data-message-role="user"]'))
        .find((candidate) => candidate.innerText.includes(${JSON.stringify(SENTENCE)}));
      return Boolean(message?.querySelector('button[aria-label="Copy message"]'));
    })()`,
    { timeoutMs: 60_000, label: "user bubble hover actions" },
  );
}

async function measureBubbleTextRect(ctx) {
  const rect = await ctx.eval(`(() => {
    const message = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((candidate) => candidate.innerText.includes(${JSON.stringify(SENTENCE)}));
    const content = message?.querySelector('.bg-muted.whitespace-pre-wrap');
    if (!content) return null;
    content.scrollIntoView({ block: "center", inline: "center" });
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode && !textNode.textContent.includes(${JSON.stringify(SENTENCE)})) {
      textNode = walker.nextNode();
    }
    const range = document.createRange();
    if (textNode) range.selectNodeContents(textNode);
    else range.selectNodeContents(content);
    const textRect = Array.from(range.getClientRects()).find((item) => item.width > 20 && item.height > 0);
    const fallbackRect = content.getBoundingClientRect();
    const source = textRect || fallbackRect;
    return {
      left: source.left,
      right: source.right,
      top: source.top,
      bottom: source.bottom,
      width: source.width,
      height: source.height,
      midY: source.top + source.height / 2,
    };
  })()`);
  ctx.assert(rect && rect.width > 20 && rect.height > 0, "Could not measure the bubble text rect.");
  return rect;
}

async function clearSelection(ctx) {
  await ctx.eval(`(() => {
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    return true;
  })()`);
}

async function dragAcrossBubble(ctx) {
  const rect = await measureBubbleTextRect(ctx);
  const startX = rect.left + 4;
  const endX = rect.right - 4;
  const y = rect.midY;
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: startX,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 10; step += 1) {
    const x = startX + ((endX - startX) * step) / 10;
    await ctx.client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "left",
      buttons: 1,
    });
  }
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: endX,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function selectionText(ctx) {
  return ctx.eval(`(() => window.getSelection()?.toString() || "")()`);
}

export default {
  id: "chat-user-bubble-selectable",
  title: "User chat bubble text is selectable by drag and Select All",
  kind: "user-facing",
  precondition: bootPrecondition,
  steps: [
    {
      name: "Fresh task receives a distinctive user message",
      run: async (ctx) => {
        await ctx.prove("A distinctive sentence is sent as the user's own chat bubble", {
          voiceover: vo[0],
          action: async () => {
            await closeStaleDialogs(ctx);
            await ctx.control("session.create_task");
            const sessionId = await waitForActiveSessionId(ctx);
            ctx.log(`active session: ${sessionId}`);
            const pasted = await pasteComposer(ctx, SENTENCE);
            ctx.assert(pasted?.ok, `Composer not ready: ${pasted?.reason ?? "unknown"}`);
            await submitComposer(ctx);
          },
          assert: async () => {
            await ctx.waitForText(SENTENCE, { timeoutMs: 30_000 });
            await waitForUserBubble(ctx);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "distinctive-user-message", requireText: [SENTENCE], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "User bubble advertises text selection",
      run: async (ctx) => {
        await ctx.prove("The user bubble wrapper and content both compute to user-select: text", {
          voiceover: vo[1],
          action: async () => {
            await hoverUserBubble(ctx);
            await waitForUserBubbleActions(ctx);
            await hoverUserBubble(ctx);
          },
          assert: async () => {
            const styles = await userBubbleStyles(ctx);
            ctx.assert(styles?.ok, styles?.reason || "Could not inspect user bubble styles.");
            ctx.assert(styles.wrapperUserSelect === "text", `Wrapper user-select is ${styles.wrapperUserSelect}, not text.`);
            ctx.assert(styles.contentUserSelect === "text", `Bubble content user-select is ${styles.contentUserSelect}, not text.`);
            ctx.log(`user-select styles: ${JSON.stringify(styles)}`);
          },
          screenshot: { name: "bubble-select-text-style", requireText: [SENTENCE], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Mouse drag selects the user bubble text",
      run: async (ctx) => {
        await ctx.prove("A real mouse drag over the bubble selects Alex's words", {
          voiceover: vo[2],
          action: async () => {
            // This measures the text rect only; it does not create a Range
            // selection. The proof below uses raw CDP mouse events so CSS
            // user-select can block the selection if the regression returns.
            await clearSelection(ctx);
            await dragAcrossBubble(ctx);
          },
          assert: async () => {
            let selected = await selectionText(ctx);
            if (!/quick brown fox/.test(selected)) {
              ctx.log(`first drag selection was ${JSON.stringify(selected)}; retrying once with a fresh rect`);
              await clearSelection(ctx);
              await dragAcrossBubble(ctx);
              selected = await selectionText(ctx);
            }
            ctx.assert(/quick brown fox/.test(selected), `Drag selection did not include the expected words. Selected: ${JSON.stringify(selected)}`);
            ctx.log(`drag selection: ${JSON.stringify(selected.slice(0, 200))}`);
          },
          screenshot: { name: "drag-selected-user-bubble", requireText: [SENTENCE], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Select All includes the user bubble text",
      run: async (ctx) => {
        await ctx.prove("Select All includes the text from Alex's own bubble", {
          voiceover: vo[3],
          action: async () => {
            const result = await ctx.eval(`(() => {
              const selection = window.getSelection();
              if (selection) selection.removeAllRanges();
              const active = document.activeElement;
              if (active && typeof active.blur === "function") active.blur();
              const composer = document.querySelector('[contenteditable="true"]');
              if (composer && typeof composer.blur === "function") composer.blur();
              document.body.setAttribute("tabindex", "-1");
              document.body.focus({ preventScroll: true });
              const ok = document.execCommand("selectAll");
              return { ok, selection: window.getSelection()?.toString().slice(0, 200) || "" };
            })()`);
            ctx.assert(result?.ok, "document.execCommand('selectAll') returned false.");
            ctx.log(`selectAll preview: ${JSON.stringify(result.selection)}`);
          },
          assert: async () => {
            const selected = await selectionText(ctx);
            ctx.assert(selected.includes("quick brown fox"), `Select All did not include the user bubble text. Selection started: ${JSON.stringify(selected.slice(0, 200))}`);
            ctx.log(`selectAll selection first 200 chars: ${JSON.stringify(selected.slice(0, 200))}`);
          },
          screenshot: { name: "select-all-includes-user-bubble", requireText: [SENTENCE], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
