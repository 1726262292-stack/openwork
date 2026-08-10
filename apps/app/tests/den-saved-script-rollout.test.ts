import { afterEach, describe, expect, test } from "bun:test";

import { createDenClient, DenApiError } from "../src/app/lib/den";

const originalFetch = globalThis.fetch;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
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
  test("does not let a published desktop contact additive Den routes", async () => {
    const paths: string[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __OPENWORK_ELECTRON__: {} },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (async (input) => {
        paths.push(String(input));
        throw new Error("desktop rollout gate contacted Den");
      }) satisfies typeof fetch,
    });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).resolves.toBe(false);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(false);
    expect(paths).toHaveLength(0);
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

  test("enables the web control surface only after Den serves saved scripts", async () => {
    const paths: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: (async (input) => {
        const path = String(input);
        paths.push(path);
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) satisfies typeof fetch,
    });
    const client = createDenClient({ baseUrl: "https://den.test", token: "tok_test" });

    await expect(client.supportsSavedCodemodeScripts("org_test")).resolves.toBe(true);
    await expect(client.supportsCloudSavedScriptAutomations("org_test")).resolves.toBe(true);
    expect(paths.filter((path) => path.endsWith("/v1/codemode-scripts"))).toHaveLength(2);
  });
});
