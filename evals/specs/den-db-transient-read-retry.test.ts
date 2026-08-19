import { test } from "@openwork/testkit";
import { expect } from "vitest";

import { createDenDb } from "../../ee/packages/den-db/src/client.js";

function successfulQueryResponse(): Response {
  return new Response(
    JSON.stringify({
      result: {
        fields: [],
        insertId: "0",
        rows: [],
        rowsAffected: "0",
      },
      timing: 0,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({ error: { code: "internal", message: "Service Unavailable" } }), {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "application/json" },
  });
}

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === status;
}

test("Den retries transient PlanetScale reads without replaying writes", async ({ evidence }) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return attempts === 1 ? unavailableResponse() : successfulQueryResponse();
  };
  console.warn = () => undefined;

  try {
    const { client } = createDenDb({
      mode: "planetscale",
      planetscale: { host: "example.test", username: "user", password: "password" },
    });
    await client.execute("select 1");
    expect(attempts).toBe(2);
    evidence.fact(
      "Transient PlanetScale reads recover after one retry",
      "A SELECT receiving HTTP 503 once completed on the second attempt, with exactly two requests.",
      true,
    );

    attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return unavailableResponse();
    };
    await expect(client.execute("insert into example values (1)")).rejects.toSatisfy(
      (error: unknown) => hasStatus(error, 503),
    );
    expect(attempts).toBe(1);
    evidence.fact(
      "Transient failures never replay writes",
      "An INSERT receiving HTTP 503 failed after exactly one request, so the write was not retried.",
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
