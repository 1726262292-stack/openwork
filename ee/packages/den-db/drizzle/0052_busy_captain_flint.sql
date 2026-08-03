CREATE TABLE `scheduled_task_artifact` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`run_id` varchar(64) NOT NULL,
	`attempt_id` varchar(64) NOT NULL,
	`kind` enum('file','url') NOT NULL,
	`value` varchar(8192) NOT NULL,
	`name` varchar(512),
	`reference` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_artifact_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_attempt` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`run_id` varchar(64) NOT NULL,
	`worker_id` varchar(64) NOT NULL,
	`attempt` int NOT NULL,
	`status` enum('starting','running','completed','failed','cancelled','needs-attention','timed-out','ambiguous') NOT NULL,
	`lease_generation` int NOT NULL,
	`lease_token_hash` varchar(128) NOT NULL,
	`lease_expires_at` timestamp(3) NOT NULL,
	`last_heartbeat_at` timestamp(3) NOT NULL,
	`session_id` varchar(240),
	`started_at` timestamp(3) NOT NULL,
	`completed_at` timestamp(3),
	`error` json,
	`result_digest` varchar(128),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_attempt_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_attempt_number` UNIQUE(`run_id`,`attempt`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_execution_event` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`run_id` varchar(64) NOT NULL,
	`attempt_id` varchar(64) NOT NULL,
	`sequence` int NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`event` json NOT NULL,
	`event_digest` varchar(128) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_execution_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_event_sequence` UNIQUE(`attempt_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_grant_revision` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`task_revision_id` varchar(64) NOT NULL,
	`revision` int NOT NULL,
	`grant` mediumtext NOT NULL,
	`placement_identity` varchar(4096) NOT NULL,
	`reviewed_by_member_id` varchar(64) NOT NULL,
	`reviewed_at` timestamp(3) NOT NULL,
	`expires_at` timestamp(3),
	`revoked_at` timestamp(3),
	`revoked_by_member_id` varchar(64),
	`revocation_reason` varchar(2000),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_grant_revision_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_grant_number` UNIQUE(`task_id`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_revision` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`revision` int NOT NULL,
	`definition` mediumtext NOT NULL,
	`placement` json NOT NULL,
	`placement_identity` varchar(4096) NOT NULL,
	`created_by_member_id` varchar(64) NOT NULL,
	`reviewed_at` timestamp(3),
	`reviewed_by_member_id` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_revision_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_revision_number` UNIQUE(`task_id`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_run` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`task_revision_id` varchar(64) NOT NULL,
	`grant_revision_id` varchar(64) NOT NULL,
	`owner_member_id` varchar(64) NOT NULL,
	`execution_member_id` varchar(64) NOT NULL,
	`worker_id` varchar(64) NOT NULL,
	`workspace_id` varchar(240) NOT NULL,
	`placement` json NOT NULL,
	`occurrence_id` varchar(512) NOT NULL,
	`trigger` enum('manual','scheduled','recovery') NOT NULL,
	`status` enum('scheduled','claimed','running','retrying','completed','failed','cancelled','needs-attention','missed','skipped-overlap','ambiguous') NOT NULL,
	`scheduled_for` timestamp(3),
	`claimed_at` timestamp(3) NOT NULL,
	`dispatch_deadline` timestamp(3) NOT NULL,
	`started_at` timestamp(3),
	`completed_at` timestamp(3),
	`duration_ms` int,
	`idempotency_key` varchar(512) NOT NULL,
	`session_id` varchar(240),
	`attempt_count` int NOT NULL DEFAULT 0,
	`bounded_usage` json NOT NULL,
	`error` json,
	`needs_attention` json,
	`cancel_requested_at` timestamp(3),
	`retry_not_before` timestamp(3),
	`result_digest` varchar(128),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `scheduled_task_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_run_occurrence` UNIQUE(`task_revision_id`,`trigger`,`occurrence_id`),
	CONSTRAINT `scheduled_task_run_idempotency` UNIQUE(`task_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`owner_member_id` varchar(64) NOT NULL,
	`execution_member_id` varchar(64) NOT NULL,
	`worker_id` varchar(64) NOT NULL,
	`workspace_id` varchar(240) NOT NULL,
	`state` enum('draft','ready','enabled','paused','needs-attention','deleted') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`draft_revision_id` varchar(64) NOT NULL,
	`active_revision_id` varchar(64),
	`active_grant_id` varchar(64),
	`active_run_id` varchar(64),
	`next_due_at` timestamp(3),
	`needs_attention` json,
	`deleted_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `scheduled_task_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_task_tick_invocation` (
	`id` varchar(64) NOT NULL,
	`request_id` varchar(240) NOT NULL,
	`source` enum('vercel-cron','den-loop') NOT NULL,
	`request_digest` varchar(128) NOT NULL,
	`processed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_task_tick_invocation_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_task_tick_request` UNIQUE(`request_id`)
);
--> statement-breakpoint
ALTER TABLE `worker_token` MODIFY COLUMN `scope` enum('client','host','activity','execution') NOT NULL;--> statement-breakpoint
CREATE INDEX `scheduled_task_artifact_org_run` ON `scheduled_task_artifact` (`organization_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_attempt_worker_lease` ON `scheduled_task_attempt` (`worker_id`,`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `scheduled_task_event_org_run` ON `scheduled_task_execution_event` (`organization_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_grant_org_task` ON `scheduled_task_grant_revision` (`organization_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_grant_revision` ON `scheduled_task_grant_revision` (`task_revision_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_revision_org_task` ON `scheduled_task_revision` (`organization_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_run_worker_queue` ON `scheduled_task_run` (`worker_id`,`status`,`dispatch_deadline`);--> statement-breakpoint
CREATE INDEX `scheduled_task_run_org_task` ON `scheduled_task_run` (`organization_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_org_owner` ON `scheduled_task` (`organization_id`,`owner_member_id`);--> statement-breakpoint
CREATE INDEX `scheduled_task_worker_state` ON `scheduled_task` (`worker_id`,`state`);--> statement-breakpoint
CREATE INDEX `scheduled_task_due` ON `scheduled_task` (`enabled`,`next_due_at`);