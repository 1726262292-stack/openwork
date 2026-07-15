// One-shot latch: has the user already been shown the org onboarding
// ("your organization resources") page? Set when they continue past it,
// checked before auto-routing to /onboarding on relaunch so the page —
// and its default-model picker — doesn't reappear on every app start.
// The key is already covered by session-memory cleanup and the dev reset
// button in session-page.tsx.
const ORG_ONBOARDING_SEEN_KEY = "openwork.orgOnboardingSeen";

export function hasSeenOrgOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ORG_ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOrgOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORG_ONBOARDING_SEEN_KEY, "1");
  } catch {
    // ignore quota errors
  }
}
