import { defineFlow, type FlowContext } from "../runner/flow.ts";
import { loadVoiceoverParagraphs } from "../runner/voiceover.ts";

const FLOW_ID = "hero-composer-alignment";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
if (!vo) throw new Error(`Missing approved voice-over script for ${FLOW_ID}.`);

type HeroAlignmentMetrics = {
  panelLeft: number;
  panelRight: number;
  panelWidth: number;
  gridLeft: number;
  gridRight: number;
  gridWidth: number;
  firstCardLeft: number;
  widestCardRight: number;
  cardsLength: number;
  rootPosition: string;
};

type DockedComposerMetrics = {
  rootLeft: number;
  rootRight: number;
  rootWidth: number;
  innerLeft: number;
  innerRight: number;
  innerWidth: number;
  panelLeft: number;
  panelRight: number;
  panelWidth: number;
  leftInset: number;
  rightInset: number;
  centerDelta: number;
  rootPosition: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberProperty(record: Record<string, unknown>, key: string): number | null {
  const value = Reflect.get(record, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = Reflect.get(record, key);
  return typeof value === "string" ? value : null;
}

function heroAlignmentMetrics(value: unknown): HeroAlignmentMetrics | null {
  if (!isRecord(value)) return null;
  const panelLeft = numberProperty(value, "panelLeft");
  const panelRight = numberProperty(value, "panelRight");
  const panelWidth = numberProperty(value, "panelWidth");
  const gridLeft = numberProperty(value, "gridLeft");
  const gridRight = numberProperty(value, "gridRight");
  const gridWidth = numberProperty(value, "gridWidth");
  const firstCardLeft = numberProperty(value, "firstCardLeft");
  const widestCardRight = numberProperty(value, "widestCardRight");
  const cardsLength = numberProperty(value, "cardsLength");
  const rootPosition = stringProperty(value, "rootPosition");
  if (
    panelLeft === null ||
    panelRight === null ||
    panelWidth === null ||
    gridLeft === null ||
    gridRight === null ||
    gridWidth === null ||
    firstCardLeft === null ||
    widestCardRight === null ||
    cardsLength === null ||
    rootPosition === null
  ) {
    return null;
  }
  return {
    panelLeft,
    panelRight,
    panelWidth,
    gridLeft,
    gridRight,
    gridWidth,
    firstCardLeft,
    widestCardRight,
    cardsLength,
    rootPosition,
  };
}

function dockedComposerMetrics(value: unknown): DockedComposerMetrics | null {
  if (!isRecord(value)) return null;
  const rootLeft = numberProperty(value, "rootLeft");
  const rootRight = numberProperty(value, "rootRight");
  const rootWidth = numberProperty(value, "rootWidth");
  const innerLeft = numberProperty(value, "innerLeft");
  const innerRight = numberProperty(value, "innerRight");
  const innerWidth = numberProperty(value, "innerWidth");
  const panelLeft = numberProperty(value, "panelLeft");
  const panelRight = numberProperty(value, "panelRight");
  const panelWidth = numberProperty(value, "panelWidth");
  const leftInset = numberProperty(value, "leftInset");
  const rightInset = numberProperty(value, "rightInset");
  const centerDelta = numberProperty(value, "centerDelta");
  const rootPosition = stringProperty(value, "rootPosition");
  if (
    rootLeft === null ||
    rootRight === null ||
    rootWidth === null ||
    innerLeft === null ||
    innerRight === null ||
    innerWidth === null ||
    panelLeft === null ||
    panelRight === null ||
    panelWidth === null ||
    leftInset === null ||
    rightInset === null ||
    centerDelta === null ||
    rootPosition === null
  ) {
    return null;
  }
  return {
    rootLeft,
    rootRight,
    rootWidth,
    innerLeft,
    innerRight,
    innerWidth,
    panelLeft,
    panelRight,
    panelWidth,
    leftInset,
    rightInset,
    centerDelta,
    rootPosition,
  };
}

function formatHeroMetrics(metrics: HeroAlignmentMetrics): string {
  return JSON.stringify(metrics);
}

function formatDockedMetrics(metrics: DockedComposerMetrics): string {
  return JSON.stringify(metrics);
}

const WAIT_FOR_CREATE_TASK_READY = `(() => {
  const control = window.__openworkControl;
  if (!control) return null;
  const route = String(control.snapshot().route || "");
  if (route.startsWith("/welcome") || route.startsWith("/signin")) {
    return "Profile is on welcome/sign-in; hero composer alignment requires an onboarded workspace.";
  }
  const action = control.listActions().find((candidate) => candidate.id === "session.create_task");
  if (action && !action.disabled) {
    delete window.__heroComposerCreateTaskUnavailableSince;
    return "ready";
  }
  const text = document.body.innerText || "";
  let reason = "";
  if (!action && text.trim().length > 40) {
    reason = "session.create_task control action is not registered; cannot prove the docked composer handoff.";
  } else if (action && action.disabled && (
    text.includes("What do you need done?") ||
    text.includes("Connect a model provider") ||
    text.includes("OpenCode unavailable") ||
    text.includes("Remote workspace unavailable")
  )) {
    reason = "session.create_task control action is disabled; cannot create a session for the docked composer check.";
  }
  if (!reason) return null;
  const key = "__heroComposerCreateTaskUnavailableSince";
  if (!window[key]) window[key] = Date.now();
  return Date.now() - window[key] > 2000 ? reason : null;
})()`;

const INSPECT_CREATE_TASK_READY = `(() => {
  const control = window.__openworkControl;
  if (!control) return "OpenWork control API is unavailable.";
  const route = String(control.snapshot().route || "");
  if (route.startsWith("/welcome") || route.startsWith("/signin")) {
    return "Profile is on welcome/sign-in; hero composer alignment requires an onboarded workspace.";
  }
  const action = control.listActions().find((candidate) => candidate.id === "session.create_task");
  if (action && !action.disabled) return "ready";
  if (!action) return "session.create_task control action is not registered; cannot prove the docked composer handoff.";
  return "session.create_task control action is disabled; cannot create a session for the docked composer check.";
})()`;

async function createTaskPrecondition(ctx: FlowContext): Promise<string | null> {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API",
  });
  try {
    const state = await ctx.waitFor(WAIT_FOR_CREATE_TASK_READY, {
      timeoutMs: 30_000,
      label: "session.create_task ready or unavailable",
    });
    return state === "ready"
      ? null
      : typeof state === "string"
        ? state
        : "session.create_task is unavailable; cannot prove the docked composer handoff.";
  } catch {
    const state = await ctx.eval(INSPECT_CREATE_TASK_READY);
    return state === "ready"
      ? null
      : typeof state === "string"
        ? state
        : "session.create_task is unavailable; cannot prove the docked composer handoff.";
  }
}

const EMPTY_TASK_ROUTE_FROM_SESSION = `(() => {
  const route = String(window.__openworkControl.snapshot().route || "");
  if (!route.includes("/session/")) return "";
  const workspaceMatch = route.match(/^\/workspace\/([^/]+)\/session\/[^/]+/);
  if (workspaceMatch) return "/workspace/" + workspaceMatch[1] + "/session";
  if (route.match(/^\/session\/[^/]+/)) return "/session";
  return route.replace(/\/session\/.*$/, "/session");
})()`;

const HERO_LAYOUT_READY = `(() => {
  const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "What do you need done?");
  const hero = heading && heading.parentElement ? heading.parentElement.parentElement : null;
  const editor = hero ? hero.querySelector('[contenteditable="true"]') : null;
  let panel = editor;
  while (panel && String(panel.className || "").indexOf("rounded-[18px]") === -1) panel = panel.parentElement;
  const grid = hero ? [...hero.children].find((el) => el.classList.contains("grid")) : null;
  const cards = grid ? [...grid.children] : [];
  if (!heading || !hero || !editor || !panel || !grid || cards.length < 1) return false;
  const panelRect = panel.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const firstCardRect = cards[0].getBoundingClientRect();
  return panelRect.width > 0 && gridRect.width > 0 && firstCardRect.width > 0;
})()`;

const MEASURE_HERO_ALIGNMENT = `(() => {
  const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "What do you need done?");
  const hero = heading && heading.parentElement ? heading.parentElement.parentElement : null;
  const editor = hero ? hero.querySelector('[contenteditable="true"]') : null;
  let panel = editor;
  while (panel && String(panel.className || "").indexOf("rounded-[18px]") === -1) panel = panel.parentElement;
  const grid = hero ? [...hero.children].find((el) => el.classList.contains("grid")) : null;
  const cards = grid ? [...grid.children] : [];
  if (!panel || !grid || cards.length < 1) return null;
  const panelRect = panel.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const firstCardRect = cards[0].getBoundingClientRect();
  const widestCardRight = cards.reduce((right, card) => Math.max(right, card.getBoundingClientRect().right), firstCardRect.right);
  const composerRoot = panel.parentElement && panel.parentElement.parentElement ? panel.parentElement.parentElement : null;
  return {
    panelLeft: Math.round(panelRect.left),
    panelRight: Math.round(panelRect.right),
    panelWidth: Math.round(panelRect.width),
    gridLeft: Math.round(gridRect.left),
    gridRight: Math.round(gridRect.right),
    gridWidth: Math.round(gridRect.width),
    firstCardLeft: Math.round(firstCardRect.left),
    widestCardRight: Math.round(widestCardRight),
    cardsLength: cards.length,
    rootPosition: composerRoot ? getComputedStyle(composerRoot).position : "missing",
  };
})()`;

const DOCKED_COMPOSER_READY = `(() => {
  const editors = [...document.querySelectorAll('[contenteditable="true"]')];
  for (const editor of editors) {
    let panel = editor;
    while (panel && String(panel.className || "").indexOf("rounded-[18px]") === -1) panel = panel.parentElement;
    if (!panel || !panel.parentElement || !panel.parentElement.parentElement) continue;
    const root = panel.parentElement.parentElement;
    const rootRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (getComputedStyle(root).position === "sticky" && rootRect.width > 0 && panelRect.width > 0) return true;
  }
  return false;
})()`;

const MEASURE_DOCKED_COMPOSER = `(() => {
  const editors = [...document.querySelectorAll('[contenteditable="true"]')];
  for (const editor of editors) {
    let panel = editor;
    while (panel && String(panel.className || "").indexOf("rounded-[18px]") === -1) panel = panel.parentElement;
    if (!panel || !panel.parentElement || !panel.parentElement.parentElement) continue;
    const inner = panel.parentElement;
    const root = inner.parentElement;
    if (getComputedStyle(root).position !== "sticky") continue;
    const rootRect = root.getBoundingClientRect();
    const innerRect = inner.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      rootLeft: Math.round(rootRect.left),
      rootRight: Math.round(rootRect.right),
      rootWidth: Math.round(rootRect.width),
      innerLeft: Math.round(innerRect.left),
      innerRight: Math.round(innerRect.right),
      innerWidth: Math.round(innerRect.width),
      panelLeft: Math.round(panelRect.left),
      panelRight: Math.round(panelRect.right),
      panelWidth: Math.round(panelRect.width),
      leftInset: Math.round(panelRect.left - rootRect.left),
      rightInset: Math.round(rootRect.right - panelRect.right),
      centerDelta: Math.round(Math.abs((panelRect.left + panelRect.right) / 2 - (rootRect.left + rootRect.right) / 2)),
      rootPosition: getComputedStyle(root).position,
    };
  }
  return null;
})()`;

export default defineFlow({
  id: FLOW_ID,
  title: "New-task composer spans the same width as the starter cards below it",
  kind: "user-facing",
  spec: "evals/react-session-flows.md",
  precondition: createTaskPrecondition,
  steps: [
    {
      name: "New-task screen is visible on launch",
      run: async (ctx) => {
        await ctx.prove("OpenWork lands on the empty new-task composer screen", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 60_000,
              label: "control API",
            });
            const emptyRoute = await ctx.eval(EMPTY_TASK_ROUTE_FROM_SESSION);
            if (typeof emptyRoute === "string" && emptyRoute.length > 0) {
              await ctx.navigateHash(emptyRoute);
            }
          },
          assert: async () => {
            await ctx.expectText("What do you need done?");
            await ctx.expectText("Describe your task");
            await ctx.expectText("Run task");
          },
          screenshot: {
            name: "new-task-screen",
            requireText: ["What do you need done?", "Run task"],
          },
        });
      },
    },
    {
      name: "New-task composer aligns to the starter-card column",
      run: async (ctx) => {
        await ctx.prove("The hero composer card and starter-card grid share the same edges", {
          voiceover: vo[1],
          action: async () => {
            await ctx.waitFor(HERO_LAYOUT_READY, {
              timeoutMs: 30_000,
              label: "hero composer and starter cards laid out",
            });
          },
          assert: async () => {
            const measured = await ctx.eval(MEASURE_HERO_ALIGNMENT);
            const metrics = heroAlignmentMetrics(measured);
            if (!metrics) {
              ctx.assert(false, `Could not measure hero alignment metrics: ${JSON.stringify(measured)}.`);
              return;
            }
            ctx.log(`Hero alignment metrics: ${formatHeroMetrics(metrics)}`);
            ctx.assert(
              metrics.cardsLength >= 1,
              `Expected cards.length >= 1, got ${metrics.cardsLength}; measured ${formatHeroMetrics(metrics)}.`,
            );
            ctx.assert(
              Math.abs(metrics.panelLeft - metrics.gridLeft) <= 1,
              `Composer left ${metrics.panelLeft}px must match grid left ${metrics.gridLeft}px within 1px; measured ${formatHeroMetrics(metrics)}.`,
            );
            ctx.assert(
              Math.abs(metrics.panelRight - metrics.gridRight) <= 1,
              `Composer right ${metrics.panelRight}px must match grid right ${metrics.gridRight}px within 1px; measured ${formatHeroMetrics(metrics)}.`,
            );
            ctx.assert(
              Math.abs(metrics.panelWidth - metrics.gridWidth) <= 1,
              `Composer width ${metrics.panelWidth}px must match grid width ${metrics.gridWidth}px within 1px; measured ${formatHeroMetrics(metrics)}.`,
            );
            ctx.assert(
              metrics.panelWidth > 0,
              `Composer panel width must be positive, got ${metrics.panelWidth}px; measured ${formatHeroMetrics(metrics)}.`,
            );
            ctx.assert(
              metrics.rootPosition !== "sticky",
              `New-task composer root must not be sticky, got position ${metrics.rootPosition}; measured ${formatHeroMetrics(metrics)}.`,
            );
          },
          screenshot: {
            name: "composer-aligned-with-cards",
            requireText: ["What do you need done?"],
          },
        });
      },
    },
    {
      name: "Session composer keeps the docked chat chrome",
      run: async (ctx) => {
        await ctx.prove("Starting a task keeps the session composer docked and width-capped", {
          voiceover: vo[2],
          action: async () => {
            await ctx.control("session.create_task");
            await ctx.waitFor(`window.__openworkControl.snapshot().route.includes("/session/")`, {
              timeoutMs: 60_000,
              label: "session route after task creation",
            });
            await ctx.waitFor(DOCKED_COMPOSER_READY, {
              timeoutMs: 30_000,
              label: "sticky session composer laid out",
            });
          },
          assert: async () => {
            const measured = await ctx.eval(MEASURE_DOCKED_COMPOSER);
            const metrics = dockedComposerMetrics(measured);
            if (!metrics) {
              ctx.assert(false, `Could not measure docked composer metrics: ${JSON.stringify(measured)}.`);
              return;
            }
            ctx.log(`Docked composer metrics: ${formatDockedMetrics(metrics)}`);
            ctx.assert(
              metrics.rootPosition === "sticky",
              `Session composer root must be sticky, got position ${metrics.rootPosition}; measured ${formatDockedMetrics(metrics)}.`,
            );
            ctx.assert(
              metrics.panelWidth <= 800,
              `Session composer panel must stay at most 800px wide, got ${metrics.panelWidth}px; measured ${formatDockedMetrics(metrics)}.`,
            );
            if (metrics.rootWidth > 800) {
              ctx.assert(
                metrics.centerDelta <= 2,
                `Session composer panel must be centered in its ${metrics.rootWidth}px column within 2px, got center delta ${metrics.centerDelta}px; measured ${formatDockedMetrics(metrics)}.`,
              );
            } else {
              ctx.assert(
                metrics.leftInset > 0 && metrics.rightInset > 0,
                `Narrow session composer must keep dock padding, got left inset ${metrics.leftInset}px and right inset ${metrics.rightInset}px; measured ${formatDockedMetrics(metrics)}.`,
              );
            }
          },
          screenshot: { name: "session-composer-still-docked" },
        });
      },
    },
  ],
});
