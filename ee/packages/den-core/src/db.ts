import { createDenDb } from "@openwork-ee/den-db"
import { env } from "./env.js"

export const { client, db, readClient, readDb } = createDenDb({
  databaseUrl: env.databaseUrl,
  readReplicaUrl: env.databaseReplicaUrl,
  routeReadsToReplica: env.dbRoutingService === "cloud-mcp",
  mode: env.dbMode,
  planetscale: env.planetscale,
})
