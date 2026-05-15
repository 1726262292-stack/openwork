/** @jsxImportSource react */
import { createContext, useCallback, use, useMemo, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * User-level layout preferences stored in localStorage.
 * Each key can be overridden by the org's cloud config (DesktopConfig).
 * When cloud sets a value, it takes precedence — see useEffectiveConfig.
 */
export type ShellConfig = {
  /** Show the bottom status bar (connection status, docs, feedback). */
  statusBar: boolean;
  /** Show the Docs button in the status bar. */
  docsButton: boolean;
  /** Show the Feedback button in the status bar. */
  feedbackButton: boolean;
  /** Show the Cloud sign-in button when not signed in. */
  cloudSignin: boolean;
  /** Show starter task cards in empty sessions. */
  starterCards: boolean;
  /** Show the model picker / model change UI. */
  modelPicker: boolean;
  /** Show the "Add workspace" button. */
  addWorkspace: boolean;
};

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_SHELL_CONFIG: ShellConfig = {
  statusBar: true,
  docsButton: true,
  feedbackButton: true,
  cloudSignin: true,
  starterCards: true,
  modelPicker: true,
  addWorkspace: true,
};

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "openwork.shell-config";

export function readShellConfig(): ShellConfig {
  if (typeof window === "undefined") return DEFAULT_SHELL_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHELL_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SHELL_CONFIG, ...parsed };
  } catch {
    return DEFAULT_SHELL_CONFIG;
  }
}

function writeShellConfig(config: ShellConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors.
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type ShellConfigContextValue = {
  config: ShellConfig;
  update: (patch: Partial<ShellConfig>) => void;
  reset: () => void;
};

const ShellConfigContext = createContext<ShellConfigContextValue | undefined>(undefined);

export function ShellConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ShellConfig>(readShellConfig);

  const update = useCallback((patch: Partial<ShellConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      writeShellConfig(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_SHELL_CONFIG);
    writeShellConfig(DEFAULT_SHELL_CONFIG);
  }, []);

  const value = useMemo<ShellConfigContextValue>(
    () => ({ config, update, reset }),
    [config, update, reset],
  );

  return (
    <ShellConfigContext.Provider value={value}>
      {children}
    </ShellConfigContext.Provider>
  );
}

export function useShellConfig(): ShellConfigContextValue {
  const ctx = use(ShellConfigContext);
  if (!ctx) {
    throw new Error("useShellConfig must be used within a ShellConfigProvider");
  }
  return ctx;
}
