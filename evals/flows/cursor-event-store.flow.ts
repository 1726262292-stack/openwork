import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow } from "../runner/flow.ts";
import { loadVoiceoverParagraphs } from "../runner/voiceover.ts";

const FLOW_ID = "cursor-event-store";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vo = await loadVoiceoverParagraphs(FLOW_ID);
if (!vo) throw new Error("Missing approved voice-over script for cursor-event-store.");

type CommandResult = {
  status: number;
  output: string;
};

function witness(ctx: { recordEvidence: (entry: { type: "assertion"; status: "passed" | "failed"; assertion: string; actual?: string }) => unknown; assert: (condition: unknown, message: string) => void }, condition: boolean, assertion: string, actual?: string): void {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    ...(actual ? { actual } : {}),
  });
  ctx.assert(condition, assertion + (actual ? ` (actual: ${actual})` : ""));
}

function run(ctx: { output: (name: string, text: unknown) => unknown }, label: string, args: string[]): CommandResult {
  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  const status = typeof result.status === "number" ? result.status : -1;
  ctx.output(label, output);
  return { status, output };
}

function requireResult(result: CommandResult | null): CommandResult {
  if (!result) throw new Error("Expected command result");
  return result;
}

async function sourceSnippet(path: string, includes: string[]): Promise<string> {
  const source = await readFile(join(ROOT, path), "utf8");
  return source.split("\n").filter((line) => includes.some((item) => line.includes(item))).join("\n");
}

export default defineFlow({
  id: FLOW_ID,
  title: "One cursor primitive preserves local server event semantics",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Fresh stores start at a known cursor",
      run: async (ctx) => {
        let result: CommandResult | null = null;
        await ctx.prove("The generic event store starts at cursor 0 and assigns seq 1, then seq 2", {
          voiceover: vo[0],
          action: () => {
            result = run(ctx, "$ cursor primitive initial cursor test", [
              "--filter", "openwork-server", "exec", "bun", "test",
              "src/cursor-event-store.test.ts",
              "--test-name-pattern", "starts at cursor zero",
            ]);
          },
          assert: async () => {
            const command = requireResult(result);
            witness(ctx, command.status === 0, "The primitive initial-cursor test exits successfully", command.output.split("\n").at(-1));
            const snippet = await sourceSnippet("apps/server/src/cursor-event-store.test.ts", [
              "expect(store.cursor()).toBe(0)",
              "first\")).seq).toBe(1)",
              "second\")).seq).toBe(2)",
            ]);
            ctx.output("Initial cursor assertions", snippet);
            witness(ctx, snippet.includes("toBe(0)") && snippet.includes("toBe(1)") && snippet.includes("toBe(2)"), "The checked harness asserts cursor 0 and monotonic seq 1/2");
          },
        });
      },
    },
    {
      name: "Workspace readers get newer events in order",
      run: async (ctx) => {
        let result: CommandResult | null = null;
        await ctx.prove("The cursor list operation is workspace-scoped and treats since as exclusive", {
          voiceover: vo[1],
          action: () => {
            result = run(ctx, "$ cursor primitive workspace filter test", [
              "--filter", "openwork-server", "exec", "bun", "test",
              "src/cursor-event-store.test.ts",
              "--test-name-pattern", "filters by workspace",
            ]);
          },
          assert: async () => {
            const command = requireResult(result);
            witness(ctx, command.status === 0, "The workspace filter/since test exits successfully", command.output.split("\n").at(-1));
            const snippet = await sourceSnippet("apps/server/src/cursor-event-store.test.ts", [
              "store.list(\"ws_1\", first.seq)",
              "store.list(\"ws_2\")",
            ]);
            ctx.output("Workspace filter assertions", snippet);
            witness(ctx, snippet.includes("[\"second\"]") && snippet.includes("[\"other\"]"), "The checked harness asserts only newer same-workspace events are returned in order");
          },
        });
      },
    },
    {
      name: "Domain wrappers and routes keep their payloads",
      run: async (ctx) => {
        let result: CommandResult | null = null;
        await ctx.prove("Reload, session-group, and file-session wrappers keep their event payload contracts", {
          voiceover: vo[2],
          action: () => {
            result = run(ctx, "$ wrapper and route payload tests", [
              "--filter", "openwork-server", "exec", "bun", "test",
              "src/events.test.ts",
              "src/session-groups.e2e.test.ts",
              "src/file-sessions.test.ts",
              "src/file-sessions.e2e.test.ts",
            ]);
          },
          assert: async () => {
            const command = requireResult(result);
            witness(ctx, command.status === 0, "The wrapper and route payload tests exit successfully", command.output.split("\n").at(-1));
            const reloadSnippet = await sourceSnippet("apps/server/src/events.test.ts", ["reason: \"mcp\"", "trigger: { type: \"mcp\", name: \"server.json\" }"]);
            const groupSnippet = await sourceSnippet("apps/server/src/session-groups.e2e.test.ts", ["type: \"session_groups.updated\"", "action: \"assigned\""]);
            const fileSnippet = await sourceSnippet("apps/server/src/file-sessions.e2e.test.ts", ["toPath).toBe(\"notes/b.md\")", "workspaceId === \"ws_1\""]);
            ctx.output("Preserved domain payload assertions", [reloadSnippet, groupSnippet, fileSnippet].filter(Boolean).join("\n"));
            witness(ctx, reloadSnippet.includes("reason: \"mcp\"") && groupSnippet.includes("session_groups.updated") && fileSnippet.includes("notes/b.md"), "The checked harness asserts reload reason/trigger, session-group type/action, and file toPath/workspace payloads");
          },
        });
      },
    },
    {
      name: "Bounded buffers evict without leaking workspaces",
      run: async (ctx) => {
        let result: CommandResult | null = null;
        await ctx.prove("Bounded buffers evict old events while cursors continue and workspace scopes stay isolated", {
          voiceover: vo[3],
          action: () => {
            result = run(ctx, "$ cursor eviction and wrapper scoping tests", [
              "--filter", "openwork-server", "exec", "bun", "test",
              "src/cursor-event-store.test.ts",
              "src/events.test.ts",
              "src/session-groups.e2e.test.ts",
              "src/file-sessions.test.ts",
              "--test-name-pattern", "evicts|independent workspace|global cursor|buffered per workspace|buffers scoped",
            ]);
          },
          assert: async () => {
            const command = requireResult(result);
            witness(ctx, command.status === 0, "The eviction and scoping tests exit successfully", command.output.split("\n").at(-1));
            const primitiveSnippet = await sourceSnippet("apps/server/src/cursor-event-store.test.ts", ["toEqual([\"second\", \"third\"])", "store.cursor()).toBe(3)", "cursor(\"quiet\")"]);
            const wrapperSnippet = await sourceSnippet("apps/server/src/file-sessions.test.ts", ["maxEventsPerWorkspace: 2", "[\"second.md\", \"third.md\"]", "[\"quiet.md\"]"]);
            ctx.output("Eviction and no-leak assertions", [primitiveSnippet, wrapperSnippet].filter(Boolean).join("\n"));
            witness(ctx, primitiveSnippet.includes("second") && primitiveSnippet.includes("third") && wrapperSnippet.includes("quiet.md"), "The checked harness asserts bounded eviction, cursor continuity, and no cross-workspace leakage");
          },
        });
      },
    },
  ],
});
