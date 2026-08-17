ALTER TABLE `remote_mcp_app` DROP INDEX `remote_mcp_app_plugin_id`;--> statement-breakpoint
CREATE INDEX `remote_mcp_app_plugin_idx` ON `remote_mcp_app` (`plugin_id`);