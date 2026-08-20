import { expect } from "vitest"
import { denFetch } from "@openwork/behaviors"
import { needs, server, test } from "@openwork/testkit"

const requirements = {
  optIn: ["OPENWORK_EVAL_E2E_TESTS", "OPENWORK_EVAL_AUTOMATION_DEPLOYMENT_GATE_E2E_TEST"],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

test("Den publishes the Automation availability contract before enforcing it", { timeout: 300_000 }, async ({ evidence, place }) => {
  needs(requirements)
  await using den = await server({
    place,
    env: { DEN_AUTOMATIONS_ENABLED: "false" },
  })

  const config = await denFetch(den.admin, "/v1/me/desktop-config", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  })
  expect(config.response.status, config.text).toBe(200)
  expect(isRecord(config.body) ? config.body.automationsEnabled : undefined).toBe(false)

  const list = await denFetch(den.admin, "/v1/automations", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  })
  expect(list.response.status, list.text).toBe(200)
  expect(isRecord(list.body) && Array.isArray(list.body.items)).toBe(true)

  expect(await den.apiLog()).toContain("Automation scheduler enabled")
  evidence.recordAssertionEvidence(
    "Automation availability contract",
    "Den advertised automationsEnabled=false through desktop config while preserving the published Automation API and scheduler behavior for the staged Desktop rollout.",
    true,
  )
})
