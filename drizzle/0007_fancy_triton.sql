CREATE TABLE `audit_events` (
	`id` varchar(32) NOT NULL,
	`subject_id` varchar(32) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`action` varchar(48) NOT NULL,
	`payload` text NOT NULL,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `participant_proofs` (
	`id` varchar(32) NOT NULL,
	`participant_id` varchar(32) NOT NULL,
	`storage_key` varchar(80) NOT NULL,
	`encryption_context` varchar(80) NOT NULL,
	`mime` varchar(40) NOT NULL,
	`size` int unsigned NOT NULL,
	`created_at` varchar(32) NOT NULL,
	`created_by` varchar(120),
	CONSTRAINT `participant_proofs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` varchar(32) NOT NULL,
	`expires_at` varchar(32) NOT NULL,
	CONSTRAINT `staff_sessions_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`username` varchar(120) NOT NULL,
	`password_hash` text NOT NULL,
	`role` varchar(16) NOT NULL,
	`active` tinyint unsigned NOT NULL DEFAULT 1,
	`must_change_password` tinyint unsigned NOT NULL DEFAULT 1,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `staff_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `updated_at` varchar(32);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `updated_by` varchar(120);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `proof_id` varchar(32);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `payment_status` varchar(24) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `payment_date` varchar(10);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `payment_reviewed_at` varchar(32);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `payment_reviewer` varchar(120);--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `payment_note` text;--> statement-breakpoint
ALTER TABLE `participant_proofs` ADD CONSTRAINT `participant_proofs_participant_id_calon_santri_waitinglist_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `calon_santri_waitinglist`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_sessions` ADD CONSTRAINT `staff_sessions_user_id_staff_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audit_subject` ON `audit_events` (`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_proof_participant` ON `participant_proofs` (`participant_id`);--> statement-breakpoint
CREATE INDEX `idx_staff_session_expiry` ON `staff_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_waitinglist_payment` ON `calon_santri_waitinglist` (`payment_status`,`payment_date`);--> statement-breakpoint
CREATE INDEX `idx_waitinglist_archived` ON `calon_santri_waitinglist` (`deleted_at`);