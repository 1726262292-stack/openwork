import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { jsonColumn, timestamps } from "../columns";

/**
 * Server-level config — replaces the scalar keys of `server.json` (everything except
 * `workspaces[]` and `authorizedRoots[]`, which have their own tables).
 *
 * Stored as a key/value table so we can add/remove settings without migrations and
 * preserve the "unknown keys are preserved" behavior of the old merge-on-write.
 *
 * Known keys: host, port, token, hostToken, approval, corsOrigins, readOnly,
 * opencodeBaseUrl, opencodeDirectory, opencodeUsername, opencodePassword, logFormat,
 * logRequests, preferredPort. Values are JSON-encoded.
 *
 * NOTE: `token`/`hostToken`/`opencodePassword` are plaintext secrets here, exactly as
 * they are in `server.json` today.
 */
export const serverConfigTable = sqliteTable("server_config", {
  key: text("key").primaryKey(),
  value: jsonColumn<unknown>("value").notNull(),
  ...timestamps,
});

export type ServerConfigRow = typeof serverConfigTable.$inferSelect;
export type ServerConfigInsert = typeof serverConfigTable.$inferInsert;
