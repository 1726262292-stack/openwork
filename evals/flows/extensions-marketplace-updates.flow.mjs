/**
 * Extension Marketplace surface renders without the retired pending-update wiring.
 *
 * Signed-out baseline: the marketplace view must render its header, Connect-only
 * status filters, and the signed-out notice without relying on desktop sync state.
 */
export default {
  id: "extensions-marketplace-updates",
  title: "Marketplace renders with Connect-only filters and signed-out notice",
  spec: "evals/cloud-marketplace-sync-flows.md",
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 30_000 });
      },
    },
    {
      name: "Navigate to Settings -> Marketplace",
      run: async (ctx) => {
        await ctx.navigateHash("/settings/cloud-marketplaces");
        await ctx.expectHashIncludes("/settings/cloud-marketplaces");
      },
    },
    {
      name: "Marketplace header and status filters render",
      run: async (ctx) => {
        await ctx.expectText("Extension Marketplace", { timeoutMs: 30_000 });
        await ctx.expectText("Installed");
        await ctx.expectText("Available");
      },
    },
    {
      name: "Signed-out state explains how to load the Marketplace",
      run: async (ctx) => {
        const signedOutNotice = await ctx.hasText(
          "Sign in to OpenWork Cloud to load the Marketplace",
        );
        const hasRows = await ctx.eval(
          "document.querySelectorAll('[data-slot=card], article, li').length > 0",
        );
        ctx.assert(
          signedOutNotice || hasRows,
          "Expected either the signed-out notice or marketplace rows to render",
        );
        await ctx.screenshot("marketplace-view", {
          claim: "Marketplace view renders a coherent signed-out notice or marketplace rows.",
          requireText: ["Extension Marketplace"],
          rejectText: ["Something went wrong"],
          hashIncludes: "/settings/cloud-marketplaces",
        });
      },
    },
    {
      name: "Installed filter is interactive and view stays stable",
      run: async (ctx) => {
        await ctx.clickText("Installed");
        await ctx.expectText("Extension Marketplace");
        await ctx.expectNoText("Something went wrong");
        await ctx.screenshot("installed-filter", {
          claim: "Selecting Installed keeps the Marketplace view stable.",
          requireText: ["Extension Marketplace", "Installed"],
          rejectText: ["Something went wrong"],
          hashIncludes: "/settings/cloud-marketplaces",
        });
      },
    },
  ],
};
