import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  appliedAt: integer("applied_at").notNull(),
});

export const migrationState = sqliteTable("migration_state", {
  source: text("source").primaryKey(),
  status: text("status").notNull(),
  path: text("path").notNull().default(""),
  hash: text("hash").notNull().default(""),
  rowCount: integer("row_count").notNull().default(0),
  importedAt: integer("imported_at").notNull(),
});

export const runtimeOpencodeConfigs = sqliteTable("runtime_opencode_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const openworkWorkspaceConfigs = sqliteTable("openwork_workspace_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const runtimeDbSchema = {
  schemaMigrations,
  migrationState,
  runtimeOpencodeConfigs,
  openworkWorkspaceConfigs,
};
