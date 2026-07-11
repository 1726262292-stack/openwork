import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/deterministic-org-installer.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("deterministic-org-installer");

export default {
  id: "deterministic-org-installer",
  title: "TODO: one-line claim — user can do X and sees Y",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 1", {
          voiceover: vo[0],
          // "From my organization’s download page, I choose my platform and receive one o"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 1 not implemented yet");
          },
          screenshot: { name: "frame-1", requireText: [] },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 2", {
          voiceover: vo[1],
          // "After extracting it, I see the generic signed OpenWork Installer, the standa"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 2 not implemented yet");
          },
          screenshot: { name: "frame-2", requireText: [] },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 3", {
          voiceover: vo[2],
          // "I launch this specific installer and it shows the organization name and exac"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 3 not implemented yet");
          },
          screenshot: { name: "frame-3", requireText: [] },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 4", {
          voiceover: vo[3],
          // "With public internet access disabled, the installer uses the standard applic"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 4 not implemented yet");
          },
          screenshot: { name: "frame-4", requireText: [] },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 5", {
          voiceover: vo[4],
          // "On the first macOS launch from Applications, OpenWork immediately targets th"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 5 not implemented yet");
          },
          screenshot: { name: "frame-5", requireText: [] },
        });
      },
    },
    {
      name: "Frame 6",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 6", {
          voiceover: vo[5],
          // "On Windows, the first launch and installed shortcut use the organization nam"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 6 not implemented yet");
          },
          screenshot: { name: "frame-6", requireText: [] },
        });
      },
    },
    {
      name: "Frame 7",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 7", {
          voiceover: vo[6],
          // "I leave a second testing bundle in Downloads and restart OpenWork. Nothing c"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 7 not implemented yet");
          },
          screenshot: { name: "frame-7", requireText: [] },
        });
      },
    },
    {
      name: "Frame 8",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 8", {
          voiceover: vo[7],
          // "After upgrading the standard OpenWork application, the same server configura"
          action: async () => {
            // TODO: drive the app as the end user (ctx.clickText, ctx.fill, ...)
          },
          assert: async () => {
            // TODO: witness the side effect (ctx.expectText, ctx.eval, ...)
            ctx.assert(false, "frame 8 not implemented yet");
          },
          screenshot: { name: "frame-8", requireText: [] },
        });
      },
    },
  ],
};
