# Sistem Pendaftaran Santri Baru (SPSB) 2027 — Griya Qur'an Tunas Ilmu

Aplikasi pendaftaran publik dan dashboard panitia untuk Kelompok Tahfidz. Stack aplikasi dibuat ringan: Bun, Elysia, Drizzle ORM, MariaDB, serta HTML/CSS/JavaScript tanpa frontend framework.

## Menjalankan lokal

Persyaratan: Bun 1.4+ dan database MariaDB yang dapat diakses.

```bash
cp .env.example .env
```

Isi koneksi MariaDB, kredensial admin, dan secret di `.env`. Kemudian jalankan:

```bash
bun install
bun run dev
```

Buka `http://127.0.0.1:8000`; dashboard admin berada di `/admin`. Migrasi Drizzle diterapkan otomatis saat aplikasi mulai. Untuk menerapkan migrasi secara manual, gunakan `bun run db:migrate`.

## Stack dan struktur

- **Runtime/package manager:** Bun 1.4.
- **HTTP/API:** Elysia.
- **Database:** MariaDB melalui driver `mysql2`.
- **ORM dan migrasi:** Drizzle ORM + Drizzle Kit.
- **Frontend:** HTML, CSS, dan JavaScript biasa; tanpa bundler atau framework frontend.
- `src/db/schema.ts` — skema pendaftar (nama tabel legacy waitinglist dipertahankan) dan pengaturan sistem.
- `drizzle/` — migrasi SQL yang dilacak oleh Drizzle.
- `src/index.ts` — endpoint Elysia dan server aplikasi.
- `public/` — halaman publik dan dashboard admin.

Jika mengubah skema Drizzle, buat migrasi dengan `bun run db:generate`, tinjau hasil SQL di `drizzle/`, lalu sertakan migrasi tersebut dalam deployment.

## Audit UI/UX

Audit otomatis halaman pendaftaran dijalankan secara lokal dengan Lighthouse CLI 13.5.0 dan Chrome for Testing 153.0.8010.12. Empat kategori Lighthouse standar dipakai sebagai skor audit yang dapat diulang (bukan skor UX resmi Google):

| Halaman / mode | Performance | Accessibility | Best Practices | SEO | Rata-rata kategori yang dinilai |
|---|---:|---:|---:|---:|---:|
| Pendaftaran / mobile | 100 | 100 | 100 | 100 | **100 (4 kategori)** |
| Pendaftaran / desktop | 100 | 100 | 100 | 100 | **100 (4 kategori)** |
| Admin / mobile | 100 | 100 | 100 | 60¹ | **100 (3 kategori UX)** |
| Konfirmasi / mobile | 100 | 100 | 100 | 60¹ | **100 (3 kategori UX)** |

¹ Skor SEO 60 muncul karena halaman admin dan konfirmasi sengaja diberi `noindex,nofollow`; Lighthouse menilai halaman tidak dapat diindeks. SEO bukan sasaran audit halaman ini dan skornya tidak dihitung ke rata-rata UX.

Audit visual mobile menemukan teks judul yang menyatu setelah line break disembunyikan dan nama aksesibel logo yang tidak cocok dengan teks terlihat; keduanya dirapikan. Favicon lokal juga ditambahkan agar halaman tidak meminta aset yang hilang.

Fixture audit menyajikan file UI aktual dari `public/` dan memalsukan hanya respons konfigurasi serta daftar provinsi, sehingga pemeriksaan tidak memerlukan MariaDB atau key Turnstile. Jalankan server fixture:

```bash
bun run audit:ui:server
```

Di terminal lain, set `CHROME_PATH` ke executable Chrome/Chromium lokal dan jalankan Lighthouse:

```bash
CHROME_PATH=/path/to/chrome npx --yes lighthouse http://127.0.0.1:8766/ \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=html --output-path=/tmp/spsb-lighthouse-mobile.html
```

Ulangi dengan `--preset=desktop` untuk profil desktop. Untuk audit admin/konfirmasi, ganti URL menjadi `/admin` atau `/success`; evaluasi tiga kategori UX (performance, accessibility, best practices) dan jangan masukkan SEO halaman noindex. Hasil mengukur tampilan awal sebelum interaksi; pengiriman formulir, validasi, dan verifikasi Turnstile tetap diuji terpisah. Fixture memakai API tiruan lokal, sehingga hasilnya mengukur frontend, bukan performa server/database production. Skor Lighthouse dapat berbeda menurut versi browser dan mesin audit.

## Dashboard admin

Dashboard di `/admin` mencakup:

- Login admin dengan sesi bertanda tangan, cookie HttpOnly, dan perlindungan CSRF.
- Monitoring status aplikasi, koneksi MariaDB, runtime Bun, webhook n8n, dan Turnstile.
- Ringkasan total pendaftar, jumlah yang memenuhi kriteria, dan pendaftar dalam 24 jam terakhir.
- Pencarian, filter, paginasi, serta ekspor CSV data pendaftar.
- Pengaturan tanggal acuan usia, usia minimum, dan link grup WhatsApp. Perubahan disimpan di MariaDB.

Kredensial admin, `APP_SECRET`, URL webhook n8n, dan secret Turnstile tetap dikelola melalui environment Coolify—bukan ditampilkan atau disimpan sebagai pengaturan biasa di dashboard.

## Perlindungan data dan operasional keamanan

- Field identitas pendaftar dienkripsi di aplikasi memakai AES-256-GCM sebelum masuk MariaDB. Ciphertext terikat pada nama field dan ID record; ID serta waktu pendaftaran tetap terlihat untuk kebutuhan operasional.
- Bukti transfer JPG/PNG/PDF (maksimal 5 MB) diverifikasi berdasarkan signature file, dienkripsi AES-256-GCM, lalu disimpan di `DATA_DIR/payment-proofs` dengan nama acak dan permission terbatas. File tidak disajikan sebagai aset publik; panitia harus login untuk mengunduhnya sebagai attachment.
- Saat startup, aplikasi mengenkripsi record plaintext dari versi lama dan memperbarui format ciphertext lama. Buat backup database sebelum upgrade pertama; bila proses terputus, startup berikutnya akan melanjutkan record yang belum diperbarui.
- `DATA_ENCRYPTION_KEY` harus tepat 32 byte (64 karakter hex). Buat sekali dengan `openssl rand -hex 32`, simpan sebagai secret di Coolify, dan simpan salinan pemulihan terenkripsi terpisah dari backup database serta volume bukti transfer. Jangan mengganti key secara langsung: rencanakan proses decrypt/re-encrypt dan pemulihan backup terlebih dahulu. Kehilangan key berarti data terenkripsi tidak dapat dibaca.
- Enkripsi database tidak melindungi data saat aplikasi sedang berjalan, dari host/aplikasi yang telah diambil alih, atau dari ekspor yang diunduh admin. Batasi akses Coolify/host, gunakan user MariaDB khusus dengan hak minimum, jangan publikasikan port database, aktifkan TLS MariaDB (`DB_SSL=true`) jika koneksi melewati jaringan yang tidak sepenuhnya tepercaya, dan batasi akses ke file CSV hasil ekspor.
- Webhook n8n di production wajib memakai HTTPS. Jangan kirim data pendaftar ke endpoint yang tidak dipercaya.
- Aplikasi menggunakan header IP dari reverse proxy untuk pembatasan percobaan. Pastikan port aplikasi hanya dapat dijangkau lewat proxy Coolify dan proxy menimpa (bukan meneruskan nilai kiriman pengguna untuk) header `CF-Connecting-IP`, `X-Real-IP`, atau `X-Forwarded-For`.
- File `data/waitinglist.sqlite3` lama tetap plaintext sesuai keputusan migrasi manual dan tidak disertakan dalam image Docker. Batasi permission file (mis. `chmod 600 data/waitinglist.sqlite3 data/waitinglist.sqlite3-wal data/waitinglist.sqlite3-shm`) dan akses backup/binlog/snapshot lama; setelah import terverifikasi dan retensi mengizinkan, pindahkan arsip ke penyimpanan terenkripsi yang aksesnya terbatas. Backup sebelum enkripsi juga tetap plaintext.

## Konfigurasi

Salin `.env.example` sebagai titik awal. Variabel penting:

| Variabel | Fungsi |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Koneksi MariaDB. `DATABASE_URL` dapat dipakai sebagai alternatif. |
| `DB_POOL_SIZE` | Batas koneksi pool MariaDB per instance (1–100, default 10). Sesuaikan dengan batas koneksi database dan jumlah replica. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Kredensial admin. Isi password kuat sebelum deployment. |
| `APP_SECRET` | Kunci sesi admin; gunakan nilai acak yang kuat dan tetap antar-restart. |
| `DATA_ENCRYPTION_KEY` | Kunci AES-256-GCM 32 byte yang stabil untuk enkripsi field pribadi. Simpan terpisah dan aman; jangan kehilangan atau menggantinya tanpa rencana rotasi. |
| `COOKIE_SECURE` | Set `true` di deployment HTTPS. |
| `DB_SSL` | Set `true` jika endpoint MariaDB mendukung TLS, terutama bila koneksi keluar dari jaringan privat container. |
| `CUTOFF_DATE`, `MIN_AGE_YEARS`, `MIN_AGE_MONTHS` | Nilai awal aturan usia; admin dapat mengubahnya setelah database diinisialisasi. |
| `WHATSAPP_GROUP_URL` | Nilai awal link grup; dapat diubah dari dashboard. |
| `N8N_WEBHOOK_URL` | Webhook notifikasi email n8n. Secret ini dikelola melalui environment. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Wajib di production: isi pasangan site key dan secret key Cloudflare Turnstile. Startup production ditolak jika salah satu atau keduanya tidak ada; pasangan parsial selalu ditolak. Development lokal dapat berjalan tanpa keduanya. |
| `HOST`, `PORT`, `DATA_DIR` | Alamat listener, port aplikasi, serta cache wilayah dan penyimpanan bukti transfer terenkripsi. Di Docker, pasang volume persisten pada `/app/data`; Dockerfile menetapkan host `0.0.0.0` dan port `8000`. |

Pengaturan tanggal acuan dan WhatsApp disalin dari environment ke tabel `system_settings` saat pertama kali database kosong. Setelah itu, nilai di dashboard menjadi sumber aktifnya.

### Data wilayah

Dropdown wilayah menggunakan proxy backend ke [EMSIFA API Wilayah Indonesia v2](https://www.emsifa.com/api-wilayah-indonesia/#api) (`https://www.emsifa.com/api-wilayah-indonesia/v2`). Respons upstream berbentuk `{ data, meta }`; adapter hanya meneruskan `id` dan `name` ke frontend. ID memakai format hierarkis bertitik (contoh `32`, `32.73`, `32.73.01`, `32.73.01.1001`). Backend menyimpan cache lokal versi v2 dan dapat melayani cache ketika upstream sementara tidak tersedia.

## API utama

- `GET /api/config`
- `GET /api/regions/provinces`
- `GET /api/regions/regencies?parent_id=<id>`
- `GET /api/regions/districts?parent_id=<id>`
- `GET /api/regions/villages?parent_id=<id>`
- `POST /api/waitinglist` (endpoint internal kompatibilitas untuk menyimpan pendaftaran SPSB)
- `POST /api/admin/login`, `POST /api/admin/logout`
- `GET /api/admin/system`, `GET /api/admin/settings`, `PUT /api/admin/settings`
- `GET /api/admin/waitinglist`, `GET /api/admin/export.csv`
- `GET /api/admin/waitinglist/:id/proof` — unduh bukti transfer, khusus admin terautentikasi.
- `GET /healthz` — liveness aplikasi; `GET /readyz` — kesiapan koneksi database.

`POST /api/waitinglist` menerima `multipart/form-data`, termasuk bukti transfer JPG/PNG/PDF wajib maksimal 5 MB dan konfirmasi pembayaran. Pendaftaran disimpan sebelum webhook n8n dipanggil. Jika webhook gagal atau belum diatur, record tetap tersimpan dan halaman konfirmasi menampilkan status notifikasi. Perbarui template email pada workflow n8n agar menyebut pendaftaran SPSB 2027, bukan waitinglist/pendaftaran minat. Penerimaan data bukan pengumuman hasil seleksi.

## Deployment di Coolify

Repository ini menyediakan `Dockerfile` berbasis image resmi Bun. Di Coolify:

1. Buat resource MariaDB, database, dan user khusus aplikasi. Aktifkan backup database serta volume persisten aplikasi pada `/app/data` untuk menyimpan bukti transfer terenkripsi. Pastikan volume dapat ditulis oleh UID `10001`.
2. Deploy repository sebagai aplikasi berbasis Dockerfile, gunakan port container `8000`, dan pasang domain HTTPS. Izinkan request upload minimal 5,2 MB di reverse proxy. Jangan publikasikan port aplikasi langsung ke internet; akses harus melalui reverse proxy Coolify.
3. Isi environment aplikasi dari `.env.example`. Gunakan hostname/internal connection details MariaDB dari Coolify—jangan gunakan `localhost` antar-container. Pastikan app dan database terhubung ke network internal yang sama.
4. Set `COOKIE_SECURE=true`. Isi `ADMIN_PASSWORD` unik (minimal 16 karakter), `APP_SECRET` acak (minimal 32 karakter), `DATA_ENCRYPTION_KEY` hasil `openssl rand -hex 32`, serta pasangan `TURNSTILE_SITE_KEY` dan `TURNSTILE_SECRET_KEY` dari Cloudflare. Kredensial MariaDB harus unik dengan password minimal 20 karakter; production menolak konfigurasi database `localhost`, webhook n8n non-HTTPS, atau key Turnstile yang tidak tersedia.
5. Pastikan `/readyz` merespons status `ready`. Pemeriksaan kesehatan container juga menunggu kesiapan koneksi database. Jangan membuka port MariaDB ke internet publik.

Data pendaftar berada di MariaDB, sedangkan bukti transfer terenkripsi berada di volume persisten `/app/data/payment-proofs`; backup dan pemulihan perlu mencakup keduanya serta `DATA_ENCRYPTION_KEY`. Cache wilayah di direktori yang sama dapat dibuat ulang. Database SQLite lama (`data/waitinglist.sqlite3`) tetap dipertahankan, tetapi tidak diimpor otomatis; lakukan migrasi terencana bila file tersebut berisi data yang harus dibawa ke MariaDB.

Untuk memeriksa dan mengimpor record dari file SQLite lama, atur `SQLITE_IMPORT_PATH` bila lokasinya berbeda, lalu jalankan `bun run db:import-sqlite -- --dry-run` untuk hitung saja atau `bun run db:import-sqlite` untuk mengimpor. Importer mempertahankan ID record dan melewati ID yang sudah ada di MariaDB; tetap buat backup sebelum migrasi.

## Pengujian

```bash
bun run verify
```

`tests/database.integration.test.ts` menjalankan alur pendaftaran, enkripsi, login admin, filter/ekspor, pengaturan, Turnstile, dan webhook terhadap MariaDB sungguhan serta mock untuk layanan eksternal. Tes ini hanya aktif bila `TEST_DATABASE_URL` diarahkan ke database khusus yang namanya memuat `test`; migrasi dan penghapusan record uji dilakukan di database tersebut, jadi jangan arahkan ke database produksi. Workflow GitHub Actions menjalankannya dengan MariaDB sementara, memeriksa audit dependency, migrasi, impor SQLite dry-run, dan build Docker.
