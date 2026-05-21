import { create } from "zustand";

export const PERSISTED_UI_STATE_KEY = "openwork:ui-state:v1";
const SIDEBAR_COOKIE_NAME = "sidebar_state";

export const SIDE_PANEL_ITEMS = ["browser", "artifacts", "extensions"] as const;
export type SidePanelItem = (typeof SIDE_PANEL_ITEMS)[number];
export type SidePanelState = Record<string, SidePanelItem | null>;

export type PersistedUiState = {
  sidePanelState?: SidePanelState;
};

export type UiState = {
  sidebarOpen: boolean;
  sidePanelState: SidePanelState;
  applicationMenuVisible: boolean;
};

const initialState: UiState = {
  sidebarOpen: true,
  sidePanelState: {},
  applicationMenuVisible: false,
};

function isSidePanelItem(value: unknown): value is SidePanelItem {
  return SIDE_PANEL_ITEMS.includes(value as SidePanelItem);
}

function normalizeSidePanelState(value: unknown): SidePanelState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return initialState.sidePanelState;
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, SidePanelItem | null] => (
        typeof entry[0] === "string" && (entry[1] === null || isSidePanelItem(entry[1]))
      ),
    ),
  );
}

function readSidebarCookieOpen(): boolean | null {
  if (globalThis.window === undefined) {
    return null;
  }

  const prefix = `${SIDEBAR_COOKIE_NAME}=`;
  const cookie = window.document.cookie
    .split("; ")
    .find((row) => row.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  return cookie.slice(prefix.length) === "true";
}

function readPersistedUiState(): UiState {
  if (globalThis.window === undefined) {
    return initialState;
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_UI_STATE_KEY);
    const sidebarOpen = readSidebarCookieOpen() ?? initialState.sidebarOpen;

    if (!raw) {
      return { ...initialState, sidebarOpen };
    }

    const parsed: PersistedUiState = JSON.parse(raw);
    const sidePanelState = normalizeSidePanelState(parsed.sidePanelState);

    return {
      ...initialState,
      sidebarOpen,
      sidePanelState,
    };
  } catch {
    return initialState;
  }
}

export function persistUiState(state: UiState): void {
  if (globalThis.window === undefined) {
    return;
  }

  try {
    window.localStorage.setItem(
      PERSISTED_UI_STATE_KEY,
      JSON.stringify({
        sidePanelState: state.sidePanelState,
      } satisfies PersistedUiState),
    );
  } catch {
    return;
  }
}

export function setSidebarOpen(state: UiState, open: boolean): UiState {
  if (state.sidebarOpen === open) {
    return state;
  }

  return {
    ...state,
    sidebarOpen: open,
  };
}

export function toggleSidebar(state: UiState): UiState {
  return setSidebarOpen(state, !state.sidebarOpen);
}

export function getSidePanelState(state: UiState, sessionId: string | null | undefined): SidePanelItem | null {
  if (!sessionId) {
    return null;
  }

  return state.sidePanelState[sessionId] ?? null;
}

export function setSidePanelState(
  state: UiState,
  sessionId: string | null | undefined,
  panel: SidePanelItem | null,
): UiState {
  if (!sessionId || getSidePanelState(state, sessionId) === panel) {
    return state;
  }

  return {
    ...state,
    sidePanelState: {
      ...state.sidePanelState,
      [sessionId]: panel,
    },
  };
}

export function toggleSidePanelState(
  state: UiState,
  sessionId: string | null | undefined,
  panel: SidePanelItem,
): UiState {
  return setSidePanelState(state, sessionId, getSidePanelState(state, sessionId) === panel ? null : panel);
}

export function setApplicationMenuVisible(state: UiState, visible: boolean): UiState {
  if (state.applicationMenuVisible === visible) {
    return state;
  }

  return {
    ...state,
    applicationMenuVisible: visible,
  };
}

function syncApplicationMenuVisible(visible: boolean): void {
  void globalThis.window?.__OPENWORK_ELECTRON__?.invokeDesktop?.("__setApplicationMenuVisible", visible);
}

type UiStateStore = UiState & {
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidePanelState: (sessionId: string | null | undefined, panel: SidePanelItem | null) => void;
  toggleSidePanelState: (sessionId: string | null | undefined, panel: SidePanelItem) => void;
  setApplicationMenuVisible: (visible: boolean) => void;
};

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedUiState(),
  setSidebarOpen: (open) => set((state) => setSidebarOpen(state, open)),
  toggleSidebar: () => set((state) => toggleSidebar(state)),
  setSidePanelState: (sessionId, panel) => set((state) => setSidePanelState(state, sessionId, panel)),
  toggleSidePanelState: (sessionId, panel) => set((state) => toggleSidePanelState(state, sessionId, panel)),
  setApplicationMenuVisible: (visible) => {
    set((state) => setApplicationMenuVisible(state, visible));
    syncApplicationMenuVisible(visible);
  },
}));

syncApplicationMenuVisible(useUiStateStore.getState().applicationMenuVisible);

useUiStateStore.subscribe((state) => persistUiState(state));
