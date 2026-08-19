import type { Hono } from "hono"
import type { OrganizationContextVariables } from "@openwork-ee/den-core/middleware/index"
import type { AuthContextVariables } from "@openwork-ee/den-core/session"
import { registerMemoryCoreRoutes } from "./core.js"

export function registerMemoryRoutes<T extends { Variables: AuthContextVariables & Partial<OrganizationContextVariables> }>(
  app: Hono<T>,
) {
  registerMemoryCoreRoutes(app)
}
