# Cloud marketplace delivery flows

End-to-end user flows for Connect-only organization marketplace delivery and
the lifecycle of local copies created by the retired desktop import path.

## Preflight

1. Start Daytona Den server and Electron sandboxes.
2. Create a local workspace.
3. Use a Den org where the signed-in user can create plugins and marketplaces.

## Flow 1: Connect-only marketplace catalog

**Goal:** Organization marketplace plugins are discoverable without offering a
desktop install or update action.

### Steps

1. Publish a recognizable plugin in an organization marketplace through Den.
2. Sign the desktop app into that organization.
3. Open Settings -> Extensions (Legacy) -> Marketplace.
4. Refresh the catalog and open the plugin details.
5. Open Settings -> OpenWork Connect and search for a capability from the plugin.

### Expected outcome

- The Marketplace row describes delivery through OpenWork Connect.
- The row and details offer no Install, Import, or Update action.
- The capability is available through OpenWork Connect.

## Flow 2: Signed-out catalog baseline

**Goal:** Marketplace filters and signed-out guidance render without desktop
snapshot state.

### Steps

1. Sign out of OpenWork Cloud.
2. Open Settings -> Extensions (Legacy) -> Marketplace.
3. Select the Installed filter.

### Expected outcome

- All, Available, and Installed filters render; Updates does not.
- The view remains stable and shows sign-in guidance.

## Flow 3: Existing local copy preservation

**Goal:** A local copy from the retired import path remains user-owned even when
the Den catalog changes.

### Steps

1. Seed a historical marketplace plugin registry record and its local file.
2. Refresh the Marketplace and My Extensions views.
3. Change or remove the upstream plugin in Den and refresh again.
4. Remove the local copy explicitly from My Extensions.

### Expected outcome

- The copy is labeled `Local copy installed` and appears under My Extensions.
- Upstream changes do not update or delete local files.
- A copy absent from the catalog remains visible and uninstallable.
- Explicit removal deletes the registered local files and registry record.

## Flow 4: Supported local plugin import

**Goal:** GitHub/Claude plugin bundles remain the supported local installation
path.

### Steps

1. Open My Extensions and choose the GitHub import action.
2. Preview and install a plugin bundle containing a skill and MCP server.
3. Verify both resources become available.
4. Remove the local extension.

### Expected outcome

- Preview does not write files.
- Install materializes namespaced resources and hot-registers the MCP server.
- The installed extension is listed as a local copy and can be fully removed.

## Flow 5: Marketplace refresh timing

**Goal:** Measure how fast a newly published marketplace plugin appears in the
desktop catalog.

### Steps

1. Open Marketplace settings.
2. Publish a marketplace and plugin through Den.
3. Refresh and poll until both names are visible.

### Expected outcome

- Manual refresh reveals the catalog entry within a few seconds.
- No workspace files or local plugin registry rows are created.
