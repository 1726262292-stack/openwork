import { beforeAll, expect, test } from "bun:test"

let workerModule: typeof import("../src/workers/github-sync.js")
let githubModule: typeof import("../src/routes/org/plugin-system/github-app.js")

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  workerModule = await import("../src/workers/github-sync.js")
  githubModule = await import("../src/routes/org/plugin-system/github-app.js")
})

test("GitHub sync treats 502 and TimeoutError as transient", () => {
  expect(workerModule.isTransientGithubSyncError(
    new githubModule.GithubConnectorRequestError("bad gateway", 502),
  )).toBe(true)
  const timeoutError = new Error("timed out")
  timeoutError.name = "TimeoutError"
  expect(workerModule.isTransientGithubSyncError(timeoutError)).toBe(true)
})
