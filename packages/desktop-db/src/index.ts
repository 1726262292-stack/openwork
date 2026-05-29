export * from "./typeid";
export * from "./columns";
export * from "./schema/index";
export {
  openDb,
  closeDb,
  resolveDefaultDbPath,
  resolveDbPathForServerConfig,
  schema,
  type DesktopDb,
  type OpenDbOptions,
} from "./client";
export * as drizzle from "./drizzle";
export {
  MIRRORED_PREFERENCE_KEYS,
  MIRRORED_PREFERENCE_PREFIXES,
  isMirroredPreferenceKey,
  getPreference,
  getAllMirroredPreferences,
  setPreference,
  removePreference,
  removePreferences,
} from "./preferences";
export {
  isValidEnvKey,
  isReservedEnvKey,
  listEnvVars,
  getEnvVar,
  upsertEnvVars,
  deleteEnvVar,
  readEnvForInjection,
  InvalidEnvKeyError,
  type EnvRecord,
  type EnvEntry,
} from "./env-store";
export {
  BOOTSTRAP_BASE_URL_PREF,
  BOOTSTRAP_API_BASE_URL_PREF,
  BOOTSTRAP_REQUIRE_SIGNIN_PREF,
  getDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  type DesktopBootstrapConfig,
} from "./bootstrap";
export {
  runPhase1Import,
  runPhase1ImportOnce,
  importServerJson,
  importTokensJson,
  importAuditDir,
  resolveServerJsonPath,
  resolveTokensJsonPath,
  resolveAuditDir,
  type ImportOptions,
  type ImportReport,
  type ImportResult,
  type ImportOnceReport,
  type ImportOnceEntry,
  type ImportOnceStatus,
  importElectronWorkspaces,
  importElectronServerTokens,
  importElectronServerState,
  importEnvJson,
  importDesktopBootstrap,
  runDesktopImportOnce,
  DESKTOP_SELECTED_WORKSPACE_PREF,
  DESKTOP_WATCHED_WORKSPACE_PREF,
  DESKTOP_PREFERRED_PORT_PREF,
  type DesktopImportOptions,
  type DesktopImportReport,
  type DesktopImportEntry,
  type DesktopImportStatus,
} from "./import/index";
