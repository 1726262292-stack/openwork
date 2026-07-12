import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("session-sidebar-states");
const LOADING_TITLE = "Follow up Blue Yonder";
const READING_TITLE = "Review Q3 forecast";
const COMPLETION_TEXT = "SIDEBAR STATE READY";

let loadingSessionId = null;
let readingSessionId = null;
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
      bubbles: true,
      button: 0,
      clientX: startX,
      pointerId: 1,
      pointerType: "mouse",
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      clientX: startX + delta,
      pointerId: 1,
      pointerType: "mouse",
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      clientX: startX + delta,
      pointerId: 1,
      pointerType: "mouse",
    }));
    return true;
  })()`);
  await ctx.waitFor(
    `Math.abs(document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width - ${targetWidth}) <= 1`,
    { label: `sidebar width to become ${targetWidth}px` },
  );
}

export default {
  id: "session-sidebar-states",
  title: "Contained session sidebar hides smoothly without losing context",
  kind: "user-facing",
  steps: [
    {
      name: "Opaque contained sidebar",
      run: async (ctx) => {
        await ctx.prove("The sidebar is an opaque contained panel on every platform", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 30_000,
              label: "OpenWork control API",
            });
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
            const panel = await ctx.eval(`(() => {
              const inner = document.querySelector('[data-slot="sidebar-inner"]');
              const container = document.querySelector('[data-slot="sidebar-container"]');
              const shell = document.querySelector('[data-slot="sidebar-wrapper"]');
              if (!inner || !container || !shell) return null;
              const innerStyle = getComputedStyle(inner);
              const shellStyle = getComputedStyle(shell);
              const alpha = (color) => {
                const match = color.match(/rgba?\\(([^)]+)\\)/);
                if (!match) return 1;
                const parts = match[1].split(",").map((part) => part.trim());
                return parts.length === 4 ? Number(parts[3]) : 1;
              };
              return {
                radius: Number.parseFloat(innerStyle.borderRadius),
                shadow: innerStyle.boxShadow,
                padding: Number.parseFloat(getComputedStyle(container).paddingLeft),
                innerAlpha: alpha(innerStyle.backgroundColor),
                shellAlpha: alpha(shellStyle.backgroundColor),
                backdrop: innerStyle.backdropFilter,
              };
            })()`);
            ctx.assert(Boolean(panel), "Sidebar panel was not rendered.");
            ctx.assert(panel.radius >= 12, `Sidebar corner radius was ${panel.radius}px.`);
            ctx.assert(panel.padding >= 8, `Sidebar separation was ${panel.padding}px.`);
            ctx.assert(panel.shadow !== "none", "Sidebar panel had no border or shadow.");
            ctx.assert(panel.innerAlpha === 1 && panel.shellAlpha === 1, "Sidebar shell was translucent.");
            ctx.assert(!panel.backdrop || panel.backdrop === "none", `Unexpected backdrop filter: ${panel.backdrop}`);
          },
          screenshot: {
            name: "opaque-contained-sidebar",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Readable at minimum width",
      run: async (ctx) => {
        await ctx.prove("Selected, loading, and unread rows remain readable at minimum width", {
          voiceover: vo[1],
          action: async () => {
            await resizeSidebar(ctx, 220);
            await ctx.control("session.open", { sessionId: loadingSessionId });
            await ctx.control("composer.set_text", {
              text: `Wait for 6 seconds, then reply with exactly ${COMPLETION_TEXT}.`,
            });
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
              };
            })()`);
            ctx.assert(Boolean(loadingLayout), "Narrow loading row was not measurable.");
            ctx.assert(Math.abs(loadingLayout.width - 220) <= 1, `Sidebar width was ${loadingLayout.width}px.`);
            ctx.assert(loadingLayout.titleBeforeSpinner && loadingLayout.spinnerInside, "Loading indicator overlapped or overflowed.");
            ctx.assert(loadingLayout.timestampHidden, "Timestamp still competed with the title at minimum width.");

            await ctx.waitFor(
              `(() => {
                const row = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))});
                return row?.dataset.sessionLoading === "false" && row?.dataset.sessionUnread === "true";
              })()`,
              { timeoutMs: 90_000, label: "background session to become unread" },
            );
            const unread = await ctx.eval(`document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionUnread`);
            ctx.assert(unread === "true", "Completed background session was not unread.");
          },
          screenshot: {
            name: "minimum-width-session-states",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Sidebar hides as one panel",
      run: async (ctx) => {
        await ctx.prove("The fixed-width panel glides away while the main surface expands in sync", {
          voiceover: vo[2],
          action: async () => {
            const before = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const inset = document.querySelector('[data-slot="sidebar-inset"]');
              const title = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})
                ?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              return {
                panelWidth: panel?.getBoundingClientRect().width ?? null,
                insetWidth: inset?.getBoundingClientRect().width ?? null,
                titleWidth: title?.getBoundingClientRect().width ?? null,
              };
            })()`);
            expandedInsetWidth = before.insetWidth;
            await ctx.eval(`window.__sidebarProofBeforeHide = ${JSON.stringify(before)}`);
            await clickVisibleSidebarTrigger(ctx);
            await waitForSidebarState(ctx, "collapsed");
            await ctx.waitFor(
              "document.querySelector('[data-slot=\"sidebar-gap\"]')?.getBoundingClientRect().width === 0",
              { label: "sidebar gap to close" },
            );
          },
          assert: async () => {
            const hidden = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const gap = document.querySelector('[data-slot="sidebar-gap"]');
              const inset = document.querySelector('[data-slot="sidebar-inset"]');
              const title = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})
                ?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              if (!panel || !gap || !inset || !title) return null;
              const panelStyle = getComputedStyle(panel);
              const gapStyle = getComputedStyle(gap);
              return {
                panelWidth: panel.getBoundingClientRect().width,
                panelRight: panel.getBoundingClientRect().right,
                gapWidth: gap.getBoundingClientRect().width,
                insetWidth: inset.getBoundingClientRect().width,
                titleWidth: title.getBoundingClientRect().width,
                panelDuration: panelStyle.transitionDuration,
                gapDuration: gapStyle.transitionDuration,
                panelEasing: panelStyle.transitionTimingFunction,
                gapEasing: gapStyle.transitionTimingFunction,
                before: window.__sidebarProofBeforeHide,
              };
            })()`);
            ctx.assert(Boolean(hidden), "Collapsed shell was not measurable.");
            ctx.assert(Math.abs(hidden.panelWidth - hidden.before.panelWidth) <= 1, "Panel width changed while hiding.");
            ctx.assert(Math.abs(hidden.titleWidth - hidden.before.titleWidth) <= 1, "Sidebar title rewrapped while hiding.");
            ctx.assert(hidden.panelRight <= 1 && hidden.gapWidth === 0, "Sidebar left a visible or reserved gap.");
            ctx.assert(hidden.insetWidth > expandedInsetWidth, "Main surface did not expand.");
            ctx.assert(hidden.panelDuration === hidden.gapDuration, "Panel and gap transition durations differed.");
            ctx.assert(hidden.panelEasing === hidden.gapEasing, "Panel and gap easing differed.");
          },
          screenshot: {
            name: "sidebar-hidden-main-expanded",
            requireText: ["Review Q3 forecast"],
          },
        });
      },
    },
    {
      name: "Main shell moves together",
      run: async (ctx) => {
        await ctx.prove("Header, tabs, and conversation remain one aligned surface", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`(() => {
              const affordance = document.querySelector('[data-sidebar-collapsed-affordance="true"]');
              if (!affordance) throw new Error("Collapsed edge affordance missing");
              affordance.click();
              return true;
            })()`);
            await waitForSidebarState(ctx, "expanded");
            await waitForExpandedSidebarLayout(ctx);
          },
          assert: async () => {
            const alignment = await ctx.eval(`(() => {
              const inset = document.querySelector('[data-slot="sidebar-inset"]');
              const header = inset?.querySelector('header');
              const tab = inset?.querySelector('[data-session-tab-id]')?.parentElement;
              const surface = inset?.querySelector('.bg-dls-surface');
              if (!inset || !header || !tab || !surface) return null;
              const headerStyle = getComputedStyle(header);
              return {
                insetLeft: inset.getBoundingClientRect().left,
                headerLeft: header.getBoundingClientRect().left,
                tabLeft: tab.getBoundingClientRect().left,
                surfaceLeft: surface.getBoundingClientRect().left,
                headerTransitionProperty: headerStyle.transitionProperty,
              };
            })()`);
            ctx.assert(Boolean(alignment), "Main shell surfaces were not measurable.");
            ctx.assert(Math.abs(alignment.headerLeft - alignment.insetLeft) <= 1, "Header drifted from the shell inset.");
            ctx.assert(Math.abs(alignment.tabLeft - alignment.insetLeft) <= 1, "Tabs drifted from the shell inset.");
            ctx.assert(Math.abs(alignment.surfaceLeft - alignment.insetLeft) <= 1, "Conversation drifted from the shell inset.");
            ctx.assert(!alignment.headerTransitionProperty.includes("padding"), "Header still had an independent padding transition.");
          },
          screenshot: {
            name: "aligned-expanded-shell",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Reopen preserves context",
      run: async (ctx) => {
        await ctx.prove("Reopening restores sidebar selection, scroll, groups, and width", {
          voiceover: vo[4],
          action: async () => {
            preservedState = await ctx.eval(`(() => {
              const content = document.querySelector('[data-slot="sidebar-content"]');
              if (!content) throw new Error("Sidebar content missing");
              content.scrollTop = Math.max(0, content.scrollHeight - content.clientHeight - 80);
              const selected = document.querySelector('[data-session-selected="true"]');
              return {
                scrollTop: content.scrollTop,
                width: document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width,
                selectedId: selected?.dataset.sessionId ?? null,
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
            const restored = await ctx.eval(`(() => {
              const content = document.querySelector('[data-slot="sidebar-content"]');
              const selected = document.querySelector('[data-session-selected="true"]');
              return {
                scrollTop: content?.scrollTop ?? null,
                width: document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width,
                selectedId: selected?.dataset.sessionId ?? null,
                openGroups: document.querySelectorAll('[data-slot="sidebar-content"] [data-open]').length,
              };
            })()`);
            ctx.assert(Math.abs(restored.scrollTop - preservedState.scrollTop) <= 1, "Sidebar scroll position changed.");
            ctx.assert(Math.abs(restored.width - preservedState.width) <= 1, "Sidebar preferred width changed.");
            ctx.assert(restored.selectedId === preservedState.selectedId, "Selected session changed.");
            ctx.assert(restored.openGroups === preservedState.openGroups, "Expanded group state changed.");
          },
          screenshot: {
            name: "reopened-context-preserved",
            requireText: ["Add workspace"],
          },
        });
      },
    },
    {
      name: "Resize remains immediate",
      run: async (ctx) => {
        await ctx.prove("Resizing is immediate and collapse leaves no stale gap", {
          voiceover: vo[5],
          action: async () => {
            await ctx.eval(`(() => {
              const rail = document.querySelector('[data-sidebar-resize-rail="true"]');
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              if (!rail || !panel) throw new Error("Sidebar resize controls unavailable");
              const railRect = rail.getBoundingClientRect();
              const startX = railRect.left + railRect.width / 2;
              const delta = 300 - panel.getBoundingClientRect().width;
              window.__sidebarResizePointer = { startX, endX: startX + delta };
              rail.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                button: 0,
                clientX: startX,
                pointerId: 1,
                pointerType: "mouse",
              }));
              window.dispatchEvent(new PointerEvent("pointermove", {
                bubbles: true,
                buttons: 1,
                clientX: startX + delta,
                pointerId: 1,
                pointerType: "mouse",
              }));
              return true;
            })()`);
            await ctx.waitFor(
              `document.body.style.userSelect === "none" && Math.abs(document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect().width - 300) <= 1`,
              { label: "active immediate sidebar resize" },
            );
            const activeResize = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const gap = document.querySelector('[data-slot="sidebar-gap"]');
              return {
                panelTransition: panel ? getComputedStyle(panel).transitionProperty : null,
                gapTransition: gap ? getComputedStyle(gap).transitionProperty : null,
              };
            })()`);
            ctx.assert(activeResize.panelTransition === "none" && activeResize.gapTransition === "none", `Resize transitions were ${JSON.stringify(activeResize)}.`);
            await ctx.eval(`(() => {
              const pointer = window.__sidebarResizePointer;
              window.dispatchEvent(new PointerEvent("pointerup", {
                bubbles: true,
                button: 0,
                clientX: pointer.endX,
                pointerId: 1,
                pointerType: "mouse",
              }));
              delete window.__sidebarResizePointer;
              return true;
            })()`);
            await clickVisibleSidebarTrigger(ctx);
            await waitForSidebarState(ctx, "collapsed");
            await ctx.waitFor(
              "document.querySelector('[data-slot=\"sidebar-gap\"]')?.getBoundingClientRect().width === 0",
              { label: "resized sidebar gap to close" },
            );
            await ctx.eval(`document.querySelector('[data-sidebar-collapsed-affordance="true"]')?.click()`);
            await waitForSidebarState(ctx, "expanded");
            await waitForExpandedSidebarLayout(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const panel = document.querySelector('[data-slot="sidebar-container"]');
              const gap = document.querySelector('[data-slot="sidebar-gap"]');
              return {
                panelWidth: panel?.getBoundingClientRect().width,
                gapWidth: gap?.getBoundingClientRect().width,
                bodyUserSelect: document.body.style.userSelect,
              };
            })()`);
            ctx.assert(Math.abs(state.panelWidth - 300) <= 1, `Restored panel width was ${state.panelWidth}px.`);
            ctx.assert(Math.abs(state.gapWidth - 300) <= 1, `Restored gap width was ${state.gapWidth}px.`);
            ctx.assert(!state.bodyUserSelect, "Resize left the document in a dragging state.");
          },
          screenshot: {
            name: "resized-sidebar-restored",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Reduced motion snaps cleanly",
      run: async (ctx) => {
        await ctx.prove("Reduced motion hides and restores the sidebar instantly", {
          voiceover: vo[6],
          action: async () => {
            await ctx.client.send("Emulation.setEmulatedMedia", {
              media: "screen",
              features: [{ name: "prefers-reduced-motion", value: "reduce" }],
            });
            await ctx.waitFor("matchMedia('(prefers-reduced-motion: reduce)').matches", {
              label: "reduced motion media preference",
            });
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
            ctx.assert(motion.selected === "true", "Selected session was lost during reduced-motion toggles.");
          },
          screenshot: {
            name: "reduced-motion-context-restored",
            requireText: [LOADING_TITLE, COMPLETION_TEXT],
          },
        });
        await ctx.client.send("Emulation.setEmulatedMedia", { media: "", features: [] });
      },
    },
  ],
};
