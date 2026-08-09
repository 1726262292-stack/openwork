import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core"
import { denTypeIdColumn } from "../columns"

export const CodemodeRunTable = mysqlTable(
  "codemode_run",
  {
    id: denTypeIdColumn("codemodeRun", "id").notNull().primaryKey(),
    organization_id: denTypeIdColumn("organization", "organization_id").notNull(),
    org_membership_id: denTypeIdColumn("member", "org_membership_id"),
    source: varchar("source", { length: 255 }).notNull(),
    code_digest: varchar("code_digest", { length: 80 }).notNull(),
    status: mysqlEnum("status", ["succeeded", "failed"]).notNull(),
    error_kind: varchar("error_kind", { length: 64 }),
    error_message: text("error_message"),
    tool_calls: json("tool_calls").$type<Array<{ name: string }>>(),
    tool_call_count: int("tool_call_count").notNull().default(0),
    duration_ms: int("duration_ms").notNull().default(0),
    started_at: timestamp("started_at", { fsp: 3 }).notNull(),
    finished_at: timestamp("finished_at", { fsp: 3 }).notNull(),
    created_at: timestamp("created_at", { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [index("codemode_run_org_created").on(table.organization_id, table.created_at)],
)
