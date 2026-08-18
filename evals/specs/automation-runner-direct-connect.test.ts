import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { test, eventually, sleep } from "@openwork/testkit";
import { createDesktopAutomationRunner } from "../../apps/desktop/electron/automation-runner.mjs";

// den-api reads its environment at module load, so the runner-auth module is
// imported dynamically after these are present. Values mirror the den-api unit
// test setup; nothing here talks to a database.
process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test";
process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32);
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790";

type WitnessRequest = { path: string; authorization: string; accept: string };

function startApiOriginWitness() {
  const requests: WitnessRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push({
      path: request.url ?? "",
      authorization: request.headers.authorization ?? "",
      accept: request.headers.accept ?? "",
    });
    if (request.url === "/v1/automation-runners/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("event: keepalive\ndata: {}\n\n");
      return; // Held open like the real SSE endpoint.
    }
    if (request.url === "/v1/automation-runner/work") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  return new Promise<{ requests: WitnessRequest[]; origin: string; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        requests,
        origin: `http://127.0.0.1:${address.port}`,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

test("protocol v2 runner credentials steer long-lived channels to the API origin, not the proxy", async ({ evidence }) => {
  const { AutomationRunnerAuth, automationRunnerDirectAudience } = await import(
    "../../ee/apps/den-api/src/automations/runner-auth.js"
  );
  const witness = await startApiOriginWitness();
  const runners: { stop: () => void }[] = [];
  try {
    // Server half: the configured public API origin becomes the credential's
    // bound destination, and the credential authenticates back on the API.
    const direct = automationRunnerDirectAudience(witness.origin);
    expect(direct).toBe(witness.origin);
    const auth = new AutomationRunnerAuth("runner-direct-spec-secret".repeat(2));
    const issued = auth.issue(
      { organizationId: "org_spec", ownerMemberId: "member_spec", runnerId: "runner-spec", capabilities: [] },
      direct ?? "",
    );
    expect(issued.baseUrl).toBe(witness.origin);
    expect(auth.authenticate(`Bearer ${issued.token}`)?.audience).toBe(witness.origin);
    // Negative half: a plaintext non-loopback public URL is never minted as a
    // destination (desktops refuse it), so those deployments keep the
    // request-derived audience instead of stranding every runner.
    expect(automationRunnerDirectAudience("http://api.internal:8790")).toBeNull();
    evidence.fact(
      "Direct destinations are minted only when a desktop will accept them",
      `The credential is bound and returned as ${witness.origin}; a plaintext non-loopback public URL yields no direct destination.`,
      true,
    );

    // Desktop half: the real Electron runner configured with the minted
    // destination opens its SSE and work-poll channels against that origin.
    const runner = createDesktopAutomationRunner({
      getLocalRuntime: async () => null,
      log: () => undefined,
    });
    runners.push(runner);
    runner.configure({ baseUrl: issued.baseUrl, token: issued.token, runnerId: "runner-spec" });
    const seen = await eventually(
      () => witness.requests.map((request) => request.path),
      {
        within: 5_000,
        label: "runner channels reach the API origin witness",
        until: (paths) =>
          paths.includes("/v1/automation-runners/events") && paths.includes("/v1/automation-runner/work"),
      },
    );
    expect(seen).toContain("/v1/automation-runners/events");
    expect(seen).toContain("/v1/automation-runner/work");
    const sse = witness.requests.find((request) => request.path === "/v1/automation-runners/events");
    expect(sse?.authorization).toBe(`Bearer ${issued.token}`);
    expect(sse?.accept).toBe("text/event-stream");
    evidence.fact(
      "The runner holds its live channels against the minted API origin",
      "The loopback API-origin witness observed the SSE subscribe (Accept: text/event-stream) and the work poll, both presenting the minted bearer credential.",
      true,
    );

    // Negative half: the same credential pointed at a proxy-shaped base URL is
    // refused outright — no request leaves the desktop.
    const attempted: string[] = [];
    const refusals: string[] = [];
    const proxyRunner = createDesktopAutomationRunner({
      getLocalRuntime: async () => null,
      fetchImpl: async (url: unknown) => {
        attempted.push(String(url));
        throw new Error("unreachable in spec");
      },
      log: (line: unknown) => refusals.push(String(line)),
    });
    runners.push(proxyRunner);
    proxyRunner.configure({
      baseUrl: "https://app.openworklabs.com/api/den",
      token: issued.token,
      runnerId: "runner-spec",
    });
    await sleep(100);
    expect(attempted).toEqual([]);
    expect(refusals.some((line) => line.includes("rejected runner credential"))).toBe(true);
    evidence.fact(
      "A directly bound credential never rides the Den Web proxy",
      "Configured with a proxy-shaped base URL, the runner refuses the credential, logs the rejection, and attempts zero requests.",
      true,
    );
  } finally {
    for (const runner of runners) runner.stop();
    witness.close();
  }
});
