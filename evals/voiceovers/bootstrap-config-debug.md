# bootstrap-config-debug — Bootstrap config diagnostics and save proof

This proof uses an isolated desktop instance, so the bootstrap file shown here is a temporary eval file rather than the user's real OpenWork configuration.

1. Alex opens Settings and goes to Advanced. At the bottom, Developer mode is visible, and turning it on adds the Debug tools to the settings sidebar.

2. Alex opens Debug. A new Bootstrap config section appears with the desktop bootstrap path and the JSON diagnostics, including the baseUrl the app read from the temporary config.

3. Alex goes to Cloud account, enters a Cloud control plane URL, and saves it. The page confirms the URL was updated instead of failing silently.

4. Back on Debug, the Bootstrap config diagnostics now show the saved URL together with a writtenAt timestamp, proving the desktop bootstrap file was stamped and persisted.

5. Alex returns to Cloud account and clears the server configuration. The URL returns to the default OpenWork Cloud host, and the temporary bootstrap file is gone without resetting workspaces.
