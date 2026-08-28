import { describe, expect, test } from "bun:test";

import {
  assertOpencodeProxyAllowed,
  normalizeOpencodeDirectory,
  scopeWorkspaceOpencodeRequest,
} from "./server.js";
import { ApiError } from "./errors.js";
import type { Actor, TokenScope } from "./types.js";

const actor = (scope: TokenScope | undefined): Actor => ({ type: "remote", scope });

const PERMISSION_REPLY_PATH = "/opencode/permission/req_123/reply";

describe("assertOpencodeProxyAllowed", () => {
  test("collaborators can reply to permission requests (#1918)", () => {
    // The SPA's only credential is the collaborator-scoped client token
    // (OPENWORK_TOKEN); an owner-only gate made every permission dialog
    // un-answerable.
    expect(() =>
      assertOpencodeProxyAllowed(actor("collaborator"), "POST", PERMISSION_REPLY_PATH),
    ).not.toThrow();
  });

  test("owners can reply to permission requests", () => {
    expect(() =>
      assertOpencodeProxyAllowed(actor("owner"), "POST", PERMISSION_REPLY_PATH),
    ).not.toThrow();
  });

  test("viewers cannot send any mutating request", () => {
    expect(() =>
      assertOpencodeProxyAllowed(actor("viewer"), "POST", PERMISSION_REPLY_PATH),
    ).toThrow(ApiError);
    expect(() =>
      assertOpencodeProxyAllowed(actor("viewer"), "POST", "/opencode/session/s1/command"),
    ).toThrow(ApiError);
  });

  test("viewers can still read", () => {
    expect(() =>
      assertOpencodeProxyAllowed(actor("viewer"), "GET", "/opencode/permission"),
    ).not.toThrow();
  });

  test("missing scope defaults to viewer (read-only)", () => {
    expect(() =>
      assertOpencodeProxyAllowed(actor(undefined), "POST", PERMISSION_REPLY_PATH),
    ).toThrow(ApiError);
    expect(() =>
      assertOpencodeProxyAllowed(actor(undefined), "GET", "/opencode/permission"),
    ).not.toThrow();
  });
});

describe("scopeWorkspaceOpencodeRequest", () => {
  test("overwrites caller-controlled directory headers and query parameters", () => {
    const scoped = scopeWorkspaceOpencodeRequest(
      new Headers({ "x-opencode-directory": "/tmp/foreign" }),
      "?directory=%2Ftmp%2Fforeign&roots=true&directory=%2Ftmp%2Fother",
      "/tmp/workspace",
    );

    expect(scoped.headers.get("x-opencode-directory")).toBe("/tmp/workspace");
    expect(new URLSearchParams(scoped.search).getAll("directory")).toEqual(["/tmp/workspace"]);
    expect(new URLSearchParams(scoped.search).get("roots")).toBe("true");
  });

  test("removes caller-controlled directory scope when a workspace has no engine directory", () => {
    const scoped = scopeWorkspaceOpencodeRequest(
      new Headers({ "X-OpenCode-Directory": "/tmp/foreign" }),
      "?directory=%2Ftmp%2Fforeign&limit=10",
      null,
    );

    expect(scoped.headers.has("x-opencode-directory")).toBe(false);
    expect(new URLSearchParams(scoped.search).has("directory")).toBe(false);
    expect(new URLSearchParams(scoped.search).get("limit")).toBe("10");
  });

  test("encodes non-ASCII directory headers while preserving the query value", () => {
    const directory = "/tmp/项目";
    const scoped = scopeWorkspaceOpencodeRequest(new Headers(), "", directory);

    expect(scoped.headers.get("x-opencode-directory")).toBe(encodeURIComponent(directory));
    expect(new URLSearchParams(scoped.search).get("directory")).toBe(directory);
  });
});

describe("normalizeOpencodeDirectory", () => {
  test("removes Windows extended-length prefixes", () => {
    expect(normalizeOpencodeDirectory("\\\\?\\C:\\Users\\agent\\repo", "win32"))
      .toBe("C:\\Users\\agent\\repo");
    expect(normalizeOpencodeDirectory("//?/C:/Users/agent/repo", "win32"))
      .toBe("C:/Users/agent/repo");
  });

  test("leaves paths unchanged on non-Windows platforms", () => {
    expect(normalizeOpencodeDirectory("\\\\?\\C:\\Users\\agent\\repo", "darwin"))
      .toBe("\\\\?\\C:\\Users\\agent\\repo");
  });
});
