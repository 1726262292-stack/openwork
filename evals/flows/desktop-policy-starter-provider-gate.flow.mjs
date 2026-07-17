import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "desktop-policy-starter-provider-gate";
const STARTER_CARD = "Connect a model provider";
const STARTER_CARD_DESCRIPTION = "Add an API key for Anthropic, OpenAI, Google, or other providers";
const PROVIDER_DIALOG = "Connect providers";
const RESTRICTION_TITLE = "Adding custom providers is disabled";
const POLICY_ACTIVE = "Organization policies active";
const SETTINGS_POLICY_COPY = "managed by your organization";
const SETTINGS_POLICY_BANNER = '[data-testid="desktop-policy-banner"]';
const NEW_SESSION_TITLE = "New session";
const DELETE_SESSION_LABEL = "Delete session";
const DELETE_SESSION_DIALOG = "Delete session?";
const DELETE_LABEL = "Delete";

// Narration is loaded from the approved script (evals/voiceovers/desktop-policy-starter-provider-gate.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyDesktopConfig(ctx, config) {
  await ctx.eval(`(() => {
    const bridge = window.__openworkApplyDesktopConfig;
    if (typeof bridge !== 'function') throw new Error('Desktop config bridge not available');
    bridge(${JSON.stringify(config)});
    return true;
  })()`);
}

async function closeStaleDialogs(ctx) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await ctx.eval(`(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      return {
        count: dialogs.length,
        restrictionOpen: dialogs.some((dialog) => dialog.innerText.includes(${JSON.stringify(RESTRICTION_TITLE)})),
        providerOpen: dialogs.some((dialog) => dialog.innerText.includes(${JSON.stringify(PROVIDER_DIALOG)})),
        modelUnavailableOpen: dialogs.some((dialog) => dialog.innerText.includes('no longer available')),
      };
    })()`);
    if (state.count === 0) return;

    if (state.restrictionOpen) {
      await ctx.eval(`(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        const dialog = dialogs.find((entry) => entry.innerText.includes(${JSON.stringify(RESTRICTION_TITLE)}));
        if (!dialog) return false;
        const buttons = [...dialog.querySelectorAll('button')];
        const closeButton = buttons.find((button) => button.textContent.trim() === 'Close');
        if (!closeButton) return false;
        closeButton.click();
        return true;
      })()`);
    } else {
      await ctx.eval(`(() => {
        const eventInit = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
        document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        for (const dialog of dialogs) {
          dialog.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        }
        return true;
      })()`);
    }

    await settle(200);
  }

  const remaining = await ctx.eval("document.querySelectorAll('[role=\"dialog\"], [role=\"alertdialog\"]').length");
  ctx.assert(remaining === 0, `Expected stale dialogs to close; ${remaining} dialog(s) remain.`);
}

async function openNotificationCenter(ctx) {
  await ctx.waitFor(`(() => {
    const bell = document.querySelector('[title="Notifications"]');
    if (!bell) return false;
    bell.click();
    return true;
  })()`, { timeoutMs: 5_000, label: "notification button" });
}

async function closeNotificationCenter(ctx) {
  await ctx.eval("document.body.click()");
  await ctx.waitFor(
    `!document.body.innerText.includes(${JSON.stringify(POLICY_ACTIVE)})`,
    { timeoutMs: 5_000, label: "notification center closed" },
  );
}

async function reachEmptyStateStarterCard(ctx) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ctx.navigateHash("/session");
    await ctx.waitFor("document.body.innerText.trim().length > 40", {
      label: "session page rendered",
    });
    await closeStaleDialogs(ctx);

    const sessionSelected = await ctx.eval("location.hash.includes('/session/ses_')");
    if (!sessionSelected) break;

    const foundSidebarRow = await ctx.eval(`(() => {
      const link = [...document.querySelectorAll('a')]
        .find((entry) => entry.textContent.trim() === ${JSON.stringify(NEW_SESSION_TITLE)});
      if (!link) return false;
      link.scrollIntoView({ block: 'center' });
      const rect = link.getBoundingClientRect();
      link.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 20,
        clientY: rect.y + 5,
        button: 2,
      }));
      return true;
    })()`);

    if (foundSidebarRow) {
      await ctx.waitFor("Boolean(document.querySelector('[role=\"menu\"]'))", {
        timeoutMs: 5_000,
        label: "session context menu",
      });
      await ctx.waitFor(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find((entry) => entry.textContent.trim() === ${JSON.stringify(DELETE_SESSION_LABEL)});
        if (!item) return false;
        item.click();
        return true;
      })()`, { timeoutMs: 5_000, label: "delete session menu item" });
      await ctx.waitFor(`(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        return dialogs.some((dialog) => dialog.innerText.includes(${JSON.stringify(DELETE_SESSION_DIALOG)}));
      })()`, { timeoutMs: 5_000, label: "delete session confirmation" });
      await ctx.waitFor(`(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        const dialog = dialogs.find((entry) => entry.innerText.includes(${JSON.stringify(DELETE_SESSION_DIALOG)}));
        if (!dialog) return false;
        const button = [...dialog.querySelectorAll('button')]
          .find((entry) => entry.textContent.trim() === ${JSON.stringify(DELETE_LABEL)});
        if (!button) return false;
        button.click();
        return true;
      })()`, { timeoutMs: 5_000, label: "delete session confirm button" });
      await ctx.waitFor("!location.hash.includes('/session/ses_')", {
        timeoutMs: 20_000,
        label: "draft session removed from route",
      });
      break;
    }

    ctx.log("Selected draft session is not listed in the sidebar; reloading to clear it.");
    await ctx.eval("location.reload()");
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 30_000,
      label: "control API after clearing draft session",
    });
    await applyDesktopConfig(ctx, { allowZenModel: false, allowCustomProviders: false });
    await settle(800);
    await closeStaleDialogs(ctx);
  }

  await ctx.waitFor(
    `document.body.innerText.includes(${JSON.stringify(STARTER_CARD)})`,
    { timeoutMs: 20_000, label: "starter provider card title" },
  );
  await ctx.waitFor(
    `document.body.innerText.includes(${JSON.stringify(STARTER_CARD_DESCRIPTION)})`,
    { timeoutMs: 20_000, label: "starter provider card description" },
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
        await closeStaleDialogs(ctx);
      },
    },
    {
      name: "Policy activation is announced",
      run: async (ctx) => {
        await ctx.prove("Policy activation appears in the notification center", {
          claim: "When the admin disables Zen models and custom providers, OpenWork announces active organization policies.",
          voiceover: vo[0],
          action: async () => {
            await applyDesktopConfig(ctx, { allowZenModel: false, allowCustomProviders: false });
            await settle(1_000);
            await closeStaleDialogs(ctx);
            await openNotificationCenter(ctx);
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
      name: "Settings confirms managed policies",
      run: async (ctx) => {
        await ctx.prove("Settings shows the managed-by-organization policy banner", {
          claim: "Settings confirms that organization policy is managing this install.",
          voiceover: vo[1],
          action: async () => {
            await closeStaleDialogs(ctx);
            await ctx.navigateHash("/settings/general");
            await ctx.waitForText("Settings", { timeoutMs: 10_000 });
            await ctx.waitFor(
              `Boolean(document.querySelector(${JSON.stringify(SETTINGS_POLICY_BANNER)}))`,
              { timeoutMs: 5_000, label: "desktop policy banner" },
            );
            await settle(2_000);
            await closeStaleDialogs(ctx);
          },
          assert: async () => {
            await ctx.expectText(SETTINGS_POLICY_COPY);
          },
          screenshot: {
            name: "settings-policy-banner",
            requireText: [SETTINGS_POLICY_COPY],
          },
        });
      },
    },
    {
      name: "Empty workspace reveals the starter card",
      run: async (ctx) => {
        await ctx.prove("No usable model leaves the workspace get-started provider card visible", {
          claim: "With Zen models blocked and no other providers connected, the empty workspace shows the provider starter card.",
          voiceover: vo[2],
          action: async () => {
            await reachEmptyStateStarterCard(ctx);
          },
          assert: async () => {
            await ctx.expectText(STARTER_CARD);
            await ctx.expectText(STARTER_CARD_DESCRIPTION);
          },
          screenshot: {
            name: "empty-state-provider-card",
            requireText: [STARTER_CARD, STARTER_CARD_DESCRIPTION],
          },
        });
      },
    },
    {
      name: "Restricted policy blocks the starter-card provider dialog",
      run: async (ctx) => {
        await ctx.prove("Starter card shows the restriction notice instead of the provider dialog", {
          claim: "With custom providers disabled by org policy, the starter card shows the same restriction notice as Settings instead of opening the provider dialog.",
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
        await closeStaleDialogs(ctx);
      },
    },
    {
      name: "Clearing the policy restores the provider dialog",
      run: async (ctx) => {
        await ctx.prove("Starter card opens the provider dialog again after custom providers are allowed", {
          claim: "When the admin lifts the custom-provider restriction, the same starter card opens the provider dialog again.",
          voiceover: vo[4],
          action: async () => {
            await applyDesktopConfig(ctx, {});
            await settle(800);
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
        await closeStaleDialogs(ctx);
        await ctx.navigateHash("/settings/general");
        await ctx.waitForText("Settings", { timeoutMs: 10_000 });
        await settle(2_000);
        await ctx.navigateHash("/session");
      },
    },
  ],
};
