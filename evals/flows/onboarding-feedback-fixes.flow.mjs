/**
 * Onboarding feedback fixes (#2624): the three "it forgets what I chose"
 * bugs reported from Windows onboarding, replayed end-to-end:
 *
 *   1. A default model chosen during org onboarding survives a relaunch —
 *      the legacy explicit-default key and the live preferences blob are
 *      reconciled instead of falling back to the retired built-in model.
 *   2. The org onboarding page shows once: fresh sign-ins land there, but
 *      after the user continues past it, refreshed sign-ins on relaunch
 *      stay on the session view.
 *   3. The "Organization policies active" notification stays cleared after
 *      a relaunch while the policy is still active.
 *
 * The den org backend is a local stub HTTP server started by this flow
 * (sign-in session + one org provider with models); relaunches are
 * simulated at the renderer level with location.reload(), which re-runs
 * the exact boot code paths (LocalProvider init, DesktopPolicyNotification
 * effect, den session routing) the fixes changed.
 *
 * Run against an isolated profile to avoid touching a real dev profile:
 *   OPENWORK_ELECTRON_USERDATA=$(mktemp -d) OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=9826 pnpm dev
 *   pnpm fraimz --flow onboarding-feedback-fixes --cdp-url http://127.0.0.1:9826
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import {
  DEN_STUB_FIRST_MODEL_ID,
  DEN_STUB_ORG_NAME as ORG_NAME,
  DEN_STUB_PORT,
  DEN_STUB_PROVIDER_ID,
  DEN_STUB_PROVIDER_NAME as PROVIDER_NAME,
  startDenStub,
} from "./lib/den-onboarding-stub.mjs";

const vo = await loadVoiceoverParagraphs("onboarding-feedback-fixes");

// Frame 2 simulates the pre-fix bitten state with this explicit choice…
const LEGACY_DEFAULT = { providerID: DEN_STUB_PROVIDER_ID, modelID: "glm-5.2" };
// …while frame 4 picks the provider's first model through the real UI.
const UI_DEFAULT = { providerID: DEN_STUB_PROVIDER_ID, modelID: DEN_STUB_FIRST_MODEL_ID };
const BIG_PICKLE = { providerID: "opencode", modelID: "big-pickle" };

// When the app runs on another host (Daytona), start the stub next to the
// app (`node evals/flows/lib/den-onboarding-stub.mjs`) and set
// OPENWORK_EVAL_DEN_STUB_EXTERNAL=1 for the runner. The baseUrl written into
// the app's localStorage always targets the app-local loopback.
const externalStub = process.env.OPENWORK_EVAL_DEN_STUB_EXTERNAL === "1";

let denStub = null;

async function waitForControl(ctx) {
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "window.__openworkControl",
  });
  await ctx.waitFor("document.body.innerText.trim().length > 40", {
    timeoutMs: 30_000,
    label: "rendered body text",
  });
}

async function readPrefsDefaultModel(ctx) {
  return ctx.eval(
    "JSON.parse(localStorage.getItem('openwork.preferences') ?? '{}').defaultModel ?? null",
  );
}

export default {
  id: "onboarding-feedback-fixes",
  title: "Onboarding choices stick: default model, one-time org page, dismissible policy notice",
  kind: "user-facing",
  steps: [
    {
      name: "Reset eval state, start den stub, boot to the session view",
      run: async (ctx) => {
        if (!externalStub) denStub ??= await startDenStub();
        await waitForControl(ctx);

        // Idempotence: wipe every key this flow exercises so reruns start
        // from the same "member finished setup" baseline.
        await ctx.eval(`(() => {
          const keys = [
            'openwork.defaultModel',
            'openwork.orgOnboardingSeen',
            'openwork.den.baseUrl',
            'openwork.den.authToken',
            'openwork.den.activeOrgId',
            'openwork.den.activeOrgName',
            'openwork:notifications:v1',
            'openwork.openworkModelsPromo.hidden',
            'openwork.openworkModelsPromo.startupShown',
          ];
          for (const key of keys) localStorage.removeItem(key);
          const prefs = JSON.parse(localStorage.getItem('openwork.preferences') ?? '{}');
          prefs.defaultModel = null;
          localStorage.setItem('openwork.preferences', JSON.stringify(prefs));
          const bridge = window.__openworkApplyDesktopConfig;
          if (typeof bridge === 'function') bridge({});
          return true;
        })()`);
        await ctx.eval("location.reload()");
        await waitForControl(ctx);

        // Fresh isolated profiles land on /welcome: create a workspace so
        // the flow starts where a set-up member would.
        const onWelcome = await ctx.eval("location.hash.includes('/welcome')");
        if (onWelcome) {
          const wsPath = mkdtempSync(join(tmpdir(), "openwork-eval-ws-"));
          await ctx.fill("input", wsPath);
          await ctx.clickText("Use this folder", { timeoutMs: 5_000 });
          await ctx.waitFor(
            "location.hash.includes('/workspace/') || location.hash.includes('/session')",
            { timeoutMs: 30_000, label: "workspace route after creation" },
          );
          // The first-run flow may interpose provider/attribution steps;
          // dismiss anything with a Skip affordance.
          await ctx.clickText("Skip", { timeoutMs: 3_000 }).catch(() => {});
        }
        await ctx.navigateHash("/session");
        await new Promise((resolve) => setTimeout(resolve, 800));

        await ctx.prove("App boots to the session view for a set-up member", {
          claim: "OpenWork opens on the session view — the state a member is in right after finishing setup.",
          voiceover: vo[0],
          assert: async () => {
            await ctx.expectHashIncludes("/session");
          },
          screenshot: {
            name: "baseline-session",
            hashIncludes: "/session",
          },
        });
      },
    },

    {
      name: "Explicit org default survives a relaunch instead of the retired fallback",
      run: async (ctx) => {
        await ctx.prove("Chosen default model wins over the baked-in fallback after relaunch", {
          claim: `With the pre-fix bitten storage (explicit ${LEGACY_DEFAULT.providerID}/${LEGACY_DEFAULT.modelID} + baked ${BIG_PICKLE.modelID} in preferences), a relaunch reconciles preferences to the member's explicit choice.`,
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              localStorage.setItem('openwork.defaultModel', ${JSON.stringify(`${LEGACY_DEFAULT.providerID}/${LEGACY_DEFAULT.modelID}`)});
              const prefs = JSON.parse(localStorage.getItem('openwork.preferences') ?? '{}');
              prefs.defaultModel = ${JSON.stringify(BIG_PICKLE)};
              localStorage.setItem('openwork.preferences', JSON.stringify(prefs));
              return true;
            })()`);
            await ctx.eval("location.reload()");
            await waitForControl(ctx);
            await ctx.navigateHash("/session");
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
          assert: async () => {
            const defaultModel = await readPrefsDefaultModel(ctx);
            ctx.log(`preferences.defaultModel after relaunch: ${JSON.stringify(defaultModel)}`);
            ctx.assert(
              defaultModel &&
                defaultModel.providerID === LEGACY_DEFAULT.providerID &&
                defaultModel.modelID === LEGACY_DEFAULT.modelID,
              `Expected preferences.defaultModel to be the explicit ${LEGACY_DEFAULT.providerID}/${LEGACY_DEFAULT.modelID}, got ${JSON.stringify(defaultModel)}.`,
            );
            const legacy = await ctx.eval("localStorage.getItem('openwork.defaultModel')");
            ctx.assert(
              legacy === `${LEGACY_DEFAULT.providerID}/${LEGACY_DEFAULT.modelID}`,
              `Expected the explicit default key to survive, got ${JSON.stringify(legacy)}.`,
            );
          },
          screenshot: {
            name: "default-model-reconciled",
            hashIncludes: "/session",
          },
        });
      },
    },

    {
      name: "Fresh sign-in lands on the org onboarding page",
      run: async (ctx) => {
        await ctx.prove("First sign-in routes to the org resources page", {
          claim: "A fresh cloud sign-in routes to /onboarding, where the member sees their org's provider and models.",
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`(() => {
              localStorage.setItem('openwork.den.baseUrl', 'http://127.0.0.1:${DEN_STUB_PORT}');
              localStorage.setItem('openwork.den.authToken', 'eval-fake-token');
              localStorage.setItem('openwork.den.activeOrgId', 'org_eval');
              localStorage.setItem('openwork.den.activeOrgName', ${JSON.stringify(ORG_NAME)});
              localStorage.removeItem('openwork.orgOnboardingSeen');
              window.dispatchEvent(new CustomEvent('openwork-den-session-updated', { detail: { status: 'success' } }));
              return true;
            })()`);
            await ctx.waitFor("location.hash.includes('/onboarding')", {
              timeoutMs: 15_000,
              label: "route to /onboarding after sign-in",
            });
            // The page opens with an organization chooser before the
            // resource list; confirm the (only) org.
            const hasOrgChooser = await ctx.waitFor(
              "document.body.innerText.includes('Continue with organization') || document.body.innerText.includes('Acme AI Gateway')",
              { timeoutMs: 15_000, label: "org chooser or resource list" },
            );
            void hasOrgChooser;
            const onChooser = await ctx.eval(
              "document.body.innerText.includes('Continue with organization')",
            );
            if (onChooser) {
              await ctx.clickText("Continue with organization", { timeoutMs: 5_000 });
            }
            await ctx.waitForText("AI Providers", { timeoutMs: 15_000 });
            // Expand the providers accordion so the org's provider card
            // (with its "Use as default" affordance) is visible.
            await ctx.clickText("AI Providers", { timeoutMs: 5_000 });
            await ctx.waitForText(PROVIDER_NAME, { timeoutMs: 10_000 });
          },
          assert: async () => {
            await ctx.expectHashIncludes("/onboarding");
            await ctx.expectText(PROVIDER_NAME);
          },
          screenshot: {
            name: "org-onboarding-page",
            hashIncludes: "/onboarding",
            requireText: [PROVIDER_NAME],
          },
        });
      },
    },

    {
      name: "Continuing past onboarding latches it: relaunch sign-ins stay on the session",
      run: async (ctx) => {
        await ctx.prove("Onboarding does not reappear after the member continues past it", {
          claim: "The member picks a default model, continues to the workspace, and a refreshed sign-in (as on every relaunch) no longer routes back to /onboarding; the picked model is live in preferences.",
          voiceover: vo[3],
          action: async () => {
            await ctx.clickText("Use as default", { timeoutMs: 5_000 });
            await ctx.waitForText("will be set as your default model", { timeoutMs: 5_000 });
            await ctx.clickText("Continue to workspace", { timeoutMs: 5_000 });
            await ctx.waitFor("location.hash.includes('/session')", {
              timeoutMs: 15_000,
              label: "back on the session view",
            });
            // Simulate the relaunch-time refreshed sign-in that used to drag
            // the member back to onboarding.
            await ctx.eval(
              "window.dispatchEvent(new CustomEvent('openwork-den-session-updated', { detail: { status: 'success' } })) ?? true",
            );
            await new Promise((resolve) => setTimeout(resolve, 3_000));
          },
          assert: async () => {
            await ctx.expectHashIncludes("/session");
            const seen = await ctx.eval("localStorage.getItem('openwork.orgOnboardingSeen')");
            ctx.assert(seen === "1", `Expected the onboarding-seen latch to be set, got ${JSON.stringify(seen)}.`);
            const defaultModel = await readPrefsDefaultModel(ctx);
            ctx.assert(
              defaultModel &&
                defaultModel.providerID === UI_DEFAULT.providerID &&
                defaultModel.modelID === UI_DEFAULT.modelID,
              `Expected the UI-picked default ${UI_DEFAULT.providerID}/${UI_DEFAULT.modelID} in live preferences, got ${JSON.stringify(defaultModel)}.`,
            );
          },
          screenshot: {
            name: "session-after-continue",
            hashIncludes: "/session",
          },
        });
      },
    },

    {
      name: "Active org policies raise a one-time notification",
      run: async (ctx) => {
        await ctx.prove("Policy notice appears in the notification bell", {
          claim: "Applying an org desktop policy raises the 'Organization policies active' notification in the bell.",
          voiceover: vo[4],
          action: async () => {
            await ctx.eval("window.__openworkApplyDesktopConfig({ brandAccentColor: 'grass' }) ?? true");
            await ctx.waitFor(
              `(() => {
                try {
                  const raw = localStorage.getItem('openwork:notifications:v1');
                  const list = JSON.parse(raw ?? '{}')?.state?.notifications ?? [];
                  return list.some((n) => n.dedupeKey === 'desktop-policy-active' && n.readAt === null);
                } catch { return false; }
              })()`,
              { timeoutMs: 10_000, label: "desktop-policy-active notification in the store" },
            );
            await ctx.eval(`(() => {
              const bell = document.querySelector('button[aria-label^="Notifications"]');
              if (!bell) return false;
              bell.click();
              return true;
            })()`);
            await ctx.waitForText("Organization policies active", { timeoutMs: 5_000 });
          },
          assert: async () => {
            await ctx.expectText("Organization policies active");
          },
          screenshot: {
            name: "policy-notification",
            requireText: ["Organization policies active"],
          },
        });
      },
    },

    {
      name: "Cleared policy notification stays cleared across a relaunch",
      run: async (ctx) => {
        await ctx.prove("Dismissing the policy notice is permanent", {
          claim: "After 'Clear all' and a relaunch with the policy still active, the notification is not recreated and the bell shows no unread badge.",
          voiceover: vo[5],
          action: async () => {
            await ctx.clickText("Clear all", { timeoutMs: 5_000 });
            await ctx.eval("location.reload()");
            await waitForControl(ctx);
            // Give the policy-notification effect time to (wrongly) re-fire.
            await new Promise((resolve) => setTimeout(resolve, 2_000));
          },
          assert: async () => {
            const store = await ctx.eval(`(() => {
              try {
                const raw = localStorage.getItem('openwork:notifications:v1');
                const state = JSON.parse(raw ?? '{}')?.state ?? {};
                const list = state.notifications ?? [];
                return {
                  policyEntries: list.filter((n) => n.dedupeKey === 'desktop-policy-active').length,
                  onceKeys: state.onceKeys ?? [],
                };
              } catch (error) { return { error: String(error) }; }
            })()`);
            ctx.log(`notification store after relaunch: ${JSON.stringify(store)}`);
            ctx.assert(
              store.policyEntries === 0,
              `Expected no desktop-policy-active notification after clearing + relaunch, found ${store.policyEntries}.`,
            );
            ctx.assert(
              Array.isArray(store.onceKeys) && store.onceKeys.includes("desktop-policy-active"),
              "Expected the once-delivered latch to be persisted for desktop-policy-active.",
            );
            // Brand accent is still applied, so the policy really is active.
            const accentActive = await ctx.eval(
              "getComputedStyle(document.documentElement).getPropertyValue('--dls-accent').trim().length > 0",
            );
            ctx.assert(accentActive, "Expected the org policy (brand accent) to still be active after relaunch.");
          },
          screenshot: {
            name: "policy-notification-stays-cleared",
            rejectText: ["Organization policies active"],
          },
        });

        // Leave the profile clean: reset the injected policy config.
        await ctx.eval("window.__openworkApplyDesktopConfig({}) ?? true");
        denStub?.close();
        denStub = null;
      },
    },
  ],
};
