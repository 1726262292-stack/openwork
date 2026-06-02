CREATE TABLE `cloud_task` (
	`id` varchar(64) NOT NULL,
	`org_id` varchar(64) NOT NULL,
	`created_by_user_id` varchar(64),
	`created_by_member_id` varchar(64),
	`name` varchar(255) NOT NULL,
	`prompt` varchar(12000) NOT NULL,
	`schedule_type` enum('manual','daily') NOT NULL,
	`schedule_time_of_day` varchar(5),
	`schedule_timezone` varchar(64),
	`model_provider_id` varchar(255),
	`model_id` varchar(255),
	`agent` varchar(255),
	`variant` varchar(255),
	`enabled` boolean NOT NULL DEFAULT true,
	`next_run_at` timestamp(3),
	`last_run_id` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `cloud_task_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cloud_task_run` (
	`id` varchar(64) NOT NULL,
	`task_id` varchar(64) NOT NULL,
	`org_id` varchar(64) NOT NULL,
	`worker_id` varchar(64),
	`status` enum('pending','provisioning','running','accepted','failed','cancelled') NOT NULL,
	`session_id` varchar(128),
	`openwork_url` varchar(2048),
	`error_message` varchar(2048),
	`started_at` timestamp(3),
	`completed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `cloud_task_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cloud_task_org_id` ON `cloud_task` (`org_id`);
--> statement-breakpoint
CREATE INDEX `cloud_task_created_by_user_id` ON `cloud_task` (`created_by_user_id`);
--> statement-breakpoint
CREATE INDEX `cloud_task_next_run_at` ON `cloud_task` (`next_run_at`);
--> statement-breakpoint
CREATE INDEX `cloud_task_run_task_id` ON `cloud_task_run` (`task_id`);
--> statement-breakpoint
CREATE INDEX `cloud_task_run_org_id` ON `cloud_task_run` (`org_id`);
--> statement-breakpoint
CREATE INDEX `cloud_task_run_worker_id` ON `cloud_task_run` (`worker_id`);
--> statement-breakpoint
CREATE INDEX `cloud_task_run_status` ON `cloud_task_run` (`status`);
