import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { test } from "node:test";

import { startEnterpriseTlsReverseEdge } from "../src/egress.ts";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("server did not bind"));
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(url: string, options: { ca?: string; method?: string; path?: string; body?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = https.request({
      hostname: target.hostname,
      port: target.port,
      ca: options.ca,
      method: options.method,
      path: options.path ?? `${target.pathname}${target.search}`,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

test("enterprise TLS edge pins its upstream and exposes selective trust", async () => {
  const upstreamRequests: { method: string; url: string; body: string }[] = [];
  const upstream = http.createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    upstreamRequests.push({ method: incoming.method ?? "GET", url: incoming.url ?? "/", body: Buffer.concat(chunks).toString("utf8") });
    response.end("from-pinned-upstream");
  });
  const attackerHits: string[] = [];
  const attacker = http.createServer((incoming, response) => {
    attackerHits.push(incoming.url ?? "/");
    response.end("attacker");
  });
  const upstreamPort = await listen(upstream);
  const attackerPort = await listen(attacker);
  const edge = await startEnterpriseTlsReverseEdge({ upstream: `http://127.0.0.1:${upstreamPort}` });
  const rootPath = edge.rootPemPath;
  try {
    await assert.rejects(request(`${edge.candidateUrl}/default-trust`));
    assert.equal(await request(`${edge.candidateUrl}/v1/me?full=1`, { ca: edge.rootPem, method: "POST", body: "payload" }), "from-pinned-upstream");
    await assert.rejects(request(`${edge.negativeUrl}/negative`, { ca: edge.rootPem }));

    const absoluteTarget = `http://127.0.0.1:${attackerPort}/stolen?token=yes`;
    assert.equal(await request(edge.candidateUrl, { ca: edge.rootPem, path: absoluteTarget }), "from-pinned-upstream");
    assert.deepEqual(attackerHits, []);
    assert.deepEqual(upstreamRequests, [
      { method: "POST", url: "/v1/me?full=1", body: "payload" },
      { method: "GET", url: "/stolen?token=yes", body: "" },
    ]);
    assert.deepEqual(edge.requests.map(({ endpoint, method, path, body }) => ({ endpoint, method, path, body })), [
      { endpoint: "trusted-candidate", method: "POST", path: "/v1/me?full=1", body: "payload" },
      { endpoint: "trusted-candidate", method: "GET", path: "/stolen?token=yes", body: "" },
    ]);
    assert.equal(edge.linuxTrust.restartApplication, true);
    assert.equal(edge.linuxTrust.install()[1]?.file, "/usr/sbin/update-ca-certificates");
    assert.equal(edge.linuxTrust.prerequisiteFailures.root, "ENTERPRISE_TLS_LINUX_ROOT_REQUIRED");
    const prerequisites = await edge.linuxTrust.checkPrerequisites();
    if (!prerequisites.ok) {
      assert.ok([
        "ENTERPRISE_TLS_LINUX_ROOT_REQUIRED",
        "ENTERPRISE_TLS_UPDATE_CA_CERTIFICATES_REQUIRED",
      ].includes(prerequisites.failure));
    }
  } finally {
    await edge.stop();
    await Promise.all([close(upstream), close(attacker)]);
  }
  await assert.rejects(access(rootPath));
  await assert.rejects(request(edge.candidateUrl, { ca: edge.rootPem }));
});
