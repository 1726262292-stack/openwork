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
          // "When something looks wrong with my agent's config today, I have to guess — c"
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
          // "After the update, managed state flows one way only: OpenWork writes a single"
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
          // "I flip a provider off, restart the app, and check again: my personal config "
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
          // "Debug settings now shows the whole story on one card: the managed file's exa"
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
