CREATE TABLE `authorized_root` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorized_root_path_unique` ON `authorized_root` (`path`);--> statement-breakpoint
CREATE TABLE `blueprint_session` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`template_id` text NOT NULL,
	`session_id` text NOT NULL,
	`hydrated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blueprint_session_ws_template_unique` ON `blueprint_session` (`workspace_id`,`template_id`);--> statement-breakpoint
CREATE TABLE `desktop_cloud_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`context_key` text NOT NULL,
	`organization_id` text NOT NULL,
	`org_member_id` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_cloud_sync_ws_context_unique` ON `desktop_cloud_sync` (`workspace_id`,`context_key`);--> statement-breakpoint
CREATE TABLE `workspace_meta` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`workspace_name` text,
	`preset` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`preset` text,
	`workspace_type` text DEFAULT 'local' NOT NULL,
	`remote_type` text,
	`base_url` text,
	`directory` text,
	`display_name` text,
	`openwork_host_url` text,
	`openwork_token` text,
	`openwork_workspace_id` text,
	`openwork_workspace_name` text,
	`sandbox_backend` text,
	`sandbox_run_id` text,
	`sandbox_container_name` text,
	`opencode_username` text,
	`opencode_password` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_path_unique` ON `workspace` (`path`);--> statement-breakpoint
CREATE INDEX `workspace_sort_order_idx` ON `workspace` (`sort_order`);--> statement-breakpoint
CREATE TABLE `token` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`scope` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_hash_unique` ON `token` (`hash`);--> statement-breakpoint
CREATE TABLE `workspace_port` (
	`workspace_key` text PRIMARY KEY NOT NULL,
	`port` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_port_port_idx` ON `workspace_port` (`port`);--> statement-breakpoint
CREATE TABLE `workspace_server_token` (
	`workspace_key` text PRIMARY KEY NOT NULL,
	`client_token` text,
	`host_token` text,
	`owner_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `server_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `env_var` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_var_key_unique` ON `env_var` (`key`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`workspace_id` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`summary` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_workspace_timestamp_idx` ON `audit` (`workspace_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `file_session_event` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`path` text NOT NULL,
	`to_path` text,
	`revision` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_session_event_ws_seq_unique` ON `file_session_event` (`workspace_id`,`seq`);--> statement-breakpoint
CREATE TABLE `file_session` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_root` text NOT NULL,
	`actor_token_hash` text NOT NULL,
	`actor_scope` text NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_session_workspace_idx` ON `file_session` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `session_pref` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_pref_session_key_unique` ON `session_pref` (`session_id`,`key`);--> statement-breakpoint
CREATE INDEX `session_pref_workspace_idx` ON `session_pref` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_ws_name_unique` ON `mcp_server` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `opencode_config` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opencode_config_ws_scope_key_unique` ON `opencode_config` (`workspace_id`,`scope`,`key`);--> statement-breakpoint
CREATE TABLE `plugin_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`spec` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_entry_ws_spec_unique` ON `plugin_entry` (`workspace_id`,`spec`);--> statement-breakpoint
CREATE INDEX `plugin_entry_sort_order_idx` ON `plugin_entry` (`sort_order`);--> statement-breakpoint
CREATE TABLE `extension_state` (
	`extension_id` text PRIMARY KEY NOT NULL,
	`enabled` integer,
	`hidden` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_workspace_vault` (
	`id` text PRIMARY KEY NOT NULL,
	`account_sub` text,
	`data` text NOT NULL,
	`encrypted` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preference` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
