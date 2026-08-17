CREATE TABLE `initial_admin_bootstrap_claim` (
	`singleton_key` varchar(64) NOT NULL,
	`reserved_grant_hash` varchar(64),
	`reserved_at` timestamp(3),
	`reserved_expires_at` timestamp(3),
	`consumed_at` timestamp(3),
	`consumed_by_user_id` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `initial_admin_bootstrap_claim_singleton_key` PRIMARY KEY(`singleton_key`)
);
--> statement-breakpoint
CREATE TABLE `initial_admin_bootstrap_grant` (
	`token_hash` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`consumed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `initial_admin_bootstrap_grant_token_hash` PRIMARY KEY(`token_hash`)
);
