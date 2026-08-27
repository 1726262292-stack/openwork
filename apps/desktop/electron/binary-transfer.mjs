import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DESKTOP_TRANSFER_MAX_BYTES = 250_000_000;
const MAX_HEADERS = 64;
const MAX_FIELDS = 32;
const MAX_METADATA_LENGTH = 1_024;
const MAX_RESPONSE_TEXT_BYTES = 1_000_000;

function transferError(message, code) {
  return Object.assign(new Error(message), { code });
}

function boundedString(value, label, { required = false, maxLength = MAX_METADATA_LENGTH } = {}) {
  if (typeof value !== "string") {
    if (!required && value === undefined) return undefined;
    throw transferError(`${label} must be a string.`, "invalid-metadata");
  }
  const result = value.trim();
  if (required && !result) throw transferError(`${label} is required.`, "invalid-metadata");
  if (result.length > maxLength) throw transferError(`${label} is too long.`, "invalid-metadata");
  if (/\0|[\r\n]/.test(result)) throw transferError(`${label} contains invalid characters.`, "invalid-metadata");
  return result;
}

function boundedRecord(value, label, maximumEntries) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw transferError(`${label} must be an object.`, "invalid-metadata");
  }
  const entries = Object.entries(value);
  if (entries.length > maximumEntries) {
    throw transferError(`${label} has too many entries.`, "invalid-metadata");
  }
  return Object.fromEntries(entries.map(([key, entryValue]) => [
    boundedString(key, `${label} name`, { required: true, maxLength: 128 }),
    boundedString(entryValue, `${label} value`, { required: false, maxLength: 8_192 }) ?? "",
  ]));
}

function boundedByteCount(value, label, { allowUndefined = false } = {}) {
  if (allowUndefined && value === undefined) return DESKTOP_TRANSFER_MAX_BYTES;
  if (!Number.isSafeInteger(value)) throw transferError(`${label} must be an integer.`, "invalid-size");
  if (value === 0) throw transferError(`${label} must be greater than zero.`, "zero-byte-file");
  if (value < 0) throw transferError(`${label} must be greater than zero.`, "invalid-size");
  if (value > DESKTOP_TRANSFER_MAX_BYTES) {
    throw transferError(`${label} exceeds the ${DESKTOP_TRANSFER_MAX_BYTES}-byte limit.`, "file-too-large");
  }
  return value;
}

function remoteUrl(value) {
  const raw = boundedString(value, "URL", { required: true, maxLength: 8_192 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw transferError("URL is invalid.", "invalid-url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw transferError("URL must use HTTP or HTTPS.", "invalid-url");
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw transferError("Dedicated file transfers are only available for remote destinations.", "loopback-url");
  }
  return parsed.toString();
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function rejectSymlinkComponents(root, target, includeTarget) {
  const relative = path.relative(root, target);
  const components = relative ? relative.split(path.sep) : [];
  const count = includeTarget ? components.length : Math.max(components.length - 1, 0);
  let current = root;
  const rootInfo = await lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw transferError("Authorized workspace root is unavailable or symbolic.", "unauthorized-path");
  }
  for (let index = 0; index < count; index += 1) {
    current = path.join(current, components[index]);
    const info = await lstat(current).catch(() => null);
    if (!info) throw transferError("Transfer path does not exist.", "missing-path");
    if (info.isSymbolicLink()) {
      throw transferError("Transfer paths must not contain symbolic links.", "symlink-path");
    }
  }
}

async function resolveAuthorizedPath(candidateValue, rootsValue, mode) {
  const candidateRaw = boundedString(candidateValue, mode === "read" ? "File path" : "Destination path", {
    required: true,
    maxLength: 32_768,
  });
  if (!path.isAbsolute(candidateRaw)) {
    throw transferError("Transfer path must be absolute.", "unauthorized-path");
  }
  const candidate = path.resolve(candidateRaw);
  const roots = Array.isArray(rootsValue) ? rootsValue : [];
  for (const rootValue of roots) {
    if (typeof rootValue !== "string" || !path.isAbsolute(rootValue)) continue;
    const root = path.resolve(rootValue);
    if (!isInside(root, candidate)) continue;
    await rejectSymlinkComponents(root, candidate, mode === "read");
    const rootRealPath = await realpath(root).catch(() => null);
    if (!rootRealPath) continue;
    if (mode === "read") {
      const candidateRealPath = await realpath(candidate).catch(() => null);
      if (!candidateRealPath || !isInside(rootRealPath, candidateRealPath)) {
        throw transferError("File path escapes the authorized workspace.", "unauthorized-path");
      }
    } else {
      const parentRealPath = await realpath(path.dirname(candidate)).catch(() => null);
      if (!parentRealPath || !isInside(rootRealPath, parentRealPath)) {
        throw transferError("Destination path escapes the authorized workspace.", "unauthorized-path");
      }
      const existing = await lstat(candidate).catch(() => null);
      if (existing?.isSymbolicLink()) {
        throw transferError("Destination path must not be a symbolic link.", "symlink-path");
      }
    }
    return candidate;
  }
  throw transferError("Transfer path is outside every authorized workspace root.", "unauthorized-path");
}

async function responseText(response, maximumBytes = MAX_RESPONSE_TEXT_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw transferError("Text response is too large.", "response-too-large");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

function responseMetadata(response) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
  };
}

function timeoutSignal(timeoutMs, parentSignal) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return parentSignal;
  return parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

async function writeAll(file, value) {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
    if (bytesWritten === 0) throw transferError("Download could not be written.", "write-failed");
    offset += bytesWritten;
  }
}

async function readFileBytes(file, size, signal) {
  const result = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    signal?.throwIfAborted();
    const length = Math.min(size - offset, 1024 * 1024);
    const { bytesRead } = await file.read(result, offset, length);
    if (bytesRead === 0) throw transferError("File size changed while it was being read.", "size-mismatch");
    offset += bytesRead;
  }
  signal?.throwIfAborted();
  return result;
}

export async function uploadMultipartFromPath(input, options) {
  const url = remoteUrl(input?.url);
  const expectedBytes = boundedByteCount(input?.size, "File size");
  const filePath = await resolveAuthorizedPath(input?.filePath, options?.authorizedRoots, "read");
  const filename = boundedString(input?.filename, "Filename", { required: true });
  if (filename !== path.basename(filename) || /[\\/]/.test(filename)) {
    throw transferError("Filename must not contain a path.", "invalid-metadata");
  }
  const fieldName = boundedString(input?.fieldName ?? "file", "File field name", { required: true, maxLength: 128 });
  const contentType = boundedString(input?.contentType, "Content type", { maxLength: 256 });
  const fields = boundedRecord(input?.fields, "Multipart fields", MAX_FIELDS);
  const headers = boundedRecord(input?.headers, "Headers", MAX_HEADERS);
  const method = boundedString(input?.method ?? "POST", "Method", { required: true, maxLength: 16 });
  const signal = timeoutSignal(input?.timeoutMs, options?.signal);
  const file = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile()) throw transferError("Upload path is not a regular file.", "invalid-file");
    boundedByteCount(info.size, "File size");
    if (info.size !== expectedBytes) {
      throw transferError(`File size changed: expected ${expectedBytes} bytes but found ${info.size}.`, "size-mismatch");
    }
    const data = await readFileBytes(file, expectedBytes, signal);
    const form = new FormData();
    form.append(fieldName, new Blob([data], contentType ? { type: contentType } : undefined), filename);
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    const response = await options.fetcher(url, {
      method,
      headers,
      body: form,
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    return { ...responseMetadata(response), body: await responseText(response) };
  } finally {
    await file.close();
  }
}

export async function downloadBinaryToPath(input, options) {
  const url = remoteUrl(input?.url);
  const destinationPath = await resolveAuthorizedPath(input?.destinationPath, options?.authorizedRoots, "write");
  const maxBytes = boundedByteCount(input?.maxBytes, "Maximum download size", { allowUndefined: true });
  const headers = boundedRecord(input?.headers, "Headers", MAX_HEADERS);
  const method = boundedString(input?.method ?? "GET", "Method", { required: true, maxLength: 16 });
  const signal = timeoutSignal(input?.timeoutMs, options?.signal);
  const parent = path.dirname(destinationPath);
  await mkdir(parent, { recursive: true });
  const temporaryPath = path.join(parent, `.${path.basename(destinationPath)}.${randomUUID()}.part`);
  let temporaryFile;
  try {
    const response = await options.fetcher(url, {
      method,
      headers,
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      return { ...responseMetadata(response), body: await responseText(response), path: null, bytes: 0 };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw transferError(`Download exceeds the ${maxBytes}-byte limit.`, "file-too-large");
    }
    temporaryFile = await open(temporaryPath, "wx");
    const reader = response.body?.getReader();
    let bytes = 0;
    if (reader) {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw transferError(`Download exceeds the ${maxBytes}-byte limit.`, "file-too-large");
        }
        await writeAll(temporaryFile, value);
      }
    }
    if (bytes === 0) throw transferError("Download response was empty.", "zero-byte-file");
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await rename(temporaryPath, destinationPath);
    return { ...responseMetadata(response), path: destinationPath, bytes };
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined);
    throw error;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
