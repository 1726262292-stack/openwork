import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "desktop-policy-starter-provider-gate";
const STARTER_CARD = "Connect a model provider";
const PROVIDER_DIALOG = "Connect providers";
const RESTRICTION_TITLE = "Adding custom providers is disabled";
const POLICY_ACTIVE = "Organization policies active";
const CLOSE_LABEL = "Close";

// Narration is loaded from the approved script (evals/voiceovers/desktop-policy-starter-provider-gate.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs(FLOW_ID);

async function applyDesktopConfig(ctx, config) {
  await ctx.eval(`(() => {
    const bridge = window.__openworkApplyDesktopConfig;
    if (typeof bridge !== 'function') throw new Error('Desktop config bridge not available');
    bridge(${JSON.stringify(config)});
    return true;
  })()`);
}

async function closeProviderDialog(ctx) {
  const isOpen = await ctx.hasText(PROVIDER_DIALOG);
  if (!isOpen) return;
  await ctx.eval(`(() => {
    const target = document.querySelector('[role="dialog"]') ?? document;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await ctx.waitFor(
    `!document.body.innerText.includes(${JSON.stringify(PROVIDER_DIALOG)})`,
    { timeoutMs: 5_000, label: "provider dialog closed" },
  );
}

async function closeRestrictionNotice(ctx) {
  const isOpen = await ctx.hasText(RESTRICTION_TITLE);
  if (!isOpen) return;
  await ctx.clickText(CLOSE_LABEL, { timeoutMs: 5_000 });
  await ctx.waitFor(
    `!document.body.innerText.includes(${JSON.stringify(RESTRICTION_TITLE)})`,
    { timeoutMs: 5_000, label: "restriction notice closed" },
  );
}

async function closeStaleDialogs(ctx) {
  await closeRestrictionNotice(ctx);
  await closeProviderDialog(ctx);
}

async function closeNotificationCenter(ctx) {
  await ctx.eval("document.body.click()");
  await ctx.waitFor(
    `!document.body.innerText.includes(${JSON.stringify(POLICY_ACTIVE)})`,
    { timeoutMs: 5_000, label: "notification center closed" },
  );
}

export default {
  id: FLOW_ID,
  title: "Starter card honors the org provider policy",
  kind: "user-facing",
  steps: [
    {
      name: "Setup",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "window.__openworkControl",
        });
        await ctx.eval(`(() => {
          localStorage.setItem('openwork.react.settings.theme-mode', 'light');
          const bridge = window.__openworkApplyDesktopConfig;
          if (typeof bridge === 'function') bridge({});
          return true;
        })()`);
        await ctx.eval("location.reload()");
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "control API after reload",
        });
        await ctx.navigateHash("/session");
        await ctx.waitFor("document.body.innerText.trim().length > 40", {
          label: "rendered body text",
        });
      },
    },
    {
      name: "Starter card is visible before providers are connected",
      run: async (ctx) => {
        await ctx.prove("Fresh empty session shows the provider starter card", {
          claim: "With no connected providers and no active policy, the empty session screen offers a Connect a model provider card.",
          voiceover: vo[0],
          assert: async () => {
            await ctx.expectText(STARTER_CARD);
          },
          screenshot: {
            name: "starter-card-visible",
            requireText: [STARTER_CARD],
          },
        });
      },
    },
    {
      name: "Provider dialog opens when no policy is active",
      run: async (ctx) => {
        await ctx.prove("Starter card opens the provider dialog when allowed", {
          claim: "Clicking the starter card opens the provider connection dialog while custom providers are allowed.",
          voiceover: vo[1],
          action: async () => {
            await closeStaleDialogs(ctx);
            await ctx.clickText(STARTER_CARD);
          },
          assert: async () => {
            await ctx.expectText(PROVIDER_DIALOG);
          },
          screenshot: {
            name: "provider-dialog-allowed",
            requireText: [PROVIDER_DIALOG],
          },
        });
        await closeProviderDialog(ctx);
      },
    },
    {
      name: "Policy injection is visible in the notification center",
      run: async (ctx) => {
        await ctx.prove("Organization policy activation is surfaced to the user", {
          claim: "When custom providers are disabled by policy, the notification center tells the user organization policies are active.",
          voiceover: vo[2],
          action: async () => {
            await closeStaleDialogs(ctx);
            await applyDesktopConfig(ctx, { allowCustomProviders: false });
            await ctx.waitFor(`(() => {
              const bell = document.querySelector('[title="Notifications"]');
              if (!bell) return false;
              bell.click();
              return true;
            })()`, { timeoutMs: 5_000, label: "notification button" });
          },
          assert: async () => {
            await ctx.expectText(POLICY_ACTIVE);
          },
          screenshot: {
            name: "policy-active-notification",
            requireText: [POLICY_ACTIVE],
          },
        });
        await closeNotificationCenter(ctx);
      },
    },
    {
      name: "Restricted policy blocks the starter-card provider dialog",
      run: async (ctx) => {
        await ctx.prove("Starter card shows the restriction notice instead of the provider dialog", {
          claim: "With custom providers disabled, clicking the starter card shows the same restriction notice as Settings and does not open the provider dialog.",
          voiceover: vo[3],
          action: async () => {
            await closeStaleDialogs(ctx);
            await ctx.clickText(STARTER_CARD);
          },
          assert: async () => {
            await ctx.expectText(RESTRICTION_TITLE);
            await ctx.expectNoText(PROVIDER_DIALOG);
          },
          screenshot: {
            name: "starter-card-restricted",
            requireText: [RESTRICTION_TITLE],
            rejectText: [PROVIDER_DIALOG],
          },
        });
        await closeRestrictionNotice(ctx);
      },
    },
    {
      name: "Clearing the policy restores the provider dialog",
      run: async (ctx) => {
        await ctx.prove("Starter card opens the provider dialog again after the policy is lifted", {
          claim: "After the organization policy is cleared, the same starter card opens the provider connection dialog again.",
          voiceover: vo[4],
          action: async () => {
            await closeStaleDialogs(ctx);
            await applyDesktopConfig(ctx, {});
            await ctx.clickText(STARTER_CARD);
          },
          assert: async () => {
            await ctx.expectText(PROVIDER_DIALOG);
          },
          screenshot: {
            name: "provider-dialog-restored",
            requireText: [PROVIDER_DIALOG],
          },
        });
        await closeProviderDialog(ctx);
      },
    },
  ],
};
