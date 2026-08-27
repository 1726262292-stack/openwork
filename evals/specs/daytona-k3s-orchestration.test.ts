import assert from "node:assert/strict";
import type { DaytonaExec } from "@openwork/hosts";
import {
  createDaytonaK3sCluster,
  createPlacement,
  exposeK3sService,
  exposePort,
  installK3sHelmRelease,
  placementHasCapability,
  test,
} from "@openwork/testkit";
import type { K3sBinaryDescriptor } from "@openwork/testkit";

function remoteScript(args: string[]): string {
  const wrapped = args[3] ?? "";
  const prefix = "bash -lc '";
  assert.deepEqual(args.slice(0, 3), ["exec", "owned-contract-sandbox", "--"]);
  assert.equal(args.length, 4);
  assert(wrapped.startsWith(prefix) && wrapped.endsWith("'"));
  return wrapped.slice(prefix.length, -1).replaceAll(`'"'"'`, "'");
}

test("exclusive Daytona k3s lifecycle composes with network plans through injected orchestration", async ({ evidence }) => {
  const calls: string[][] = [];
  const exec: DaytonaExec = async (args) => {
    calls.push([...args]);
    if (args[0] === "delete") return { stdout: "deleted\n", stderr: "", code: 0 };
    if (args[0] === "preview-url") {
      return { stdout: "Preview URL: https://32005.preview.example.test/signed?token=contract\n", stderr: "", code: 0 };
    }
    const script = remoteScript(args);
    if (script === "'id' '-u'") return { stdout: "0\n", stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  };
  const binary: K3sBinaryDescriptor = {
    version: "v1.31.6+k3s1",
    url: "https://github.com/k3s-io/k3s/releases/download/v1.31.6%2Bk3s1/k3s",
    sha256: "b".repeat(64),
  };
  const placement = createPlacement({ id: "contract-cluster", provider: "daytona-k3s" });
  const portPlan = exposePort(placement, 32_005);
  assert.equal(placementHasCapability(placement, "kubernetes:k3s"), true);
  assert.equal(portPlan.mode, "daytona-preview");

  const cluster = await createDaytonaK3sCluster({
    placement,
    ownedSandboxId: "owned-contract-sandbox",
    binary,
    exec,
  });
  await installK3sHelmRelease(cluster, { release: "contract", namespace: "contract", chart: "repo/contract" });
  const exposure = await exposeK3sService(cluster, {
    namespace: "contract",
    service: "contract-api",
    localPort: portPlan.port,
    servicePort: 3005,
    expiresInSeconds: 600,
  });
  assert.equal(exposure.placementId, portPlan.placementId);
  assert.equal(exposure.localPort, portPlan.port);
  assert.equal(exposure.ephemeral, true);
  assert.equal(exposure.persistableInDesktopConfig, false);
  assert.equal(exposure.validUntil, "cluster-disposal-or-expiry");
  assert.deepEqual(calls.find((args) => args[0] === "preview-url"), [
    "preview-url", "owned-contract-sandbox", "-p", "32005", "--expires", "600",
  ]);

  await cluster.stop();
  await cluster[Symbol.asyncDispose]();
  assert.equal(calls.filter((args) => args[0] === "delete").length, 1);
  const scripts = calls.filter((args) => args[0] === "exec").map(remoteScript);
  assert(scripts.some((script) => script.includes("'sha256sum' '--check' '--status' '-'")));
  assert(scripts.some((script) => script.includes("'helm' '--kubeconfig' '/tmp/openwork-world-k3s/contract-cluster/kubeconfig.yaml'")));
  assert(scripts.every((script) => !/\b(?:kill|pkill)\b|\.pid|PID/.test(script)));
  evidence.recordAssertionEvidence(
    "Exclusive-sandbox Daytona k3s orchestration composes with network plans (not live k3s behavior)",
    `The injected executor observed ${calls.length} contract calls, a checksummed placement binary, a 600-second ephemeral preview, and one idempotent whole-sandbox deletion with no PID or kill cleanup; no live Daytona or k3s behavior is claimed.`,
    true,
  );
});
