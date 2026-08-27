import assert from "node:assert/strict";
import {
  createDaytonaK3sCluster,
  createPlacement,
  needs,
  test,
} from "@openwork/testkit";

const K3S_BINARY = {
  version: "v1.31.6+k3s1",
  url: "https://github.com/k3s-io/k3s/releases/download/v1.31.6%2Bk3s1/k3s",
  sha256: "9f82f06b4cf318fcf4eeda3f4fedaa10c0cebc418b1a047e72b104f5ea7874c5",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("an exclusively owned Daytona sandbox boots the pinned k3s provider", { timeout: 300_000 }, async ({ evidence }) => {
  needs({
    daytona: true,
    env: ["OPENWORK_EVAL_DAYTONA_K3S_SANDBOX"],
    optIn: ["OPENWORK_EVAL_DAYTONA_K3S_LIVE"],
    commands: ["daytona"],
  });
  const ownedSandboxId = process.env.OPENWORK_EVAL_DAYTONA_K3S_SANDBOX?.trim();
  if (!ownedSandboxId) throw new Error("OPENWORK_EVAL_DAYTONA_K3S_SANDBOX was empty after needs().");
  const placement = createPlacement({
    id: "live-k3s",
    provider: "daytona-k3s",
    privileged: true,
    resources: { cpu: 4, memoryGb: 8, diskGb: 10 },
  });

  await using cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId, binary: K3S_BINARY });
  const listed = await cluster.kubectl(["get", "nodes", "-o", "json"]);
  const payload: unknown = JSON.parse(listed.stdout);
  const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
  const ready = items.some((item) => {
    if (!isRecord(item) || !isRecord(item.status) || !Array.isArray(item.status.conditions)) return false;
    return item.status.conditions.some((condition) =>
      isRecord(condition) && condition.type === "Ready" && condition.status === "True"
    );
  });
  assert.equal(listed.code, 0);
  assert.equal(items.length, 1);
  assert.equal(ready, true);
  evidence.recordAssertionEvidence(
    "A dedicated Daytona sandbox runs the pinned k3s binary and reports one Ready node",
    `k3s ${K3S_BINARY.version} returned ${items.length} node with Ready=${ready}; disposal deletes owned sandbox ${ownedSandboxId}.`,
    listed.code === 0 && items.length === 1 && ready,
  );
});
