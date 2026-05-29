import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { jsonColumn, timestamps, typeIdColumn } from "../columns";

/**
 * OpenCode config projection — the keys OpenWork currently writes into
 * `opencode.json[c]` (`default_agent`, `plugin`, `mcp`, `provider`,
 * `permission.external_directory`). DB becomes the source of truth; the server projects
 * these into OpenCode via `OPENCODE_CONFIG_CONTENT` (managed) and/or a generated config
 * file (external/portable). See research doc 08.
 *
 * Generic key/value bag per (workspace, scope). `scope` = "project" | "global"; a NULL
 * workspaceId is used for global scope.
 */
export const opencodeConfigTable = sqliteTable(
  "opencode_config",
  {
    id: typeIdColumn("opencodeConfig", "id").primaryKey(),
    /** NULL for global scope. */
    workspaceId: text("workspace_id"),
    /** "project" | "global" */
    scope: text("scope").notNull().default("project"),
    /** e.g. "default_agent", "plugin", "provider", "permission.external_directory" */
    key: text("key").notNull(),
    value: jsonColumn<unknown>("value").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("opencode_config_ws_scope_key_unique").on(
      table.workspaceId,
      table.scope,
      table.key,
    ),
  ],
);

/**
 * MCP servers — replaces the `mcp` key inside `opencode.json[c]`. Modeled explicitly
 * (rather than a JSON blob) since it's a first-class concept. Inline auth (headers/key)
 * is kept in `config` JSON, mirroring today's verbatim storage.
 */
export const mcpServerTable = sqliteTable(
  "mcp_server",
  {
    id: typeIdColumn("mcpServer", "id").primaryKey(),
    /** NULL for global-scope MCP (read-only merge today; OpenWork only writes project). */
    workspaceId: text("workspace_id"),
    scope: text("scope").notNull().default("project"),
    name: text("name").notNull(),
    /** "local" | "remote" */
    type: text("type").notNull(),
    enabled: integer("enabled", { mode: "boolean" }),
    /** Full entry config verbatim: command[] (local) / url + headers/key (remote). */
    config: jsonColumn<Record<string, unknown>>("config").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("mcp_server_ws_name_unique").on(table.workspaceId, table.name)],
);

/**
 * Plugin registrations — replaces the `plugin` array in `opencode.json[c]`. Ordering is
 * preserved via `sortOrder`.
 */
export const pluginEntryTable = sqliteTable(
  "plugin_entry",
  {
    id: typeIdColumn("pluginEntry", "id").primaryKey(),
    workspaceId: text("workspace_id"),
    scope: text("scope").notNull().default("project"),
    /** The plugin spec string (npm name, file:, http(s):, git:, absolute). */
    spec: text("spec").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("plugin_entry_ws_spec_unique").on(table.workspaceId, table.spec),
    index("plugin_entry_sort_order_idx").on(table.sortOrder),
  ],
);

export type OpencodeConfigRow = typeof opencodeConfigTable.$inferSelect;
export type McpServerRow = typeof mcpServerTable.$inferSelect;
export type McpServerInsert = typeof mcpServerTable.$inferInsert;
export type PluginEntryRow = typeof pluginEntryTable.$inferSelect;
