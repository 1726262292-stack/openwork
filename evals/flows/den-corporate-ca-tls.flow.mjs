/**
 * App-less integration proof for a corporate CA on an outbound Den OAuth MCP.
 * Intended to run in the Daytona server sandbox after its MySQL schema is up.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "den-corporate-ca-tls";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vo = await loadVoiceoverParagraphs(FLOW_ID);

function witness(ctx, condition, assertion, actual) {
  if (!condition) {
    ctx.recordEvidence({ type: "assertion", status: "failed", assertion, actual });
    ctx.assert(false, assertion + (actual ? ` (actual: ${actual})` : ""));
  }
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual });
}

export default {
  id: FLOW_ID,
  title: "Den trusts an explicitly mounted corporate CA for OAuth MCP discovery",
  kind: "internal",
  spec: "evals/den-corporate-ca-tls.md",
  requiresApp: false,
  steps: [
    {
      name: "The same Den OAuth route fails before CA injection and succeeds after it",
      run: async (ctx) => {
        await ctx.prove("NODE_EXTRA_CA_CERTS changes the real Den OAuth result from 502 fetch failed to needs_auth", {
          voiceover: vo[0],
          assert: async () => {
            const result = spawnSync("bash", [join(ROOT, "scripts", "support", "repro-den-corporate-ca.sh")], {
              cwd: ROOT,
              encoding: "utf8",
              env: process.env,
              maxBuffer: 4 * 1024 * 1024,
              timeout: 180_000,
            });
            const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
            ctx.output("corporate-ca-reproduction", output);
            witness(ctx, result.status === 0, "The corporate CA integration repro exits successfully", `status=${result.status}\n${output.slice(-2000)}`);
            witness(ctx, output.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") || output.includes("SELF_SIGNED_CERT_IN_CHAIN") || output.includes("UNABLE_TO_GET_ISSUER_CERT"), "The control request records a certificate-chain rejection");
            witness(ctx, output.includes('"expected": "untrusted"') && output.includes('"status": 502'), "The real Den route returns 502 without the corporate CA");
            witness(ctx, output.includes('"expected": "trusted"') && output.includes('"status": 200') && output.includes('"status": "needs_auth"'), "The same Den route reaches OAuth discovery with the corporate CA");
            witness(ctx, output.includes("PASS: the same Den OAuth route fails without the corporate CA and reaches needs_auth"), "The harness reports its final before/after invariant");
          },
        });
      },
    },
  ],
};
