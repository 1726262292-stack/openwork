import { bigint, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { denTypeIdColumn, timestamps } from "../columns"

export const RateLimitTable = mysqlTable(
  "rate_limit",
  {
    id: denTypeIdColumn("rateLimit", "id").notNull().primaryKey(),
    key: varchar("key", { length: 512 }).notNull(),
    count: int("count").notNull().default(0),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("rate_limit_key").on(table.key)],
)

export const AdminAllowlistTable = mysqlTable(
  "admin_allowlist",
  {
    id: denTypeIdColumn("adminAllowlist", "id").notNull().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    note: varchar("note", { length: 255 }),
    ...timestamps,
  },
  (table) => [uniqueIndex("admin_allowlist_email").on(table.email)],
)

export const InitialAdminBootstrapClaimTable = mysqlTable(
  "initial_admin_bootstrap_claim",
  {
    singletonKey: varchar("singleton_key", { length: 64 }).notNull().primaryKey(),
    reservedGrantHash: varchar("reserved_grant_hash", { length: 64 }),
    reservedAt: timestamp("reserved_at", { fsp: 3 }),
    reservedExpiresAt: timestamp("reserved_expires_at", { fsp: 3 }),
    consumedAt: timestamp("consumed_at", { fsp: 3 }),
    consumedByUserId: varchar("consumed_by_user_id", { length: 64 }),
    ...timestamps,
  },
)

export const InitialAdminBootstrapGrantTable = mysqlTable(
  "initial_admin_bootstrap_grant",
  {
    tokenHash: varchar("token_hash", { length: 64 }).notNull().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
    consumedAt: timestamp("consumed_at", { fsp: 3 }),
    createdAt: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
)

export const rateLimit = RateLimitTable
