import { defineFlow, type FlowContext } from "../runner/flow.ts";
import { loadVoiceoverParagraphs } from "../runner/voiceover.ts";

const FLOW_ID = "signin-redesign";
const DEFAULT_DEN_BASE_URL = "https://app.openworklabs.com";
const DEFAULT_DEN_API_BASE_URL = "https://app.openworklabs.com/api/den";

// Narration is loaded from the approved script (evals/voiceovers/signin-redesign.md).
// The runner fails this flow if the narration drifts from that script.
const vo = await loadVoiceoverParagraphs(FLOW_ID);
if (!vo) throw new Error("Missing approved voice-over script for signin-redesign.");

/** Let focus-ring transitions settle before the frame is captured. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

/**
 * Presenter-style keyboard focus: frames 1-4 narrate different regions of one
 * static screen, so each frame moves keyboard focus the way a presenter
 * tabbing through the screen would (synthetic mouse hover does not repaint in
 * the Electron/VNC harness, but :focus-visible rings do). Focused frames show
 * the ring on the narrated element; blurred frames give the clean wide shot.
 */
async function focusTestId(ctx: FlowContext, testId: string): Promise<void> {
  const focused = await ctx.eval(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!(el instanceof HTMLElement)) return false;
    el.focus();
    return document.activeElement === el && el.matches(":focus-visible");
  })()`);
  ctx.assert(focused === true, `Expected keyboard focus with a visible ring on ${testId}.`);
  await settle();
}

async function blurActiveElement(ctx: FlowContext): Promise<void> {
  await ctx.eval(`(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) el.blur();
    return true;
  })()`);
  await settle();
}

function writeOnboardingPrefScript(completed: boolean): string {
  return `(() => {
    let prefs = {};
    try {
      const raw = localStorage.getItem("openwork.preferences");
      prefs = raw ? JSON.parse(raw) : {};
    } catch {
      prefs = {};
    }
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) prefs = {};
    prefs.hasCompletedOnboarding = ${completed ? "true" : "false"};
    // This flow proves the classic (flag-off) welcome; a prior chat-first run
    // on the same app may have left the flag on.
    const featureFlags = prefs.featureFlags && typeof prefs.featureFlags === "object" && !Array.isArray(prefs.featureFlags)
      ? prefs.featureFlags
      : {};
    prefs.featureFlags = { ...featureFlags, chatFirstOnboarding: false };
    localStorage.setItem("openwork.preferences", JSON.stringify(prefs));
    return true;
  })()`;
}

async function resetToDefaultWelcome(ctx: FlowContext): Promise<void> {
  await ctx.eval(`(async () => {
    const defaultBaseUrl = ${JSON.stringify(DEFAULT_DEN_BASE_URL)};
    const defaultApiBaseUrl = ${JSON.stringify(DEFAULT_DEN_API_BASE_URL)};
    const bridge = window.__OPENWORK_ELECTRON__;
    if (bridge?.invokeDesktop) {
      const persisted = await bridge.invokeDesktop("setDesktopBootstrapConfig", {
        baseUrl: defaultBaseUrl,
        apiBaseUrl: defaultApiBaseUrl,
        requireSignin: false,
      }).catch(() => null);
      localStorage.setItem("openwork.den.baseUrl", persisted?.baseUrl || defaultBaseUrl);
      localStorage.setItem("openwork.den.apiBaseUrl", persisted?.apiBaseUrl || defaultApiBaseUrl);
    } else {
      localStorage.setItem("openwork.den.baseUrl", defaultBaseUrl);
      localStorage.setItem("openwork.den.apiBaseUrl", defaultApiBaseUrl);
    }
    localStorage.removeItem("openwork.den.authToken");
    localStorage.removeItem("openwork.den.activeOrgId");
    localStorage.removeItem("openwork.den.activeOrgSlug");
    localStorage.removeItem("openwork.den.activeOrgName");
    // "0" portrays the packaged default: dev builds (like this eval app)
    // otherwise show the welcome Developer section by default.
    localStorage.setItem("openwork.developerMode", "0");
    ${writeOnboardingPrefScript(false)};
    location.hash = "#/welcome";
    location.reload();
    return true;
  })()`, { awaitPromise: true });
  await ctx.waitForText("Welcome to OpenWork", { timeoutMs: 60_000 });
}

export default defineFlow({
  id: FLOW_ID,
  title: "Welcome sign-in screen shows one honest hierarchy with developer plumbing gated",
  kind: "user-facing",
  steps: [
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The first-run welcome screen has one headline, three steps, and one primary action", {
          voiceover: vo[0],
          action: async () => {
            await resetToDefaultWelcome(ctx);
            // The narration ends on "a single primary button" — rest keyboard
            // focus there, like a presenter tabbing to it.
            await focusTestId(ctx, "welcome-primary-cta");
          },
          assert: async () => {
            const markPresent = await ctx.eval(`Boolean(document.querySelector('[data-testid="welcome-brand-mark"]'))`);
            ctx.assert(markPresent === true, "Expected the OpenWork brand mark above the welcome headline.");
            const headlineMatches = await ctx.eval(`(() => (document.body.innerText.match(/but it works for you/g) ?? []).length)()`);
            ctx.assert(headlineMatches === 1, `Expected exactly one occurrence of "but it works for you", got ${headlineMatches}`);
            await ctx.expectText("Pick a folder");
            await ctx.expectText("Chat");
            await ctx.expectText("Interact");
            await ctx.expectText("Pick a folder to get started");
          },
          screenshot: {
            name: "frame-1",
            requireText: ["Welcome to OpenWork", "Pick a folder to get started"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The showcase panel uses a quiet label and plain-text capabilities without borrowed logos", {
          voiceover: vo[1],
          action: async () => {
            // Attention moves to the right panel — clear the focus ring for
            // the clean panel shot.
            await blurActiveElement(ctx);
          },
          assert: async () => {
            // The label renders through CSS text-transform: uppercase, which
            // Chromium reflects in document.body.innerText.
            await ctx.expectText("WHAT OPENWORK CAN DO");
            const simpleIconCount = await ctx.eval(`document.querySelectorAll('img[src*="simpleicons"]').length`);
            ctx.assert(simpleIconCount === 0, `Expected no Simple Icons images, got ${simpleIconCount}`);
            await ctx.expectText("Edit spreadsheets");
            await ctx.expectText("Connect to APIs");
          },
          screenshot: {
            name: "frame-2",
            requireText: ["WHAT OPENWORK CAN DO", "Edit spreadsheets"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("The secondary sign-in paths sit behind an or divider with full subtitles", {
          voiceover: vo[2],
          action: async () => {
            // Focus the first team card — its ring marks the frame.
            await focusTestId(ctx, "welcome-team-signin");
          },
          assert: async () => {
            const dividerPresent = await ctx.eval(`Boolean(document.querySelector('[data-testid="welcome-or-divider"]'))`);
            ctx.assert(dividerPresent === true, "Expected the or divider to render between the primary CTA and team cards.");
            await ctx.expectText("or");
            await ctx.expectText("Use OpenWork Cloud");
            await ctx.expectText("Join your organization");
            await ctx.expectText("Sign in for hosted OpenWork and team features.");
            await ctx.expectText("Paste your invite or install link.");
            const subtitlesFit = await ctx.eval(`(() => {
              const ids = ["welcome-team-signin-subtitle", "welcome-join-org-subtitle"];
              return ids.every((id) => {
                const el = document.querySelector('[data-testid="' + id + '"]');
                return el instanceof HTMLElement && el.scrollWidth <= el.clientWidth + 1;
              });
            })()`);
            ctx.assert(subtitlesFit === true, "Expected both card subtitles to wrap without horizontal clipping.");
          },
          screenshot: {
            name: "frame-3",
            requireText: ["Use OpenWork Cloud", "Join your organization", "or"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("The normal first-run screen hides on-premises and Daytona developer plumbing", {
          voiceover: vo[3],
          action: async () => {
            // Back to a neutral wide shot: clear the focus ring.
            await blurActiveElement(ctx);
          },
          assert: async () => {
            await ctx.expectNoText("Using OpenWork on-premises?");
            await ctx.expectNoText("Daytona folder path");
            await ctx.expectNoText("DEVELOPER");
          },
          screenshot: {
            name: "frame-4",
            rejectText: ["Using OpenWork on-premises?", "Daytona folder path", "DEVELOPER"],
          },
        });
      },
    },
    {
      name: "Frame 5",
      run: async (ctx) => {
        try {
          await ctx.prove("Developer mode reveals the same welcome plumbing under an explicit Developer label", {
            voiceover: vo[4],
            action: async () => {
              await ctx.eval(`(() => {
                localStorage.setItem("openwork.developerMode", "1");
                location.reload();
                return true;
              })()`);
              await ctx.waitForText("DEVELOPER", { timeoutMs: 60_000 });
            },
            assert: async () => {
              await ctx.expectText("DEVELOPER");
              await ctx.expectText("Using OpenWork on-premises?");
              const manualFolderInput = await ctx.eval(`Boolean(document.querySelector('input[placeholder="/workspace/my-project"]'))`);
              ctx.assert(manualFolderInput === true, "Expected the Daytona folder path input in developer mode.");
            },
            screenshot: {
              name: "frame-5",
              requireText: ["DEVELOPER", "Using OpenWork on-premises?"],
            },
          });
        } finally {
          await ctx.eval(`localStorage.removeItem("openwork.developerMode")`);
        }
      },
    },
  ],
});
