import { Client } from "@planetscale/database"
import { drizzle } from "drizzle-orm/mysql2"
import { drizzle as drizzlePlanetScale } from "drizzle-orm/planetscale-serverless"
import { AsyncLocalStorage } from "node:async_hooks"
import type { FieldPacket, QueryOptions, QueryResult } from "mysql2"
import mysql, { type Pool } from "mysql2/promise"
import { parseMySqlConnectionConfig } from "./mysql-config"
import * as schema from "./schema"

export type DenDbMode = "mysql" | "planetscale"
type DenDb = ReturnType<typeof drizzlePlanetScale>
export type DenDbHandles = {
  client: Client | Pool
  db: DenDb
  readClient: Client | Pool
  readDb: DenDb
}
export type PlanetScaleCredentials = {
  host: string
  username: string
  password: string
}

const TRANSIENT_DB_ERROR_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
])

const RETRYABLE_QUERY_PREFIXES = ["select", "show", "describe", "explain"]
const REPLICA_READ_PREFIX = /^(?:select|show|describe|explain)\b/
const WRITE_INTENT_READ_PATTERN = /\b(?:for\s+update|lock\s+in\s+share\s+mode)\b/i

type DbRoutingContext = {
  pinnedToPrimary: boolean
}

const dbRoutingContext = new AsyncLocalStorage<DbRoutingContext>()

export function runWithDbRoutingContext<T>(fn: () => T): T {
  return dbRoutingContext.run({ pinnedToPrimary: false }, fn)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null
  }

  if (typeof error.code === "string") {
    return error.code
  }

  return getErrorCode(error.cause)
}

export function isTransientDbConnectionError(error: unknown): boolean {
  const code = getErrorCode(error)
  if (!code) {
    return false
  }
  return TRANSIENT_DB_ERROR_CODES.has(code)
}

function extractSql(value: unknown): string | null {
  if (typeof value === "string") {
    return value
  }

  if (!isRecord(value)) {
    return null
  }

  if (typeof value.sql === "string") {
    return value.sql
  }

  return null
}

function isRetryableReadQuery(sql: string | null): boolean {
  if (!sql) {
    return false
  }

  const normalized = sql.trimStart().toLowerCase()
  return RETRYABLE_QUERY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function isReplicaReadQuery(sql: string | null): boolean {
  if (!sql) {
    return false
  }

  const normalized = sql.trim().toLowerCase()
  if (WRITE_INTENT_READ_PATTERN.test(normalized)) {
    // Deliberately over-route matches in literals or comments rather than risk
    // sending a locking read to a replica.
    return false
  }

  const statement = normalized.endsWith(";") ? normalized.slice(0, -1) : normalized
  if (statement.includes(";")) {
    return false
  }

  return REPLICA_READ_PREFIX.test(statement)
}

async function retryReadQuery<T>(label: "query" | "execute", sql: string | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isRetryableReadQuery(sql) || !isTransientDbConnectionError(error)) {
      throw error
    }

    const queryType = sql?.trimStart().split(/\s+/, 1)[0]?.toUpperCase() ?? "QUERY"
    console.warn(`[db] transient mysql error on ${label} (${queryType}); retrying once`)
    return run()
  }
}

function parsePlanetScaleConfigFromDatabaseUrl(databaseUrl: string): PlanetScaleCredentials {
  const parsed = new URL(databaseUrl)
  if (!parsed.hostname || !parsed.username) {
    throw new Error("DATABASE_URL must include host and username when DB_MODE=planetscale")
  }

  return {
    host: parsed.hostname,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  }
}

function resolveDbMode(input: { mode?: DenDbMode; databaseUrl?: string | null }): DenDbMode {
  if (input.mode) {
    return input.mode
  }

  return input.databaseUrl ? "mysql" : "planetscale"
}

function createMySqlPool(databaseUrl: string): Pool {
  const client = mysql.createPool({
    ...parseMySqlConnectionConfig(databaseUrl),
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60_000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  })

  const query = client.query.bind(client)

  async function retryingQuery<T extends QueryResult>(sql: string): Promise<[T, FieldPacket[]]>
  async function retryingQuery<T extends QueryResult>(sql: string, values: unknown): Promise<[T, FieldPacket[]]>
  async function retryingQuery<T extends QueryResult>(options: QueryOptions): Promise<[T, FieldPacket[]]>
  async function retryingQuery<T extends QueryResult>(options: QueryOptions, values: unknown): Promise<[T, FieldPacket[]]>
  async function retryingQuery<T extends QueryResult>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown,
  ): Promise<[T, FieldPacket[]]> {
    const sql = extractSql(sqlOrOptions)
    return retryReadQuery("query", sql, () => query<T>(sqlOrOptions as never, values as never))
  }

  client.query = retryingQuery

  const execute = client.execute.bind(client)

  async function retryingExecute<T extends QueryResult>(sql: string): Promise<[T, FieldPacket[]]>
  async function retryingExecute<T extends QueryResult>(sql: string, values: unknown): Promise<[T, FieldPacket[]]>
  async function retryingExecute<T extends QueryResult>(options: QueryOptions): Promise<[T, FieldPacket[]]>
  async function retryingExecute<T extends QueryResult>(options: QueryOptions, values: unknown): Promise<[T, FieldPacket[]]>
  async function retryingExecute<T extends QueryResult>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown,
  ): Promise<[T, FieldPacket[]]> {
    const sql = extractSql(sqlOrOptions)
    return retryReadQuery("execute", sql, () => execute<T>(sqlOrOptions as never, values as never))
  }

  client.execute = retryingExecute

  return client
}

function createReadRoutingPool(primary: Pool, replica: Pool): Pool {
  function selectPool(sqlOrOptions: string | QueryOptions): Pool {
    const context = dbRoutingContext.getStore()
    // Without a request context, a write cannot pin later reads. Primary-only
    // routing is therefore the safe default against stale read-after-write data.
    if (!context || context.pinnedToPrimary) {
      return primary
    }

    if (isReplicaReadQuery(extractSql(sqlOrOptions))) {
      return replica
    }

    context.pinnedToPrimary = true
    return primary
  }

  async function routingQuery<T extends QueryResult>(sql: string): Promise<[T, FieldPacket[]]>
  async function routingQuery<T extends QueryResult>(sql: string, values: unknown): Promise<[T, FieldPacket[]]>
  async function routingQuery<T extends QueryResult>(options: QueryOptions): Promise<[T, FieldPacket[]]>
  async function routingQuery<T extends QueryResult>(options: QueryOptions, values: unknown): Promise<[T, FieldPacket[]]>
  async function routingQuery<T extends QueryResult>(
    sqlOrOptions: string | QueryOptions,
    values?: unknown,
  ): Promise<[T, FieldPacket[]]> {
    const selected = selectPool(sqlOrOptions)
    if (typeof sqlOrOptions === "string") {
      return values === undefined ? selected.query<T>(sqlOrOptions) : selected.query<T>(sqlOrOptions, values)
    }
    return values === undefined ? selected.query<T>(sqlOrOptions) : selected.query<T>(sqlOrOptions, values)
  }

  async function routingExecute<T extends QueryResult>(sql: string): Promise<[T, FieldPacket[]]>
  async function routingExecute<T extends QueryResult>(sql: string, values: QueryOptions["values"]): Promise<[T, FieldPacket[]]>
  async function routingExecute<T extends QueryResult>(options: QueryOptions): Promise<[T, FieldPacket[]]>
  async function routingExecute<T extends QueryResult>(
    options: QueryOptions,
    values: QueryOptions["values"],
  ): Promise<[T, FieldPacket[]]>
  async function routingExecute<T extends QueryResult>(
    sqlOrOptions: string | QueryOptions,
    values?: QueryOptions["values"],
  ): Promise<[T, FieldPacket[]]> {
    const selected = selectPool(sqlOrOptions)
    if (typeof sqlOrOptions === "string") {
      return values === undefined ? selected.execute<T>(sqlOrOptions) : selected.execute<T>(sqlOrOptions, values)
    }
    return values === undefined ? selected.execute<T>(sqlOrOptions) : selected.execute<T>(sqlOrOptions, values)
  }

  function routingGetConnection() {
    const context = dbRoutingContext.getStore()
    if (context) {
      context.pinnedToPrimary = true
    }
    return primary.getConnection()
  }

  return new Proxy(primary, {
    get(target, property) {
      if (property === "query") {
        return routingQuery
      }
      if (property === "execute") {
        return routingExecute
      }
      if (property === "getConnection") {
        return routingGetConnection
      }

      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

export function createDenDb(input: {
  databaseUrl?: string | null
  /** Read replica URL supplied by consumers via DATABASE_REPLICA_URL. MySQL mode only. */
  readReplicaUrl?: string | null
  /** Route reads through the replica inside runWithDbRoutingContext scopes. */
  routeReadsToReplica?: boolean
  mode?: DenDbMode
  planetscale?: PlanetScaleCredentials | null
}): DenDbHandles {
  const mode = resolveDbMode(input)

  if (mode === "planetscale") {
    if (input.readReplicaUrl) {
      throw new Error("Read replicas are only supported in mysql mode")
    }

    const credentials = input.planetscale ?? (input.databaseUrl ? parsePlanetScaleConfigFromDatabaseUrl(input.databaseUrl) : null)
    if (!credentials) {
      throw new Error("PlanetScale mode requires DATABASE_HOST, DATABASE_USERNAME, and DATABASE_PASSWORD")
    }

    const client = new Client(credentials)
    const db = drizzlePlanetScale(client, { schema }) as unknown as DenDb
    return { client, db, readClient: client, readDb: db }
  }

  if (!input.databaseUrl) {
    throw new Error("MySQL mode requires DATABASE_URL")
  }

  const primaryClient = createMySqlPool(input.databaseUrl)
  if (!input.readReplicaUrl) {
    const db = drizzle(primaryClient, { schema, mode: "default" }) as unknown as DenDb
    return { client: primaryClient, db, readClient: primaryClient, readDb: db }
  }

  const readClient = createMySqlPool(input.readReplicaUrl)
  const readDb = drizzle(readClient, { schema, mode: "default" }) as unknown as DenDb
  if (!input.routeReadsToReplica) {
    const db = drizzle(primaryClient, { schema, mode: "default" }) as unknown as DenDb
    return { client: primaryClient, db, readClient, readDb }
  }

  const client = createReadRoutingPool(primaryClient, readClient)
  const db = drizzle(client, { schema, mode: "default" }) as unknown as DenDb
  return { client, db, readClient, readDb }
}
