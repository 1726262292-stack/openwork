/**
 * fraimz on the PR: render the frame-by-frame proof as a PR comment and post
 * it with `gh`. The comment is the reviewable demo (verdict + per-frame claim,
 * voiceover, assertions, and the actual screenshot); `fraimz.html` in the run
 * directory stays the full artifact.
 *
 * GitHub PR comments can't reference local file paths, so every frame
 * screenshot is uploaded to Vercel Blob first (zero-dependency: plain fetch,
 * same approach as the `upload-photo` skill) and embedded by public URL.
 * Requires BLOB_READ_WRITE_TOKEN; when it's missing (or every upload fails)
 * the comment still posts, just without inline images — never blocks the run.
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BLOB_UPLOAD_PREFIX = "openwork-fraimz";

function blobContentTypeFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function encodeBlobPathname(pathname) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Upload one screenshot to Vercel Blob. Never throws — returns null on any failure. */
async function uploadScreenshotToBlob({ filePath, pathname, token }) {
  try {
    const body = await readFile(filePath);
    const response = await fetch(`https://blob.vercel-storage.com/${encodeBlobPathname(pathname)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-content-type": blobContentTypeFor(filePath),
        // Deterministic pathname (runId + file is already unique) so re-runs
        // of the same run id overwrite instead of accumulating blobs.
        "x-add-random-suffix": "0",
      },
      body,
    });
    if (!response.ok) {
      console.error(`fraimz: blob upload failed (${response.status}) for ${filePath}`);
      return null;
    }
    const payload = await response.json();
    return typeof payload?.url === "string" && payload.url ? payload.url : null;
  } catch (error) {
    console.error(`fraimz: blob upload error for ${filePath}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Upload every frame screenshot referenced in the report to Vercel Blob.
 * Returns a Map<fileName, publicUrl> — empty when BLOB_READ_WRITE_TOKEN is
 * unset or there is nothing to upload; individual failures are just omitted.
 */
export async function uploadReportScreenshots(report, { outDir, runId = report.runId } = {}) {
  const imageUrls = new Map();
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const files = new Set();
  for (const flow of report.flows ?? []) {
    for (const step of flow.steps ?? []) {
      for (const evidence of step.evidence ?? []) {
        if (evidence.type === "frame" && evidence.file) files.add(evidence.file);
      }
    }
  }
  if (!token || files.size === 0) return imageUrls;

  await Promise.all(
    [...files].map(async (file) => {
      const url = await uploadScreenshotToBlob({
        filePath: join(outDir, file),
        pathname: `${BLOB_UPLOAD_PREFIX}/${runId}/${file}`,
        token,
      });
      if (url) imageUrls.set(file, url);
    }),
  );
  return imageUrls;
}

export function renderPrComment(report, { imageUrls = new Map() } = {}) {
  const verdict = report.summary.failed > 0 ? "❌ FAILED" : "✅ PASSED";
  const lines = [
    `## fraimz — ${verdict}`,
    "",
    `${report.summary.passed} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped — run \`${report.runId}\``,
    "",
    `Full frame proof with validated screenshots: \`evals/results/${report.runId}/fraimz.html\` (re-run: \`pnpm fraimz ${report.flows.map((flow) => `--flow ${flow.id}`).join(" ")}\`)`,
    "",
  ];
  for (const flow of report.flows) {
    const icon = flow.status === "passed" ? "✅" : flow.status === "skipped" ? "⏭️" : "❌";
    lines.push(`### ${icon} ${flow.id} — ${flow.title}`);
    if (flow.kind) lines.push(`_${flow.kind === "user-facing" ? "User-facing flow demo" : "Internal demo"}_`);
    if (flow.skipReason) lines.push(`Skipped: ${flow.skipReason}`);
    lines.push("");
    let frame = 0;
    for (const step of flow.steps ?? []) {
      for (const evidence of step.evidence ?? []) {
        if (evidence.type === "claim" && evidence.status === "passed") {
          frame += 1;
          lines.push(`${frame}. **${evidence.claim ?? evidence.name}**`);
          if (evidence.voiceover) lines.push(`   > 🎙 ${evidence.voiceover}`);
        }
        if (evidence.type === "assertion") {
          lines.push(`   - ${evidence.status === "passed" ? "✅" : "❌"} ${evidence.assertion}`);
        }
        if (evidence.type === "frame") {
          const failed = (evidence.validations ?? []).filter((validation) => !validation.passed);
          lines.push(
            `   - 📸 \`${evidence.file}\` — ${failed.length === 0 ? `${(evidence.validations ?? []).length} validations passed` : `FAILED: ${failed.map((validation) => validation.label).join(", ")}`}`,
          );
          const imageUrl = imageUrls.get(evidence.file);
          if (imageUrl) {
            // Not indented: 4+ space indentation inside a list item renders
            // as a code block on GitHub instead of an image.
            const alt = (evidence.claim ?? evidence.name ?? evidence.file).replace(/"/g, "'");
            lines.push("");
            lines.push(`<img src="${imageUrl}" alt="${alt}" width="720">`);
            lines.push("");
          }
        }
      }
      if (step.status === "failed") lines.push(`   - ❌ **${step.name}** — ${step.error}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Post the comment with `gh pr comment`. `prNumber` may be null: gh then
 * targets the PR of the current branch. Returns { posted, detail }.
 */
export async function postPrComment(report, { outDir, prNumber = null } = {}) {
  const imageUrls = await uploadReportScreenshots(report, { outDir });
  if (imageUrls.size === 0 && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    console.error(
      "fraimz: BLOB_READ_WRITE_TOKEN is not set — posting without inline screenshots. " +
        'Fetch it with the get-env-var skill: export BLOB_READ_WRITE_TOKEN="$(infisical secrets get BLOB_READ_WRITE_TOKEN --plain --silent)"',
    );
  }
  const body = renderPrComment(report, { imageUrls });
  const bodyPath = join(outDir, "pr-comment.md");
  await writeFile(bodyPath, body);
  const args = ["pr", "comment", ...(prNumber ? [String(prNumber)] : []), "--body-file", bodyPath];
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `gh exited ${result.status}`;
    return { posted: false, bodyPath, detail };
  }
  return { posted: true, bodyPath, detail: result.stdout.trim() };
}
