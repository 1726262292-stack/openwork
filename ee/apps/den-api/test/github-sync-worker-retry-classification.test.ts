import { beforeAll, expect, test } from "bun:test"

let workerModule: typeof import("../src/workers/github-sync.js")
let githubModule: typeof import("../src/routes/org/plugin-system/github-app.js")

beforeAll(async () => {
  const defaults = {
    DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
    DATABASE_HOST: "127.0.0.1",
    DATABASE_USERNAME: "root",
    DATABASE_PASSWORD: "password",
    DB_MODE: "mysql",
    DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
    BETTER_AUTH_SECRET: "y".repeat(32),
    BETTER_AUTH_URL: "http://127.0.0.1:8790",
  }
  for (const [name, value] of Object.entries(defaults)) {
    if (!process.env[name]?.trim()) process.env[name] = value
  }
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
