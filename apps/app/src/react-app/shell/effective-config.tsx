/** @jsxImportSource react */
import { createContext, use, useMemo, type ReactNode } from "react";
import { useShellConfig, type ShellConfig } from "./shell-config";
import { useDesktopConfig } from "../domains/cloud/desktop-config-provider";
import type { DesktopConfig } from "@openwork/types/den/desktop-app-restrictions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * The merged effective config used by the entire app.
 *
 * For Category A settings (UI customization): local user preference
 * is the fallback; cloud override wins when set.
 *
 * For Category B settings (org policies): always from cloud, not
 * user-togglable.
 */
export type EffectiveConfig = {
  // Category A: UI visibility (local default, cloud override)
  statusBar: boolean;
  docsButton: boolean;
  feedbackButton: boolean;
  cloudSignin: boolean;
  starterCards: boolean;
  modelPicker: boolean;
  addWorkspace: boolean;

  // Category B: Org-level policies (cloud only)
  disallowNonCloudModels: boolean;
  blockZenModel: boolean;
  blockMultipleWorkspaces: boolean;
  blockSettingsAccess: boolean;
  restrictExtensions: boolean;

  /** For each Category A key, whether the cloud is overriding it. */
  cloudManaged: {
    statusBar: boolean;
    docsButton: boolean;
    feedbackButton: boolean;
    cloudSignin: boolean;
    starterCards: boolean;
    modelPicker: boolean;
    addWorkspace: boolean;
  };
};

/* ------------------------------------------------------------------ */
/*  Mapping: ShellConfig key -> DesktopConfig cloud override key       */
/* ------------------------------------------------------------------ */

const CLOUD_OVERRIDE_MAP: Record<keyof ShellConfig, keyof DesktopConfig> = {
  statusBar: "showStatusBar",
  docsButton: "showDocsButton",
  feedbackButton: "showFeedbackButton",
  cloudSignin: "showCloudSignin",
  starterCards: "showStarterCards",
  modelPicker: "showModelPicker",
  addWorkspace: "showAddWorkspace",
};

/* ------------------------------------------------------------------ */
/*  Merge logic                                                        */
/* ------------------------------------------------------------------ */

function mergeConfig(local: ShellConfig, cloud: DesktopConfig): EffectiveConfig {
  const cloudManaged = {} as EffectiveConfig["cloudManaged"];
  const effective = {} as Record<string, boolean>;

  for (const [localKey, cloudKey] of Object.entries(CLOUD_OVERRIDE_MAP)) {
    const cloudVal = cloud[cloudKey as keyof DesktopConfig];
    const isCloudSet = typeof cloudVal === "boolean";
    cloudManaged[localKey as keyof typeof cloudManaged] = isCloudSet;
    effective[localKey] = isCloudSet
      ? (cloudVal as boolean)
      : local[localKey as keyof ShellConfig] as boolean;
  }

  return {
    ...(effective as Pick<EffectiveConfig,
      "statusBar" | "docsButton" | "feedbackButton" | "cloudSignin" |
      "starterCards" | "modelPicker" | "addWorkspace"
    >),
    cloudManaged,
    // Category B: always from cloud, default false
    disallowNonCloudModels: cloud.disallowNonCloudModels === true,
    blockZenModel: cloud.blockZenModel === true,
    blockMultipleWorkspaces: cloud.blockMultipleWorkspaces === true,
    blockSettingsAccess: (cloud as DesktopConfig & { blockSettingsAccess?: boolean }).blockSettingsAccess === true,
    restrictExtensions: (cloud as DesktopConfig & { restrictExtensions?: boolean }).restrictExtensions === true,
  };
}

/* ------------------------------------------------------------------ */
/*  Context + Provider                                                 */
/* ------------------------------------------------------------------ */

const EffectiveConfigContext = createContext<EffectiveConfig | undefined>(undefined);

export function EffectiveConfigProvider({ children }: { children: ReactNode }) {
  const { config: localConfig } = useShellConfig();
  const { config: cloudConfig } = useDesktopConfig();

  const effective = useMemo(
    () => mergeConfig(localConfig, cloudConfig),
    [localConfig, cloudConfig],
  );

  return (
    <EffectiveConfigContext.Provider value={effective}>
      {children}
    </EffectiveConfigContext.Provider>
  );
}

/**
 * Returns the merged effective config (local prefs + cloud overrides).
 * Use this everywhere instead of useShellConfig or useDesktopConfig
 * for UI visibility decisions.
 */
export function useEffectiveConfig(): EffectiveConfig {
  const ctx = use(EffectiveConfigContext);
  if (!ctx) {
    throw new Error("useEffectiveConfig must be used within an EffectiveConfigProvider");
  }
  return ctx;
}
