# onboarding-feedback-fixes — Onboarding choices stick across relaunches

A member of a managed organization sets up OpenWork once and the app remembers it. This fraimz replays the reported Windows-onboarding feedback against the fixed app: the default model chosen during org onboarding survives a relaunch instead of falling back to a retired built-in model, the organization onboarding page shows only once, and the "Organization policies active" notice stays dismissed after the user clears it.

1. OpenWork is open on the session view. This is the app a new organization member sees right after signing in and finishing setup.

2. We recreate the reported bug state from before the fix: the member chose their organization's GLM model as default during onboarding, but the app's preferences still carried the retired built-in fallback model. After a relaunch, the app now reconciles the two and keeps the member's real choice — the preferences agree with the model they picked, and the retired fallback is gone.

3. Signing in used to drag the member back to the organization onboarding page on every launch. Fresh sign-ins still land there once, so new members see what their organization provides.

4. After the member has continued past onboarding once, a relaunch with a refreshed sign-in stays on the session view — the model selection page does not come back.

5. Organization policies are active, so a one-time notice appears in the notification bell telling the member some settings are managed by their administrator.

6. The member clears the notification. After a relaunch with the same policies still active, the notice stays cleared instead of reappearing — dismissing it means dismissed.
