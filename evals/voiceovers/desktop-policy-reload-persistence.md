# desktop-policy-reload-persistence — Organization policy restrictions persist from boot fetches

Context (not narrated): The eval signs in as the org owner, changes the default desktop policy through Den, clears the desktop-config cache, and relies on app reloads to fetch the effective policy.

1. We start from the default policy state. Settings is clean, with no organization policy banner, because every desktop feature is allowed.

2. The admin disables custom providers and the Zen model, then the app reloads with an empty cache. The policy banner appears from the app’s own cloud fetch.

3. On the AI settings tab, Connect provider no longer opens setup. It opens a clear restriction notice that adding custom providers is disabled.

4. A second reload does not lose the restriction. The organization policy banner is still visible on Settings.

5. Finally the admin restores the defaults, the app reloads again, and Settings returns to the unrestricted state with the banner gone.
