import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { link, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const GENERIC_MIME = "application/octet-stream";
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_STRONG_ENCRYPTION = 0x0040;
const ZIP_STORED = 0;
const ZIP_DEFLATE = 8;
const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 128;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const MAX_EXTRACTED_TEXT_CHARS = 24_000;
const MATERIALIZED_DIR = join(".opencode", "openwork", "inbox", "chat-attachments");

type RuntimeContext = {
  directory?: string;
};

type OfficeKind = "docx" | "pptx";

type OfficeFilePart = {
  filename: string;
  mime: string;
  url: string;
  kind: OfficeKind;
  part: Record<string, unknown>;
};

type MaterializedAttachment = {
  sha256: string;
  relativePath: string;
};

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const property = value[key];
  return typeof property === "string" && property.trim().length > 0 ? property : undefined;
}

function normalizeOpenCodeContext(value: unknown): RuntimeContext {
  const directory = optionalStringProperty(value, "directory");
  return {
    ...(directory ? { directory } : {}),
  };
}

function workspaceRoot(factoryContext: RuntimeContext): string | null {
  return factoryContext.directory ? resolve(factoryContext.directory) : null;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizedMime(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().split(";")[0]?.trim() ?? "" : "";
}

function extensionFromFilename(filename: string): string {
  const name = basename(filename).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function isGenericMime(mime: string): boolean {
  return mime === "" || mime === GENERIC_MIME;
}

function officeKindFromMimeOrFilename(mime: string, filename: string): OfficeKind | null {
  if (mime === DOCX_MIME) return "docx";
  if (mime === PPTX_MIME) return "pptx";
  if (!isGenericMime(mime)) return null;
  const extension = extensionFromFilename(filename);
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  return null;
}

function canonicalMime(kind: OfficeKind): string {
  return kind === "docx" ? DOCX_MIME : PPTX_MIME;
}

function officeFilePart(value: unknown): OfficeFilePart | null {
  if (!isRecord(value) || value.type !== "file") return null;
  const url = optionalStringProperty(value, "url");
  if (!url) return null;
  const filename = optionalStringProperty(value, "filename") ?? optionalStringProperty(value, "name") ?? "attachment";
  const mime = normalizedMime(value.mediaType ?? value.mime ?? value.mimeType);
  const kind = officeKindFromMimeOrFilename(mime, filename);
  if (!kind) return null;
  return { filename, mime: canonicalMime(kind), url, kind, part: value };
}

function safeFilename(filename: string, kind: OfficeKind): string {
  const extension = kind;
  const clean = basename(filename)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  const base = clean || `attachment.${extension}`;
  const currentExtension = extensionFromFilename(base);
  const rawStem = currentExtension ? base.slice(0, -(currentExtension.length + 1)) : base;
  const stem = rawStem.replace(/\.+$/, "").trim() || "attachment";
  return `${stem.slice(0, 120 - extension.length - 1)}.${extension}`;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function toWorkerRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;

  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;

  const dataEnd = value.length - padding;
  for (let index = 0; index < dataEnd; index += 1) {
    if (base64Value(value.charCodeAt(index)) < 0) return false;
  }
  for (let index = dataEnd; index < value.length; index += 1) {
    if (value[index] !== "=") return false;
  }

  if (padding === 1) return (base64Value(value.charCodeAt(value.length - 2)) & 0b11) === 0;
  if (padding === 2) return (base64Value(value.charCodeAt(value.length - 3)) & 0b1111) === 0;
  return true;
}

function decodeDataUrl(url: string): Buffer {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!match) throw new Error("Only base64 data URLs are supported for Office attachments.");
  const encoded = match[2].replace(/\s+/g, "");
  if (encoded.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4 + 8) throw new Error("Office attachment data URL exceeds the compressed byte limit.");
  if (!isValidBase64(encoded)) throw new Error("Office attachment data URL is not valid base64.");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength > MAX_COMPRESSED_BYTES) throw new Error("Office attachment exceeds the compressed byte limit.");
  return buffer;
}

async function bytesFromPart(part: OfficeFilePart, root: string | null): Promise<Buffer> {
  if (part.url.startsWith("data:")) return decodeDataUrl(part.url);
  const url = new URL(part.url);
  if (url.protocol !== "file:") throw new Error("Office attachment URL was not a supported data: or workspace file: URL.");
  if (!root) throw new Error("Workspace root is unavailable for file: Office attachment URLs.");
  const filePath = resolve(fileURLToPath(url));
  if (!isWithin(root, filePath)) throw new Error("Office attachment file URL points outside the active workspace.");
  const realRoot = await realpath(root);
  const realFilePath = await realpath(filePath);
  if (!isWithin(realRoot, realFilePath)) throw new Error("Office attachment file URL points outside the active workspace.");
  const buffer = await readFile(realFilePath);
  if (buffer.byteLength > MAX_COMPRESSED_BYTES) throw new Error("Office attachment exceeds the compressed byte limit.");
  return buffer;
}

async function existingSha(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

async function linkBytesAtomically(target: string, bytes: Buffer): Promise<void> {
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes, { flag: "wx" });
  try {
    await link(tmp, target);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function materializeAttachment(root: string | null, filename: string, kind: OfficeKind, bytes: Buffer): Promise<MaterializedAttachment | null> {
  if (!root) return null;
  const digest = sha256(bytes);
  const directory = join(root, MATERIALIZED_DIR);
  await mkdir(directory, { recursive: true });
  const names = [`${digest.slice(0, 16)}-${safeFilename(filename, kind)}`, `${digest}-${safeFilename(filename, kind)}`];
  for (const name of names) {
    const target = join(directory, name);
    const current = await existingSha(target);
    if (current === digest) return { sha256: digest, relativePath: toWorkerRelativePath(root, target) };
    if (current !== null) continue;
    try {
      await linkBytesAtomically(target, bytes);
      return { sha256: digest, relativePath: toWorkerRelativePath(root, target) };
    } catch (cause) {
      const afterRace = await existingSha(target);
      if (afterRace === digest) return { sha256: digest, relativePath: toWorkerRelativePath(root, target) };
      if (afterRace !== null) continue;
      throw cause;
    }
  }
  throw new Error("A different Office attachment already exists at the materialized path.");
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (offset < 0 || buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error("ZIP end-of-central-directory not found.");
}

function rejectUnsafeZipFlags(flags: number, name: string): void {
  if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) throw new Error(`ZIP entry ${name} is encrypted.`);
  if ((flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) throw new Error(`ZIP entry ${name} uses data descriptors.`);
  if ((flags & ZIP_FLAG_STRONG_ENCRYPTION) !== 0) throw new Error(`ZIP entry ${name} uses strong encryption.`);
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.byteLength > MAX_COMPRESSED_BYTES) throw new Error("ZIP input exceeds compressed byte limit.");
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const countOnDisk = buffer.readUInt16LE(eocd + 8);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const centralEnd = centralOffset + centralSize;
  if (disk !== 0 || centralDisk !== 0 || countOnDisk !== count) throw new Error("Multi-disk ZIP archives are not supported.");
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported.");
  if (count > MAX_ZIP_ENTRIES) throw new Error(`ZIP entry count ${count} exceeds limit ${MAX_ZIP_ENTRIES}.`);
  if (centralOffset + centralSize > buffer.byteLength) throw new Error("ZIP central directory is out of bounds.");
  if (centralEnd > eocd) throw new Error("ZIP central directory overlaps the end-of-central-directory record.");

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > centralEnd || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) throw new Error("Invalid ZIP central directory entry.");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported.");
    if (cursor + 46 + nameLength + extraLength + commentLength > centralEnd) throw new Error("ZIP central directory entry is out of bounds.");
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    rejectUnsafeZipFlags(flags, name);
    if (method !== ZIP_STORED && method !== ZIP_DEFLATE) throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}.`);
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) throw new Error(`ZIP entry ${name} exceeds per-entry uncompressed limit.`);
    if (uncompressedSize > 0 && compressedSize === 0) throw new Error(`ZIP entry ${name} has an invalid compression ratio.`);
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ZIP_COMPRESSION_RATIO) throw new Error(`ZIP entry ${name} exceeds compression ratio limit.`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("ZIP archive exceeds total uncompressed limit.");
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralEnd) throw new Error("ZIP central directory size does not match its entries.");
  return entries;
}

function readZipEntryData(buffer: Buffer, entry: ZipEntry): Buffer {
  const cursor = entry.localOffset;
  if (cursor + 30 > buffer.byteLength || buffer.readUInt32LE(cursor) !== ZIP_LOCAL_FILE_HEADER) throw new Error(`Invalid local ZIP header for ${entry.name}.`);
  const localFlags = buffer.readUInt16LE(cursor + 6);
  const localMethod = buffer.readUInt16LE(cursor + 8);
  const localCompressedSize = buffer.readUInt32LE(cursor + 18);
  const localUncompressedSize = buffer.readUInt32LE(cursor + 22);
  const nameLength = buffer.readUInt16LE(cursor + 26);
  const extraLength = buffer.readUInt16LE(cursor + 28);
  rejectUnsafeZipFlags(localFlags, entry.name);
  if (localMethod !== entry.method) throw new Error(`ZIP method mismatch for ${entry.name}.`);
  if (localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize) throw new Error(`ZIP size mismatch for ${entry.name}.`);
  if (cursor + 30 + nameLength + extraLength > buffer.byteLength) throw new Error(`ZIP local header for ${entry.name} is out of bounds.`);
  const localName = buffer.toString("utf8", cursor + 30, cursor + 30 + nameLength);
  if (localName !== entry.name) throw new Error(`ZIP local header name mismatch for ${entry.name}.`);
  const dataStart = cursor + 30 + nameLength + extraLength;
  if (dataStart + entry.compressedSize > buffer.byteLength) throw new Error(`ZIP data for ${entry.name} is out of bounds.`);
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  const data = entry.method === ZIP_STORED ? compressed : inflateRawSync(compressed);
  if (data.byteLength !== entry.uncompressedSize) throw new Error(`ZIP uncompressed size mismatch for ${entry.name}.`);
  return data;
}

function relevantXmlEntry(kind: OfficeKind, name: string): boolean {
  if (!name.endsWith(".xml")) return false;
  if (kind === "docx") {
    return name === "word/document.xml"
      || /^word\/header\d+\.xml$/.test(name)
      || /^word\/footer\d+\.xml$/.test(name)
      || name === "word/footnotes.xml"
      || name === "word/endnotes.xml"
      || name === "word/comments.xml";
  }
  return /^ppt\/slides\/slide\d+\.xml$/.test(name) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name);
}

function compareEntryName(left: ZipEntry, right: ZipEntry): number {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function xmlText(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractOfficeText(kind: OfficeKind, bytes: Buffer): string {
  const entries = listZipEntries(bytes).filter((entry) => relevantXmlEntry(kind, entry.name)).sort(compareEntryName);
  if (entries.length === 0) throw new Error("No supported Office XML text entries were found.");
  const pieces: string[] = [];
  let remaining = MAX_EXTRACTED_TEXT_CHARS;
  for (const entry of entries) {
    if (remaining <= 0) break;
    const text = xmlText(readZipEntryData(bytes, entry).toString("utf8"));
    if (!text) continue;
    const chunk = text.slice(0, remaining);
    pieces.push(`[${entry.name}]\n${chunk}`);
    remaining -= chunk.length;
  }
  const combined = pieces.join("\n\n").slice(0, MAX_EXTRACTED_TEXT_CHARS);
  if (!combined) throw new Error("Office XML text entries contained no extractable text.");
  return combined;
}

function basePartIds(part: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["id", "sessionID", "messageID", "sessionId", "messageId"]) {
    const value = part[key];
    if (typeof value === "string" || typeof value === "number") result[key] = value;
  }
  return result;
}

function normalizedText(part: OfficeFilePart, materialized: MaterializedAttachment | null, extractedText: string, error?: string): string {
  return [
    "OpenWork normalized an Office attachment before sending this request to the model.",
    `filename: ${safeFilename(part.filename, part.kind)}`,
    `canonical_mime: ${part.mime}`,
    `sha256: ${materialized?.sha256 ?? "unavailable"}`,
    `worker_relative_path: ${materialized?.relativePath ?? "unavailable"}`,
    ...(error ? [`extraction_error: ${error}`] : []),
    "extracted_text:",
    extractedText,
  ].join("\n");
}

function textPartFrom(part: OfficeFilePart, text: string): Record<string, unknown> {
  return { ...basePartIds(part.part), type: "text", text };
}

async function normalizeOfficePart(part: OfficeFilePart, root: string | null): Promise<Record<string, unknown>> {
  try {
    const bytes = await bytesFromPart(part, root);
    const materialized = await materializeAttachment(root, part.filename, part.kind, bytes);
    try {
      const extractedText = extractOfficeText(part.kind, bytes);
      return textPartFrom(part, normalizedText(part, materialized, extractedText));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return textPartFrom(part, normalizedText(part, materialized, "No text could be safely extracted from this Office attachment.", message));
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return textPartFrom(part, normalizedText(part, null, "The original Office attachment was not forwarded to the provider.", message));
  }
}

async function transformPart(value: unknown, root: string | null): Promise<unknown> {
  const part = officeFilePart(value);
  return part ? await normalizeOfficePart(part, root) : value;
}

async function transformMessage(value: unknown, root: string | null): Promise<unknown> {
  if (!isRecord(value)) return value;
  if (Array.isArray(value.parts)) return { ...value, parts: await Promise.all(value.parts.map((part) => transformPart(part, root))) };
  if (Array.isArray(value.content)) return { ...value, content: await Promise.all(value.content.map((part) => transformPart(part, root))) };
  return value;
}

// Single export: the OpenCode plugin loader treats every export of a plugin
// module as a plugin factory, so helpers must stay module-private.
export const OpenWorkOfficeAttachments = async (factoryInput?: unknown) => {
  const factoryContext = normalizeOpenCodeContext(factoryInput);
  return {
    "experimental.chat.messages.transform": async (input: unknown, output: { messages: unknown[] }) => {
      void input;
      const root = workspaceRoot(factoryContext);
      const messages = await Promise.all(output.messages.map((message) => transformMessage(message, root)));
      output.messages.splice(0, output.messages.length, ...messages);
    },
  };
};
