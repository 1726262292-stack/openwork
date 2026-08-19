import "./load-env.js"
import { env as denEnv } from "@openwork-ee/den-core/env"
import { z } from "zod"

const EnvSchema = z.object({
  PORT: z.string().optional(),
  DATABASE_REPLICA_URL: z.string().trim().min(1),
  DEN_DB_ROUTING_SERVICE: z.literal("cloud-mcp"),
  DEN_MCP_OAUTH_RESOURCE_SEEDING: z.literal("disabled"),
})

const parsed = EnvSchema.parse(process.env)

function parsePort(value: string | undefined) {
  const port = Number(value ?? "8791")
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535")
  }
  return port
}

if (denEnv.dbMode !== "mysql") {
  throw new Error("cloud-mcp requires DB_MODE=mysql")
}

export const env = {
  port: parsePort(parsed.PORT),
  databaseReplicaUrl: parsed.DATABASE_REPLICA_URL,
}
