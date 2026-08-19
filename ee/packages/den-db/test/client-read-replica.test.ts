import assert from "node:assert/strict"
import test from "node:test"
import { sql } from "drizzle-orm"
import { createDenDb, runWithDbRoutingContext } from "../src/client.js"

const primaryUrl = "mysql://user:password@127.0.0.1:3306/primary"
const replicaUrl = "mysql://user:password@127.0.0.1:3306/replica"

function createRoutingHarness() {
  const { client, db, readClient } = createDenDb({
    databaseUrl: primaryUrl,
    readReplicaUrl: replicaUrl,
    routeReadsToReplica: true,
  })
  if (!("query" in client) || !("getConnection" in client) || !("query" in readClient)) {
    throw new Error("Expected MySQL pool clients")
  }

  const calls: string[] = []
  const primaryConnection = { source: "primary" }
  const primaryQuery = async () => {
    calls.push("primary")
    return [[], []]
  }
  const replicaQuery = async () => {
    calls.push("replica")
    return [[], []]
  }

  Reflect.set(client, "query", primaryQuery)
  Reflect.set(client, "execute", primaryQuery)
  Reflect.set(client, "getConnection", async () => {
    calls.push("primary connection")
    return primaryConnection
  })
  Reflect.set(readClient, "query", replicaQuery)
  Reflect.set(readClient, "execute", replicaQuery)

  return { calls, client, db, primaryConnection }
}

test("uses the primary handles for reads when no replica is configured", () => {
  const { client, db, readClient, readDb } = createDenDb({ databaseUrl: primaryUrl })

  assert.strictEqual(readDb, db)
  assert.strictEqual(readClient, client)
})

test("creates separate read handles when a replica is configured", () => {
  const { client, db, readClient, readDb } = createDenDb({
    databaseUrl: primaryUrl,
    readReplicaUrl: replicaUrl,
  })

  assert.notStrictEqual(readDb, db)
  assert.notStrictEqual(readClient, client)
})

test("routes a SELECT through the database facade to the replica", async () => {
  const { calls, db } = createRoutingHarness()

  await runWithDbRoutingContext(() => db.execute(sql.raw("select 1")))

  assert.deepEqual(calls, ["replica"])
})

test("routes write-intent SELECT statements to the primary", async () => {
  const { calls, client } = createRoutingHarness()

  await runWithDbRoutingContext(() => client.query("SELECT * FROM jobs FOR UPDATE"))
  await runWithDbRoutingContext(() => client.query("select * from jobs lock in share mode"))

  assert.deepEqual(calls, ["primary", "primary"])
})

test("routes INSERT, UPDATE, and DELETE statements to the primary", async () => {
  const { calls, client } = createRoutingHarness()

  await runWithDbRoutingContext(() => client.query("insert into jobs values (1)"))
  await runWithDbRoutingContext(() => client.execute("update jobs set id = 2"))
  await runWithDbRoutingContext(() => client.query("delete from jobs"))

  assert.deepEqual(calls, ["primary", "primary", "primary"])
})

test("routes an unrecognized statement to the primary", async () => {
  const { calls, client } = createRoutingHarness()

  await runWithDbRoutingContext(() => client.query("with jobs as (select 1) select * from jobs"))

  assert.deepEqual(calls, ["primary"])
})

test("pins reads after a write only in the same routing context", async () => {
  const { calls, client } = createRoutingHarness()

  await runWithDbRoutingContext(async () => {
    await client.query("insert into jobs values (1)")
    await client.query("select * from jobs")
  })
  await runWithDbRoutingContext(() => client.query("select * from jobs"))

  assert.deepEqual(calls, ["primary", "primary", "replica"])
})

test("getConnection returns a primary connection and pins the context", async () => {
  const { calls, client, primaryConnection } = createRoutingHarness()

  await runWithDbRoutingContext(async () => {
    const connection = await client.getConnection()
    assert.strictEqual(connection, primaryConnection)
    await client.query("select * from jobs")
  })

  assert.deepEqual(calls, ["primary connection", "primary"])
})

test("routes to the primary when no routing context exists", async () => {
  const { calls, client } = createRoutingHarness()

  await client.query("select 1")

  assert.deepEqual(calls, ["primary"])
})
