import { beforeAll, describe, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
  process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
}

let AutomationRunnerAuth: typeof import("../src/automations/runner-auth.js")["AutomationRunnerAuth"]
let automationRunnerAudienceFromRequestUrl: typeof import("../src/automations/runner-auth.js")["automationRunnerAudienceFromRequestUrl"]

beforeAll(async () => {
  seedRequiredEnv()
  ;({ AutomationRunnerAuth, automationRunnerAudienceFromRequestUrl } = await import("../src/automations/runner-auth.js"))
})

describe("Automation runner credentials", () => {
  test("survive process-local auth instances while remaining scoped and tamper-evident", () => {
    const secret = "runner-auth-test-secret".repeat(3)
    const issuer = new AutomationRunnerAuth(secret)
    const verifier = new AutomationRunnerAuth(secret)
    const issued = issuer.issue({
      organizationId: "org_test",
      ownerMemberId: "member_test",
      runnerId: "desktop-test",
    }, "https://den.example.com/api/den")

    expect(verifier.authenticate(`Bearer ${issued.token}`)).toEqual({
      organizationId: "org_test",
      ownerMemberId: "member_test",
      runnerId: "desktop-test",
      audience: "https://den.example.com/api/den",
      expiresAt: issued.expiresAt,
    })
    expect(new AutomationRunnerAuth(`${secret}x`).authenticate(`Bearer ${issued.token}`)).toBeNull()
    expect(verifier.authenticate(`Bearer ${issued.token}x`)).toBeNull()
  })

  test("binds a runner credential to the API base that minted it", () => {
    expect(automationRunnerAudienceFromRequestUrl(
      "https://den.example.com/api/den/v1/automation-runners/token?ignored=true",
    )).toBe("https://den.example.com/api/den")
    expect(() => automationRunnerAudienceFromRequestUrl("https://den.example.com/not-the-token-route"))
      .toThrow("automation_runner_audience_invalid")
  })
})
