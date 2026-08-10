import { afterEach, describe, expect, test } from "bun:test";

import {
  assertLocalManagedMcpUrl,
  createLocalManagedMcpGuardedFetch,
  isLocalManagedMcpPrivateAddress,
} from "./local-managed-mcp-url-guard.js";

const previousDevMode = process.env.OPENWORK_DEV_MODE;
const previousPrivateOverride = process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS;

afterEach(() => {
  if (previousDevMode === undefined) delete process.env.OPENWORK_DEV_MODE;
  else process.env.OPENWORK_DEV_MODE = previousDevMode;
  if (previousPrivateOverride === undefined) delete process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS;
  else process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS = previousPrivateOverride;
});

describe("local managed MCP outbound URL guard", () => {
  test("classifies private and reserved IPv4 and IPv6 ranges", () => {
    expect(isLocalManagedMcpPrivateAddress("127.0.0.1")).toBe(true);
    expect(isLocalManagedMcpPrivateAddress("169.254.169.254")).toBe(true);
    expect(isLocalManagedMcpPrivateAddress("192.168.1.10")).toBe(true);
    expect(isLocalManagedMcpPrivateAddress("::1")).toBe(true);
    expect(isLocalManagedMcpPrivateAddress("fc00::1")).toBe(true);
    expect(isLocalManagedMcpPrivateAddress("8.8.8.8")).toBe(false);
    expect(isLocalManagedMcpPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("requires public HTTPS outside explicit local development", async () => {
    delete process.env.OPENWORK_DEV_MODE;
    delete process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS;
    await expect(assertLocalManagedMcpUrl("http://127.0.0.1:3978/mcp")).rejects.toThrow("HTTPS");
    await expect(assertLocalManagedMcpUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow("private or reserved");
    await expect(assertLocalManagedMcpUrl("https://8.8.8.8/mcp")).resolves.toBeUndefined();
  });

  test("revalidates redirects and never follows one into a private network", async () => {
    delete process.env.OPENWORK_DEV_MODE;
    delete process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS;
    let requests = 0;
    const guarded = createLocalManagedMcpGuardedFetch(async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:80/private" } });
    });
    await expect(guarded("https://8.8.8.8/mcp")).rejects.toThrow("HTTPS");
    expect(requests).toBe(1);
  });

  test("blocks cross-origin redirects for credential-bearing request bodies", async () => {
    delete process.env.OPENWORK_DEV_MODE;
    delete process.env.OPENWORK_ALLOW_PRIVATE_MCP_URLS;
    let requests = 0;
    const guarded = createLocalManagedMcpGuardedFetch(async () => {
      requests += 1;
      return new Response(null, { status: 307, headers: { location: "https://1.1.1.1/token" } });
    });
    await expect(guarded("https://8.8.8.8/token", {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: "grant_type=refresh_token",
    })).rejects.toThrow("request body cannot be redirected");
    expect(requests).toBe(1);
  });
});
