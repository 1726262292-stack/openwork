CREATE TABLE `migration_state` (
	`source` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`backup_path` text,
	`imported_at` integer NOT NULL
);
