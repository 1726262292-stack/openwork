import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("session-sidebar-states");
const LOADING_TITLE = "Follow up Blue Yonder";
const READING_TITLE = "Review Q3 forecast";
const COMPLETION_TEXT = "SIDEBAR STATE READY";

let loadingSessionId = null;
let readingSessionId = null;

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

export default {
  id: "session-sidebar-states",
  title: "Session sidebar keeps selected, loading, and unread states distinct",
  kind: "user-facing",
  steps: [
    {
      name: "Sidebar is a distinct panel",
      run: async (ctx) => {
        await ctx.prove("The sessions sidebar is visually separated from the workspace", {
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
            await ctx.control("session.open", { sessionId: loadingSessionId });
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionSelected === "true"`,
              { label: "loading proof session to become selected" },
            );
          },
          assert: async () => {
            const panel = await ctx.eval(`(() => {
              const inner = document.querySelector('[data-slot="sidebar-inner"]');
              const container = document.querySelector('[data-slot="sidebar-container"]');
              if (!inner || !container) return null;
              const innerStyle = getComputedStyle(inner);
              const containerStyle = getComputedStyle(container);
              return {
                radius: Number.parseFloat(innerStyle.borderRadius),
                shadow: innerStyle.boxShadow,
                padding: Number.parseFloat(containerStyle.paddingLeft),
              };
            })()`);
            ctx.assert(Boolean(panel), "Sidebar panel was not rendered.");
            ctx.assert(panel.radius >= 12, `Sidebar corner radius was ${panel.radius}px.`);
            ctx.assert(panel.padding >= 8, `Sidebar separation was ${panel.padding}px.`);
            ctx.assert(panel.shadow !== "none", "Sidebar panel had no visible border or shadow.");
          },
          screenshot: {
            name: "distinct-sidebar-panel",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Selected row remains aligned",
      run: async (ctx) => {
        await ctx.prove("The selected session has a stable title and timestamp layout", {
          voiceover: vo[1],
          action: async () => {
            await ctx.control("session.open", { sessionId: readingSessionId });
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(rowSelector(readingSessionId))})?.dataset.sessionSelected === "true"`,
              { label: "reading session to become selected" },
            );
          },
          assert: async () => {
            const selector = rowSelector(readingSessionId);
            const layout = await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(selector)});
              const title = row?.querySelector('[title=${JSON.stringify(READING_TITLE)}]');
              const timestamp = row?.lastElementChild;
              if (!row || !title || !timestamp) return null;
              const titleRect = title.getBoundingClientRect();
              const timestampRect = timestamp.getBoundingClientRect();
              return {
                selected: row.dataset.sessionSelected,
                timestamp: timestamp.textContent?.trim() || "",
                noOverlap: titleRect.right <= timestampRect.left,
                centerDelta: Math.abs(
                  (titleRect.top + titleRect.bottom) / 2 -
                  (timestampRect.top + timestampRect.bottom) / 2,
                ),
              };
            })()`);
            ctx.assert(Boolean(layout), "Selected session row was not measurable.");
            ctx.assert(layout.selected === "true", "Reading session was not selected.");
            ctx.assert(Boolean(layout.timestamp), "Selected session timestamp was empty.");
            ctx.assert(layout.noOverlap, "Selected session title overlapped its timestamp.");
            ctx.assert(layout.centerDelta <= 2, `Title and timestamp differed vertically by ${layout.centerDelta}px.`);
          },
          screenshot: {
            name: "selected-session-row",
            requireText: [READING_TITLE],
          },
        });
      },
    },
    {
      name: "Loading indicator uses reserved space",
      run: async (ctx) => {
        await ctx.prove("A background task spinner never overlaps its session title", {
          voiceover: vo[2],
          action: async () => {
            await ctx.control("session.open", { sessionId: loadingSessionId });
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionSelected === "true"`,
              { label: "loading proof session to open" },
            );
            await ctx.control("composer.set_text", {
              text: `Wait for 10 seconds, then reply with exactly ${COMPLETION_TEXT}.`,
            });
            await ctx.control("composer.send");
            await ctx.control("session.open", { sessionId: readingSessionId });
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))})?.dataset.sessionLoading === "true"`,
              { timeoutMs: 30_000, label: "background session loading indicator" },
            );
            await ctx.waitFor(
              `(() => {
                const loading = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))});
                const reading = document.querySelector(${JSON.stringify(rowSelector(readingSessionId))});
                if (!loading || !reading) return false;
                const loadingRect = loading.getBoundingClientRect();
                const readingRect = reading.getBoundingClientRect();
                return loadingRect.bottom <= readingRect.top || readingRect.bottom <= loadingRect.top;
              })()`,
              { label: "session reorder animation to settle" },
            );
          },
          assert: async () => {
            const selector = rowSelector(loadingSessionId);
            const layout = await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(selector)});
              const title = row?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              const spinner = row?.querySelector('.animate-spin')?.parentElement;
              if (!row || !title || !spinner) return null;
              const rowRect = row.getBoundingClientRect();
              const titleRect = title.getBoundingClientRect();
              const spinnerRect = spinner.getBoundingClientRect();
              return {
                loading: row.dataset.sessionLoading,
                selected: row.dataset.sessionSelected,
                titleBeforeSpinner: titleRect.right <= spinnerRect.left,
                spinnerInsideRow: spinnerRect.left >= rowRect.left && spinnerRect.right <= rowRect.right,
              };
            })()`);
            ctx.assert(Boolean(layout), "Loading session row was not measurable.");
            ctx.assert(layout.loading === "true", "Loading state was not exposed on the session row.");
            ctx.assert(layout.selected === "false", "The loading session was not running in the background.");
            ctx.assert(layout.titleBeforeSpinner, "Spinner overlapped the session title.");
            ctx.assert(layout.spinnerInsideRow, "Spinner overflowed the session row.");
          },
          screenshot: {
            name: "non-overlapping-loading-state",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Completed background session becomes unread",
      run: async (ctx) => {
        await ctx.prove("A completed background session gains a clear unread state", {
          voiceover: vo[3],
          action: async () => {
            await ctx.waitFor(
              `(() => {
                const row = document.querySelector(${JSON.stringify(rowSelector(loadingSessionId))});
                return row?.dataset.sessionLoading === "false" && row?.dataset.sessionUnread === "true";
              })()`,
              { timeoutMs: 90_000, label: "completed session to become unread" },
            );
          },
          assert: async () => {
            const selector = rowSelector(loadingSessionId);
            const state = await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(selector)});
              const title = row?.querySelector('[title=${JSON.stringify(LOADING_TITLE)}]');
              if (!row || !title) return null;
              return {
                unread: row.dataset.sessionUnread,
                selected: row.dataset.sessionSelected,
                weight: Number.parseInt(getComputedStyle(title).fontWeight, 10),
              };
            })()`);
            ctx.assert(Boolean(state), "Unread session row was not rendered.");
            ctx.assert(state.unread === "true", "Completed background session was not marked unread.");
            ctx.assert(state.selected === "false", "Unread session incorrectly competed with selected state.");
            ctx.assert(state.weight >= 600, `Unread title font weight was ${state.weight}.`);
          },
          screenshot: {
            name: "unread-session-state",
            requireText: [LOADING_TITLE, READING_TITLE],
          },
        });
      },
    },
    {
      name: "Opening clears unread state",
      run: async (ctx) => {
        await ctx.prove("Opening the unread session marks it read and selects it", {
          voiceover: vo[4],
          action: async () => {
            const selector = rowSelector(loadingSessionId);
            await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(selector)});
              if (!row) throw new Error("Unread session row not found");
              row.click();
              return true;
            })()`);
            await ctx.waitFor(
              `(() => {
                const row = document.querySelector(${JSON.stringify(selector)});
                return row?.dataset.sessionSelected === "true" && row?.dataset.sessionUnread === "false";
              })()`,
              { label: "opened session to clear unread state" },
            );
          },
          assert: async () => {
            const selector = rowSelector(loadingSessionId);
            const state = await ctx.eval(`(() => {
              const row = document.querySelector(${JSON.stringify(selector)});
              return row ? {
                selected: row.dataset.sessionSelected,
                unread: row.dataset.sessionUnread,
              } : null;
            })()`);
            ctx.assert(Boolean(state), "Opened session row disappeared.");
            ctx.assert(state.selected === "true", "Opened session was not selected.");
            ctx.assert(state.unread === "false", "Opening the session did not clear unread state.");
          },
          screenshot: {
            name: "opened-session-clears-unread",
            requireText: [LOADING_TITLE, COMPLETION_TEXT],
          },
        });
      },
    },
  ],
};
