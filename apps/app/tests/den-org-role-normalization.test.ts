import { afterEach, describe, expect, test } from "bun:test";

import { createDenClient, normalizeDenOrgRole } from "../src/app/lib/den";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});

describe("normalizeDenOrgRole", () => {
  test("normalizes server role strings to desktop roles", () => {
    expect(normalizeDenOrgRole("owner")).toBe("owner");
    expect(normalizeDenOrgRole("super-admin")).toBe("admin");
    expect(normalizeDenOrgRole("admin")).toBe("admin");
    expect(normalizeDenOrgRole("member")).toBe("member");
    expect(normalizeDenOrgRole("owner,role_x")).toBe("owner");
    expect(normalizeDenOrgRole("role_x,super-admin")).toBe("admin");
    expect(normalizeDenOrgRole(" super-admin , role_x ")).toBe("admin");
    expect(normalizeDenOrgRole("role_x")).toBe("member");
    expect(normalizeDenOrgRole("")).toBe("member");
    expect(normalizeDenOrgRole(undefined)).toBe("member");
    expect(normalizeDenOrgRole(42)).toBe("member");
  });
});

describe("Den organization list", () => {
  test("keeps a super-admin organization with an admin role", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(JSON.stringify({
        orgs: [{ id: "org_1", name: "Acme Robotics", slug: "acme", role: "super-admin" }],
        activeOrgId: "org_1",
        activeOrgSlug: "acme",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await createDenClient({
      baseUrl: "https://den.example.com",
      token: "tok_test",
    }).listOrgs();

    expect(response.orgs).toEqual([
      { id: "org_1", name: "Acme Robotics", slug: "acme", role: "admin" },
    ]);
    expect(response.rawOrgCount).toBe(1);
  });

  test("drops malformed organizations while preserving the raw count", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(JSON.stringify({
        orgs: [{ role: "member" }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await createDenClient({
      baseUrl: "https://den.example.com",
      token: "tok_test",
    }).listOrgs();

    expect(response.orgs).toEqual([]);
    expect(response.rawOrgCount).toBe(1);
  });
});
