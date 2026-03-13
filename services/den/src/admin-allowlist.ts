import { sql } from "drizzle-orm"
import { db } from "./db/index.js"
import { AdminAllowlistTable } from "./db/schema.js"

const ADMIN_ALLOWLIST_SEEDS = [
  {
    id: "admin-ben-openworklabs-com",
    email: "ben@openworklabs.com",
    note: "Seeded internal admin",
  },
  {
    id: "admin-jan-openworklabs-com",
    email: "jan@openworklabs.com",
    note: "Seeded internal admin",
  },
  {
    id: "admin-omar-openworklabs-com",
    email: "omar@openworklabs.com",
    note: "Seeded internal admin",
  },
  {
    id: "admin-berk-openworklabs-com",
    email: "berk@openworklabs.com",
    note: "Seeded internal admin",
  },
] as const

let ensureAdminAllowlistSeededPromise: Promise<void> | null = null

async function seedAdminAllowlist() {
  for (const entry of ADMIN_ALLOWLIST_SEEDS) {
    await db
      .insert(AdminAllowlistTable)
      .values(entry)
      .onDuplicateKeyUpdate({
        set: {
          note: entry.note,
          updated_at: sql`CURRENT_TIMESTAMP(3)`,
        },
      })
  }
}

export async function ensureAdminAllowlistSeeded() {
  if (!ensureAdminAllowlistSeededPromise) {
    ensureAdminAllowlistSeededPromise = seedAdminAllowlist().catch((error) => {
      ensureAdminAllowlistSeededPromise = null
      throw error
    })
  }

  await ensureAdminAllowlistSeededPromise
}
