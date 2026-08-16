import { describe, expect, test } from "bun:test";
import { ApiError } from "./errors.js";
import { unwrapOpencodeResult } from "./server.js";

describe("unwrapOpencodeResult", () => {
  test("preserves OpenCode client errors that do not include a response", () => {
    const upstreamError = { message: "fetch failed" };

    try {
      unwrapOpencodeResult({ data: undefined, error: upstreamError }, "/session");
      throw new Error("expected unwrapOpencodeResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (!(error instanceof ApiError)) return;

      expect(error.status).toBe(502);
      expect(error.code).toBe("opencode_request_failed");
      expect(error.details).toEqual({ body: upstreamError, path: "/session" });
    }
  });
});
