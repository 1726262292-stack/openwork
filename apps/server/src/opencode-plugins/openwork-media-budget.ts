/**
 * OpenWork Media Budget Plugin
 *
 * OpenCode 1.17.11 already serializes provider requests through the AI SDK and
 * normalizes user-provided images to per-image limits before saving them. The
 * missing guard for OpenWork is aggregate inline media: replayed history can
 * combine user file parts and tool-result image attachments into a request body
 * that is too large for a model/proxy even when every single image is valid.
 *
 * This request-only transform keeps the newest inline images within a small
 * aggregate budget and replaces older or malformed inline images with compact
 * text placeholders. It intentionally does not resize images, install native
 * dependencies, or mutate persisted session history.
 */

const DEFAULT_INLINE_IMAGE_BUDGET_BYTES = 10 * 1024 * 1024;
const INLINE_IMAGE_BUDGET_ENV = "OPENWORK_INLINE_IMAGE_BUDGET_BYTES";
const BASE64_PAYLOAD = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type ChatMessage = Record<string, unknown> & {
  parts?: unknown;
};

type TransformOutput = {
  messages: ChatMessage[];
};

type PluginOptions = {
  inlineImageBudgetBytes?: unknown;
};

type InlineImageInfo =
  | {
      type: "inline";
      mime: string;
      filename?: string;
      encodedBytes: number;
    }
  | {
      type: "malformed";
      mime: string;
      filename?: string;
      reason: string;
    }
  | {
      type: "external" | "not-image";
    };

type ImageCandidate = {
  key: string;
  mime: string;
  filename?: string;
  encodedBytes: number;
  malformedReason?: string;
};

type ImageDecision = {
  keep: boolean;
  placeholder?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function compactLabel(value: string): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > 80 ? `${compacted.slice(0, 77)}...` : compacted;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${Math.ceil(value / (1024 * 1024))} MB`;
}

function numericBudget(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function resolveBudget(options?: PluginOptions): number {
  const fromOptions = numericBudget(options?.inlineImageBudgetBytes);
  if (fromOptions !== undefined) return fromOptions;

  const raw = process.env[INLINE_IMAGE_BUDGET_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    const fromEnv = numericBudget(parsed);
    if (fromEnv !== undefined) return fromEnv;
  }

  return DEFAULT_INLINE_IMAGE_BUDGET_BYTES;
}

function inlineImageInfo(record: Record<string, unknown>): InlineImageInfo {
  const mime = stringValue(record.mime);
  if (!mime?.startsWith("image/")) return { type: "not-image" };

  const filename = stringValue(record.filename);
  const url = stringValue(record.url);
  if (!url) return { type: "malformed", mime, filename, reason: "missing data URL" };
  if (!url.startsWith("data:")) return { type: "external" };

  const comma = url.indexOf(",");
  if (comma === -1) return { type: "malformed", mime, filename, reason: "malformed data URL" };

  const header = url.slice("data:".length, comma);
  const headerParts = header.toLowerCase().split(";");
  const headerMime = headerParts[0] ?? "";
  if (headerMime && !headerMime.startsWith("image/")) {
    return { type: "malformed", mime, filename, reason: "data URL media type is not an image" };
  }
  if (!headerParts.includes("base64")) {
    return { type: "malformed", mime, filename, reason: "data URL is not base64" };
  }

  const payload = url.slice(comma + 1);
  if (!payload) return { type: "malformed", mime, filename, reason: "empty image payload" };
  if (!BASE64_PAYLOAD.test(payload)) {
    return { type: "malformed", mime, filename, reason: "invalid base64 structure" };
  }

  return { type: "inline", mime, filename, encodedBytes: Buffer.byteLength(payload, "utf8") };
}

function candidateFromRecord(key: string, record: Record<string, unknown>): ImageCandidate | undefined {
  const info = inlineImageInfo(record);
  if (info.type === "not-image" || info.type === "external") return undefined;
  if (info.type === "malformed") {
    return {
      key,
      mime: info.mime,
      filename: info.filename,
      encodedBytes: 0,
      malformedReason: info.reason,
    };
  }
  return {
    key,
    mime: info.mime,
    filename: info.filename,
    encodedBytes: info.encodedBytes,
  };
}

function imageName(candidate: ImageCandidate): string {
  return candidate.filename ? ` "${compactLabel(candidate.filename)}"` : "";
}

function placeholder(candidate: ImageCandidate, budget: number): string {
  const name = imageName(candidate);
  if (candidate.malformedReason) {
    return `[OpenWork omitted image${name}: ${candidate.mime}; ${candidate.malformedReason}.]`;
  }
  return `[OpenWork omitted image${name}: ${candidate.mime}, ${formatBytes(candidate.encodedBytes)} encoded inline payload exceeds the ${formatBytes(budget)} request image budget; kept newer images.]`;
}

function decisionKey(messageIndex: number, partIndex: number, attachmentIndex?: number): string {
  return attachmentIndex === undefined
    ? `user:${messageIndex}:${partIndex}`
    : `tool:${messageIndex}:${partIndex}:${attachmentIndex}`;
}

function completedToolAttachments(part: Record<string, unknown>): unknown[] | undefined {
  if (part.type !== "tool") return undefined;
  const state = part.state;
  if (!isRecord(state) || state.status !== "completed") return undefined;
  const time = state.time;
  if (isRecord(time) && time.compacted) return undefined;
  return Array.isArray(state.attachments) ? state.attachments : undefined;
}

function collectCandidates(messages: ChatMessage[]): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (!Array.isArray(message.parts)) continue;
    for (const [partIndex, part] of message.parts.entries()) {
      if (!isRecord(part)) continue;
      if (part.type === "file") {
        const candidate = candidateFromRecord(decisionKey(messageIndex, partIndex), part);
        if (candidate) candidates.push(candidate);
      }

      const attachments = completedToolAttachments(part);
      if (!attachments) continue;
      for (const [attachmentIndex, attachment] of attachments.entries()) {
        if (!isRecord(attachment)) continue;
        const candidate = candidateFromRecord(decisionKey(messageIndex, partIndex, attachmentIndex), attachment);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function decideImages(candidates: ImageCandidate[], budget: number): Map<string, ImageDecision> {
  const decisions = new Map<string, ImageDecision>();
  for (const candidate of candidates) {
    if (candidate.malformedReason) {
      decisions.set(candidate.key, { keep: false, placeholder: placeholder(candidate, budget) });
    }
  }

  let used = 0;
  const valid = candidates.filter((candidate) => !candidate.malformedReason);
  for (let index = valid.length - 1; index >= 0; index -= 1) {
    const candidate = valid[index];
    if (!candidate) continue;
    if (used + candidate.encodedBytes <= budget) {
      used += candidate.encodedBytes;
      decisions.set(candidate.key, { keep: true });
    } else {
      decisions.set(candidate.key, { keep: false, placeholder: placeholder(candidate, budget) });
    }
  }
  return decisions;
}

function hasOmissions(decisions: Map<string, ImageDecision>): boolean {
  for (const decision of decisions.values()) {
    if (!decision.keep) return true;
  }
  return false;
}

function textPartFromImage(part: Record<string, unknown>, text: string): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "text", text, synthetic: true };
  // OpenCode v1.17.11 TextPart and FilePart share partBase fields:
  // id, sessionID, and messageID are required, so preserve them when turning a
  // request-only FilePart into a request-only TextPart placeholder.
  for (const key of ["id", "messageID", "sessionID"]) {
    const value = part[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function appendPlaceholders(output: unknown, placeholders: string[]): string {
  const suffix = placeholders.join("\n");
  if (typeof output === "string" && output.length > 0) return `${output}\n${suffix}`;
  return suffix;
}

function transformToolPart(
  part: Record<string, unknown>,
  messageIndex: number,
  partIndex: number,
  decisions: Map<string, ImageDecision>,
): Record<string, unknown> {
  const state = part.state;
  if (!isRecord(state) || !Array.isArray(state.attachments)) return part;

  let changed = false;
  const placeholders: string[] = [];
  const attachments = state.attachments.filter((attachment, attachmentIndex) => {
    if (!isRecord(attachment)) return true;
    const decision = decisions.get(decisionKey(messageIndex, partIndex, attachmentIndex));
    if (!decision || decision.keep) return true;
    changed = true;
    if (decision.placeholder) placeholders.push(decision.placeholder);
    return false;
  });

  if (!changed) return part;
  return {
    ...part,
    state: {
      ...state,
      attachments,
      output: appendPlaceholders(state.output, placeholders),
    },
  };
}

function transformPart(
  part: Record<string, unknown>,
  messageIndex: number,
  partIndex: number,
  decisions: Map<string, ImageDecision>,
): Record<string, unknown> {
  if (part.type === "file") {
    const decision = decisions.get(decisionKey(messageIndex, partIndex));
    if (decision && !decision.keep && decision.placeholder) return textPartFromImage(part, decision.placeholder);
  }
  if (part.type === "tool") return transformToolPart(part, messageIndex, partIndex, decisions);
  return part;
}

function transformMessages(messages: ChatMessage[], budget: number): ChatMessage[] {
  const decisions = decideImages(collectCandidates(messages), budget);
  if (!hasOmissions(decisions)) return messages;

  return messages.map((message, messageIndex) => {
    if (!Array.isArray(message.parts)) return message;
    return {
      ...message,
      parts: message.parts.map((part, partIndex) =>
        isRecord(part) ? transformPart(part, messageIndex, partIndex, decisions) : part,
      ),
    };
  });
}

// Single export: the OpenCode plugin loader treats every export of a plugin
// module as a plugin factory, so helpers must stay module-private.
export const OpenWorkMediaBudget = async (_input?: unknown, options?: PluginOptions) => {
  const budget = resolveBudget(options);
  return {
    "experimental.chat.messages.transform": async (_hookInput: unknown, output: TransformOutput) => {
      const transformed = transformMessages(output.messages, budget);
      if (transformed !== output.messages) output.messages.splice(0, output.messages.length, ...transformed);
    },
  };
};
