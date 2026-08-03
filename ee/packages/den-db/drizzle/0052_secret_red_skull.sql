CREATE TABLE `automation_revision` (
	`id` varchar(64) NOT NULL,
	`automation_id` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`instructions` mediumtext NOT NULL,
	`schedule_kind` enum('once','daily','weekly') NOT NULL,
	`schedule_config` json NOT NULL,
	`timezone` varchar(120) NOT NULL,
	`provider_id` varchar(160) NOT NULL,
	`model_id` varchar(240) NOT NULL,
	`maximum_runtime_ms` int NOT NULL,
	`digest` varchar(128) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `automation_revision_id` PRIMARY KEY(`id`),
	CONSTRAINT `automation_revision_version` UNIQUE(`automation_id`,`version`),
	CONSTRAINT `automation_revision_digest` UNIQUE(`automation_id`,`digest`)
);
--> statement-breakpoint
CREATE TABLE `automation_run_event` (
	`id` varchar(64) NOT NULL,
	`run_id` varchar(64) NOT NULL,
	`sequence` int NOT NULL,
	`engine_event_id` varchar(240),
	`engine_idempotency_key` varchar(512),
	`engine_execution_id` varchar(240),
	`event_type` enum('user','assistant','capability_search','capability_execution','usage','warning','terminal') NOT NULL,
	`payload` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `automation_run_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `automation_run_event_sequence` UNIQUE(`run_id`,`sequence`),
	CONSTRAINT `automation_run_engine_event` UNIQUE(`run_id`,`engine_idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `automation_run` (
	`id` varchar(64) NOT NULL,
	`automation_id` varchar(64) NOT NULL,
	`revision_id` varchar(64) NOT NULL,
	`trigger` enum('scheduled','recovery','manual') NOT NULL,
	`scheduled_for` timestamp(3),
	`idempotency_key` varchar(512) NOT NULL,
	`status` enum('queued','claimed','running','succeeded','failed','cancelled','skipped') NOT NULL DEFAULT 'queued',
	`lease_owner` varchar(240),
	`lease_expires_at` timestamp(3),
	`heartbeat_at` timestamp(3),
	`attempt_count` int NOT NULL DEFAULT 0,
	`cloud_thread_id` varchar(64) NOT NULL,
	`engine_kind` varchar(160),
	`engine_receipt` json,
	`engine_sequence` int NOT NULL DEFAULT 0,
	`engine_admitted_at` timestamp(3),
	`provider_id` varchar(160) NOT NULL,
	`model_id` varchar(240) NOT NULL,
	`started_at` timestamp(3),
	`finished_at` timestamp(3),
	`error` json,
	`result_summary` text,
	`usage` json NOT NULL,
	`cancel_requested_at` timestamp(3),
	`mcp_token_hash` varchar(128),
	`mcp_token_expires_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `automation_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `automation_run_occurrence` UNIQUE(`idempotency_key`),
	CONSTRAINT `automation_run_cloud_thread` UNIQUE(`cloud_thread_id`)
);
--> statement-breakpoint
CREATE TABLE `automation` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`owner_member_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`state` enum('active','inactive','needs_attention','archived') NOT NULL DEFAULT 'active',
	`current_revision_id` varchar(64) NOT NULL,
	`next_due_at` timestamp(3),
	`latest_run_at` timestamp(3),
	`needs_attention_reason` json,
	`archived_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `automation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `automation_run_event_created` ON `automation_run_event` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_run_claimable` ON `automation_run` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `automation_run_history` ON `automation_run` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_org_owner_state` ON `automation` (`organization_id`,`owner_member_id`,`state`);--> statement-breakpoint
CREATE INDEX `automation_due` ON `automation` (`state`,`next_due_at`);