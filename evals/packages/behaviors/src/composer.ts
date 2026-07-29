import type { Surface } from "@openwork/cdp";
import { evalIn, waitFor } from "./desktop.ts";

export interface ComposerState {
  draftText: string;
  route: string;
  runTaskVisible: boolean;
  runTaskEnabled: boolean;
  userMessageCount: number;
  assistantMessageCount: number;
  selectedModelLabel: string;
  modelUnavailable: boolean;
}

export interface AssistantReplyFacts {
  text: string;
  assistantMessageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function executeControl(app: Surface, action: string, args?: unknown): Promise<unknown> {
  const result = await evalIn(
    app,
    `window.__openworkControl.execute(${JSON.stringify(action)}, ${JSON.stringify(args ?? null)})`,
    { awaitPromise: true },
  );
  if (!isRecord(result) || result.ok !== true) {
    throw new Error(`Desktop control action ${action} failed: ${isRecord(result) ? String(result.error ?? "unknown") : "unknown"}`);
  }
  return result.result;
}

export async function readComposerState(app: Surface): Promise<ComposerState> {
  const value = await evalIn(app, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      ?? document.querySelector('[contenteditable="true"]');
    const run = [...document.querySelectorAll("button")]
      .find((button) => (button.textContent ?? "").trim() === "Run task");
    const model = document.querySelector('button[aria-label="Change model"]');
    return {
      draftText: editor?.innerText ?? "",
      route: location.hash,
      runTaskVisible: Boolean(run),
      runTaskEnabled: Boolean(run && !run.disabled),
      userMessageCount: document.querySelectorAll('[data-message-role="user"]').length,
      assistantMessageCount: document.querySelectorAll('[data-message-role="assistant"]').length,
      selectedModelLabel: model?.textContent?.trim() ?? "",
      modelUnavailable: document.body.innerText.includes("Model no longer available")
        || document.body.innerText.includes("The model you were using is no longer available"),
    };
  })()`);
  if (!isRecord(value)) throw new Error("Composer state was not an object.");
  return {
    draftText: stringField(value.draftText),
    route: stringField(value.route),
    runTaskVisible: value.runTaskVisible === true,
    runTaskEnabled: value.runTaskEnabled === true,
    userMessageCount: numberField(value.userMessageCount),
    assistantMessageCount: numberField(value.assistantMessageCount),
    selectedModelLabel: stringField(value.selectedModelLabel),
    modelUnavailable: value.modelUnavailable === true,
  };
}

export async function sendComposerMessage(app: Surface, text: string): Promise<ComposerState> {
  await waitFor(app, `window.__openworkControl?.listActions().some((entry) => entry.id === "composer.set_text" && entry.disabled === false)`, {
    timeoutMs: 30_000,
    label: "composer.set_text enabled",
  });
  const before = await readComposerState(app);
  await executeControl(app, "composer.set_text", { text });
  await waitFor(app, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      ?? document.querySelector('[contenteditable="true"]');
    return Boolean(editor && (editor.innerText ?? "").includes(${JSON.stringify(text)}));
  })()`, { timeoutMs: 30_000, label: "composer draft text" });
  await waitFor(app, `window.__openworkControl?.listActions().some((entry) => entry.id === "composer.send" && entry.disabled === false)`, {
    timeoutMs: 30_000,
    label: "composer.send enabled",
  });
  await executeControl(app, "composer.send");
  await waitFor(app, `document.querySelectorAll('[data-message-role="user"]').length > ${before.userMessageCount}`, {
    timeoutMs: 60_000,
    label: "sent user message",
  });
  return readComposerState(app);
}

export async function waitForAssistantReply(
  app: Surface,
  { timeoutMs }: { timeoutMs: number },
): Promise<AssistantReplyFacts> {
  await waitFor(app, `(() => {
    const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
    return messages.some((message) => (message.innerText ?? "").trim().length > 0);
  })()`, { timeoutMs, label: "assistant reply" });
  const value = await evalIn(app, `(() => {
    const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
    const latest = messages[messages.length - 1];
    return { text: latest?.innerText?.trim() ?? "", assistantMessageCount: messages.length };
  })()`);
  if (!isRecord(value)) throw new Error("Assistant reply facts were not an object.");
  return {
    text: stringField(value.text),
    assistantMessageCount: numberField(value.assistantMessageCount),
  };
}
