import type { OpencodeConfigFile } from "../../../../app/lib/desktop";

export type ConfigScope = "project" | "global";

export type ExtensionsViewLocalState = {
  logoutOpen: boolean;
  logoutTarget: string | null;
  logoutBusy: boolean;
  removeOpen: boolean;
  removeTarget: string | null;
  configScope: ConfigScope;
  projectConfig: OpencodeConfigFile | null;
  globalConfig: OpencodeConfigFile | null;
  configError: string | null;
  revealBusy: boolean;
  showAdvanced: boolean;
  addMcpModalOpen: boolean;
  togglingMcp: string | null;
};

type ExtensionsViewLocalAction<K extends keyof ExtensionsViewLocalState = keyof ExtensionsViewLocalState> =
  | { type: "set"; key: K; value: ExtensionsViewLocalState[K] }
  | { type: "configUnavailable" }
  | { type: "configLoaded"; project: OpencodeConfigFile | null; global: OpencodeConfigFile | null }
  | { type: "configLoadError"; error: string };

export const initialExtensionsViewLocalState: ExtensionsViewLocalState = {
  logoutOpen: false,
  logoutTarget: null,
  logoutBusy: false,
  removeOpen: false,
  removeTarget: null,
  configScope: "project",
  projectConfig: null,
  globalConfig: null,
  configError: null,
  revealBusy: false,
  showAdvanced: false,
  addMcpModalOpen: false,
  togglingMcp: null,
};

export function extensionsViewLocalReducer(
  state: ExtensionsViewLocalState,
  action: ExtensionsViewLocalAction,
): ExtensionsViewLocalState {
  switch (action.type) {
    case "set": {
      const current = state[action.key];
      const next = action.value;
      if (Object.is(current, next)) return state;
      return { ...state, [action.key]: next };
    }
    case "configUnavailable":
      return { ...state, projectConfig: null, globalConfig: null, configError: null };
    case "configLoaded":
      return { ...state, projectConfig: action.project, globalConfig: action.global };
    case "configLoadError":
      return { ...state, projectConfig: null, globalConfig: null, configError: action.error };
  }
}
