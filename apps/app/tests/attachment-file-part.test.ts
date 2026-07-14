import { describe, expect, test } from "bun:test";

import type { ComposerAttachment } from "../src/app/types";
import { composerAttachmentToFilePart, resolveAttachmentFileMetadata } from "../src/react-app/domains/session/sync/attachment-file-part";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x77, 0x6f, 0x72, 0x64]);
const PPTX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x70, 0x70, 0x74, 0x78]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function attachmentFor(file: File, metadata: Partial<Pick<ComposerAttachment, "name" | "mimeType" | "kind">> = {}): ComposerAttachment {
  return {
    id: "attachment-1",
    name: metadata.name ?? file.name,
    mimeType: metadata.mimeType ?? file.type,
    size: file.size,
    kind: metadata.kind ?? (file.type.startsWith("image/") ? "image" : "file"),
    file,
  };
}

function decodedDataUrlBytes(url: string) {
  const marker = ";base64,";
  const markerIndex = url.indexOf(marker);
  expect(markerIndex).toBeGreaterThan(0);
  const binary = atob(url.slice(markerIndex + marker.length));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

describe("composer attachment file parts", () => {
  test("preserves JPEG filename, mime, data URL, and exact bytes", async () => {
    const file = new File([JPEG_BYTES], "PassaportoPaolo_small.jpg", { type: "image/jpeg" });
    const part = await composerAttachmentToFilePart(attachmentFor(file));

    expect(part.filename).toBe("PassaportoPaolo_small.jpg");
    expect(part.mime).toBe("image/jpeg");
    expect(part.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(Array.from(decodedDataUrlBytes(part.url))).toEqual(Array.from(JPEG_BYTES));
  });

  test("stale ComposerAttachment PDF metadata cannot override an underlying JPEG File", async () => {
    const file = new File([JPEG_BYTES], "PassaportoPaolo_small.jpg", { type: "image/jpeg" });
    const part = await composerAttachmentToFilePart(attachmentFor(file, {
      name: "PassaportoPaolo_small.pdf",
      mimeType: "application/pdf",
      kind: "file",
    }));

    expect(part.filename).toBe("PassaportoPaolo_small.jpg");
    expect(part.mime).toBe("image/jpeg");
    expect(part.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  test("generic MIME resolves from supported .pdf and .png extensions", () => {
    expect(resolveAttachmentFileMetadata(new File([JPEG_BYTES], "scan.pdf", { type: "application/octet-stream" }))).toMatchObject({
      filename: "scan.pdf",
      mime: "application/pdf",
      kind: "file",
      readable: true,
    });
    expect(resolveAttachmentFileMetadata(new File([JPEG_BYTES], "scan.png", { type: "" }))).toMatchObject({
      filename: "scan.png",
      mime: "image/png",
      kind: "image",
      readable: true,
    });
  });

  test("preserves canonical Office MIME, data URL headers, filenames, and exact bytes", async () => {
    const docx = new File([DOCX_BYTES], "PlanningMemo.docx", { type: DOCX_MIME });
    const pptx = new File([PPTX_BYTES], "RoadshowDeck.pptx", { type: PPTX_MIME });

    expect(resolveAttachmentFileMetadata(docx)).toMatchObject({
      filename: "PlanningMemo.docx",
      mime: DOCX_MIME,
      kind: "file",
      readable: true,
    });
    expect(resolveAttachmentFileMetadata(pptx)).toMatchObject({
      filename: "RoadshowDeck.pptx",
      mime: PPTX_MIME,
      kind: "file",
      readable: true,
    });

    const docxPart = await composerAttachmentToFilePart(attachmentFor(docx));
    const pptxPart = await composerAttachmentToFilePart(attachmentFor(pptx));

    expect(docxPart.filename).toBe("PlanningMemo.docx");
    expect(docxPart.mime).toBe(DOCX_MIME);
    expect(docxPart.url.startsWith(`data:${DOCX_MIME};base64,`)).toBe(true);
    expect(Array.from(decodedDataUrlBytes(docxPart.url))).toEqual(Array.from(DOCX_BYTES));

    expect(pptxPart.filename).toBe("RoadshowDeck.pptx");
    expect(pptxPart.mime).toBe(PPTX_MIME);
    expect(pptxPart.url.startsWith(`data:${PPTX_MIME};base64,`)).toBe(true);
    expect(Array.from(decodedDataUrlBytes(pptxPart.url))).toEqual(Array.from(PPTX_BYTES));
  });

  test("resolves generic Office MIME from case-insensitive extensions without coercing bytes to text", async () => {
    const docx = new File([DOCX_BYTES], "QuarterlyReport.DOCX", { type: "application/octet-stream" });
    const pptx = new File([PPTX_BYTES], "LaunchPlan.PPTX", { type: "" });

    expect(resolveAttachmentFileMetadata(docx)).toMatchObject({
      filename: "QuarterlyReport.DOCX",
      mime: DOCX_MIME,
      kind: "file",
      readable: true,
    });
    expect(resolveAttachmentFileMetadata(pptx)).toMatchObject({
      filename: "LaunchPlan.PPTX",
      mime: PPTX_MIME,
      kind: "file",
      readable: true,
    });

    const docxPart = await composerAttachmentToFilePart(attachmentFor(docx));
    const pptxPart = await composerAttachmentToFilePart(attachmentFor(pptx));

    expect(docxPart.filename).toBe("QuarterlyReport.DOCX");
    expect(docxPart.mime).toBe(DOCX_MIME);
    expect(docxPart.url.startsWith(`data:${DOCX_MIME};base64,`)).toBe(true);
    expect(Array.from(decodedDataUrlBytes(docxPart.url))).toEqual(Array.from(DOCX_BYTES));

    expect(pptxPart.filename).toBe("LaunchPlan.PPTX");
    expect(pptxPart.mime).toBe(PPTX_MIME);
    expect(pptxPart.url.startsWith(`data:${PPTX_MIME};base64,`)).toBe(true);
    expect(Array.from(decodedDataUrlBytes(pptxPart.url))).toEqual(Array.from(PPTX_BYTES));
  });

  test("normalizes Office filename extensions from canonical MIME when filenames disagree", async () => {
    const docxNamedBin = new File([DOCX_BYTES], "PlanningMemo.bin", { type: DOCX_MIME });
    const pptxWithoutExtension = new File([PPTX_BYTES], "RoadshowDeck", { type: PPTX_MIME });

    expect((await composerAttachmentToFilePart(attachmentFor(docxNamedBin))).filename).toBe("PlanningMemo.docx");
    expect((await composerAttachmentToFilePart(attachmentFor(pptxWithoutExtension))).filename).toBe("RoadshowDeck.pptx");
  });

  test("rejects unsupported binary attachments instead of broadly treating generic bytes as text", () => {
    expect(resolveAttachmentFileMetadata(new File([PPTX_BYTES], "board.key", { type: "application/octet-stream" }))).toMatchObject({
      filename: "board.key",
      mime: "application/octet-stream",
      kind: "file",
      readable: false,
    });
    expect(resolveAttachmentFileMetadata(new File([PPTX_BYTES], "board.key", { type: "application/x-iwork-keynote-sffkey" }))).toMatchObject({
      filename: "board.key",
      mime: "application/x-iwork-keynote-sffkey",
      kind: "file",
      readable: false,
    });
    expect(resolveAttachmentFileMetadata(new File([PPTX_BYTES], "archive.zip", { type: "" }))).toMatchObject({
      filename: "archive.zip",
      mime: "application/octet-stream",
      kind: "file",
      readable: false,
    });
  });

  test("known MIME and filename extension conflicts normalize outbound filename extension", async () => {
    const imageNamedPdf = new File([JPEG_BYTES], "PassaportoPaolo_small.pdf", { type: "image/jpeg" });
    const pdfNamedPng = new File([JPEG_BYTES], "scan.png", { type: "application/pdf" });

    expect((await composerAttachmentToFilePart(attachmentFor(imageNamedPdf))).filename).toBe("PassaportoPaolo_small.jpg");
    expect((await composerAttachmentToFilePart(attachmentFor(pdfNamedPng))).filename).toBe("scan.pdf");
  });
});
