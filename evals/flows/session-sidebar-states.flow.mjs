import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("session-sidebar-states");
const LOADING_TITLE = "Follow up Blue Yonder";
const READING_TITLE = "Review Q3 forecast";
const COMPLETION_TEXT = "SIDEBAR STATE READY";
const WORKSPACE_COLORS = [
  "#499D81", "#3F7F96", "#4F6FAE", "#685DA8", "#855AA0", "#A25482", "#B65365",
  "#B9634D", "#B57935", "#96833B", "#708541", "#4F8557", "#556F82", "#8A6255",
];

let loadingSessionId = null;
let readingSessionId = null;
let selectedWorkspaceIdentity = null;
let expandedInsetWidth = null;
let preservedState = null;

async function currentSessionId(ctx) {
  return ctx.eval(`(() => {
    const route = window.__openworkControl.snapshot().route || "";
    return route.match(/ses_[A-Za-z0-9]+/)?.[0] ?? null;
  })()`);
}

async function createNamedSession(ctx, title) {
  await ctx.control("session.create_task");
  const sessionId = await currentSessionId(ctx);
  ctx.assert(Boolean(sessionId), `No session ID after creating ${title}.`);
  await ctx.control("session.rename", { sessionId, title });
  await ctx.waitForText(title, { timeoutMs: 30_000 });
  return sessionId;
}

function rowSelector(sessionId) {
  return `[data-session-row="true"][data-session-id=${JSON.stringify(sessionId)}]`;
}

async function clickVisibleSidebarTrigger(ctx) {
  await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll('[data-sidebar="trigger"]'))
      .find((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    if (!trigger) throw new Error("No visible sidebar trigger");
    trigger.click();
    return true;
  })()`);
}

async function waitForSidebarState(ctx, state) {
  await ctx.waitFor(
    `document.querySelector('[data-slot="sidebar"][data-state]')?.dataset.state === ${JSON.stringify(state)}`,
    { label: `sidebar to become ${state}` },
  );
}

async function waitForExpandedSidebarLayout(ctx) {
  await ctx.waitFor(
    `(() => {
      const panel = document.querySelector('[data-slot="sidebar-container"]');
      const gap = document.querySelector('[data-slot="sidebar-gap"]');
      if (!panel || !gap) return false;
      return Math.abs(panel.getBoundingClientRect().width - gap.getBoundingClientRect().width) <= 1;
    })()`,
    { label: "expanded sidebar panel and gap to align" },
  );
}

async function resizeSidebar(ctx, targetWidth) {
  await ctx.eval(`(() => {
    const rail = document.querySelector('[data-sidebar-resize-rail="true"]');
    const panel = document.querySelector('[data-slot="sidebar-container"]');
    if (!rail || !panel) throw new Error("Sidebar resize controls unavailable");
    const railRect = rail.getBoundingClientRect();
    const startX = railRect.left + railRect.width / 2;
    const delta = ${targetWidth} - panel.getBoundingClientRect().width;
    rail.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, clientX: startX, pointerId: 1, pointerType: "mouse",
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, buttons: 1, clientX: startX + delta, pointerId: 1, pointerType: "mouse",
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, button: 0, clientX: startX + delta, pointerId: 1, pointerType: "mouse",
    }));
    return true;
  })()`);
  await ctx.waitFor(
    `Math.abs(document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width - ${targetWidth}) <= 1`,
    { label: `sidebar width to become ${targetWidth}px` },
  );
}

async function returnToSession(ctx) {
  await ctx.control("route.session");
  await ctx.waitFor(
    "window.__openworkControl.listActions().some((action) => action.id === 'session.open')",
    { timeoutMs: 30_000, label: "session actions after returning to app" },
  );
  await ctx.control("session.open", { sessionId: readingSessionId });
  await ctx.waitFor(
    `document.querySelector(${JSON.stringify(rowSelector(readingSessionId))})?.dataset.sessionSelected === "true"`,
    { label: "reading session to reopen" },
  );
}

export default {
  id: "session-sidebar-states",
  title: "Consistent workspace identity and adaptable contained panels",
  kind: "user-facing",
  steps: [
    {
      name: "Solid workspace identity palette",
      run: async (ctx) => {
        await ctx.prove("Workspaces use deterministic solid colors instead of gradients", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "OpenWork control API" });
            await ctx.control("route.session");
            await ctx.waitFor(
              "window.__openworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)",
              { timeoutMs: 30_000, label: "new task action" },
            );
            loadingSessionId = await createNamedSession(ctx, LOADING_TITLE);
            readingSessionId = await createNamedSession(ctx, READING_TITLE);
            await ctx.control("session.open", { sessionId: readingSessionId });
            await ctx.eval(`(() => {
              const content = document.querySelector('[data-slot="sidebar-content"]');
              if (content) content.scrollTop = 0;
              return true;
            })()`);
          },
          assert: async () => {
            const identity = await ctx.eval(`(() => {
              const icons = Array.from(document.querySelectorAll('[data-openwork-workspace-icon="true"]'));
              const selected = icons.find((icon) => icon.closest('[data-open]')) ?? icons[0];
              return {
                icons: icons.map((icon) => ({
                  id: icon.dataset.workspaceId,
                  color: icon.dataset.workspaceColor,
                  background: getComputedStyle(icon).backgroundColor,
                  backgroundImage: getComputedStyle(icon).backgroundImage,
                  round: getComputedStyle(icon).borderRadius,
                })),
                selected: selected ? { id: selected.dataset.workspaceId, color: selected.dataset.workspaceColor } : null,
              };
            })()`);
            ctx.assert(identity.icons.length >= 2, "Not enough workspace identities were visible.");
            ctx.assert(identity.icons.every((icon) => WORKSPACE_COLORS.includes(icon.color)), "A workspace used a color outside the approved palette.");
            ctx.assert(identity.icons.every((icon) => icon.backgroundImage === "none"), "A workspace still used a gradient image.");
            ctx.assert(new Set(identity.icons.map((icon) => icon.color)).size >= 2, "Visible workspaces did not receive distinct colors.");
            selectedWorkspaceIdentity = identity.selected;
            ctx.assert(Boolean(selectedWorkspaceIdentity?.id && selectedWorkspaceIdentity?.color), "Selected workspace identity was unavailable.");
          },
          screenshot: { name: "solid-workspace-palette", requireText: [LOADING_TITLE, READING_TITLE] },
        });
      },
    },
    {
      name: "Workspace identity stays consistent",
      run: async (ctx) => {
        await ctx.prove("Settings uses the same workspace identity as the session sidebar", {
          voiceover: vo[1],
          action: async () => {
            await ctx.control("settings.panel.open", { panel: "general" });
            await ctx.waitFor("location.hash.includes('/settings/general')", { label: "general settings route" });
          },
          assert: async () => {
            const settingsIdentity = await ctx.eval(`(() => {
              const icon = document.querySelector('[data-openwork-workspace-icon="true"]');
              return icon ? { id: icon.dataset.workspaceId, color: icon.dataset.workspaceColor } : null;
            })()`);
            ctx.assert(Boolean(settingsIdentity), "Settings workspace identity was missing.");
            ctx.assert(settingsIdentity.id === selectedWorkspaceIdentity.id, "Settings showed a different workspace.");
            ctx.assert(settingsIdentity.color === selectedWorkspaceIdentity.color, "Workspace color changed between app and settings.");
          },
          screenshot: { name: "settings-workspace-identity", requireText: ["Settings", "Workspace"] },
        });
      },
    },
    {
      name: "Extensions use flat identity tiles",
      run: async (ctx) => {
        await ctx.prove("Extension cards and details use the same neutral puzzle tile", {
          voiceover: vo[2],
          action: async () => {
            await ctx.control("settings.panel.open", { panel: "extensions" });
            await ctx.waitFor("Boolean(document.querySelector('[data-openwork-extension-avatar=\"true\"]'))", {
              timeoutMs: 30_000,
              label: "extension fallback identity",
            });
            await ctx.eval(`(() => {
              const avatar = document.querySelector('[data-openwork-extension-avatar="true"]');
              const button = avatar?.closest('button');
              if (!avatar || !button) throw new Error("Extension card fallback unavailable");
              avatar.scrollIntoView({ block: "center" });
              button.click();
              return true;
            })()`);
            await ctx.waitFor("Boolean(document.querySelector('[role=\"dialog\"] [data-openwork-extension-avatar=\"true\"]'))", {
              label: "extension detail fallback identity",
            });
            await ctx.waitFor(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const overlay = document.querySelector('[data-slot="dialog-overlay"]');
              if (!dialog) return false;
              const targets = [dialog, overlay, ...dialog.querySelectorAll('*')].filter(Boolean);
              return getComputedStyle(dialog).opacity === "1" && targets.every((element) =>
                element.getAnimations().every((animation) => animation.playState !== "running")
              );
            })()`, { label: "extension detail animation to settle" });
          },
          assert: async () => {
            const extensionIdentity = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const detail = dialog?.querySelector('[data-openwork-extension-avatar="true"]');
              const card = Array.from(document.querySelectorAll('[data-openwork-extension-avatar="true"]'))
                .find((avatar) => !dialog?.contains(avatar));
              const describe = (element) => element ? {
                identity: element.dataset.extensionIdentity,
                background: getComputedStyle(element).backgroundColor,
                backgroundImage: getComputedStyle(element).backgroundImage,
                hasPuzzle: Boolean(element.querySelector('svg')),
              } : null;
              return { card: describe(card), detail: describe(detail) };
            })()`);
            ctx.assert(Boolean(extensionIdentity.card && extensionIdentity.detail), "Extension card/detail identities were not both rendered.");
            ctx.assert(extensionIdentity.card.identity === "neutral" && extensionIdentity.detail.identity === "neutral", "Extension identity was not neutral.");
            ctx.assert(extensionIdentity.card.backgroundImage === "none" && extensionIdentity.detail.backgroundImage === "none", "Extension identity still used a gradient.");
            ctx.assert(extensionIdentity.card.background === extensionIdentity.detail.background, "Card and detail identity backgrounds differed.");
            ctx.assert(extensionIdentity.card.hasPuzzle && extensionIdentity.detail.hasPuzzle, "Puzzle glyph was missing.");
          },
          screenshot: { name: "flat-extension-identity", requireText: ["Connected", "Extensions"] },
        });
      },
    },
    {
      name: "Sidebar and main panel match",
      run: async (ctx) => {
        await ctx.prove("Sidebar and workspace share one contained panel language", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              if (dialog) dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              return true;
            })()`);
            await returnToSession(ctx);
            await waitForExpandedSidebarLayout(ctx);
          },
          assert: async () => {
            const geometry = await ctx.eval(`(() => {
              const sidebar = document.querySelector('[data-slot="sidebar-inner"]');
              const main = document.querySelector('[data-session-main-panel="true"]');
              if (!sidebar || !main) return null;
              const sidebarStyle = getComputedStyle(sidebar);
              const mainStyle = getComputedStyle(main);
              const sidebarRect = sidebar.getBoundingClientRect();
              const mainRect = main.getBoundingClientRect();
              return {
                sidebarRadius: sidebarStyle.borderRadius,
                mainRadius: mainStyle.borderRadius,
                sidebarBackground: sidebarStyle.backgroundColor,
                mainBackground: mainStyle.backgroundColor,
                sidebarShadow: sidebarStyle.boxShadow,
                mainShadow: mainStyle.boxShadow,
                gap: mainRect.left - sidebarRect.right,
                outer: { left: sidebarRect.left, top: sidebarRect.top, right: innerWidth - mainRect.right, bottom: innerHeight - mainRect.bottom },
              };
            })()`);
            ctx.assert(Boolean(geometry), "Panel geometry was unavailable.");
            ctx.assert(geometry.sidebarRadius === geometry.mainRadius, "Sidebar and main corner radii differed.");
            ctx.assert(geometry.sidebarBackground === geometry.mainBackground, "Sidebar and main backgrounds differed.");
            ctx.assert(geometry.sidebarShadow === geometry.mainShadow, "Sidebar and main border/shadow weight differed.");
            ctx.assert(Math.abs(geometry.gap - 8) <= 1, `Panel gap was ${geometry.gap}px.`);
            ctx.assert(Object.values(geometry.outer).every((value) => Math.abs(value - 8) <= 1), `Outer gutters were ${JSON.stringify(geometry.outer)}.`);
          },
          screenshot: { name: "matching-contained-panels", requireText: [LOADING_TITLE, READING_TITLE] },
        });
      },
    },
    {
      name: "Main content clips as one panel",
      run: async (ctx) => {
        await ctx.prove("Header, tabs, conversation, composer, and tools stay inside the main panel", {
          voiceover: vo[4],
          action: async () => {
            await ctx.eval(`(() => {
              const button = document.querySelector('button[aria-label="Extensions"]');
              if (!button) throw new Error("Extensions tool button missing");
              button.click();
              return true;
            })()`);
            await ctx.waitFor("document.querySelector('button[aria-label=\"Extensions\"]')?.getAttribute('aria-pressed') === 'true'", {
              label: "extensions inspector to open inside main panel",
            });
            await ctx.waitFor(`(() => {
              const panel = document.querySelector('[data-session-main-panel="true"]');
              if (!panel || !panel.innerText.includes("Manage MCP apps and OpenCode plugins")) return false;
              return [panel, ...panel.querySelectorAll('*')].every((element) =>
                element.getAnimations().every((animation) => animation.playState !== "running")
              );
            })()`, { timeoutMs: 30_000, label: "extensions inspector animation and content to settle" });
          },
          assert: async () => {
            const containment = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-session-main-panel="true"]');
              const header = panel?.querySelector('header');
              const tabs = panel?.querySelector('[data-session-tab-id]')?.parentElement;
              const surface = panel?.querySelector('.bg-dls-surface');
              const tools = panel?.querySelector('aside');
              const composer = panel?.querySelector('[contenteditable="true"]')?.closest('form') ?? panel?.querySelector('[contenteditable="true"]')?.parentElement;
              if (!panel || !header || !tabs || !surface || !tools || !composer) return null;
              const bounds = panel.getBoundingClientRect();
              const inside = (element) => {
                const rect = element.getBoundingClientRect();
                return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
              };
              return {
                overflow: getComputedStyle(panel).overflow,
                header: inside(header), tabs: inside(tabs), surface: inside(surface), composer: inside(composer), tools: inside(tools),
              };
            })()`);
            ctx.assert(Boolean(containment), "Main panel descendants were not measurable.");
            ctx.assert(containment.overflow === "hidden", "Main panel did not clip its contents.");
            ctx.assert(containment.header && containment.tabs && containment.surface && containment.composer && containment.tools, `A main surface escaped the panel: ${JSON.stringify(containment)}.`);
          },
          screenshot: { name: "coherent-main-workspace", requireText: [READING_TITLE] },
        });
      },
    },
    {
      name: "Readable at minimum width",
      run: async (ctx) => {
        await ctx.prove("Session states remain readable at the narrowest sidebar width", {
          voiceover: vo[5],
          action: async () => {
            await ctx.eval(`(() => {
              const button = document.querySelector('button[aria-label="Extensions"][aria-pressed="true"]');
              button?.click();
              return true;
            })()`);
            await ctx.waitFor("document.querySelector('button[aria-label=\"Extensions\"]')?.getAttribute('aria-pressed') === 'false'", {
              label: "extensions inspector to close before narrow resize",
            });
            await resizeSidebar(ctx, 220);
            await ctx.control("session.open", { sessionId: loadingSessionId });
            await ctx.control("composer.set_text", { text: `Wait for 6 seconds, then reply with exactly ${COMPLETION_TEXT}.` });
            await ctx.control("composer.send");
            await ctx.control("session.open", { sessionId: readingSessionId });
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionLoading === "true"`,
              { timeoutMs: 30_000, label: "background loading state" },
            );
          },
          assert: async () => {
            const loadingLayout = await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))});
              const title = row?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              const spinner = row?.querySelector('.animate-spin')?.parentElement;
              const timestamp = row?.lastElementChild;
              if (!row || !title || !spinner || !timestamp) return null;
              const rowRect = row.getBoundingClientRect();
              const titleRect = title.getBoundingClientRect();
              const spinnerRect = spinner.getBoundingClientRect();
              return {
                width: document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width,
                titleBeforeSpinner: titleRect.right <= spinnerRect.left,
                spinnerInside: spinnerRect.right <= rowRect.right,
                timestampHidden: getComputedStyle(timestamp).display === "none",
                selected: document.querySelector(${JSON.stringify(rowSelector(readingSessionId))})?.dataset.sessionSelected,
              };
            })()`);
            ctx.assert(Boolean(loadingLayout), "Narrow loading row was not measurable.");
            ctx.assert(Math.abs(loadingLayout.width - 220) <= 1, `Sidebar width was ${loadingLayout.width}px.`);
            ctx.assert(loadingLayout.titleBeforeSpinner && loadingLayout.spinnerInside, "Loading indicator overlapped or overflowed.");
            ctx.assert(loadingLayout.timestampHidden, "Timestamp competed with the title at minimum width.");
            ctx.assert(loadingLayout.selected === "true", "Selected state was lost.");
            await ctx.waitFor(
              `(() => {
                const row = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))});
                return row?.dataset.sessionLoading === "false" && row?.dataset.sessionUnread === "true";
              })()`,
              { timeoutMs: 90_000, label: "background session to become unread" },
            );
          },
          screenshot: { name: "minimum-width-session-states", requireText: [LOADING_TITLE, READING_TITLE] },
        });
      },
    },
    {
      name: "Sidebar hides with synchronized motion",
      run: async (ctx) => {
        await ctx.prove("The sidebar leaves cleanly while the rounded main panel expands", {
          voiceover: vo[6],
          action: async () => {
            const before = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const inset = document.querySelector('[data-session-main-panel="true"]');
              const title = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              return { panelWidth: panel?.getBoundingClientRect().width, insetWidth: inset?.getBoundingClientRect().width, titleWidth: title?.getBoundingClientRect().width };
            })()`);
            expandedInsetWidth = before.insetWidth;
            await ctx.eval(`window.__sidebarProofBeforeHide = ${JSON.stringify(before)}`);
            await clickVisibleSidebarTrigger(ctx);
            await waitForSidebarState(ctx, "collapsed");
            await ctx.waitFor("document.querySelector('[data-slot=\"sidebar-gap\"]')?.getBoundingClientRect().width === 0", { label: "sidebar gap to close" });
          },
          assert: async () => {
            const hidden = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const gap = document.querySelector('[data-slot="sidebar-gap"]');
              const inset = document.querySelector('[data-session-main-panel="true"]');
              const title = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              if (!panel || !gap || !inset || !title) return null;
              const panelStyle = getComputedStyle(panel);
              const gapStyle = getComputedStyle(gap);
              return {
                panelWidth: panel.getBoundingClientRect().width, panelRight: panel.getBoundingClientRect().right,
                gapWidth: gap.getBoundingClientRect().width, insetWidth: inset.getBoundingClientRect().width,
                titleWidth: title.getBoundingClientRect().width, mainLeft: inset.getBoundingClientRect().left,
                mainRight: innerWidth - inset.getBoundingClientRect().right,
                panelDuration: panelStyle.transitionDuration, gapDuration: gapStyle.transitionDuration,
                panelEasing: panelStyle.transitionTimingFunction, gapEasing: gapStyle.transitionTimingFunction,
                before: window.__sidebarProofBeforeHide,
              };
            })()`);
            ctx.assert(Boolean(hidden), "Collapsed shell was not measurable.");
            ctx.assert(Math.abs(hidden.panelWidth - hidden.before.panelWidth) <= 1 && Math.abs(hidden.titleWidth - hidden.before.titleWidth) <= 1, "Sidebar squeezed while hiding.");
            ctx.assert(hidden.panelRight <= 1 && hidden.gapWidth === 0, "Sidebar left a visible or reserved gap.");
            ctx.assert(hidden.insetWidth > expandedInsetWidth, "Main panel did not expand.");
            ctx.assert(Math.abs(hidden.mainLeft - 8) <= 1 && Math.abs(hidden.mainRight - 8) <= 1, "Expanded main panel lost its outer gutters.");
            ctx.assert(hidden.panelDuration === hidden.gapDuration && hidden.panelEasing === hidden.gapEasing, "Panel and gap motion differed.");
          },
          screenshot: { name: "rounded-main-panel-expanded", requireText: [READING_TITLE] },
        });
      },
    },
    {
      name: "Reopen restores context",
      run: async (ctx) => {
        await ctx.prove("Reopening restores sidebar state, scroll, selection, and preferred width", {
          voiceover: vo[7],
          action: async () => {
            await ctx.eval(`document.querySelector('[data-sidebar-collapsed-affordance="true"]')?.click()`);
            await waitForSidebarState(ctx, "expanded");
            await waitForExpandedSidebarLayout(ctx);
            preservedState = await ctx.eval(`(() => {
              const content = document.querySelector('[data-slot="sidebar-content"]');
              if (!content) throw new Error("Sidebar content missing");
              content.scrollTop = Math.max(0, content.scrollHeight - content.clientHeight - 80);
              return {
                scrollTop: content.scrollTop,
                width: document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width,
                selectedId: document.querySelector('[data-session-selected="true"]')?.dataset.sessionId ?? null,
                openGroups: document.querySelectorAll('[data-slot="sidebar-content"] [data-open]').length,
              };
            })()`);
            await clickVisibleSidebarTrigger(ctx);
            await waitForSidebarState(ctx, "collapsed");
            await ctx.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }))`);
            await waitForSidebarState(ctx, "expanded");
            await waitForExpandedSidebarLayout(ctx);
          },
          assert: async () => {
            const restored = await ctx.eval(`(() => ({
              scrollTop: document.querySelector('[data-slot="sidebar-content"]')?.scrollTop ?? null,
              width: document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width,
              selectedId: document.querySelector('[data-session-selected="true"]')?.dataset.sessionId ?? null,
              openGroups: document.querySelectorAll('[data-slot="sidebar-content"] [data-open]').length,
            }))()`);
            ctx.assert(Math.abs(restored.scrollTop - preservedState.scrollTop) <= 1, "Sidebar scroll position changed.");
            ctx.assert(Math.abs(restored.width - preservedState.width) <= 1, "Sidebar preferred width changed.");
            ctx.assert(restored.selectedId === preservedState.selectedId, "Selected session changed.");
            ctx.assert(restored.openGroups === preservedState.openGroups, "Expanded group state changed.");
          },
          screenshot: { name: "reopened-context-preserved", requireText: ["Add workspace"] },
        });
      },
    },
    {
      name: "Reduced motion preserves context",
      run: async (ctx) => {
        await ctx.prove("Reduced motion performs the same transition instantly", {
          voiceover: vo[8],
          action: async () => {
            await ctx.client.send("Emulation.setEmulatedMedia", {
              media: "screen",
              features: [{ name: "prefers-reduced-motion", value: "reduce" }],
            });
            await ctx.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches", { label: "reduced motion preference" });
            await ctx.control("session.open", { sessionId: loadingSessionId });
            await clickVisibleSidebarTrigger(ctx);
            await waitForSidebarState(ctx, "collapsed");
            await ctx.eval(`document.querySelector('[data-sidebar-collapsed-affordance="true"]')?.click()`);
            await waitForSidebarState(ctx, "expanded");
            await waitForExpandedSidebarLayout(ctx);
          },
          assert: async () => {
            const motion = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const gap = document.querySelector('[data-slot="sidebar-gap"]');
              const affordance = document.querySelector('[data-sidebar-collapsed-affordance="true"]');
              return {
                panel: panel ? getComputedStyle(panel).transitionProperty : null,
                gap: gap ? getComputedStyle(gap).transitionProperty : null,
                affordance: affordance ? getComputedStyle(affordance).transitionProperty : null,
                selected: document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionSelected,
              };
            })()`);
            ctx.assert(motion.panel === "none" && motion.gap === "none" && motion.affordance === "none", `Reduced motion transitions were ${JSON.stringify(motion)}.`);
            ctx.assert(motion.selected === "true", "Selected session was lost.");
          },
          screenshot: { name: "reduced-motion-context-restored", requireText: [LOADING_TITLE, COMPLETION_TEXT] },
        });
        await ctx.client.send("Emulation.setEmulatedMedia", { media: "", features: [] });
      },
    },
  ],
};
