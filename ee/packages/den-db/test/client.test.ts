import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseError } from "@planetscale/database"
import { createDenDb, isTransientDbConnectionError } from "../src/client.js"

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
  )
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({ error: { code: "internal", message: "Service Unavailable" } }), {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "application/json" },
  })
}

test("classifies transient database transport errors through nested causes", () => {
  assert.equal(isTransientDbConnectionError({ status: 503 }), true)
  assert.equal(isTransientDbConnectionError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), true)
  assert.equal(isTransientDbConnectionError({ code: "ER_PARSE_ERROR", status: 400 }), false)
  assert.equal(isTransientDbConnectionError(new Error("query failed")), false)
})

test("PlanetScale retries a transient read response once", async () => {
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const warnings: string[] = []
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return attempts === 1 ? unavailableResponse() : successfulQueryResponse()
  }
  console.warn = (message) => warnings.push(String(message))

  try {
    const { client } = createDenDb({
      mode: "planetscale",
      planetscale: { host: "example.test", username: "user", password: "password" },
    })
    await client.execute("select 1")

    assert.equal(attempts, 2)
    assert.deepEqual(warnings, ["[db] transient database error on execute (SELECT); retrying once"])
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  }
})

test("PlanetScale does not retry writes", async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return unavailableResponse()
  }

  try {
    const { client } = createDenDb({
      mode: "planetscale",
      planetscale: { host: "example.test", username: "user", password: "password" },
    })
    await assert.rejects(client.execute("insert into example values (1)"), (error: unknown) => {
      assert.equal(error instanceof DatabaseError && error.status === 503, true)
      return true
    })
    assert.equal(attempts, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("PlanetScale surfaces the second transient read failure", async () => {
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return unavailableResponse()
  }
  console.warn = () => undefined

  try {
    const { client } = createDenDb({
      mode: "planetscale",
      planetscale: { host: "example.test", username: "user", password: "password" },
    })
    await assert.rejects(client.execute("select 1"), (error: unknown) => {
      assert.equal(error instanceof DatabaseError && error.status === 503, true)
      return true
    })
    assert.equal(attempts, 2)
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  }
})
