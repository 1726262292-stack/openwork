import { describe, expect, test } from "bun:test";

import { denApiCredentialsForEndpoint, denApiEndpointForWebOrigin, denApiOriginForWebOrigin } from "../app/(den)/_lib/den-api-origin";

describe("Den API browser origin", () => {
  test("prefixes the hosted app origin with the api subdomain", () => {
    expect(denApiOriginForWebOrigin("https://app.openworklabs.com")).toBe("https://api.app.openworklabs.com");
  });

  test("prefixes custom web hosts with the api subdomain", () => {
    expect(denApiOriginForWebOrigin("https://den.example.com")).toBe("https://api.den.example.com");
  });

  test("leaves existing api hosts stable", () => {
    expect(denApiOriginForWebOrigin("https://api.openworklabs.com")).toBe("https://api.openworklabs.com");
  });

  test("builds direct API URLs instead of same-origin proxy URLs", () => {
    expect(denApiEndpointForWebOrigin("/v1/me", "https://app.openworklabs.com")).toBe("https://api.app.openworklabs.com/v1/me");
    expect(denApiEndpointForWebOrigin("/api/auth/sign-in/email", "https://app.openworklabs.com")).toBe(
      "https://api.app.openworklabs.com/api/auth/sign-in/email",
    );
  });

  test("omits cookies for direct API-origin browser requests", () => {
    expect(denApiCredentialsForEndpoint("https://api.app.openworklabs.com/v1/me", "https://app.openworklabs.com")).toBe("omit");
    expect(denApiCredentialsForEndpoint("/api/runtime-config", "https://app.openworklabs.com")).toBe("include");
  });
});
