import { describe, expect, test } from "bun:test";

import {
  buildVisibleConversationSystemContext,
  composeSystemContexts,
  sanitizeVisibleContextBrowserUrl,
} from "../src/react-app/domains/session/sync/visible-context";

describe("buildVisibleConversationSystemContext", () => {
  test("labels horizontal split conversations by left and right without transcripts", () => {
    const context = buildVisibleConversationSystemContext({
      originSessionId: "ses_left",
      conversations: [
        { sessionId: "ses_left", title: "Launch notes", position: "left" },
        { sessionId: "ses_right", title: "Budget review", position: "right" },
      ],
    });

    expect(context).toContain('"originSessionId": "ses_left"');
    expect(context).toContain('"position": "left"');
    expect(context).toContain('"title": "Launch notes"');
    expect(context).toContain('"position": "right"');
    expect(context).toContain('"title": "Budget review"');
    expect(context).toContain("untrusted UI metadata only");
    expect(context).not.toContain("transcript:");
  });

  test("labels stacked split conversations by top and bottom", () => {
    const context = buildVisibleConversationSystemContext({
      originSessionId: "ses_bottom",
      conversations: [
        { sessionId: "ses_top", title: "Top plan", position: "top" },
        { sessionId: "ses_bottom", title: "Bottom plan", position: "bottom" },
      ],
    });

    expect(context).toContain('"originSessionId": "ses_bottom"');
    expect(context).toContain('"position": "bottom"');
    expect(context).toContain('"position": "top"');
    expect(context).not.toContain('"position": "right"');
  });

  test("distinguishes the right utility browser panel from the right conversation without page title", () => {
    const context = buildVisibleConversationSystemContext({
      originSessionId: "ses_left",
      conversations: [
        { sessionId: "ses_left", title: "Left chat", position: "left" },
        { sessionId: "ses_right", title: "Right chat", position: "right" },
      ],
      utilityPanel: {
        type: "browser",
        url: "https://Example.com/page?token=secret#private",
      },
    });

    expect(context).toContain('"position": "right"');
    expect(context).toContain('"title": "Right chat"');
    expect(context).toContain('"rightUtilityPanel"');
    expect(context).toContain('"kind": "browser"');
    expect(context).toContain('"url": "https://example.com/page"');
    expect(context).toContain("separate from any conversation");
    expect(context).not.toContain("Example Domain");
    expect(context).not.toContain("token=secret");
    expect(context).not.toContain("#private");
  });

  test("omits unsafe or malformed browser URLs", () => {
    expect(sanitizeVisibleContextBrowserUrl("data:text/html,secret")).toBeNull();
    expect(sanitizeVisibleContextBrowserUrl("file:///Users/me/report.html")).toBeNull();
    expect(sanitizeVisibleContextBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeVisibleContextBrowserUrl("blob:https://example.com/id")).toBeNull();
    expect(sanitizeVisibleContextBrowserUrl("not a url")).toBeNull();
  });

  test("strips credentials, query, and hash from browser URLs", () => {
    expect(sanitizeVisibleContextBrowserUrl("https://user:pass@example.com/path?token=secret#hash")).toEqual({
      url: "https://example.com/path",
      origin: "https://example.com",
    });
  });

  test("omits invalid browser panel metadata from system context", () => {
    const context = buildVisibleConversationSystemContext({
      originSessionId: "ses_left",
      conversations: [{ sessionId: "ses_left", title: "Left chat", position: "current" }],
      utilityPanel: { type: "browser", url: "file:///Users/me/secrets.html" },
    });

    expect(context).not.toContain("rightUtilityPanel");
    expect(context).not.toContain("secrets.html");
  });

  test("composes with existing environment context", () => {
    const context = composeSystemContexts([
      "OpenWork environment variables configured:\n- ANTHROPIC_API_KEY",
      buildVisibleConversationSystemContext({
        originSessionId: "ses_current",
        conversations: [
          { sessionId: "ses_current", title: "Current", position: "current" },
        ],
      }),
    ]);

    expect(context).toContain("OpenWork environment variables configured:");
    expect(context).toContain('"originSessionId": "ses_current"');
    expect(context).toContain('"title": "Current"');
  });
});
