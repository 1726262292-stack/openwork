import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/office-chat-attachments.md).
const FLOW_ID = "office-chat-attachments";
const DOCX_FILENAME = "QuarterlyBrief.docx";
const PPTX_FILENAME = "LaunchRoadmap.PPTX";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

async function forceEnglish(ctx) {
  const shouldReload = await ctx.eval(`(() => {
    const current = localStorage.getItem("openwork.language");
    localStorage.setItem("openwork.language", "en");
    return current !== "en" || document.documentElement.getAttribute("lang") !== "en";
  })()`);
  if (!shouldReload) return;
  await ctx.eval("location.reload()");
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after language reload",
  });
}

async function attachOfficeFiles(ctx) {
  return ctx.eval(
    `(() => {
      const input = document.querySelector('input[type="file"][multiple]');
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: "file input not found" };
      const transfer = new DataTransfer();
      transfer.items.add(new File([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x77, 0x6f, 0x72, 0x64]),
      ], ${JSON.stringify(DOCX_FILENAME)}, { type: ${JSON.stringify(DOCX_MIME)} }));
      transfer.items.add(new File([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x70, 0x70, 0x74, 0x78]),
      ], ${JSON.stringify(PPTX_FILENAME)}, { type: "application/octet-stream" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, files: Array.from(transfer.files).map((file) => file.name) };
    })()`,
  );
}

export default {
  id: FLOW_ID,
  title: "Session composer accepts Word and PowerPoint attachments",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DAYTONA_SANDBOX"],
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const state = await ctx.waitFor(
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
    return state === "blocked"
      ? "Profile is not onboarded (welcome/signin); Office attachment flow requires a workspace."
      : null;
  },
  steps: [
    {
      name: "Fresh task has a ready composer",
      run: async (ctx) => {
        await ctx.prove("A fresh task opens with the composer ready for attachments", {
          voiceover: vo[0],
          action: async () => {
            await forceEnglish(ctx);
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `(() => {
                const route = window.__openworkControl.snapshot().route || "";
                return /ses_[A-Za-z0-9]+/.test(route);
              })()`,
              { timeoutMs: 30_000, label: "active session route" },
            );
            await ctx.waitFor(`Boolean(document.querySelector('input[type="file"][multiple]'))`, {
              timeoutMs: 30_000,
              label: "composer file input",
            });
          },
          assert: async () => {
            await ctx.expectText("Run task");
            await ctx.expectNoText("has a format the model can't read");
          },
          screenshot: {
            name: "fresh-composer",
            requireText: ["Run task"],
            rejectText: ["has a format the model can't read"],
            hashIncludes: "/session/",
          },
        });
      },
    },
    {
      name: "DOCX and PPTX attach without rejection",
      run: async (ctx) => {
        await ctx.prove("DOCX and PPTX uploads render as accepted composer attachments", {
          voiceover: vo[1],
          action: async () => {
            const attached = await attachOfficeFiles(ctx);
            ctx.assert(attached?.ok, `Could not attach Office files: ${attached?.reason ?? "unknown"}`);
            await ctx.waitFor(
              `(() => {
                const text = document.body.innerText;
                return text.includes(${JSON.stringify(DOCX_FILENAME)}) && text.includes(${JSON.stringify(PPTX_FILENAME)});
              })()`,
              { timeoutMs: 30_000, label: "Office attachment chips" },
            );
          },
          assert: async () => {
            await ctx.expectText(DOCX_FILENAME);
            await ctx.expectText(PPTX_FILENAME);
            await ctx.expectNoText("has a format the model can't read");
            await ctx.expectNoText("files have formats the model can't read");
            await ctx.expectNoText("Convert to PDF");
          },
          screenshot: {
            name: "office-attachment-chips",
            requireText: [DOCX_FILENAME, PPTX_FILENAME, "File"],
            rejectText: ["has a format the model can't read", "files have formats the model can't read", "Convert to PDF"],
            hashIncludes: "/session/",
          },
        });
      },
    },
  ],
};
