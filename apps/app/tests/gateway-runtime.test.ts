import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { readDenBootstrapConfig, readDenSettings, resolveDenBaseUrls } from "../src/app/lib/den";
import {
  hydrateOpenworkServerSettingsFromEnv,
  readOpenworkServerSettings,
} from "../src/app/lib/openwork-server";
import { resolveOpenworkConnection } from "../src/react-app/shell/openwork-connection";

const originalWindow = globalThis.window;
const originalDeployment = process.env.VITE_OPENWORK_DEPLOYMENT;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function installWindow(options: {
  origin: string;
  gateway?: boolean;
  bootstrapToken?: string;
  electronInfo?: {
    baseUrl: string;
    ownerToken: string;
    hostToken?: string;
  };
}) {
  const localStorage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      location: { origin: options.origin },
      __OPENWORK_GATEWAY__: options.gateway ? { version: 1 } : undefined,
      __OPENWORK_BOOTSTRAP__: options.bootstrapToken ? { token: options.bootstrapToken } : undefined,
      __OPENWORK_ELECTRON__: options.electronInfo
        ? {
            invokeDesktop: async (command: string) => {
              if (command !== "openworkServerInfo") {
                throw new Error(`Unexpected desktop command: ${command}`);
              }
              return {
                running: true,
                baseUrl: options.electronInfo?.baseUrl,
                ownerToken: options.electronInfo?.ownerToken,
                hostToken: options.electronInfo?.hostToken,
              };
            },
          }
        : undefined,
    },
  });
  return localStorage;
}

describe("gateway runtime mode", () => {
  beforeEach(() => {
    process.env.VITE_OPENWORK_DEPLOYMENT = "web";
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    if (originalDeployment === undefined) {
      delete process.env.VITE_OPENWORK_DEPLOYMENT;
    } else {
      process.env.VITE_OPENWORK_DEPLOYMENT = originalDeployment;
    }
  });

  test("resolves OpenWork server traffic through the gateway origin with the Den session token", async () => {
    const storage = installWindow({ origin: "https://web.openworklabs.com", gateway: true });
    storage.setItem("openwork.den.authToken", "den-session-token");
    storage.setItem("openwork.server.urlOverride", "https://direct-instance.example.com");
    storage.setItem("openwork.server.token", "stale-instance-token");

    const connection = await resolveOpenworkConnection();

    expect(connection).toEqual({
      normalizedBaseUrl: "https://web.openworklabs.com",
      resolvedToken: "den-session-token",
      resolvedHostToken: "",
      hostInfo: null,
      source: "gateway",
    });
  });

  test("keeps Den API calls on the gateway origin and ignores stale Den storage", () => {
    const storage = installWindow({ origin: "https://web.openworklabs.com", gateway: true });
    storage.setItem("openwork.den.baseUrl", "https://app.openworklabs.com");
    storage.setItem("openwork.den.authToken", "den-session-token");

    expect(resolveDenBaseUrls("https://app.openworklabs.com")).toEqual({
      baseUrl: "https://web.openworklabs.com",
      apiBaseUrl: "https://web.openworklabs.com/api/den",
    });
    expect(readDenSettings().baseUrl).toBe("https://web.openworklabs.com");
    expect(readDenSettings().apiBaseUrl).toBe("https://web.openworklabs.com/api/den");
    expect(readDenSettings().authToken).toBe("den-session-token");
  });

  test("returns a stable gateway bootstrap snapshot for React external stores", () => {
    installWindow({ origin: "https://web.openworklabs.com", gateway: true });

    const first = readDenBootstrapConfig();
    const second = readDenBootstrapConfig();

    expect(second).toBe(first);
    expect(first.baseUrl).toBe("https://web.openworklabs.com");
    expect(first.apiBaseUrl).toBe("https://web.openworklabs.com/api/den");
  });

  test("does not hydrate an instance bootstrap token into server storage behind the gateway", () => {
    const storage = installWindow({
      origin: "https://web.openworklabs.com",
      gateway: true,
      bootstrapToken: "instance-token-must-not-store",
    });

    hydrateOpenworkServerSettingsFromEnv();

    expect(storage.getItem("openwork.server.token")).toBeNull();
    expect(readOpenworkServerSettings().token).toBeUndefined();
  });
});

describe("non-gateway connection modes", () => {
  beforeEach(() => {
    process.env.VITE_OPENWORK_DEPLOYMENT = "web";
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    if (originalDeployment === undefined) {
      delete process.env.VITE_OPENWORK_DEPLOYMENT;
    } else {
      process.env.VITE_OPENWORK_DEPLOYMENT = originalDeployment;
    }
  });

  test("direct instance bootstrap hydration and same-origin resolution are unchanged without the marker", async () => {
    installWindow({ origin: "https://instance.example.com", bootstrapToken: "instance-token" });

    hydrateOpenworkServerSettingsFromEnv();
    const connection = await resolveOpenworkConnection();

    expect(readOpenworkServerSettings().token).toBe("instance-token");
    expect(connection.normalizedBaseUrl).toBe("https://instance.example.com");
    expect(connection.resolvedToken).toBe("instance-token");
    expect(connection.source).toBe("same-origin");
  });

  test("stored server settings still win without the marker", async () => {
    const storage = installWindow({ origin: "https://instance.example.com" });
    storage.setItem("openwork.server.urlOverride", "https://manual.example.com");
    storage.setItem("openwork.server.token", "manual-token");
    storage.setItem("openwork.server.hostToken", "host-token");

    const connection = await resolveOpenworkConnection();

    expect(connection.normalizedBaseUrl).toBe("https://manual.example.com");
    expect(connection.resolvedToken).toBe("manual-token");
    expect(connection.resolvedHostToken).toBe("");
    expect(connection.source).toBe("stored-settings");
  });

  test("desktop runtime still uses live desktop server info without the marker", async () => {
    installWindow({
      origin: "https://instance.example.com",
      electronInfo: {
        baseUrl: "http://127.0.0.1:8787",
        ownerToken: "owner-token",
        hostToken: "host-token",
      },
    });

    const connection = await resolveOpenworkConnection();

    expect(connection.normalizedBaseUrl).toBe("http://127.0.0.1:8787");
    expect(connection.resolvedToken).toBe("owner-token");
    expect(connection.resolvedHostToken).toBe("host-token");
    expect(connection.source).toBe("desktop-runtime");
  });
});
