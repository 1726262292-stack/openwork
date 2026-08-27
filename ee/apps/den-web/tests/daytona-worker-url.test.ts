import { expect, test } from "bun:test";
import {
  getWorker,
  getWorkerConnectionPollDelay,
  getWorkerSummary,
  getWorkerTokens,
  getWorkersList,
  withWorkerConnection,
  workerNeedsConnectionResolution,
} from "../app/(den)/_lib/den-flow";

const daytonaInstance = {
  provider: "daytona",
  status: "healthy",
  url: "https://expired.preview.example.test",
};

test("Den Web never treats Daytona list or detail URLs as durable connections", () => {
  const worker = { id: "worker-1", name: "Cloud", status: "healthy" };

  expect(getWorker({ worker, instance: daytonaInstance, tokens: {} })?.instanceUrl).toBeNull();
  expect(getWorker({ worker, instance: daytonaInstance, tokens: {} })?.openworkUrl).toBeNull();
  expect(getWorkerSummary({ worker, instance: daytonaInstance })?.instanceUrl).toBeNull();
  expect(getWorkersList({ workers: [{ ...worker, instance: daytonaInstance }] })[0]?.instanceUrl).toBeNull();
})

test("Den Web keeps durable non-Daytona URLs and resolver-backed token URLs", () => {
  const worker = { id: "worker-1", name: "Remote", status: "healthy" };
  const renderInstance = { provider: "render", status: "healthy", url: "https://durable.render.example.test" };

  expect(getWorkerSummary({ worker, instance: renderInstance })?.instanceUrl).toBe("https://durable.render.example.test");
  expect(getWorkerTokens({
    tokens: { client: "client-token", host: "host-token" },
    connect: { openworkUrl: "https://fresh.preview.example.test/w/workspace", workspaceId: "workspace" },
  })?.openworkUrl).toBe("https://fresh.preview.example.test/w/workspace");
})

test("create tokens without a URL keep polling until the late resolver URL is adopted", () => {
  const created = getWorker({
    worker: { id: "worker-late-url", name: "Cloud", status: "provisioning" },
    instance: null,
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
  });
  if (!created) throw new Error("create worker payload did not parse");

  expect(created.openworkUrl).toBeNull();
  expect(workerNeedsConnectionResolution(created)).toBe(true);

  const early = getWorkerTokens({
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
    connect: null,
  });
  if (!early) throw new Error("early token payload did not parse");
  const waiting = withWorkerConnection(created, early);
  expect(workerNeedsConnectionResolution(waiting)).toBe(true);

  const late = getWorkerTokens({
    tokens: { client: "client-token", owner: "host-token", host: "host-token" },
    connect: {
      openworkUrl: "https://late.preview.example.test/w/workspace",
      workspaceId: "workspace",
    },
  });
  if (!late) throw new Error("late token payload did not parse");
  const ready = withWorkerConnection(waiting, late);

  expect(ready.openworkUrl).toBe("https://late.preview.example.test/w/workspace");
  expect(ready.clientToken).toBe("client-token");
  expect(ready.hostToken).toBe("host-token");
  expect(workerNeedsConnectionResolution(ready)).toBe(false);
  expect(workerNeedsConnectionResolution({ ...waiting, status: "failed" })).toBe(false);
  expect([1, 2, 3, 30].map(getWorkerConnectionPollDelay)).toEqual([1_000, 2_000, 4_000, 4_000]);
})
