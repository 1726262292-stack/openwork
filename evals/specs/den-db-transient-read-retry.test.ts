import { test } from "@openwork/testkit";
import { expect } from "vitest";

import { createRetryingPlanetScaleFetch } from "../../ee/packages/den-db/src/transient-retry.js";

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
    const databaseFetch = createRetryingPlanetScaleFetch();
    const readResponse = await databaseFetch("https://example.test/psdb.v1alpha1.Database/Execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "select 1", session: null }),
    });
    expect(readResponse.ok).toBe(true);
    expect(attempts).toBe(2);
    evidence.recordAssertionEvidence(
      "Transient PlanetScale reads recover after one retry",
      "A SELECT receiving HTTP 503 once completed on the second attempt, with exactly two requests.",
      true,
    );

    attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return unavailableResponse();
    };
    const writeResponse = await databaseFetch("https://example.test/psdb.v1alpha1.Database/Execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "insert into example values (1)", session: null }),
    });
    expect(writeResponse.status).toBe(503);
    expect(attempts).toBe(1);
    evidence.recordAssertionEvidence(
      "Transient failures never replay writes",
      "An INSERT receiving HTTP 503 failed after exactly one request, so the write was not retried.",
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
