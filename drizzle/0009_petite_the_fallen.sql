CREATE TABLE IF NOT EXISTS `payment_receipt_attempts` (
	`id` varchar(32) NOT NULL,
	`participant_id` varchar(32) NOT NULL,
	`proof_id` varchar(32) NOT NULL,
	`participant_version` int unsigned NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'queued',
	`method` varchar(16),
	`execution_id` varchar(80),
	`gmail_message_id` varchar(160),
	`last_error` text,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	`sent_at` varchar(32),
	CONSTRAINT `payment_receipt_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payment_receipt_events` (
	`id` varchar(32) NOT NULL,
	`attempt_id` varchar(32) NOT NULL,
	`participant_id` varchar(32) NOT NULL,
	`event` varchar(40) NOT NULL,
	`actor` varchar(120) NOT NULL,
	`execution_id` varchar(80),
	`payload` text NOT NULL,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `payment_receipt_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `payment_receipt_attempts` ADD CONSTRAINT `fk_receipt_attempt_participant` FOREIGN KEY IF NOT EXISTS (`participant_id`) REFERENCES `calon_santri_waitinglist`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipt_events` ADD CONSTRAINT `fk_receipt_event_attempt` FOREIGN KEY IF NOT EXISTS (`attempt_id`) REFERENCES `payment_receipt_attempts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_receipt_events` ADD CONSTRAINT `fk_receipt_event_participant` FOREIGN KEY IF NOT EXISTS (`participant_id`) REFERENCES `calon_santri_waitinglist`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_attempt_participant` ON `payment_receipt_attempts` (`participant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_attempt_status` ON `payment_receipt_attempts` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_attempt_proof` ON `payment_receipt_attempts` (`proof_id`,`participant_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_event_attempt` ON `payment_receipt_events` (`attempt_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_receipt_event_participant` ON `payment_receipt_events` (`participant_id`,`created_at`);
