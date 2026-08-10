import { afterEach, describe, expect, test } from "bun:test";

import { createDenClient, DenApiError } from "../src/app/lib/den";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
});

function mockResponse(status: number, payload: unknown) {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (async () => new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) satisfies typeof fetch,
  });
}

const versionMetadata = {
  minAppVersion: "0.18.0",
  latestAppVersion: "0.18.0",
  publishedDesktopVersions: ["0.18.0"],
};

describe("saved script client rollout compatibility", () => {
  test("does not contact additive routes until the stable version endpoint advertises them", async () => {
    const paths: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (async (input) => {
        paths.push(String(input));
        return new Response(JSON.stringify(versionMetadata), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) satisfies typeof fetch,
    });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).resolves.toBe(false);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(false);
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.endsWith("/v1/app-version"))).toBe(true);
  });

  test("keeps direct list reads compatible with an older Den", async () => {
    mockResponse(404, { error: "not_found", message: "Not found" });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.listSavedCodemodeScripts("org_test")).resolves.toEqual([]);
  });

  test("does not hide authentication or server failures as rollout fallback", async () => {
    mockResponse(503, { error: "unavailable", message: "Unavailable" });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).rejects.toBeInstanceOf(DenApiError);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).rejects.toBeInstanceOf(DenApiError);
  });

  test("enables Cloud Script Automations only when Den advertises the action", async () => {
    const paths: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (async (input) => {
        const path = String(input);
        paths.push(path);
        return new Response(JSON.stringify(path.endsWith("/v1/app-version")
          ? {
              ...versionMetadata,
              capabilities: {
                savedCodemodeScripts: true,
                savedScriptCloudAutomations: true,
              },
            }
          : { items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) satisfies typeof fetch,
    });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).resolves.toBe(true);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(true);
    expect(paths.filter((path) => path.endsWith("/v1/app-version"))).toHaveLength(2);
    expect(paths.filter((path) => path.endsWith("/v1/codemode-scripts"))).toHaveLength(2);
  });
});
