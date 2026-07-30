import { expect, test } from "vitest";
import { desktop } from "@openwork/hosts";
import { startEgressLab } from "@openwork/labs";
import { clickButton, visibleText, waitUntilInteractive } from "@openwork/behaviors";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";

/**
 * CORE JOURNEY: a desktop pointed at a Den whose TLS is broken by the corporate
 * edge — the Blue Yonder shape, where five days went to blaming the wrong thing.
 *
 * This is deliberately a *welcome-surface* journey: the app is bootstrapped at a
 * Den served by the egress lab, so the fault surfaces before any workspace,
 * model or onboarding exists. What we require is that the app is HONEST about it
 * — it must say something a person can act on, not spin forever.
 */

const optedIn = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = optedIn
  ? "a desktop pointed at a TLS-broken Den says so instead of spinning"
  : "app + TLS-broken Den skipped: set OPENWORK_EVAL_APP_SPECS=1 to opt in";

test.skipIf(!optedIn)(title, async () => {
  // The lab re-signs TLS with a CA the app does not trust: a corporate
  // interception proxy, as far as the desktop is concerned.
  await using edge = await startEgressLab({ profile: "intercept" });
  await using app = await desktop({
    name: "den-tls-fault",
    bootstrap: { baseUrl: edge.url, apiBaseUrl: edge.url, requireSignin: false },
  });
  await using roll = photoRoll("app-den-tls-fault");

  // A fresh profile starts on the welcome surface — no workspace required.
  expect(app.readiness.state).toBe("welcome");
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The OpenWork welcome screen is visible with a sign-in option",
      "No error or 'Something went wrong' crash message is visible yet",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  // Attempting to reach the Den is what exercises the broken edge.
  await clickButton(app, "Sign in to OpenWork Cloud", { timeoutMs: 60_000 });
  await waitUntilInteractive(app, { timeoutMs: 180_000 });

  const text = await visibleText(app);
  {
    const shot = await screenshot(app);
    const seen = await validate(shot, [
      "The screen shows a specific problem reaching OpenWork Cloud, not an indefinite loading state",
      "The message names a connection, network, certificate or sign-in problem a person could act on",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  // The app must not pretend it is fine: some explanatory copy has to be present.
  expect(
    /couldn.t|could not|unable|failed|error|retry|try again|offline|connection|certificate/i.test(text),
    `no actionable explanation on screen. Visible text: ${text.slice(0, 400)}`,
  ).toBe(true);
});
