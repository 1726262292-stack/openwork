import { describe, expect, test } from "bun:test";

import { normalizeMcpRemoteUrl } from "../src/app/utils/mcp-url";

describe("normalizeMcpRemoteUrl", () => {
  test("trims input and strips trailing hostname dots", () => {
    expect(normalizeMcpRemoteUrl("  https://us.posthog.com./mcp  ")).toBe("https://us.posthog.com/mcp");
    expect(normalizeMcpRemoteUrl("https://us.posthog.com.../mcp")).toBe("https://us.posthog.com/mcp");
  });

  test("normalizes hostname case and preserves path, query, and port", () => {
    expect(normalizeMcpRemoteUrl("HTTPS://US.PostHog.COM.:8443/mcp/v1/?feature=a%2Fb&flag=1")).toBe(
      "https://us.posthog.com:8443/mcp/v1/?feature=a%2Fb&flag=1",
    );
  });

  test("keeps already canonical and invalid inputs otherwise unchanged after trimming", () => {
    expect(normalizeMcpRemoteUrl("https://us.posthog.com/mcp?feature=analytics")).toBe(
      "https://us.posthog.com/mcp?feature=analytics",
    );
    expect(normalizeMcpRemoteUrl("https://us.posthog.com")).toBe("https://us.posthog.com");
    expect(normalizeMcpRemoteUrl("  not a url  ")).toBe("not a url");
  });
});
