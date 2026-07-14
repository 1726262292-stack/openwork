import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenWorkMediaBudget } from "./openwork-media-budget.js";

type FixtureMessage = Record<string, unknown> & {
  info: Record<string, unknown>;
  parts: unknown[];
};

const SESSION_ID = "ses_fixture";

function messageId(id: string): string {
  return `msg_${id}`;
}

function partId(id: string): string {
  return `prt_${id}`;
}

function dataUrl(encodedBytes: number, fill = "A"): string {
  if (encodedBytes % 4 !== 0) throw new Error("fixture base64 payload length must be structurally valid");
  return `data:image/png;base64,${fill.repeat(encodedBytes)}`;
}

function userImageMessage(id: string, filename: string, encodedBytes: number, fill?: string): FixtureMessage {
  return {
    info: { id: messageId(id), sessionID: SESSION_ID, role: "user" },
    parts: [
      {
        id: partId(id),
        sessionID: SESSION_ID,
        messageID: messageId(id),
        type: "file",
        mime: "image/png",
        filename,
        url: dataUrl(encodedBytes, fill),
      },
    ],
  };
}

function toolImageMessage(
  id: string,
  images: Array<{ filename: string; encodedBytes: number; fill?: string }>,
  options?: { compacted?: unknown },
): FixtureMessage {
  return {
    info: { id: messageId(id), sessionID: SESSION_ID, role: "assistant" },
    parts: [
      {
        id: partId(id),
        sessionID: SESSION_ID,
        messageID: messageId(id),
        type: "tool",
        tool: "fixture_image_tool",
        callID: `call_${id}`,
        state: {
          status: "completed",
          input: {},
          output: "Tool returned image attachments.",
          title: "fixture images",
          metadata: {},
          attachments: images.map((image) => ({
            type: "file",
            id: partId(`${id}_${image.filename}`),
            sessionID: SESSION_ID,
            messageID: messageId(id),
            mime: "image/png",
            filename: image.filename,
            url: dataUrl(image.encodedBytes, image.fill),
          })),
          time: { start: 1, end: 2, ...(options?.compacted === undefined ? {} : { compacted: options.compacted }) },
        },
      },
    ],
  };
}

function textMessage(id: string): FixtureMessage {
  return {
    info: { id: messageId(id), sessionID: SESSION_ID, role: "user" },
    parts: [{ id: partId(id), sessionID: SESSION_ID, messageID: messageId(id), type: "text", text: "hello" }],
  };
}

async function transform(messages: FixtureMessage[], budget: number): Promise<FixtureMessage[]> {
  const plugin = await OpenWorkMediaBudget(undefined, { inlineImageBudgetBytes: budget });
  const output = { messages: structuredClone(messages) };
  await plugin["experimental.chat.messages.transform"]({}, output);
  return output.messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function partAt(messages: FixtureMessage[], messageIndex: number, partIndex: number): Record<string, unknown> {
  const message = messages[messageIndex];
  if (!message) throw new Error(`missing message ${messageIndex}`);
  const part = message.parts[partIndex];
  if (!isRecord(part)) throw new Error(`missing part ${messageIndex}.${partIndex}`);
  return part;
}

function toolState(part: Record<string, unknown>): Record<string, unknown> {
  const state = part.state;
  if (!isRecord(state)) throw new Error("missing tool state");
  return state;
}

function toolAttachments(part: Record<string, unknown>): unknown[] {
  const attachments = toolState(part).attachments;
  if (!Array.isArray(attachments)) throw new Error("missing attachments");
  return attachments;
}

function recordAt(values: unknown[], index: number): Record<string, unknown> {
  const value = values[index];
  if (!isRecord(value)) throw new Error(`missing record ${index}`);
  return value;
}

describe("OpenWorkMediaBudget plugin", () => {
  test("leaves under-budget images unchanged", async () => {
    const messages = [userImageMessage("u1", "user-new.png", 40), toolImageMessage("a1", [{ filename: "tool-new.png", encodedBytes: 40 }])];
    const plugin = await OpenWorkMediaBudget(undefined, { inlineImageBudgetBytes: 100 });
    const output = { messages };

    await plugin["experimental.chat.messages.transform"]({}, output);

    expect(output.messages).toBe(messages);
    expect(output.messages).toEqual(messages);
  });

  test("drops oldest aggregate overflow and keeps the newest image", async () => {
    const oldUrl = dataUrl(80, "A");
    const newUrl = dataUrl(80, "B");
    const messages: FixtureMessage[] = [
      {
        info: { id: messageId("u_old"), sessionID: SESSION_ID, role: "user" },
        parts: [{ id: partId("u_old"), sessionID: SESSION_ID, messageID: messageId("u_old"), type: "file", mime: "image/png", filename: "old.png", url: oldUrl }],
      },
      toolImageMessage("a_new", [{ filename: "new.png", encodedBytes: 80, fill: "B" }]),
    ];

    const transformed = await transform(messages, 100);
    const oldPart = partAt(transformed, 0, 0);
    const newToolPart = partAt(transformed, 1, 0);
    const keptAttachment = recordAt(toolAttachments(newToolPart), 0);

    expect(oldPart.type).toBe("text");
    expect(oldPart.id).toBe(partId("u_old"));
    expect(oldPart.sessionID).toBe(SESSION_ID);
    expect(oldPart.messageID).toBe(messageId("u_old"));
    expect(oldPart.text).toContain("old.png");
    expect(oldPart.text).toContain("encoded inline payload");
    expect(oldPart.text).toContain("request image budget");
    expect(toolAttachments(newToolPart)).toHaveLength(1);
    expect(keptAttachment.id).toBe(partId("a_new_new.png"));
    expect(keptAttachment.sessionID).toBe(SESSION_ID);
    expect(keptAttachment.messageID).toBe(messageId("a_new"));
    expect(JSON.stringify(transformed)).not.toContain(oldUrl);
    expect(JSON.stringify(transformed)).toContain(newUrl);
  });

  test("shares one budget across user files and tool-result attachments", async () => {
    const messages = [
      userImageMessage("u_old", "old-user.png", 72, "A"),
      toolImageMessage("a_middle", [{ filename: "middle-tool.png", encodedBytes: 72, fill: "B" }]),
      userImageMessage("u_new", "new-user.png", 72, "C"),
    ];

    const transformed = await transform(messages, 144);

    expect(partAt(transformed, 0, 0).type).toBe("text");
    expect(String(partAt(transformed, 0, 0).text)).toContain("old-user.png");
    expect(toolAttachments(partAt(transformed, 1, 0))).toHaveLength(1);
    expect(partAt(transformed, 2, 0).type).toBe("file");
  });

  test("omits malformed image data URLs with placeholders", async () => {
    const badUserUrl = "data:image/png;base64";
    const badToolUrl = "data:image/png;base64,@@@";
    const messages: FixtureMessage[] = [
      {
        info: { id: messageId("u_bad"), sessionID: SESSION_ID, role: "user" },
        parts: [{ id: partId("u_bad"), sessionID: SESSION_ID, messageID: messageId("u_bad"), type: "file", mime: "image/png", filename: "bad-user.png", url: badUserUrl }],
      },
      {
        info: { id: messageId("a_bad"), sessionID: SESSION_ID, role: "assistant" },
        parts: [
          {
            id: partId("tool_bad"),
            sessionID: SESSION_ID,
            messageID: messageId("a_bad"),
            type: "tool",
            tool: "fixture_image_tool",
            callID: "call_bad",
            state: {
              status: "completed",
              input: {},
              output: "Tool returned a malformed image.",
              title: "malformed fixture",
              metadata: {},
              attachments: [{ id: partId("bad_tool_attachment"), sessionID: SESSION_ID, messageID: messageId("a_bad"), type: "file", mime: "image/png", filename: "bad-tool.png", url: badToolUrl }],
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ];

    const transformed = await transform(messages, 1_000);
    const userPart = partAt(transformed, 0, 0);
    const toolPart = partAt(transformed, 1, 0);

    expect(userPart.type).toBe("text");
    expect(userPart.text).toContain("malformed data URL");
    expect(userPart.id).toBe(partId("u_bad"));
    expect(userPart.sessionID).toBe(SESSION_ID);
    expect(userPart.messageID).toBe(messageId("u_bad"));
    expect(toolAttachments(toolPart)).toHaveLength(0);
    expect(toolState(toolPart).output).toContain("invalid base64 structure");
    expect(JSON.stringify(transformed)).not.toContain(badUserUrl);
    expect(JSON.stringify(transformed)).not.toContain(badToolUrl);
  });

  test("omits malformed base64 length and padding structures", async () => {
    const badLengthUrl = "data:image/png;base64,AAA";
    const badPaddingUrl = "data:image/png;base64,A=AA";
    const messages: FixtureMessage[] = [
      {
        info: { id: messageId("u_bad_length"), sessionID: SESSION_ID, role: "user" },
        parts: [{ id: partId("u_bad_length"), sessionID: SESSION_ID, messageID: messageId("u_bad_length"), type: "file", mime: "image/png", filename: "bad-length.png", url: badLengthUrl }],
      },
      {
        info: { id: messageId("u_bad_padding"), sessionID: SESSION_ID, role: "user" },
        parts: [{ id: partId("u_bad_padding"), sessionID: SESSION_ID, messageID: messageId("u_bad_padding"), type: "file", mime: "image/png", filename: "bad-padding.png", url: badPaddingUrl }],
      },
    ];

    const transformed = await transform(messages, 1_000);

    expect(partAt(transformed, 0, 0).text).toContain("invalid base64 structure");
    expect(partAt(transformed, 1, 0).text).toContain("invalid base64 structure");
    expect(JSON.stringify(transformed)).not.toContain(badLengthUrl);
    expect(JSON.stringify(transformed)).not.toContain(badPaddingUrl);
  });

  test("leaves compacted completed tool attachments unchanged", async () => {
    const messages = [toolImageMessage("a_compacted", [{ filename: "compacted.png", encodedBytes: 80 }], { compacted: true })];
    const plugin = await OpenWorkMediaBudget(undefined, { inlineImageBudgetBytes: 1 });
    const output = { messages: structuredClone(messages) };
    const before = JSON.stringify(output.messages);

    await plugin["experimental.chat.messages.transform"]({}, output);

    expect(JSON.stringify(output.messages)).toBe(before);
    expect(toolAttachments(partAt(output.messages, 0, 0))).toHaveLength(1);
  });

  test("leaves text-only messages unchanged", async () => {
    const messages = [textMessage("u_text")];
    const plugin = await OpenWorkMediaBudget(undefined, { inlineImageBudgetBytes: 1 });
    const output = { messages };

    await plugin["experimental.chat.messages.transform"]({}, output);

    expect(output.messages).toBe(messages);
    expect(output.messages).toEqual(messages);
  });

  test("is deterministic and idempotent across repeat transforms", async () => {
    const messages = [userImageMessage("u_old", "old.png", 80, "A"), toolImageMessage("a_new", [{ filename: "new.png", encodedBytes: 80, fill: "B" }])];
    const once = await transform(messages, 100);
    const twice = await transform(once, 100);

    expect(twice).toEqual(once);
  });

  test("module and package build expose the runtime plugin", async () => {
    const mod = await import("./openwork-media-budget.js");
    expect(Object.keys(mod)).toEqual(["OpenWorkMediaBudget"]);

    const packageJson = await readFile(join(import.meta.dir, "..", "..", "package.json"), "utf8");
    expect(packageJson).toContain("src/opencode-plugins/openwork-media-budget.ts");
  });
});
