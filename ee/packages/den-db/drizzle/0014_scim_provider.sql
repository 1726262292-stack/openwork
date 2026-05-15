CREATE TABLE `scim_provider` (
	`id` varchar(64) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`scim_token` text NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `scim_provider_id` PRIMARY KEY(`id`),
	CONSTRAINT `scim_provider_provider_id` UNIQUE(`provider_id`),
	CONSTRAINT `scim_provider_organization_id` UNIQUE(`organization_id`)
);
