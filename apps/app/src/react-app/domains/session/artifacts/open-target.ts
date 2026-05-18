/** @jsxImportSource react */
import type { UIMessage } from "ai";

export type OpenTargetKind = "url" | "file";
export type OpenTargetPreview = "browser" | "markdown" | "sheet" | "image" | "pdf" | "html" | "text" | "external";

export type OpenTarget = {
  id: string;
  kind: OpenTargetKind;
  value: string;
  name: string;
  preview: OpenTargetPreview;
  confidence: number;
  reason: string;
  exists?: boolean;
  size?: number;
  updatedAt?: number;
};

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

const FILE_PATTERN = /(?:^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)+\.[a-z][a-z0-9]{0,9}|[\w.\-]+\.[a-z][a-z0-9]{0,9})/gi;
const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/gi;
const SOCKET_PATTERN = /(?:ws|wss):\/\/[^\s)\]}>"']+/gi;

function normalizePath(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "");
}

function basename(value: string) {
  const clean = value.split(/[?#]/)[0] ?? value;
  return clean.split("/").filter(Boolean).pop() ?? value;
}

function extname(value: string) {
  const name = basename(value).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

export function classifyOpenTarget(value: string, kind: OpenTargetKind): OpenTargetPreview {
  if (kind === "url") return "browser";
  const ext = extname(value);
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".csv", ".tsv", ".xlsx", ".xls", ".ods"].includes(ext)) return "sheet";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".txt", ".log", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss"].includes(ext)) return "text";
  return "external";
}

function targetFromFile(path: string, confidence: number, reason: string): OpenTarget | null {
  const normalized = normalizePath(path).replace(/[.,;:]+$/, "");
  if (!normalized || normalized.length > 500 || !normalized.includes(".")) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basename(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence,
    reason,
  };
}

function targetFromUrl(url: string, confidence: number, reason: string): OpenTarget | null {
  const clean = url.trim().replace(/[.,;:]+$/, "");
  if (!clean) return null;
  return {
    id: `url:${clean}`,
    kind: "url",
    value: clean,
    name: basename(clean) || clean,
    preview: "browser",
    confidence,
    reason,
  };
}

function addTarget(map: Map<string, OpenTarget>, target: OpenTarget | null) {
  if (!target) return;
  const existing = map.get(target.id);
  if (!existing || target.confidence >= existing.confidence) map.set(target.id, target);
}

function scanText(map: Map<string, OpenTarget>, text: string, confidence: number, reason: string) {
  if (!text) return;
  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }
  SOCKET_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(SOCKET_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }
  FILE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FILE_PATTERN)) {
    if (match[1]) addTarget(map, targetFromFile(match[1], confidence, reason));
  }
}

export function deriveOpenTargets(messages: UIMessage[]): OpenTarget[] {
  const targets = new Map<string, OpenTarget>();
  const recent = messages.slice(-8);

  for (const message of recent) {
    for (const part of message.parts) {
      const record = part as any;
      if (part.type === "text" && typeof record.text === "string") {
        scanText(targets, record.text, message.role === "assistant" ? 65 : 40, "message");
        continue;
      }
      if (part.type === "dynamic-tool") {
        const values = [record.input, record.output].flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const entries = value as Record<string, unknown>;
          return [entries.path, entries.file, ...(Array.isArray(entries.files) ? entries.files : [])];
        });
        for (const value of values) {
          if (typeof value === "string") addTarget(targets, targetFromFile(value, 95, "tool metadata"));
        }
        scanText(targets, JSON.stringify(record.output ?? record.input ?? ""), 75, "tool output");
      }
    }
  }

  return Array.from(targets.values())
    .filter((target) => target.preview !== "external" || target.confidence >= 95)
    .sort((left, right) => right.confidence - left.confidence);
}

export function shouldAutoOpenTarget(target: OpenTarget): boolean {
  if (target.kind === "url") return /(?:https?|wss?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(target.value);
  return target.exists === true && target.confidence >= 65 && ["markdown", "sheet", "image", "pdf", "html"].includes(target.preview);
}
