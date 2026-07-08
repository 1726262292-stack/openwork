declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => { toBe: (expected: unknown) => void };

import {
  canDisconnectNativeProviderAccount,
  isNativeProviderConnectionId,
} from "./native-provider-connections";

describe("native provider connections", () => {
  test("recognizes the Google Workspace native provider id", () => {
    expect(isNativeProviderConnectionId("google-workspace")).toBe(true);
    expect(isNativeProviderConnectionId("emc_google_workspace")).toBe(false);
  });

  test("shows disconnect only for the connected calling member", () => {
    expect(canDisconnectNativeProviderAccount({ id: "google-workspace", connectedForMe: true })).toBe(true);
    expect(canDisconnectNativeProviderAccount({ id: "google-workspace", connectedForMe: false })).toBe(false);
    expect(canDisconnectNativeProviderAccount({ id: "emc_google_workspace", connectedForMe: true })).toBe(false);
  });
});
