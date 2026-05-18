import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  classifyOpenTarget,
  deriveOpenTargets,
  shouldAutoOpenTarget,
} from "../src/react-app/domains/session/artifacts/open-target";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text, state: "done" }] };
}

describe("open target classification", () => {
  it("routes common artifact formats to deterministic previews", () => {
    expect(classifyOpenTarget("report.md", "file")).toBe("markdown");
    expect(classifyOpenTarget("customers.csv", "file")).toBe("sheet");
    expect(classifyOpenTarget("forecast.xlsx", "file")).toBe("sheet");
    expect(classifyOpenTarget("diagram.svg", "file")).toBe("image");
    expect(classifyOpenTarget("dist/index.html", "file")).toBe("html");
    expect(classifyOpenTarget("http://localhost:5173", "url")).toBe("browser");
  });
});

describe("deriveOpenTargets", () => {
  it("extracts file and localhost URL targets from recent assistant output", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "Created reports/revenue.xlsx and started http://localhost:5173 for preview."),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/revenue.xlsx");
    expect(targets.map((target) => target.value)).toContain("http://localhost:5173");
    expect(targets.find((target) => target.value === "reports/revenue.xlsx")?.preview).toBe("sheet");
  });

  it("extracts websocket URLs so local socket/dev-server hints stay visible", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "Socket open at ws://localhost:5173/socket and preview at dist/index.html"),
    ]);

    expect(targets.map((target) => target.value)).toContain("ws://localhost:5173/socket");
    expect(targets.map((target) => target.value)).toContain("dist/index.html");
  });

  it("normalizes Workspace/<id>/ prefixes from artifact paths", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "See Workspace/32423/reports/artifact-eval.md and Workspace/32423/reports/artifact-eval.csv"),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/artifact-eval.md");
    expect(targets.map((target) => target.value)).toContain("reports/artifact-eval.csv");
  });

  it("prefers explicit dynamic tool metadata over prose guesses", () => {
    const targets = deriveOpenTargets([
      {
        id: "msg_tool",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "tool_1",
          state: "output-available",
          input: { path: "summary.md" },
          output: { path: "summary.md" },
        } as any],
      },
    ]);

    expect(targets[0]).toMatchObject({ value: "summary.md", preview: "markdown", confidence: 95 });
  });

  it("auto-opens high-confidence deliverables and localhost previews only", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "Created data/customers.csv and see https://example.com for docs."),
    ]);
    const csv = targets.find((target) => target.value === "data/customers.csv");
    const externalUrl = targets.find((target) => target.value === "https://example.com");

    expect(csv && shouldAutoOpenTarget({ ...csv, exists: true })).toBe(true);
    expect(csv && shouldAutoOpenTarget({ ...csv, exists: false })).toBe(false);
    expect(externalUrl && shouldAutoOpenTarget(externalUrl)).toBe(false);
  });
});
