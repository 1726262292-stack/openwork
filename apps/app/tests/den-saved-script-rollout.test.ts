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

describe("saved script client rollout compatibility", () => {
  test("treats an older Den without saved-script routes as unsupported", async () => {
    mockResponse(404, { error: "not_found", message: "Not found" });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).resolves.toBe(false);
    await expect(client.listSavedCodemodeScripts("org_test")).resolves.toEqual([]);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(false);
  });

  test("does not hide authentication or server failures as rollout fallback", async () => {
    mockResponse(503, { error: "unavailable", message: "Unavailable" });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).rejects.toBeInstanceOf(DenApiError);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).rejects.toBeInstanceOf(DenApiError);
  });

  test("enables Cloud Script Automations only when Den advertises the action", async () => {
    mockResponse(200, { version: 1, actions: { agentDesktop: true, savedScriptCloud: true } });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(true);
  });
});
