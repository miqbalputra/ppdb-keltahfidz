ALTER TABLE `calon_santri_waitinglist` ADD `jalur_pendaftaran` varchar(16) DEFAULT 'umum' NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `askar_anggota` text;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `askar_divisi_bapak` text;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` ADD `askar_divisi_ibu` text;