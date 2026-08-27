import assert from "node:assert/strict";
import test from "node:test";
import type { DaytonaExec } from "@openwork/hosts";
import {
  createDaytonaK3sCluster,
  daytonaK3sExecArgv,
  daytonaK3sPreviewArgv,
  exposeK3sService,
  installK3sHelmRelease,
  parseDaytonaK3sPreviewUrl,
} from "../src/daytona-k3s.ts";
import { createPlacement } from "../src/network-world.ts";
import type { K3sBinaryDescriptor } from "../src/daytona-k3s.ts";
import type { Placement } from "../src/network-world.ts";

interface ExecCall {
  args: string[];
  opts?: { input?: string; timeoutMs?: number };
}

interface FakeOptions {
  uid?: string;
  sudoFails?: boolean;
  failAt?: "install" | "start" | "readiness" | "preview";
  helmMissing?: boolean;
}

function remoteScript(call: ExecCall): string {
  if (call.args[0] !== "exec") return "";
  assert.equal(call.args.length, 4);
  assert.deepEqual(call.args.slice(0, 3), ["exec", "owned-sandbox-1", "--"]);
  const wrapped = call.args[3] ?? "";
  const prefix = "bash -lc '";
  assert(wrapped.startsWith(prefix) && wrapped.endsWith("'"), `Unexpected Daytona exec transport: ${wrapped}`);
  return wrapped.slice(prefix.length, -1).replaceAll(`'"'"'`, "'");
}

function createFake(options: FakeOptions = {}): { exec: DaytonaExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: DaytonaExec = async (args, opts) => {
    const call = { args: [...args], opts };
    calls.push(call);
    if (args[0] === "delete") return { stdout: "deleted\n", stderr: "", code: 0 };
    if (args[0] === "preview-url") {
      if (options.failAt === "preview") return { stdout: "", stderr: "preview failed\n", code: 1 };
      return { stdout: "Preview URL: https://30443.preview.example.test/signed?token=unit\n", stderr: "", code: 0 };
    }
    const script = remoteScript(call);
    if (script === "'id' '-u'") return { stdout: `${options.uid ?? "0"}\n`, stderr: "", code: 0 };
    if (script === "'sudo' '-n' 'true'" && options.sudoFails) {
      return { stdout: "", stderr: "sudo: a password is required\n", code: 1 };
    }
    if (script.includes("'curl' '--fail'")) {
      if (options.failAt === "install") return { stdout: "", stderr: "checksum mismatch\n", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    }
    if (script.includes("'nohup'") && script.includes("'server'")) {
      if (options.failAt === "start") throw new Error("ambiguous Daytona transport failure");
      return { stdout: "", stderr: "", code: 0 };
    }
    if (script.includes("'--raw=/readyz'") && options.failAt === "readiness") {
      return { stdout: "", stderr: "owned server exited\n", code: 1 };
    }
    if (script.startsWith("'helm' ") && options.helmMissing) {
      return { stdout: "", stderr: "bash: helm: command not found\n", code: 127 };
    }
    return { stdout: "", stderr: "", code: 0 };
  };
  return { exec, calls };
}

const placement = createPlacement({ id: "unit-cluster", provider: "daytona-k3s" });
const binary: K3sBinaryDescriptor = {
  version: "v1.31.6+k3s1",
  url: "https://github.com/k3s-io/k3s/releases/download/v1.31.6%2Bk3s1/k3s",
  sha256: "a".repeat(64),
};
const root = "/tmp/openwork-world-k3s/unit-cluster";

function scripts(calls: ExecCall[]): string[] {
  return calls.filter((call) => call.args[0] === "exec").map(remoteScript);
}

function deletionCalls(calls: ExecCall[]): ExecCall[] {
  return calls.filter((call) => call.args[0] === "delete");
}

test("Daytona v0.173 argv keeps the complete quoted bash command in one post-separator argument", () => {
  assert.deepEqual(daytonaK3sExecArgv("owned-sandbox-1", "id -u"), [
    "exec", "owned-sandbox-1", "--", "bash -lc 'id -u'",
  ]);
  assert.deepEqual(daytonaK3sPreviewArgv("owned-sandbox-1", 8080, 86_400), [
    "preview-url", "owned-sandbox-1", "-p", "8080", "--expires", "86400",
  ]);
  assert.throws(() => daytonaK3sPreviewArgv("owned-sandbox-1", 8080, 86_401), /between 1 and 86400/);
  assert.equal(parseDaytonaK3sPreviewUrl("Preview URL: https://preview.example.test/path?token=abc\n"), "https://preview.example.test/path?token=abc");
  assert.equal(parseDaytonaK3sPreviewUrl(`Preview URL: https://preview.example.test/path${",".repeat(10_000)}`), "https://preview.example.test/path");
});

test("root lifecycle installs a checksummed pinned binary into placement paths and deletes its sandbox idempotently", async () => {
  const fake = createFake();
  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  const observed = scripts(fake.calls);

  assert.equal(observed[0], "'id' '-u'");
  const install = observed[1] ?? "";
  assert.match(install, new RegExp(`'curl'.*'${binary.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert(install.includes(`'printf' '%s\\n' '${binary.sha256}  ${root}/download/k3s' | 'sha256sum' '--check' '--status' '-'`));
  assert(install.includes(`'mv' '-f' '${root}/download/k3s' '${root}/bin/k3s'`));
  assert.doesNotMatch(install, /get\.k3s\.io|systemctl|openrc|rc-service/);

  const start = observed[2] ?? "";
  assert(start.includes(`'nohup' '${root}/bin/k3s' 'server' '--data-dir' '${root}/data' '--write-kubeconfig' '${root}/kubeconfig.yaml'`));
  assert(start.includes("'--node-name' 'openwork-unit-cluster'"));
  assert(start.includes("'--snapshotter' 'native'"));
  const readiness = observed[3] ?? "";
  const processProof = readiness.indexOf("'pgrep' '-f' '-x'");
  const readyz = readiness.indexOf(`'${root}/bin/k3s' 'kubectl' '--kubeconfig' '${root}/kubeconfig.yaml' 'get' '--raw=/readyz'`);
  assert(processProof >= 0 && readyz > processProof);
  assert.deepEqual(cluster.paths, {
    root,
    binary: `${root}/bin/k3s`,
    download: `${root}/download/k3s`,
    dataDir: `${root}/data`,
    kubeconfig: `${root}/kubeconfig.yaml`,
    serverLog: `${root}/server.log`,
  });

  await cluster.stop();
  await cluster.stop();
  await cluster[Symbol.asyncDispose]();
  assert.equal(deletionCalls(fake.calls).length, 1);
  assert.deepEqual(deletionCalls(fake.calls)[0], {
    args: ["delete", "owned-sandbox-1"],
    opts: { timeoutMs: 60_000, input: "y\n" },
  });
  assert(scripts(fake.calls).every((script) => !/\b(?:kill|pkill)\b|\.pid|PID/.test(script)));
});

test("non-root lifecycle requires passwordless sudo and uses it for the placement binary", async () => {
  const fake = createFake({ uid: "1000" });
  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  const observed = scripts(fake.calls);

  assert.equal(observed[0], "'id' '-u'");
  assert.equal(observed[1], "'sudo' '-n' 'true'");
  assert(observed[3]?.includes(`'nohup' 'sudo' '-n' '${root}/bin/k3s' 'server'`));
  assert(observed[4]?.includes(`'sudo' '-n' '${root}/bin/k3s' 'kubectl' '--kubeconfig' '${root}/kubeconfig.yaml'`));
  await cluster.kubectl(["get", "pods"]);
  assert.equal(scripts(fake.calls).at(-1), `'sudo' '-n' '${root}/bin/k3s' 'kubectl' '--kubeconfig' '${root}/kubeconfig.yaml' 'get' 'pods'`);
  await cluster.stop();
});

test("lack of root and passwordless sudo fails before start and deletes the owned sandbox", async () => {
  const fake = createFake({ uid: "1000", sudoFails: true });
  await assert.rejects(
    createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec }),
    /passwordless sudo.*failed|password is required/s,
  );
  assert(scripts(fake.calls).every((script) => !script.includes("'server'")));
  assert.equal(deletionCalls(fake.calls).length, 1);
});

test("every install, ambiguous start, and readiness failure deletes the entire owned sandbox", async () => {
  const failures: readonly NonNullable<FakeOptions["failAt"]>[] = ["install", "start", "readiness"];
  for (const failAt of failures) {
    const fake = createFake({ failAt });
    await assert.rejects(
      createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec }),
    );
    assert.equal(deletionCalls(fake.calls).length, 1, `expected owned sandbox deletion after ${failAt}`);
    assert(scripts(fake.calls).every((script) => !/\b(?:kill|pkill)\b|\.pid|PID/.test(script)));
  }
});

test("Helm uses the placement kubeconfig and missing Helm fails without curl-pipe installation", async () => {
  const fake = createFake({ helmMissing: true });
  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  const before = fake.calls.length;
  await assert.rejects(
    installK3sHelmRelease(cluster, { release: "demo", namespace: "demo-ns", chart: "oci://registry.example.test/team/chart" }),
    /helm: command not found/,
  );
  assert.equal(
    remoteScript(fake.calls[before] ?? { args: [] }),
    `'helm' '--kubeconfig' '${root}/kubeconfig.yaml' 'upgrade' '--install' 'demo' 'oci://registry.example.test/team/chart' '--namespace' 'demo-ns' '--create-namespace'`,
  );
  assert.equal(fake.calls.slice(before).filter((call) => remoteScript(call).includes("curl")).length, 0);
  await cluster.stop();
});

test("cluster-owned exposure reserves ports, accepts the maximum expiry, and has no independent cleanup", async () => {
  const fake = createFake();
  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  const exposure = await exposeK3sService(cluster, {
    namespace: "demo-ns",
    service: "demo-api",
    localPort: 30_443,
    servicePort: 443,
    expiresInSeconds: 86_400,
  });

  assert.equal(exposure.ephemeral, true);
  assert.equal(exposure.persistableInDesktopConfig, false);
  assert.equal(exposure.validUntil, "cluster-disposal-or-expiry");
  assert.equal(exposure.ownedSandboxId, "owned-sandbox-1");
  assert.deepEqual(fake.calls.find((call) => call.args[0] === "preview-url")?.args, [
    "preview-url", "owned-sandbox-1", "-p", "30443", "--expires", "86400",
  ]);
  const portStart = scripts(fake.calls).find((script) => script.includes("'port-forward'"));
  assert(portStart?.includes(`'${root}/bin/k3s' 'kubectl' '--kubeconfig' '${root}/kubeconfig.yaml' 'port-forward'`));
  const beforeDuplicate = fake.calls.length;
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "other",
    service: "other-api",
    localPort: 30_443,
    servicePort: 80,
    expiresInSeconds: 60,
  }), /already reserved/);
  assert.equal(fake.calls.length, beforeDuplicate);
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "other",
    service: "other-api",
    localPort: 30_444,
    servicePort: 80,
    expiresInSeconds: 86_401,
  }), /between 1 and 86400/);
  assert.equal(fake.calls.length, beforeDuplicate);
  assert.equal(deletionCalls(fake.calls).length, 0);
  await cluster.stop();
  assert.equal(deletionCalls(fake.calls).length, 1);
  assert(scripts(fake.calls).every((script) => !/\b(?:kill|pkill)\b|\.pid|PID/.test(script)));
});

test("an ambiguous exposure failure deletes the cluster sandbox instead of process cleanup", async () => {
  const fake = createFake({ failAt: "preview" });
  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "demo",
    service: "demo-api",
    localPort: 8080,
    servicePort: 80,
    expiresInSeconds: 300,
  }), /preview failed/);
  assert.equal(deletionCalls(fake.calls).length, 1);
  assert(scripts(fake.calls).every((script) => !/\b(?:kill|pkill)\b|\.pid|PID/.test(script)));
});

test("malformed placement, binary, sandbox, Helm, and exposure inputs fail before execution", async () => {
  const fake = createFake();
  const local = createPlacement({ id: "local-unit", provider: "local" });
  const missingCapability: Placement = { ...placement, capabilities: ["command:bash", "port:daytona-preview"] };
  await assert.rejects(createDaytonaK3sCluster({ placement: local, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec }), /requires placement provider/);
  await assert.rejects(createDaytonaK3sCluster({ placement, ownedSandboxId: "unsafe sandbox", binary, exec: fake.exec }), /ownedSandboxId/);
  await assert.rejects(createDaytonaK3sCluster({ placement: missingCapability, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec }), /missing capability/);
  await assert.rejects(createDaytonaK3sCluster({
    placement,
    ownedSandboxId: "owned-sandbox-1",
    binary: { ...binary, sha256: "moving" },
    exec: fake.exec,
  }), /sha256/);
  assert.equal(fake.calls.length, 0);

  const cluster = await createDaytonaK3sCluster({ placement, ownedSandboxId: "owned-sandbox-1", binary, exec: fake.exec });
  const before = fake.calls.length;
  assert.throws(() => installK3sHelmRelease(cluster, { release: "Bad Release", namespace: "demo", chart: "repo/chart" }), /Helm release/);
  assert.throws(() => installK3sHelmRelease(cluster, { release: "demo", namespace: "Bad_Namespace", chart: "repo/chart" }), /Helm namespace/);
  assert.throws(() => installK3sHelmRelease(cluster, { release: "demo", namespace: "demo", chart: "--set" }), /Helm chart/);
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "demo",
    service: "Bad_Service",
    localPort: 8080,
    servicePort: 80,
    expiresInSeconds: 300,
  }), /Kubernetes service/);
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "demo",
    service: "demo-api",
    localPort: 0,
    servicePort: 80,
    expiresInSeconds: 300,
  }), /local port/);
  await assert.rejects(exposeK3sService(cluster, {
    namespace: "demo",
    service: "demo-api",
    localPort: 8080,
    servicePort: 70_000,
    expiresInSeconds: 300,
  }), /service port/);
  await assert.rejects(cluster.kubectl(["get\npods"]), /control characters/);
  assert.equal(fake.calls.length, before);
  await cluster.stop();
});
