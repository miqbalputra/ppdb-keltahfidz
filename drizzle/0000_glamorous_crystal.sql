CREATE TABLE `calon_santri_waitinglist` (
	`id` varchar(32) NOT NULL,
	`nama_ortu` varchar(120) NOT NULL,
	`status_ortu` enum('bapak','ibu') NOT NULL,
	`nama_anak` varchar(120) NOT NULL,
	`tanggal_lahir_anak` varchar(10) NOT NULL,
	`umur_terhitung_bulan` smallint unsigned NOT NULL,
	`status_eligibility` enum('eligible','not_eligible') NOT NULL,
	`provinsi_id` varchar(20) NOT NULL,
	`provinsi_nama` varchar(120) NOT NULL,
	`kabupaten_id` varchar(20) NOT NULL,
	`kabupaten_nama` varchar(120) NOT NULL,
	`kecamatan_id` varchar(20) NOT NULL,
	`kecamatan_nama` varchar(120) NOT NULL,
	`desa_id` varchar(20) NOT NULL,
	`desa_nama` varchar(120) NOT NULL,
	`no_hp_wa` varchar(15) NOT NULL,
	`email` varchar(254) NOT NULL,
	`konfirmasi_data` tinyint unsigned NOT NULL,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `calon_santri_waitinglist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`setting_key` varchar(64) NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `system_settings_setting_key` PRIMARY KEY(`setting_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_waitinglist_created_at` ON `calon_santri_waitinglist` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_waitinglist_region` ON `calon_santri_waitinglist` (`kecamatan_nama`,`desa_nama`);--> statement-breakpoint
CREATE INDEX `idx_waitinglist_eligibility` ON `calon_santri_waitinglist` (`status_eligibility`);