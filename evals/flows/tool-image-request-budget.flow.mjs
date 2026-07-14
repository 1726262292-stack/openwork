import { execFile as execFileCallback } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const execFile = promisify(execFileCallback);
const FLOW_ID = "tool-image-request-budget";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const PROBE_SCRIPT = String.raw`
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { OpenWorkMediaBudget } = await import("./apps/server/src/opencode-plugins/openwork-media-budget.ts");
  const { buildOpenworkRuntimeConfigObject } = await import("./apps/server/src/openwork-runtime-config.ts");
  const { openworkMediaBudgetPluginPath, openworkPluginPath } = await import("./apps/server/src/openwork-extensions-plugin-path.ts");
  const budget = 180;
  const dataUrl = (bytes, fill) => "data:image/png;base64," + fill.repeat(bytes);
  const packageJson = JSON.parse(await readFile("./apps/server/package.json", "utf8"));
  const runtimeConfig = await buildOpenworkRuntimeConfigObject();
  const runtimePlugins = Array.isArray(runtimeConfig.plugin) ? runtimeConfig.plugin : [];
  const runtimePath = openworkMediaBudgetPluginPath();
  const builtPath = openworkPluginPath("openwork-media-budget", join(process.cwd(), "apps/server/dist"));
  const buildScript = typeof packageJson.scripts?.build === "string" ? packageJson.scripts.build : "";
  const runtime = {
    registered: runtimePlugins.includes(runtimePath),
    runtimePath,
    registeredIndex: runtimePlugins.indexOf(runtimePath),
    builtPath,
    builtPathUsesJs: builtPath.endsWith("opencode-plugins/openwork-media-budget.js") || builtPath.endsWith("opencode-plugins\\openwork-media-budget.js"),
    buildScriptIncludesPlugin: buildScript.includes("src/opencode-plugins/openwork-media-budget.ts"),
  };
  const messages = [
    {
      info: { id: "u_old", role: "user" },
      parts: [{ id: "part_user_old", type: "file", mime: "image/png", filename: "old-user.png", url: dataUrl(120, "A") }],
    },
    {
      info: { id: "a_tools", role: "assistant" },
      parts: [{
        id: "part_tool_images",
        type: "tool",
        tool: "fixture_image_tool",
        callID: "call_images",
        state: {
          status: "completed",
          input: {},
          output: "Generated comparison images.",
          attachments: [
            { type: "file", mime: "image/png", filename: "older-tool.png", url: dataUrl(120, "B") },
            { type: "file", mime: "image/png", filename: "newest-tool.png", url: dataUrl(120, "C") },
          ],
          time: { start: 1, end: 2 },
        },
      }],
    },
  ];

  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const imageBytes = (record) => {
    if (!isRecord(record) || typeof record.mime !== "string" || !record.mime.startsWith("image/")) return 0;
    if (typeof record.url !== "string" || !record.url.startsWith("data:")) return 0;
    const marker = ";base64,";
    const markerIndex = record.url.indexOf(marker);
    return markerIndex === -1 ? 0 : record.url.slice(markerIndex + marker.length).length;
  };
  const attachmentList = (part) => {
    if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)) return [];
    return Array.isArray(part.state.attachments) ? part.state.attachments : [];
  };
  const allParts = (items) => items.flatMap((message) => Array.isArray(message.parts) ? message.parts : []);
  const encodedInlineImageBytes = (items) => allParts(items).reduce((total, part) => {
    if (!isRecord(part)) return total;
    if (part.type === "file") return total + imageBytes(part);
    return total + attachmentList(part).reduce((sum, attachment) => sum + imageBytes(attachment), 0);
  }, 0);
  const attachmentCount = (items) => allParts(items).reduce((total, part) => total + attachmentList(part).length, 0);
  const placeholderCount = (items) => (JSON.stringify(items).match(/OpenWork omitted image/g) ?? []).length;
  const fakeProvider = (items) => {
    const bytes = encodedInlineImageBytes(items);
    const serialized = JSON.stringify({ messages: items });
    if (bytes > budget) {
      return {
        ok: false,
        encodedInlineImageBytes: bytes,
        attachmentCount: attachmentCount(items),
        placeholderCount: placeholderCount(items),
        error: "malformed-body: encoded inline image payload " + bytes + " exceeds proxy request budget " + budget,
      };
    }
    return {
      ok: true,
      encodedInlineImageBytes: bytes,
      attachmentCount: attachmentCount(items),
      placeholderCount: placeholderCount(items),
      bodyJsonValid: true,
      bodyLength: serialized.length,
    };
  };

  const before = fakeProvider(messages);
  const plugin = await OpenWorkMediaBudget(undefined, { inlineImageBudgetBytes: budget });
  const output = { messages: structuredClone(messages) };
  await plugin["experimental.chat.messages.transform"]({}, output);
  const after = fakeProvider(output.messages);
  const once = JSON.stringify(output.messages);
  await plugin["experimental.chat.messages.transform"]({}, output);
  const twice = JSON.stringify(output.messages);

  const transformedSummary = output.messages.map((message) => ({
    role: message.info?.role,
    parts: (message.parts ?? []).map((part) => {
      if (!isRecord(part)) return { type: typeof part };
      if (part.type === "tool" && isRecord(part.state)) {
        return {
          type: "tool",
          output: part.state.output,
          attachments: Array.isArray(part.state.attachments)
            ? part.state.attachments.map((attachment) => isRecord(attachment) ? attachment.filename : "unknown")
            : [],
        };
      }
      return { type: part.type, text: part.text, filename: part.filename };
    }),
  }));

  console.log(JSON.stringify({ budget, runtime, before, after, idempotent: once === twice, transformedSummary }, null, 2));
`;

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

async function probeBudgetTransform() {
  const { stdout } = await execFile("bun", ["-e", PROBE_SCRIPT], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

function witness(ctx, condition, assertion, actual) {
  const detail = actual === undefined ? undefined : String(actual);
  if (!condition) {
    ctx.recordEvidence({ type: "assertion", status: "failed", assertion, actual: detail });
    ctx.assert(false, assertion + (detail ? ` (actual: ${detail})` : ""));
  }
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual: detail });
}

export default {
  id: FLOW_ID,
  title: "Runtime media budget omits old inline tool images before provider serialization",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "The fixture reproduces an oversized image request",
      run: async (ctx) => {
        let result = null;
        await ctx.prove("A replayed user image plus tool images can exceed the request image budget before serialization", {
          voiceover: vo[0],
          action: async () => {
            result = await probeBudgetTransform();
            ctx.output("probe result", pretty(result));
          },
          assert: async () => {
            witness(ctx, result.before.ok === false, "The unprotected request is rejected by the fake provider", pretty(result.before));
            witness(ctx, result.before.encodedInlineImageBytes > result.budget, "Encoded inline image bytes exceed the eval request budget", `${result.before.encodedInlineImageBytes} > ${result.budget}`);
            witness(ctx, String(result.before.error).includes("malformed-body"), "The simulated failure uses the reported malformed-body class", result.before.error);
          },
        });
      },
    },
    {
      name: "The request transform keeps newest media and communicates omissions",
      run: async (ctx) => {
        let result = null;
        await ctx.prove("The transformed provider body is valid JSON under budget with text placeholders for omitted images", {
          voiceover: vo[1],
          action: async () => {
            result = await probeBudgetTransform();
            ctx.output("runtime integration + transformed request summary", pretty({ runtime: result.runtime, transformedSummary: result.transformedSummary }));
          },
          assert: async () => {
            witness(ctx, result.runtime.registered === true, "The real OpenWork runtime config registers the media-budget plugin", pretty(result.runtime));
            witness(ctx, result.runtime.builtPathUsesJs === true, "The plugin path helper resolves a built dist plugin to .js", result.runtime.builtPath);
            witness(ctx, result.runtime.buildScriptIncludesPlugin === true, "The server build bundles openwork-media-budget into dist/opencode-plugins", result.runtime.builtPath);
            witness(ctx, result.after.ok === true, "The transformed request is accepted by the fake provider", pretty(result.after));
            witness(ctx, result.after.bodyJsonValid === true, "The transformed provider body serializes as valid JSON");
            witness(ctx, result.after.encodedInlineImageBytes <= result.budget, "Remaining encoded inline image bytes stay within budget", `${result.after.encodedInlineImageBytes} <= ${result.budget}`);
            witness(ctx, result.after.attachmentCount === 1, "Only the newest image attachment remains", String(result.after.attachmentCount));
            witness(ctx, result.after.placeholderCount >= 2, "Omitted images are communicated with compact text placeholders", String(result.after.placeholderCount));
          },
        });
      },
    },
    {
      name: "Replaying transformed history is deterministic",
      run: async (ctx) => {
        let result = null;
        await ctx.prove("A second request transform leaves the already-cleaned history unchanged", {
          voiceover: vo[2],
          action: async () => {
            result = await probeBudgetTransform();
            ctx.output("idempotence", pretty({ idempotent: result.idempotent, after: result.after }));
          },
          assert: async () => {
            witness(ctx, result.idempotent === true, "Repeated transforms are deterministic and idempotent");
            witness(ctx, result.after.placeholderCount >= 2, "Placeholders are not duplicated or lost on replay", String(result.after.placeholderCount));
          },
        });
      },
    },
  ],
};
