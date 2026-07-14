import type { Env, Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"
import { publicRoute } from "../../middleware/index.js"
import { jsonResponse } from "../../openapi.js"
import { getPublishedAppVersions } from "../../published-app-versions.js"
import { denApiAppVersion } from "../../version.js"

const appVersionResponseSchema = z.object({
  minAppVersion: z.string(),
  latestAppVersion: z.string().min(1),
  availableAppVersions: z.array(z.string()),
}).meta({ ref: "DenAppVersionResponse" })

export function registerVersionRoutes<T extends Env>(app: Hono<T>) {
  app.get(
    "/v1/app-version",
    describeRoute({
      tags: ["System"],
      summary: "Get desktop app version metadata",
      description: "Returns the minimum supported desktop app version, the latest desktop app version published with this Den API build, and published desktop versions from GitHub.",
      responses: {
        200: jsonResponse("Desktop app version metadata returned successfully.", appVersionResponseSchema),
      },
    }),
    publicRoute,
    async (c) => {
      let availableAppVersions: string[]
      try {
        availableAppVersions = await getPublishedAppVersions(denApiAppVersion.minAppVersion)
      } catch {
        availableAppVersions = [
          denApiAppVersion.latestAppVersion,
          denApiAppVersion.minAppVersion,
        ]
      }

      return c.json({
        ...denApiAppVersion,
        availableAppVersions: [...new Set(availableAppVersions)],
      })
    },
  )
}
