// Cloud auto-sync tick. Kept short so org changes made on Den (a model
// added to an LLM provider, a new provider shared with the team) land on
// desktops within ~30s without user action. Each tick is cheap when nothing
// changed: one org-scoped GET for providers plus a local config read; the
// cloud MCP sync early-returns on its localStorage marker. Reconciles
// (config rewrite + engine reload) only run on actual drift.
export const CLOUD_SYNC_INTERVAL_MS = 30 * 1000;
