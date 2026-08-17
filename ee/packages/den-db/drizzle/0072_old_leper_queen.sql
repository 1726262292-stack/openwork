DROP INDEX `oauth_access_token_token` ON `oauthAccessToken`;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_token` ON `oauthAccessToken` (`token`(191));--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_token_token` ON `oauthRefreshToken` (`token`(191));
