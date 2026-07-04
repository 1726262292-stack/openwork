import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/artifact-text-preview.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("artifact-text-preview");

// Scopes the lookup to the artifact panel that shows meeting-notes.txt, so page-wide
// <pre> elements (e.g. chat code blocks) can never satisfy the assertions.
const PANEL_PRE = `(() => {
  const title = Array.from(document.querySelectorAll("h3"))
    .find((node) => (node.textContent || "").trim() === "meeting-notes.txt");
  const panel = title ? title.closest("div.shrink-0.border-b")?.parentElement : null;
  return panel ? panel.querySelector("pre") : null;
})()`;

export default {
  id: "artifact-text-preview",
  title: "Text file artifacts open in the side panel and can be edited and saved",
  spec: "evals/voiceovers/artifact-text-preview.md",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("OpenWork is ready on a session with the text-artifact seed action enabled", {
          voiceover: vo[0],
          action: async () => {
            await ctx.waitFor("Boolean(window.__openworkControl)", {
              timeoutMs: 60_000,
              label: "control API",
            });
            const hasSelectedSession = await ctx.eval(`window.__openworkControl.snapshot().route.includes("/session/")`);
            if (!hasSelectedSession) {
              // The app may have restored a route (e.g. settings) that does not
              // mount the session shell, where session.create_task is not
              // registered. Go home first, then wait for the action.
              await ctx.navigateHash("/");
              await ctx.waitFor(
                `window.__openworkControl.listActions().some((a) => a.id === "session.create_task" && !a.disabled)`,
                { timeoutMs: 45_000, label: "session.create_task action enabled" },
              );
              await ctx.control("session.create_task");
              await ctx.waitFor(
                `window.__openworkControl.snapshot().route.includes("/session/")`,
                { timeoutMs: 60_000, label: "session route after task creation" },
              );
            }
            // Mount the side panel (which registers the seed action) only if it
            // is not already open — clicking "Browser" toggles the panel.
            await ctx.eval(`(() => {
              const seedReady = window.__openworkControl.listActions()
                .some((a) => a.id === "eval.artifact_tabs.seed_text" && !a.disabled);
              if (seedReady) return "already-open";
              const button = Array.from(document.querySelectorAll("button"))
                .find((item) => item.getAttribute("aria-label") === "Browser" && !item.disabled);
              button?.click();
              return button ? "clicked" : "no-button";
            })()`);
            await ctx.waitFor(
              `window.__openworkControl.listActions().some((a) => a.id === "eval.artifact_tabs.seed_text" && !a.disabled)`,
              { timeoutMs: 30_000, label: "text artifact seed action enabled" },
            );
            // Restore a neutral panel: a previous run may have left the
            // meeting-notes artifact open; close it so this frame and the next
            // one witness visibly different states on every rerun.
            await ctx.eval(`(() => {
              const close = document.querySelector('button[aria-label="Close tab: meeting-notes.txt"]');
              close?.click();
              return Boolean(close);
            })()`);
            await ctx.waitFor(
              `!document.querySelector('button[aria-label="Select tab: meeting-notes.txt"]')`,
              { timeoutMs: 10_000, label: "meeting notes tab closed" },
            );
          },
          assert: async () => {
            const userAgent = await ctx.eval("navigator.userAgent");
            ctx.assert(userAgent.includes("Electron/"), `Expected Electron userAgent, got ${userAgent}`);
            const seedReady = await ctx.eval(
              `window.__openworkControl.listActions().some((a) => a.id === "eval.artifact_tabs.seed_text" && !a.disabled)`,
            );
            ctx.assert(seedReady, "Text artifact seed action was not enabled.");
          },
          screenshot: { name: "booted" },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("A saved plain-text file opens as a readable artifact tab with an Edit affordance", {
          voiceover: vo[1],
          action: async () => {
            const result = await ctx.control("eval.artifact_tabs.seed_text");
            ctx.assert(result?.ok === true, "Text seed control action did not report success.");
            await ctx.waitFor(
              `(() => {
                const tab = document.querySelector('button[aria-label="Select tab: meeting-notes.txt"]');
                if (!tab) return false;
                tab.click();
                const pre = ${PANEL_PRE};
                return Boolean(pre) && (pre.textContent || "").includes("Team sync");
              })()`,
              { timeoutMs: 30_000, label: "meeting notes tab selected with plain-text preview" },
            );
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const tab = document.querySelector('button[aria-label="Select tab: meeting-notes.txt"]');
              const pre = ${PANEL_PRE};
              const title = Array.from(document.querySelectorAll("h3"))
                .find((node) => (node.textContent || "").trim() === "meeting-notes.txt");
              const header = title ? title.closest("div.shrink-0.border-b") : null;
              const editButton = header
                ? Array.from(header.querySelectorAll("button"))
                  .find((button) => (button.textContent || "").trim() === "Edit")
                : null;
              return {
                hasTab: Boolean(tab),
                hasTitle: Boolean(title),
                hasBudget: Boolean(pre) && (pre.textContent || "").includes("Renewal budget: $12,00 per seat"),
                hasEdit: Boolean(editButton),
                previewText: pre ? pre.textContent || "" : "",
              };
            })()`);
            ctx.assert(result.hasTab, "meeting-notes.txt tab was not present.");
            ctx.assert(result.hasTitle, "Artifact header did not show meeting-notes.txt.");
            ctx.assert(result.hasBudget, `Plain-text preview did not show the renewal budget line: ${result.previewText}`);
            ctx.assert(result.hasEdit, "Artifact header did not expose an Edit button.");
          },
          screenshot: { name: "text-artifact-readable", requireText: ["Team sync", "Edit"] },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Edit mode shows a line-numbered text editor and accepts the budget correction", {
          voiceover: vo[2],
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const title = Array.from(document.querySelectorAll("h3"))
                .find((node) => (node.textContent || "").trim() === "meeting-notes.txt");
              const header = title ? title.closest("div.shrink-0.border-b") : null;
              const button = header
                ? Array.from(header.querySelectorAll("button"))
                  .find((item) => (item.textContent || "").trim() === "Edit" && !item.disabled)
                : null;
              if (!button) return "no-edit-button";
              button.click();
              return "clicked";
            })()`);
            ctx.assert(clicked === "clicked", `Could not click Edit: ${clicked}`);
            await ctx.waitFor(
              `(() => {
                const content = document.querySelector(".cm-editor .cm-content");
                return Boolean(content) && (content.textContent || "").includes("Team sync");
              })()`,
              { timeoutMs: 30_000, label: "text CodeMirror editor mounted with content" },
            );
            const changed = await ctx.eval(`(() => {
              const view = window.__artifactEditorView;
              if (!view || !view.dispatch || !view.state?.doc) return { ok: false, reason: "no editor view" };
              const text = view.state.doc.toString();
              const from = text.indexOf("$12,00 ");
              if (from < 0) return { ok: false, reason: "budget typo not found", text };
              const to = from + "$12,00 ".length;
              view.dispatch({ changes: { from, to, insert: "$12,000 " } });
              view.focus();
              return { ok: true, text: view.state.doc.toString() };
            })()`);
            ctx.assert(changed.ok, changed.reason || "Could not update the CodeMirror document.");
            await ctx.waitFor(
              `(() => {
                const view = window.__artifactEditorView;
                return Boolean(view?.state?.doc?.toString().includes("$12,000 per seat"));
              })()`,
              { timeoutMs: 5_000, label: "corrected budget in editor document" },
            );
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const view = window.__artifactEditorView;
              const text = view?.state?.doc ? view.state.doc.toString() : "";
              const title = Array.from(document.querySelectorAll("h3"))
                .find((node) => (node.textContent || "").trim() === "meeting-notes.txt");
              const header = title ? title.closest("div.shrink-0.border-b") : null;
              const saveButton = header
                ? Array.from(header.querySelectorAll("button"))
                  .find((button) => (button.textContent || "").trim() === "Save")
                : null;
              return {
                hasEditor: Boolean(view),
                hasCorrection: text.includes("$12,000 per seat"),
                hasLineNumbers: Boolean(document.querySelector(".cm-lineNumbers")),
                saveEnabled: Boolean(saveButton && !saveButton.disabled),
                saveText: saveButton ? saveButton.textContent || "" : "",
              };
            })()`);
            ctx.assert(result.hasEditor, "CodeMirror editor view was not exposed.");
            ctx.assert(result.hasLineNumbers, "Text editor did not show the line-number gutter.");
            ctx.assert(result.hasCorrection, "Editor document did not contain the corrected budget.");
            ctx.assert(result.saveEnabled, `Save button was not enabled: ${result.saveText}`);
          },
          screenshot: { name: "text-editor-corrected", requireText: ["Team sync", "Save"] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Saving returns to preview mode and persists the corrected text on disk", {
          voiceover: vo[3],
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const title = Array.from(document.querySelectorAll("h3"))
                .find((node) => (node.textContent || "").trim() === "meeting-notes.txt");
              const header = title ? title.closest("div.shrink-0.border-b") : null;
              const button = header
                ? Array.from(header.querySelectorAll("button"))
                  .find((item) => (item.textContent || "").trim() === "Save")
                : null;
              if (!button) return "no-save-button";
              if (button.disabled) return "save-disabled";
              button.click();
              return "clicked";
            })()`);
            ctx.assert(clicked === "clicked", `Could not click Save: ${clicked}`);
            await ctx.waitFor(
              `(() => {
                const pre = ${PANEL_PRE};
                return Boolean(pre) && (pre.textContent || "").includes("$12,000 per seat");
              })()`,
              { timeoutMs: 30_000, label: "saved plain-text preview with corrected budget" },
            );
          },
          assert: async () => {
            const preview = await ctx.eval(`(() => {
              const pre = ${PANEL_PRE};
              return pre ? pre.textContent || "" : "";
            })()`);
            ctx.assert(preview.includes("$12,000 per seat"), `Preview did not show the corrected budget: ${preview}`);
            const result = await ctx.control("eval.artifact_tabs.read_text_file", { path: "artifacts/meeting-notes.txt" });
            ctx.assert(result?.ok === true, "Read-text witness action did not report success.");
            ctx.assert(
              typeof result.content === "string" && result.content.includes("$12,000 per seat (typo)"),
              "Workspace file did not persist the corrected budget line.",
            );
          },
          screenshot: { name: "text-save-persisted", requireText: ["12,000"] },
        });
      },
    },
  ],
};
