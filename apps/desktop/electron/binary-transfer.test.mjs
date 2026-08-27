import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DESKTOP_TRANSFER_MAX_BYTES,
  downloadBinaryToPath,
  uploadMultipartFromPath,
} from "./binary-transfer.mjs";

async function withWorkspace(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openwork-binary-transfer-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function remoteResponse(bytes, init = {}) {
  return new Response(bytes, { status: 200, headers: init.headers });
}

function matchesError(error, code, messagePattern) {
  return error instanceof Error
    && Reflect.get(error, "code") === code
    && (!messagePattern || messagePattern.test(error.message));
}

test("uploads exact original multipart bytes with spaces and Unicode in the filename", async () => {
  await withWorkspace(async (root) => {
    const filename = "résumé image 你好.bin";
    const filePath = path.join(root, filename);
    const original = Uint8Array.from([0, 1, 2, 127, 128, 200, 254, 255]);
    await writeFile(filePath, original);

    const result = await uploadMultipartFromPath({
      url: "https://worker.example.test/inbox",
      filePath,
      filename,
      size: original.byteLength,
      contentType: "application/octet-stream",
      fields: { path: `uploads/${filename}` },
      headers: { Authorization: "Bearer test" },
    }, {
      authorizedRoots: [root],
      fetcher: async (url, init) => {
        const request = new Request(url, init);
        const form = await request.formData();
        const file = form.get("file");
        assert.ok(file instanceof Blob);
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), original);
        assert.equal(file.name, filename);
        assert.equal(form.get("path"), `uploads/${filename}`);
        assert.equal(request.headers.get("authorization"), "Bearer test");
        return Response.json({ ok: true });
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body, '{"ok":true}');
  });
});

test("downloads high bytes exactly and atomically removes the temporary file", async () => {
  await withWorkspace(async (root) => {
    const destinationPath = path.join(root, "saved files", "資料 high bytes.bin");
    await mkdir(path.dirname(destinationPath), { recursive: true });
    const original = Uint8Array.from([255, 254, 253, 0, 128, 129, 200, 10]);

    const result = await downloadBinaryToPath({
      url: "https://worker.example.test/files/raw",
      destinationPath,
    }, {
      authorizedRoots: [root],
      fetcher: async () => remoteResponse(original, {
        headers: { "content-type": "application/octet-stream" },
      }),
    });

    assert.equal(result.path, destinationPath);
    assert.equal(result.bytes, original.byteLength);
    assert.deepEqual(new Uint8Array(await readFile(destinationPath)), original);
    assert.deepEqual(await readdir(path.dirname(destinationPath)), [path.basename(destinationPath)]);
  });
});

test("rejects zero-byte and oversized uploads with clear error codes", async () => {
  await withWorkspace(async (root) => {
    const emptyPath = path.join(root, "empty.bin");
    await writeFile(emptyPath, "");
    await assert.rejects(
      uploadMultipartFromPath({
        url: "https://worker.example.test/inbox",
        filePath: emptyPath,
        filename: "empty.bin",
        size: 0,
      }, { authorizedRoots: [root], fetcher: async () => Response.json({}) }),
      (error) => matchesError(error, "zero-byte-file", /greater than zero/i),
    );

    const filePath = path.join(root, "small.bin");
    await writeFile(filePath, "x");
    await assert.rejects(
      uploadMultipartFromPath({
        url: "https://worker.example.test/inbox",
        filePath,
        filename: "small.bin",
        size: DESKTOP_TRANSFER_MAX_BYTES + 1,
      }, { authorizedRoots: [root], fetcher: async () => Response.json({}) }),
      (error) => matchesError(error, "file-too-large", /limit/i),
    );
  });
});

test("rejects zero-byte and oversized downloads without leaving partial files", async () => {
  await withWorkspace(async (root) => {
    const zeroDestination = path.join(root, "zero.bin");
    await assert.rejects(
      downloadBinaryToPath({
        url: "https://worker.example.test/file",
        destinationPath: zeroDestination,
      }, { authorizedRoots: [root], fetcher: async () => remoteResponse(new Uint8Array()) }),
      (error) => matchesError(error, "zero-byte-file", /empty/i),
    );
    await assert.rejects(readFile(zeroDestination), { code: "ENOENT" });

    const largeDestination = path.join(root, "large.bin");
    await assert.rejects(
      downloadBinaryToPath({
        url: "https://worker.example.test/file",
        destinationPath: largeDestination,
        maxBytes: 3,
      }, { authorizedRoots: [root], fetcher: async () => remoteResponse(Uint8Array.from([1, 2, 3, 4])) }),
      (error) => matchesError(error, "file-too-large", /limit/i),
    );
    await assert.rejects(readFile(largeDestination), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), []);
  });
});

test("cancellation removes the incomplete download", async () => {
  await withWorkspace(async (root) => {
    const destinationPath = path.join(root, "cancelled.bin");
    const controller = new AbortController();
    const response = new Response(new ReadableStream({
      pull(streamController) {
        streamController.enqueue(Uint8Array.from([1, 2, 3]));
        controller.abort();
      },
    }));

    await assert.rejects(
      downloadBinaryToPath({
        url: "https://worker.example.test/file",
        destinationPath,
      }, { authorizedRoots: [root], fetcher: async () => response, signal: controller.signal }),
      (error) => error instanceof Error && error.name === "AbortError",
    );

    await assert.rejects(readFile(destinationPath), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), []);
  });
});

test("rejects unauthorized, traversal, and symlink upload paths", async () => {
  await withWorkspace(async (root) => {
    const authorizedRoot = path.join(root, "workspace");
    const outsideRoot = path.join(root, "outside");
    await mkdir(authorizedRoot);
    await mkdir(outsideRoot);
    const outsidePath = path.join(outsideRoot, "secret.bin");
    await writeFile(outsidePath, "secret");

    const input = {
      url: "https://worker.example.test/inbox",
      filename: "secret.bin",
      size: 6,
    };
    const options = { authorizedRoots: [authorizedRoot], fetcher: async () => Response.json({}) };

    await assert.rejects(
      uploadMultipartFromPath({ ...input, filePath: outsidePath }, options),
      (error) => matchesError(error, "unauthorized-path"),
    );
    await assert.rejects(
      uploadMultipartFromPath({ ...input, filePath: path.join(authorizedRoot, "..", "outside", "secret.bin") }, options),
      (error) => matchesError(error, "unauthorized-path"),
    );

    const symlinkPath = path.join(authorizedRoot, "linked.bin");
    await symlink(outsidePath, symlinkPath);
    await assert.rejects(
      uploadMultipartFromPath({ ...input, filePath: symlinkPath }, options),
      (error) => matchesError(error, "symlink-path"),
    );
  });
});

test("rejects traversal and symlink download destinations", async () => {
  await withWorkspace(async (root) => {
    const authorizedRoot = path.join(root, "workspace");
    const outsideRoot = path.join(root, "outside");
    await mkdir(authorizedRoot);
    await mkdir(outsideRoot);
    const options = {
      authorizedRoots: [authorizedRoot],
      fetcher: async () => remoteResponse(Uint8Array.from([1])),
    };

    await assert.rejects(
      downloadBinaryToPath({
        url: "https://worker.example.test/file",
        destinationPath: path.join(authorizedRoot, "..", "outside", "escape.bin"),
      }, options),
      (error) => matchesError(error, "unauthorized-path"),
    );

    const linkedDirectory = path.join(authorizedRoot, "linked");
    await symlink(outsideRoot, linkedDirectory, "dir");
    await assert.rejects(
      downloadBinaryToPath({
        url: "https://worker.example.test/file",
        destinationPath: path.join(linkedDirectory, "escape.bin"),
      }, options),
      (error) => matchesError(error, "symlink-path"),
    );
  });
});
