import { expect, mock, test } from "bun:test"

function seedSnapshotEnv() {
  process.env.DB_MODE ??= "mysql"
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_den"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "local-dev-db-encryption-key-please-change-1234567890"
  process.env.BETTER_AUTH_SECRET ??= "local-dev-secret-not-for-production-use!!"
  process.env.BETTER_AUTH_URL ??= "http://den.local"
}

seedSnapshotEnv()

const emptyRows = Promise.resolve<unknown[]>([])
const chainTarget = () => undefined
let queryChain = chainTarget
queryChain = new Proxy(chainTarget, {
  get: (_target, property) => property === "then" ? emptyRows.then.bind(emptyRows) : queryChain,
  apply: () => queryChain,
})
const db = new Proxy({}, { get: () => () => queryChain })
mock.module("@openwork-ee/den-core/db", () => ({ db }))

function serializeCatalog(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

test("snapshot catalog equals the live Den API catalog", async () => {
  const [{ default: app }, { getCatalog, getSnapshotCatalog }] = await Promise.all([
    import("../../../apps/den-api/src/app.js"),
    import("../src/mcp/index.js"),
  ])

  const liveCatalog = await getCatalog(app, undefined)
  const snapshotCatalog = await getSnapshotCatalog()

  const liveCatalogValue = serializeCatalog(liveCatalog)
  const snapshotCatalogValue = serializeCatalog(snapshotCatalog)
  expect(snapshotCatalogValue).toEqual(liveCatalogValue)
})
