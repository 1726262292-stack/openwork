#!/usr/bin/env node
import http from "node:http";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";

import {
  DOCX_SENTINEL,
  OFFICE_FIXTURES,
  PPTX_SENTINEL,
} from "../fixtures/ooxml-office-fixtures.mjs";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ZIP_ENTRIES = 100;
const MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const OFFICE_TOOL_CALL_ID = "call_write_office_artifacts";
const OFFICE_TOOL_NAME = "bash";
const RECEIVED_ATTACHMENT_PATHS = {
  docx: "/tmp/openwork-office-attachments-received-QuarterlyBrief.docx",
  pptx: "/tmp/openwork-office-attachments-received-LaunchRoadmap.pptx",
};

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) args.set(item.slice(2), argv[index + 1] ?? "");
  }
  return args;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseDataUrl(value) {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mime = (match[1] ?? "application/octet-stream").trim().toLowerCase();
  const data = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { mime, data };
}

function looksBase64(value) {
  const clean = value.replace(/\s+/g, "");
  return clean.length > 32 && clean.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

function contextFromRecord(record, context) {
  const filename = stringField(record, ["filename", "fileName", "name"]);
  const mime = stringField(record, ["mime", "mimeType", "mediaType", "mime_type", "contentType"]);
  return {
    filename: filename || context.filename || "",
    mime: mime.includes("/") ? mime.toLowerCase() : context.mime || "",
  };
}

function addPayload(out, payload, context) {
  if (!payload.data.byteLength) return;
  out.push({
    filename: context.filename,
    mime: payload.mime || context.mime,
    data: payload.data,
    sha256: sha256(payload.data),
  });
}

function extractPayloads(value, context = { filename: "", mime: "" }) {
  const out = [];
  if (typeof value === "string") {
    const payload = parseDataUrl(value);
    if (payload) addPayload(out, payload, context);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) out.push(...extractPayloads(item, context));
    return out;
  }

  if (!isRecord(value)) return out;

  const nextContext = contextFromRecord(value, context);
  for (const key of ["file_data", "fileData", "data", "bytes", "contentBase64"]) {
    const candidate = value[key];
    if (typeof candidate !== "string") continue;
    const dataUrl = parseDataUrl(candidate);
    if (dataUrl) {
      addPayload(out, dataUrl, nextContext);
    } else if ((nextContext.filename || nextContext.mime) && looksBase64(candidate)) {
      addPayload(out, { mime: nextContext.mime, data: Buffer.from(candidate.replace(/\s+/g, ""), "base64") }, nextContext);
    }
  }

  const url = value.url;
  if (typeof url === "string") {
    const dataUrl = parseDataUrl(url);
    if (dataUrl) addPayload(out, dataUrl, nextContext);
  }

  for (const item of Object.values(value)) {
    out.push(...extractPayloads(item, nextContext));
  }

  const seen = new Set();
  return out.filter((item) => {
    const key = `${item.filename}|${item.mime}|${item.sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectPromptText(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPromptText);
  if (!isRecord(value)) return [];
  if (typeof value.role === "string" && value.role !== "user") return [];
  const type = typeof value.type === "string" ? value.type : "";
  if (type === "text" && typeof value.text === "string") return [value.text];
  if (value.role === "user" && typeof value.content === "string") return [value.content];
  return Object.values(value).flatMap(collectPromptText);
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("ZIP end-of-central-directory not found");
}

function listZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`ZIP entry count ${count} exceeds limit ${MAX_ZIP_ENTRIES}`);
  const entries = [];
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Invalid ZIP central directory entry");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(`ZIP uncompressed size exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES}`);
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ZIP_COMPRESSION_RATIO) {
      throw new Error(`ZIP compression ratio for ${name} exceeds ${MAX_ZIP_COMPRESSION_RATIO}`);
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntryData(buffer, entry) {
  const cursor = entry.localOffset;
  if (buffer.readUInt32LE(cursor) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error(`Invalid local ZIP header for ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(cursor + 26);
  const extraLength = buffer.readUInt16LE(cursor + 28);
  const dataStart = cursor + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  let data;
  if (entry.method === 0) {
    data = compressed;
  } else if (entry.method === 8) {
    data = zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  } else {
    throw new Error(`Unsupported ZIP method ${entry.method} for ${entry.name}`);
  }
  if (data.byteLength !== entry.uncompressedSize) throw new Error(`ZIP uncompressed size mismatch for ${entry.name}`);
  return data;
}

function decodeXmlText(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function extractOoxmlText(buffer) {
  const pieces = [];
  for (const entry of listZipEntries(buffer)) {
    if (!entry.name.endsWith(".xml")) continue;
    const xml = readZipEntryData(buffer, entry).toString("utf8");
    pieces.push(decodeXmlText(xml.replace(/<[^>]+>/g, " ")));
  }
  return pieces.join("\n").replace(/\s+/g, " ").trim();
}

function clearReceivedAttachments() {
  for (const path of Object.values(RECEIVED_ATTACHMENT_PATHS)) rmSync(path, { force: true });
}

function persistReceivedAttachment(kind, data) {
  const path = RECEIVED_ATTACHMENT_PATHS[kind];
  if (path) writeFileSync(path, data);
}

function findExpectedAttachment(payloads, expected) {
  return payloads.find((item) => item.filename === expected.filename && item.mime === expected.mime)
    ?? payloads.find((item) => item.sha256 === expected.sha256);
}

function verifyOfficePayloads(body, options = {}) {
  const payloads = extractPayloads(body);
  const promptText = collectPromptText(body).join("\n");
  const leak = promptText.includes(DOCX_SENTINEL) || promptText.includes(PPTX_SENTINEL);
  const attachments = {};

  for (const [kind, expected] of Object.entries(OFFICE_FIXTURES)) {
    const found = findExpectedAttachment(payloads, expected);
    if (!found) {
      attachments[kind] = { received: false, expected };
      continue;
    }
    const text = extractOoxmlText(found.data);
    const sentinels = expected.sentinels.map((sentinel) => ({ sentinel, found: text.includes(sentinel) }));
    if (
      options.persistReceived === true
      && found.sha256 === expected.sha256
      && found.mime === expected.mime
      && found.filename === expected.filename
      && sentinels.every((sentinel) => sentinel.found)
    ) {
      persistReceivedAttachment(kind, found.data);
    }
    attachments[kind] = {
      received: true,
      filename: found.filename,
      mime: found.mime,
      size: found.data.byteLength,
      sha256: found.sha256,
      hashMatches: found.sha256 === expected.sha256,
      mimeMatches: found.mime === expected.mime,
      filenameMatches: found.filename === expected.filename,
      sentinels,
    };
  }

  const values = Object.values(attachments);
  return {
    payloadCount: payloads.length,
    promptSentinelLeak: leak,
    attachments,
    ok: values.every((item) => item.received && item.hashMatches && item.mimeMatches && item.filenameMatches && item.sentinels.every((sentinel) => sentinel.found)) && !leak,
  };
}

function hasToolResult(value) {
  if (Array.isArray(value)) return value.some(hasToolResult);
  if (!isRecord(value)) return false;
  if (value.tool_call_id === OFFICE_TOOL_CALL_ID || value.toolCallId === OFFICE_TOOL_CALL_ID) return true;
  if (
    (value.role === "tool" || value.type === "tool-result" || value.type === "tool_result")
    && (value.name === OFFICE_TOOL_NAME || value.toolName === OFFICE_TOOL_NAME || value.tool_name === OFFICE_TOOL_NAME)
  ) return true;
  return Object.values(value).some(hasToolResult);
}

function writeSse(res, chunks) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function textStream(text, id = "chatcmpl-office-text") {
  return [
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
}

function artifactWriteCommand() {
  return `set -euo pipefail
mkdir -p artifacts
test -s ${RECEIVED_ATTACHMENT_PATHS.docx}
test -s ${RECEIVED_ATTACHMENT_PATHS.pptx}
cp ${RECEIVED_ATTACHMENT_PATHS.docx} artifacts/QuarterlyBrief.docx
cp ${RECEIVED_ATTACHMENT_PATHS.pptx} artifacts/LaunchRoadmap.pptx
(sha256sum artifacts/QuarterlyBrief.docx artifacts/LaunchRoadmap.pptx 2>/dev/null || shasum -a 256 artifacts/QuarterlyBrief.docx artifacts/LaunchRoadmap.pptx)`;
}

function toolCallStream() {
  return [
    { id: "chatcmpl-office-tool", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    {
      id: "chatcmpl-office-tool",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: OFFICE_TOOL_CALL_ID,
                type: "function",
                function: {
                  name: OFFICE_TOOL_NAME,
                  arguments: JSON.stringify({
                    description: "Write exact received Office attachments as workspace artifacts",
                    command: artifactWriteCommand(),
                    timeout: 10000,
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    { id: "chatcmpl-office-tool", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
}

function finalText() {
  return [
    `Verified ${OFFICE_FIXTURES.docx.filename}: ${DOCX_SENTINEL}`,
    `Verified ${OFFICE_FIXTURES.pptx.filename}: ${PPTX_SENTINEL}`,
    "Created artifacts/QuarterlyBrief.docx and artifacts/LaunchRoadmap.pptx from the exact received bytes.",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
const host = args.get("host") || "127.0.0.1";
const port = Number(args.get("port") || 18081);
const sockets = new Set();
let server;

clearReceivedAttachments();

const proof = {
  ok: true,
  requests: 0,
  providerReceipt: false,
  exactHashes: false,
  exactMimes: false,
  sentinelsExtracted: false,
  promptSentinelLeak: false,
  toolCallIssued: false,
  toolCallCompleted: false,
  finalResponse: false,
  replayResponse: false,
  replayOfficeHistoryOk: false,
  attachments: {},
  replay: null,
  errors: [],
};

async function readBody(req) {
  return await new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
  });
}

function updateProofFromVerification(verification, replay = false) {
  if (replay) {
    proof.replay = verification;
    proof.replayOfficeHistoryOk = verification.ok;
    return;
  }
  proof.providerReceipt = verification.ok;
  proof.exactHashes = Object.values(verification.attachments).every((item) => item.hashMatches === true);
  proof.exactMimes = Object.values(verification.attachments).every((item) => item.mimeMatches === true);
  proof.sentinelsExtracted = Object.values(verification.attachments).every((item) => item.sentinels?.every((sentinel) => sentinel.found));
  proof.promptSentinelLeak = verification.promptSentinelLeak;
  proof.attachments = verification.attachments;
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

async function handleChatCompletion(req, res) {
  proof.requests += 1;
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    proof.errors.push(`invalid JSON request: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    if (!proof.toolCallIssued) {
      const verification = verifyOfficePayloads(body, { persistReceived: true });
      updateProofFromVerification(verification, false);
      if (!verification.ok) {
        proof.ok = false;
        proof.errors.push(`initial Office verification failed: ${JSON.stringify(verification)}`);
        writeSse(res, textStream("Office attachment verification failed before tool execution."));
        return;
      }
      proof.toolCallIssued = true;
      writeSse(res, toolCallStream());
      return;
    }

    if (!proof.finalResponse) {
      proof.toolCallCompleted = hasToolResult(body);
      if (!proof.toolCallCompleted) {
        proof.ok = false;
        proof.errors.push("Expected a tool result on the second provider request.");
      }
      proof.finalResponse = true;
      writeSse(res, textStream(finalText(), "chatcmpl-office-final"));
      return;
    }

    const replayVerification = verifyOfficePayloads(body);
    updateProofFromVerification(replayVerification, true);
    proof.replayResponse = true;
    writeSse(res, textStream("Replay succeeded after reopening the session; Office attachment history remained readable and the follow-up was answered.", "chatcmpl-office-replay"));
  } catch (error) {
    proof.ok = false;
    proof.errors.push(error instanceof Error ? error.message : String(error));
    writeSse(res, textStream(`Office mock failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}

server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, { ok: true, port });
    return;
  }
  if (req.method === "GET" && url.pathname === "/proof") {
    sendJson(res, proof);
    return;
  }
  if (req.method === "POST" && url.pathname === "/shutdown") {
    sendJson(res, { ok: true });
    setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      server.close(() => process.exit(0));
    }, 50);
    return;
  }
  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
    sendJson(res, { object: "list", data: [{ id: "office-attachment-mock", object: "model" }] });
    return;
  }
  if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
    await handleChatCompletion(req, res);
    return;
  }
  sendJson(res, { error: "not found" }, 404);
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, host, port }));
});
