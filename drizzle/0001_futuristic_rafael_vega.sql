DROP INDEX `idx_waitinglist_region` ON `calon_santri_waitinglist`;--> statement-breakpoint
DROP INDEX `idx_waitinglist_eligibility` ON `calon_santri_waitinglist`;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `nama_ortu` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `status_ortu` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `nama_anak` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `tanggal_lahir_anak` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `umur_terhitung_bulan` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `status_eligibility` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `provinsi_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `provinsi_nama` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `kabupaten_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `kabupaten_nama` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `kecamatan_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `kecamatan_nama` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `desa_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `desa_nama` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `no_hp_wa` text NOT NULL;--> statement-breakpoint
ALTER TABLE `calon_santri_waitinglist` MODIFY COLUMN `email` text NOT NULL;