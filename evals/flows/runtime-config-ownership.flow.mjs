import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Narration is loaded from the approved script (evals/voiceovers/runtime-config-ownership.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs("runtime-config-ownership");

export default {
  id: "runtime-config-ownership",
  title: "TODO: one-line claim — user can do X and sees Y",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("TODO: claim for frame 1", {
          voiceover: vo[0],
          // "I open the OpenCode config in my home folder and find leftovers an old versi"
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
          // "I update OpenWork and launch it once: it backs up the file, sweeps out the O"
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
          // "When I change a setting now — like disabling a provider — my personal config"
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
          // "My agent keeps working exactly as before: everything OpenWork manages lives "
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
  ],
};
