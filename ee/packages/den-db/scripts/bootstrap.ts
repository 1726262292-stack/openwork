/**
 * Production-oriented install/upgrade entrypoint for Den databases.
 *
 * Empty databases cannot currently be built by replaying the historical
 * migration chain, because the migration history starts after early schema
 * state. For a new empty database we apply the current schema once, record the
 * committed migrations as the baseline, then run normal migrations.
 *
 * Existing databases skip schema push. If they have tables but no Drizzle
 * migration ledger, we baseline them before running db:migrate.
 */
import "../src/load-env.ts"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MIGRATIONS_TABLE = "__drizzle_migrations"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

type Executor = {
  query: (sql: string, args?: (string | number)[]) => Promise<Record<string, unknown>[]>
  close: () => Promise<void>
}

async function createExecutor(): Promise<Executor> {
  const databaseUrl = process.env.DATABASE_URL?.trim()

  if (databaseUrl) {
    const mysql = await import("mysql2/promise")
    const connection = await mysql.createConnection(databaseUrl)
    return {
      query: async (sql, args = []) => {
        const [rows] = await connection.query(sql, args)
        return Array.isArray(rows) ? rows.filter(isRecord) : []
      },
      close: () => connection.end(),
    }
  }

  const host = process.env.DATABASE_HOST?.trim()
  const username = process.env.DATABASE_USERNAME?.trim()
  const password = process.env.DATABASE_PASSWORD ?? ""

  if (!host || !username) {
    throw new Error("Provide DATABASE_URL, or DATABASE_HOST/DATABASE_USERNAME/DATABASE_PASSWORD.")
  }

  const { Client } = await import("@planetscale/database")
  const client = new Client({ host, username, password })
  return {
    query: async (sql, args = []) => {
      const result = await client.execute(sql, args)
      return result.rows.filter(isRecord)
    },
    close: async () => {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: packageDir,
    env: process.env,
    stdio: "inherit",
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function listTables(executor: Executor) {
  const rows = await executor.query("show tables")
  return rows
    .map((row) => Object.values(row).find((value) => typeof value === "string"))
    .filter((value): value is string => Boolean(value))
}

async function hasMigrationLedger(executor: Executor) {
  const tables = await listTables(executor)
  return tables.some((table) => table === MIGRATIONS_TABLE)
}

async function main() {
  const executor = await createExecutor()
  try {
    const tables = await listTables(executor)
    const applicationTables = tables.filter((table) => table !== MIGRATIONS_TABLE)

    if (applicationTables.length === 0) {
      console.log("[den-db] empty database detected; applying current schema")
      run("sh", ["-lc", "yes | node --import tsx ./node_modules/drizzle-kit/bin.cjs push --config drizzle.config.ts"])
      console.log("[den-db] recording migration baseline")
      run("node", ["--import", "tsx", "scripts/baseline-migrations.ts", "--yes"])
    } else if (!(await hasMigrationLedger(executor))) {
      console.log("[den-db] existing schema without migration ledger detected; recording baseline")
      run("node", ["--import", "tsx", "scripts/baseline-migrations.ts", "--yes"])
    }
  } finally {
    await executor.close()
  }

  console.log("[den-db] running migrations")
  run("node", ["--import", "tsx", "./node_modules/drizzle-kit/bin.cjs", "migrate", "--config", "drizzle.config.ts"])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
