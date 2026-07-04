/**
 * fraimz on the PR: render the frame-by-frame proof as a PR comment and post
 * it with `gh`. The comment is the reviewable demo (verdict + per-frame claim,
 * voiceover, assertions); `fraimz.html` in the run directory stays the full
 * artifact with validated screenshots.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export function renderPrComment(report, imageUrls = null) {
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
          if (imageUrls?.[evidence.file]) {
            lines.push("", `   <img src="${imageUrls[evidence.file]}" alt="${evidence.file}" width="700">`, "");
          }
        }
      }
      if (step.status === "failed") lines.push(`   - ❌ **${step.name}** — ${step.error}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function uploadRunImages(report, outDir) {
  const files = [];
  const seen = new Set();
  for (const flow of report.flows) {
    for (const step of flow.steps ?? []) {
      for (const evidence of step.evidence ?? []) {
        if (evidence.type === "frame" && !seen.has(evidence.file) && existsSync(join(outDir, evidence.file))) {
          seen.add(evidence.file);
          files.push(evidence.file);
        }
      }
    }
  }
  if (files.length === 0) return null;

  const repoResult = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" });
  if (repoResult.error || repoResult.status !== 0) {
    const detail = repoResult.error?.message ?? repoResult.stderr?.trim() ?? `gh exited ${repoResult.status}`;
    throw new Error(`gh repo view failed: ${detail}`);
  }
  const nameWithOwner = repoResult.stdout.trim();
  if (!nameWithOwner) throw new Error("gh repo view failed: empty nameWithOwner");

  const payloadPath = join(outDir, ".gh-api-payload.json");
  const ghApi = (args, inputJson = null) => {
    const ghArgs = ["api", ...args];
    if (inputJson !== null) {
      writeFileSync(payloadPath, `${JSON.stringify(inputJson)}\n`);
      ghArgs.push("--input", payloadPath);
    }
    const result = spawnSync("gh", ghArgs, { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr?.trim() ?? `gh exited ${result.status}`;
      throw new Error(`gh api ${args.join(" ")} failed: ${detail}`);
    }
    return result.stdout.trim();
  };

  try {
    const uploads = [];
    for (const file of files) {
      const blobSha = ghApi([`repos/${nameWithOwner}/git/blobs`, "--jq", ".sha"], {
        content: readFileSync(join(outDir, file)).toString("base64"),
        encoding: "base64",
      });
      uploads.push({ file, blobSha });
    }

    const headResult = spawnSync("gh", ["api", `repos/${nameWithOwner}/git/ref/heads/fraimz-assets`, "--jq", ".object.sha"], { encoding: "utf8" });
    if (headResult.error) throw new Error(`gh api repos/${nameWithOwner}/git/ref/heads/fraimz-assets failed: ${headResult.error.message}`);
    const headSha = headResult.status === 0 ? headResult.stdout.trim() : null;
    const parentTreeSha = headSha ? ghApi([`repos/${nameWithOwner}/git/commits/${headSha}`, "--jq", ".tree.sha"]) : null;
    const treePayload = parentTreeSha
      ? { base_tree: parentTreeSha, tree: uploads.map(({ file, blobSha }) => ({ path: `${report.runId}/${file}`, mode: "100644", type: "blob", sha: blobSha })) }
      : { tree: uploads.map(({ file, blobSha }) => ({ path: `${report.runId}/${file}`, mode: "100644", type: "blob", sha: blobSha })) };
    const treeSha = ghApi([`repos/${nameWithOwner}/git/trees`, "--jq", ".sha"], treePayload);
    const commitSha = ghApi([`repos/${nameWithOwner}/git/commits`, "--jq", ".sha"], {
      message: `fraimz assets ${report.runId}`,
      tree: treeSha,
      parents: headSha ? [headSha] : [],
    });
    if (headSha) {
      ghApi(["-X", "PATCH", `repos/${nameWithOwner}/git/refs/heads/fraimz-assets`], { sha: commitSha });
    } else {
      ghApi([`repos/${nameWithOwner}/git/refs`], { ref: "refs/heads/fraimz-assets", sha: commitSha });
    }

    const imageUrls = {};
    for (const file of files) {
      imageUrls[file] = `https://raw.githubusercontent.com/${nameWithOwner}/${commitSha}/${report.runId}/${encodeURIComponent(file)}`;
    }
    return imageUrls;
  } finally {
    rmSync(payloadPath, { force: true });
  }
}

/**
 * Post the comment with `gh pr comment`. `prNumber` may be null: gh then
 * targets the PR of the current branch. Returns { posted, detail }.
 */
export async function postPrComment(report, { outDir, prNumber = null } = {}) {
  let imageUrls = null;
  let uploadError = null;
  try {
    imageUrls = await uploadRunImages(report, outDir);
  } catch (error) {
    uploadError = error instanceof Error ? error.message : String(error);
  }
  const body = `${renderPrComment(report, imageUrls)}${uploadError ? `\n\n_(screenshot upload failed: ${uploadError} — images available in the run directory)_` : ""}`;
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
