import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "sidebar-spinner-clear-of-title";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"]';
const PROMPT = "Write a 150-word overview of planning a quarterly robotics offsite, thinking step by step before you answer.";
const PROMPT_MARKER = "quarterly robotics offsite";
const CONTINUE_PROMPT = "continue";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let activeSessionId = null;
let measuredSidebarTitle = "";

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
  activeSessionId = await waitForActiveSessionId(ctx, {
    previousId,
    timeoutMs: 30_000,
    label: "fresh active session id in route",
  });
  ctx.assert(Boolean(activeSessionId), "No active session id after create_task.");
  ctx.log(`active session: ${activeSessionId}`);
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
    timeoutMs: 30_000,
    label: "composer editor",
  });
  return activeSessionId;
}

function userBubbleExpression(text) {
  return `(() => Array.from(document.querySelectorAll('[data-message-role="user"]'))
    .some((element) => (element.innerText || "").includes(${JSON.stringify(text)})))()`;
}

async function sendPrompt(ctx, text) {
  const pasted = await pasteComposer(ctx, text);
  ctx.assert(pasted?.ok === true, `Composer not ready: ${pasted?.reason ?? "unknown"}`);
  await submitComposer(ctx);
  await ctx.waitFor(userBubbleExpression(text === PROMPT ? PROMPT_MARKER : text), {
    timeoutMs: 20_000,
    label: `user bubble for ${JSON.stringify(text)}`,
  });
}

function sidebarRowStateExpression(expectedTitle = "") {
  return `(() => {
    const expectedTitle = ${JSON.stringify(expectedTitle)};
    const route = window.__openworkControl?.snapshot?.().route || window.location.hash || "";
    const activeSessionId = (route.match(/ses_[A-Za-z0-9]+/) || [])[0] || "";
    const sidebarContent = document.querySelector('[data-slot="sidebar-content"]');
    const sidebar = sidebarContent?.closest('[data-slot="sidebar"]')
      || sidebarContent
      || document.querySelector('[data-sidebar="sidebar"]')
      || document.body;
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const rows = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu-sub-item"], li'));
    const candidates = [];
    for (const row of rows) {
      const title = row.querySelector('.truncate[title]');
      if (!title) continue;
      const button = title.closest('a,button') || title.closest('[data-slot="sidebar-menu-sub-button"]') || row.querySelector('[data-slot="sidebar-menu-sub-button"], a, button');
      const spinner = row.querySelector('svg.animate-spin');
      const dataActive = button ? button.getAttribute("data-active") : null;
      const isActive = Boolean(button && (
        dataActive === ""
        || dataActive === "true"
        || button.getAttribute("aria-current") === "page"
        || button.getAttribute("aria-selected") === "true"
        || button.getAttribute("data-state") === "active"
      ));
      const titleText = (title.textContent || "").trim();
      const titleAttr = title.getAttribute("title") || titleText;
      candidates.push({
        row,
        button,
        title,
        spinner,
        titleText,
        titleAttr,
        isActive,
        hasSpinner: Boolean(spinner && isVisible(spinner)),
        truncated: title.scrollWidth > title.clientWidth,
        titleClientWidth: title.clientWidth,
        titleScrollWidth: title.scrollWidth,
      });
    }
    const picked = candidates.find((candidate) => candidate.isActive && (!expectedTitle || candidate.titleAttr === expectedTitle))
      || candidates.find((candidate) => expectedTitle && candidate.titleAttr === expectedTitle)
      || candidates.find((candidate) => candidate.isActive)
      || candidates.find((candidate) => candidate.hasSpinner && candidate.truncated)
      || candidates.find((candidate) => candidate.hasSpinner)
      || null;
    if (!picked) {
      return {
        found: false,
        activeSessionId,
        expectedTitle,
        candidates: candidates.slice(-6).map((candidate) => ({
          title: candidate.titleAttr,
          isActive: candidate.isActive,
          hasSpinner: candidate.hasSpinner,
          truncated: candidate.truncated,
          titleClientWidth: candidate.titleClientWidth,
          titleScrollWidth: candidate.titleScrollWidth,
        })),
      };
    }
    return {
      found: true,
      ready: picked.hasSpinner && picked.truncated,
      activeSessionId,
      expectedTitle,
      title: picked.titleAttr,
      titleText: picked.titleText,
      isActive: picked.isActive,
      hasSpinner: picked.hasSpinner,
      truncated: picked.truncated,
      titleClientWidth: picked.titleClientWidth,
      titleScrollWidth: picked.titleScrollWidth,
    };
  })()`;
}

function sidebarMeasurementExpression(expectedTitle = "") {
  return `(() => {
    const expectedTitle = ${JSON.stringify(expectedTitle)};
    const sidebarContent = document.querySelector('[data-slot="sidebar-content"]');
    const sidebar = sidebarContent?.closest('[data-slot="sidebar"]')
      || sidebarContent
      || document.querySelector('[data-sidebar="sidebar"]')
      || document.body;
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const rows = Array.from(sidebar.querySelectorAll('[data-slot="sidebar-menu-sub-item"], li'));
    const candidates = [];
    for (const row of rows) {
      const title = row.querySelector('.truncate[title]');
      if (!title) continue;
      const closestButton = title.closest('a,button');
      const slotButton = title.closest('[data-slot="sidebar-menu-sub-button"]') || row.querySelector('[data-slot="sidebar-menu-sub-button"]');
      const button = closestButton || slotButton;
      const spinnerSvg = row.querySelector('svg.animate-spin');
      const dataActive = button ? button.getAttribute("data-active") : null;
      const isActive = Boolean(button && (
        dataActive === ""
        || dataActive === "true"
        || button.getAttribute("aria-current") === "page"
        || button.getAttribute("aria-selected") === "true"
        || button.getAttribute("data-state") === "active"
      ));
      const titleText = (title.textContent || "").trim();
      const titleAttr = title.getAttribute("title") || titleText;
      candidates.push({ row, title, button, closestButton, slotButton, spinnerSvg, titleText, titleAttr, isActive, hasSpinner: Boolean(spinnerSvg && isVisible(spinnerSvg)), truncated: title.scrollWidth > title.clientWidth });
    }
    const picked = candidates.find((candidate) => candidate.isActive && (!expectedTitle || candidate.titleAttr === expectedTitle))
      || candidates.find((candidate) => expectedTitle && candidate.titleAttr === expectedTitle)
      || candidates.find((candidate) => candidate.isActive)
      || candidates.find((candidate) => candidate.hasSpinner && candidate.truncated)
      || candidates.find((candidate) => candidate.hasSpinner)
      || null;
    if (!picked) {
      return { ok: false, reason: "No sidebar row with a titled truncated span was found.", expectedTitle, candidates: candidates.map((candidate) => ({ title: candidate.titleAttr, isActive: candidate.isActive, hasSpinner: candidate.hasSpinner, truncated: candidate.truncated })).slice(-8) };
    }
    if (!picked.spinnerSvg || !isVisible(picked.spinnerSvg)) {
      return { ok: false, reason: "The picked sidebar row does not contain a visible animate-spin svg.", title: picked.titleAttr, isActive: picked.isActive, hasSpinner: false };
    }
    const spinnerElement = picked.spinnerSvg.closest('span') || picked.spinnerSvg;
    const titleRect = picked.title.getBoundingClientRect();
    const spinnerRect = spinnerElement.getBoundingClientRect();
    const computed = picked.button ? getComputedStyle(picked.button) : null;
    const buttonPaddingRight = computed ? parseFloat(computed.paddingRight) : 0;
    const buttonSource = picked.closestButton
      ? "title.closest('a,button')"
      : picked.slotButton
        ? "data-slot=sidebar-menu-sub-button"
        : "not found";
    return {
      ok: true,
      title: picked.titleAttr,
      titleText: picked.titleText,
      rowTag: picked.row.tagName.toLowerCase(),
      buttonTag: picked.button ? picked.button.tagName.toLowerCase() : null,
      buttonSource,
      isActive: picked.isActive,
      hasSpinner: true,
      truncated: picked.title.scrollWidth > picked.title.clientWidth,
      titleScrollWidth: picked.title.scrollWidth,
      titleClientWidth: picked.title.clientWidth,
      titleRect: { left: titleRect.left, right: titleRect.right, width: titleRect.width },
      spinnerRect: { left: spinnerRect.left, right: spinnerRect.right, width: spinnerRect.width },
      buttonPaddingRight,
      noOverlap: titleRect.right <= spinnerRect.left + 0.5,
      hasReservedPadding: buttonPaddingRight >= 32,
    };
  })()`;
}

async function sendContinue(ctx) {
  ctx.log("Streaming ended before the long title and spinner held together; sending follow-up 'continue'.");
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
    timeoutMs: 30_000,
    label: "composer editor for continue follow-up",
  });
  await sendPrompt(ctx, CONTINUE_PROMPT);
}

async function waitForStreamingTruncatedSidebarRow(ctx) {
  let followUps = 0;
  let lastState = null;
  while (followUps <= 2) {
    let sawSpinner = false;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const state = await ctx.eval(sidebarRowStateExpression(measuredSidebarTitle));
      lastState = state;
      if (state?.ready) {
        measuredSidebarTitle = state.title || measuredSidebarTitle;
        ctx.log(`sidebar row ready after ${followUps} follow-up(s): ${JSON.stringify(state)}`);
        return state;
      }
      if (state?.hasSpinner) sawSpinner = true;
      if (sawSpinner && state?.found && !state.hasSpinner) break;
      await sleep(500);
    }
    if (followUps >= 2) break;
    followUps += 1;
    await sendContinue(ctx);
  }
  ctx.assert(false, `Timed out waiting for the active sidebar row to show both a visible spinner and a truncated title. Last state: ${JSON.stringify(lastState)}`);
  return null;
}

export default {
  id: FLOW_ID,
  title: "Sidebar streaming spinner stays clear of long task titles",
  kind: "user-facing",
  precondition: async (ctx) => {
    const state = await waitForReadySession(ctx);
    return state === "blocked"
      ? "Profile is not onboarded (welcome/signin); sidebar spinner proof requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Create a fresh streaming task",
      run: async (ctx) => {
        await ctx.prove("A fresh task starts running and renders the user's prompt", {
          voiceover: vo[0],
          action: async () => {
            await closeStaleDialogs(ctx);
            await createFreshTask(ctx);
            await sendPrompt(ctx, PROMPT);
          },
          assert: async () => {
            await ctx.waitFor(userBubbleExpression(PROMPT_MARKER), {
              timeoutMs: 20_000,
              label: "robotics offsite prompt in a user bubble",
            });
            ctx.assert(Boolean(activeSessionId), "No active session id was captured for the streaming task.");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "streaming-task-started", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Measure title and spinner separation while streaming",
      run: async (ctx) => {
        await ctx.prove("The active sidebar row reserves enough end padding for the streaming spinner", {
          voiceover: vo[1],
          action: async () => {
            await waitForStreamingTruncatedSidebarRow(ctx);
          },
          assert: async () => {
            const measurement = await ctx.eval(sidebarMeasurementExpression(measuredSidebarTitle));
            ctx.output("sidebar-spinner-measurement", JSON.stringify(measurement, null, 2));
            ctx.log(`sidebar measurement: ${JSON.stringify(measurement)}`);
            ctx.assert(measurement?.ok === true, measurement?.reason ?? "Sidebar row measurement failed.");
            ctx.assert(measurement.hasSpinner === true, "The measured row did not contain the streaming spinner.");
            ctx.assert(measurement.truncated === true, `The title was not actually truncated: ${JSON.stringify(measurement)}`);
            ctx.assert(measurement.noOverlap === true, `Title overlapped the spinner: ${JSON.stringify(measurement)}`);
            ctx.assert(measurement.hasReservedPadding === true, `Expected at least 32px right padding, got ${measurement.buttonPaddingRight}.`);
            measuredSidebarTitle = measurement.title || measuredSidebarTitle;
          },
          screenshot: { name: "spinner-clear-of-title", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Spinner clears when the run finishes",
      run: async (ctx) => {
        await ctx.prove("The same sidebar row removes the spinner after the task finishes", {
          voiceover: vo[2],
          action: async () => {
            await ctx.waitFor(
              `(() => {
                const state = ${sidebarRowStateExpression(measuredSidebarTitle)};
                return state.found && !state.hasSpinner ? state : null;
              })()`,
              { timeoutMs: 120_000, label: "active sidebar row spinner to disappear" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(sidebarRowStateExpression(measuredSidebarTitle));
            ctx.output("sidebar-spinner-finished-state", JSON.stringify(state, null, 2));
            ctx.assert(state?.found === true, `Could not find the measured sidebar row after streaming: ${JSON.stringify(state)}`);
            ctx.assert(state.hasSpinner === false, `Spinner was still visible in the measured row: ${JSON.stringify(state)}`);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: { name: "spinner-cleared", rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
