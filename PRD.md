# PRD: Aplikasi Waitinglist Informasi SPSB
## Kelompok Tahfidz Griya Qur'an Tunas Ilmu

**Versi:** 1.1
**Tanggal:** 25 September 2026 (revisi: tambah field email wajib, auto-format nomor WhatsApp)
**Status:** Draft untuk implementasi

---

## 1. Latar Belakang

Griya Qur'an Tunas Ilmu akan membuka **SPSB (Sistem Penerimaan Santri Baru) 2027**. Sebelum pendaftaran resmi dibuka, dibutuhkan sebuah aplikasi **waitinglist** yang memungkinkan orang tua mendaftarkan minat mereka agar mendapatkan informasi terkait pembukaan pendaftaran santri baru.

Aplikasi ini dirancang agar di masa depan (fase berikutnya) dapat dikembangkan menjadi **aplikasi pendaftaran santri baru sesungguhnya**, sehingga struktur data dan arsitektur dibangun agar mudah diperluas.

## 2. Tujuan

1. Menyediakan form pendaftaran minat (waitinglist) yang mudah diisi oleh orang tua via HP.
2. Melakukan validasi otomatis kelayakan usia calon santri berdasarkan kriteria SPSB 2027.
3. Mengumpulkan data calon pendaftar secara terstruktur untuk keperluan panitia SPSB.
4. Mengarahkan orang tua yang lolos validasi ke grup WhatsApp informasi SPSB, baik lewat halaman sukses maupun email otomatis.

## 3. Ruang Lingkup

### 3.1 Termasuk (Fase 1 — Waitinglist)
- Form publik pendaftaran waitinglist (tanpa login).
- Validasi otomatis umur calon santri.
- Pemilihan alamat wilayah (Provinsi → Kabupaten → Kecamatan → Desa) via API Wilayah Indonesia.
- Halaman sukses berisi ajakan join grup WhatsApp.
- Pengiriman email otomatis (via n8n + Gmail node) berisi info join grup WhatsApp.
- Dashboard admin sederhana untuk melihat & mengekspor data waitinglist.

### 3.2 Tidak Termasuk (Fase 1) — direncanakan Fase 2
- Proses pendaftaran santri baru sesungguhnya (upload dokumen, biaya pendaftaran, jadwal tes, dsb).
- Sistem seleksi/pengumuman kelulusan santri.
- Login/akun orang tua.

> Catatan desain: skema database dan struktur form pada Fase 1 dibuat agar tabel `calon_santri` dapat langsung dipakai ulang sebagai basis tabel `pendaftar` di Fase 2, cukup menambah kolom (status pendaftaran, dokumen, dsb) tanpa migrasi besar.

## 4. Aktor / Pengguna

| Aktor | Deskripsi |
|---|---|
| Orang Tua (Publik) | Mengisi form waitinglist, tanpa perlu login |
| Admin/Panitia SPSB | Login untuk melihat, mencari, dan mengekspor data waitinglist |

## 5. Alur Pengguna (User Flow)

```
1. Orang tua membuka link aplikasi
2. Mengisi form waitinglist
3. Sistem menghitung umur anak otomatis saat tanggal lahir diisi
   ├─ Jika umur < 6 tahun 6 bulan per 1 Juli 2027:
   │     → Tampilkan pesan: "Mohon maaf umur Ananda belum masuk kriteria,
   │        Ananda bisa mendaftar kembali tahun depan."
   │     → Tombol submit dinonaktifkan
   └─ Jika umur memenuhi syarat:
         → Tombol submit aktif
4. Orang tua mencentang checklist konfirmasi data sudah benar & lengkap
5. Orang tua submit form
6. Sistem menyimpan data ke database
7. Sistem redirect ke Halaman Sukses (ajakan join grup WhatsApp + tombol/QR)
8. Sistem trigger webhook ke n8n
9. n8n mengirim email (Gmail node) berisi info & link join grup WhatsApp
   ke email orang tua
```

## 6. Spesifikasi Form Pendaftaran Waitinglist

### 6.1 Field Form

| No | Field | Tipe Input | Wajib | Keterangan |
|---|---|---|---|---|
| 1 | Nama Orang Tua | Text | Ya | |
| 2 | Status | Radio: `Bapak` / `Ibu` | Ya | Menentukan sapaan/relasi terhadap anak |
| 3 | Nama Anak yang akan didaftarkan | Text | Ya | |
| 4 | Tanggal Lahir Anak | Date picker | Ya | Memicu perhitungan umur otomatis |
| 5 | Provinsi | Dropdown (API Wilayah) | Ya | |
| 6 | Kabupaten/Kota | Dropdown (API Wilayah, tergantung Provinsi) | Ya | |
| 7 | Kecamatan | Dropdown (API Wilayah, tergantung Kabupaten) | Ya | |
| 8 | Desa/Kelurahan | Dropdown (API Wilayah, tergantung Kecamatan) | Ya | |
| 9 | No. HP WhatsApp Aktif | Text/Tel, auto-format ke `62xxxxxxxxxx` | Ya | Dipakai untuk kontak & join grup WA — lihat 6.3 |
| 10 | Email Orang Tua | Email, validasi format email | Ya | Tujuan pengiriman email join grup WhatsApp via n8n |
| 11 | Checklist konfirmasi data lengkap & benar | Checkbox | Ya | Harus dicentang sebelum submit aktif |

### 6.2 Validasi Umur (Logika Bisnis Inti)

**Kriteria:** Calon santri harus berusia **minimal 6 tahun 6 bulan, dihitung tepat pada tanggal 1 Juli 2027**.

**Tanggal acuan (cutoff):** `1 Juli 2027`
**Batas usia minimum:** `6 tahun 6 bulan`
**Artinya, tanggal lahir anak paling lambat adalah:** `1 Januari 2021`

- Jika `tanggal_lahir_anak <= 1 Januari 2021` → **Lolos**, form dapat disubmit.
- Jika `tanggal_lahir_anak > 1 Januari 2021` → **Tidak lolos**, tampilkan pesan:
  > "Mohon maaf umur Ananda belum masuk kriteria, Ananda bisa mendaftar kembali tahun depan."

  Tombol submit dinonaktifkan (disabled), namun sistem tetap boleh menampilkan umur anak saat ini sebagai informasi.

**Catatan implementasi:** tanggal cutoff (`1 Juli 2027`) dan batas usia (`6 tahun 6 bulan`) sebaiknya disimpan sebagai **konfigurasi** (bukan hardcode), agar tahun ajaran berikutnya cukup diubah lewat admin/config tanpa deploy ulang kode.

Pseudocode perhitungan:
```
cutoff_date = 2027-07-01
min_years = 6
min_months = 6

batas_tanggal_lahir = cutoff_date - min_years tahun - min_months bulan
                     = 2021-01-01

if tanggal_lahir_anak <= batas_tanggal_lahir:
    status = "eligible"
else:
    status = "not_eligible"
    tampilkan pesan penolakan
```

### 6.3 Format Otomatis Nomor WhatsApp

**Aturan:** nomor HP WhatsApp harus tersimpan dalam format internasional `62xxxxxxxxxxx` (tanpa `+`, tanpa spasi/strip), agar langsung kompatibel dipakai untuk link `wa.me/62xxxxxxxxxxx` maupun integrasi WhatsApp API di masa depan.

**Konversi otomatis saat input (client-side), lalu divalidasi ulang di server:**
- Jika input diawali `0` → ganti awalan `0` menjadi `62`. Contoh: `081234567890` → `6281234567890`.
- Jika input diawali `62` → biarkan apa adanya (sudah benar format).
- Jika input diawali `+62` → hapus tanda `+`. Contoh: `+6281234567890` → `6281234567890`.
- Hapus semua karakter non-digit (spasi, strip, tanda kurung) sebelum konversi di atas diterapkan.
- Setelah konversi, validasi panjang digit wajar (umumnya 10–13 digit setelah `62`) dan hanya berisi angka; jika tidak valid, tampilkan pesan error dan tombol submit dinonaktifkan.

Pseudocode:
```
input_bersih = hapus semua karakter selain angka dan '+' dari input

if input_bersih dimulai dengan "0":
    nomor_final = "62" + input_bersih[1:]
elif input_bersih dimulai dengan "+62":
    nomor_final = input_bersih[1:]   // buang tanda +
elif input_bersih dimulai dengan "62":
    nomor_final = input_bersih
else:
    // format tidak dikenali, minta user cek ulang
    error = true

validasi: nomor_final hanya digit, panjang wajar (mis. 11–15 digit termasuk "62")
```

**UX:** tampilkan hasil format akhir secara real-time di bawah/di dalam input (misalnya sebagai preview `→ 6281234567890`) supaya orang tua tahu nomor yang akan tersimpan & dipakai untuk join grup WA, tanpa perlu mereka mengetik `62` secara manual.

### 6.4 Integrasi API Wilayah Indonesia

Sumber: [EMSIFA API Wilayah Indonesia v2](https://www.emsifa.com/api-wilayah-indonesia/#api), base URL `https://www.emsifa.com/api-wilayah-indonesia/v2`.

Alur pemanggilan (cascading dropdown):
1. Saat halaman load → fetch daftar **provinsi**.
2. Saat provinsi dipilih → fetch daftar **kabupaten/kota** berdasarkan `id` provinsi.
3. Saat kabupaten dipilih → fetch daftar **kecamatan** berdasarkan `id` kabupaten.
4. Saat kecamatan dipilih → fetch daftar **desa/kelurahan** berdasarkan `id` kecamatan.

API v2 membungkus daftar dalam `{ data, meta }`; setiap item memiliki `id` dan `name`. ID hierarkis dapat berisi titik, misalnya `32.73.01`. Aplikasi mengambil data melalui backend proxy/cache dan menyimpan nama wilayah bersama ID saat formulir dikirim.

**Catatan penting:** API publik emsifa adalah repo statis (data tidak berubah, tidak butuh API key), namun uptime-nya di luar kendali kita. Rekomendasi:
- Fetch data melalui **backend sebagai proxy/cache** (bukan langsung dari browser client), lalu simpan cache lokal (misalnya file JSON di server atau tabel `wilayah` di database) yang di-refresh berkala. Ini mengurangi risiko downtime pihak ketiga dan mempercepat loading.
- Simpan **nama** wilayah (bukan hanya ID) di record pendaftar, supaya data tetap terbaca meskipun API pihak ketiga sewaktu-waktu tidak dapat diakses lagi.

## 7. Halaman Sukses (Setelah Submit)

Setelah data berhasil disimpan, orang tua diarahkan ke halaman sukses berisi:
- Ucapan terima kasih & konfirmasi data telah diterima.
- Ajakan bergabung ke Grup WhatsApp Info SPSB (tombol "Join Grup WhatsApp" yang membuka link `wa.me`/link grup, dan opsional QR code).
- Instruksi bahwa info yang sama juga sudah dikirim ke email yang didaftarkan.

## 8. Integrasi n8n (Notifikasi Email)

Alur:
1. Backend aplikasi memanggil **webhook n8n** setelah data waitinglist berhasil disimpan, mengirim payload: nama orang tua, nama anak, no HP WA (format `62xxx`), email, status kelayakan usia.
2. Workflow n8n menerima webhook → node **Gmail** mengirim email ke orang tua berisi:
   - Ucapan terima kasih.
   - Info bahwa anak terdaftar di waitinglist SPSB 2027.
   - Link/instruksi join grup WhatsApp.
3. (Opsional Fase 1.1) n8n juga bisa dipakai untuk mengirim notifikasi ke Admin/Panitia setiap ada pendaftar baru (misal ke grup WA internal panitia).

**Yang perlu disiapkan Iqbal di sisi n8n:**
- Webhook node (trigger) dengan URL unik → dimasukkan ke `.env` backend aplikasi.
- Kredensial Gmail (OAuth) sudah terhubung di n8n.
- Template email (subject + body) berisi link grup WhatsApp.

## 9. Dashboard Admin (Sederhana)

- Login admin (username/password atau JWT sederhana, sesuai standar aplikasi internal lain yang sudah dipakai).
- Tabel daftar waitinglist: nama anak, nama orang tua, tanggal lahir, umur (per 1 Juli 2027), wilayah, no HP, status kelayakan, tanggal submit.
- Fitur pencarian & filter (misal filter per Kecamatan/Desa, filter status eligible/tidak).
- Export ke Excel/CSV untuk kebutuhan panitia.

## 10. Skema Data (Draft)

**Tabel `calon_santri_waitinglist`** *(nama disiapkan agar mudah di-reuse jadi `pendaftar` di Fase 2)*

| Kolom | Tipe | Keterangan |
|---|---|---|
| id | UUID/int, PK | |
| nama_ortu | varchar | |
| status_ortu | enum('bapak','ibu') | |
| nama_anak | varchar | |
| tanggal_lahir_anak | date | |
| umur_terhitung_bulan | int | Dihitung & disimpan saat submit (snapshot) |
| status_eligibility | enum('eligible','not_eligible') | Snapshot hasil validasi saat submit |
| provinsi_id / provinsi_nama | varchar | Simpan ID + nama |
| kabupaten_id / kabupaten_nama | varchar | |
| kecamatan_id / kecamatan_nama | varchar | |
| desa_id / desa_nama | varchar | |
| no_hp_wa | varchar | Tersimpan dalam format `62xxxxxxxxxxx` (lihat 6.3) |
| email | varchar | Wajib diisi, tujuan email otomatis via n8n |
| konfirmasi_data | boolean | Harus `true` |
| created_at | timestamp | |

## 11. Non-Functional Requirements

- **Mobile-first**: mayoritas orang tua akan mengisi form dari HP.
- **Ringan & cepat**: hindari library berat; dropdown wilayah harus responsif meski koneksi lambat.
- **Anti-spam**: pertimbangkan Cloudflare Turnstile pada form publik (konsisten dengan aplikasi internal lain).
- **Self-hosted/free-tier friendly**, konsisten dengan preferensi stack yang biasa dipakai.
- **Audit trail minimal**: `created_at` cukup untuk Fase 1.

## 12. Usulan Tech Stack

*(Stack implementasi dipilih agar ringan, cepat, dan mudah di-deploy mandiri melalui Coolify.)*

- **Frontend:** HTML, CSS, dan JavaScript tanpa framework berat (form + cascading dropdown wilayah).
- **Backend:** Bun runtime + Elysia.
- **ORM/migrasi:** Drizzle ORM + Drizzle Kit.
- **Database:** MariaDB, dikelola dan disimpan persisten di VPS melalui Coolify.
- **Dashboard admin:** monitoring kesehatan aplikasi/database/integrasi, statistik waitinglist, serta pengaturan aturan usia dan link WhatsApp.
- **Anti-spam:** Cloudflare Turnstile.
- **Integrasi:** Webhook ke n8n → node Gmail.
- **Hosting:** Self-hosted (konsisten dengan infrastruktur Griya Qur'an lain, mis. subdomain `spsb.griyaquran.web.id` atau serupa).

## 13. Rencana Implementasi Bertahap

1. **Setup proyek** — struktur backend + frontend, koneksi database.
2. **Skema database** — tabel `calon_santri_waitinglist` + cache tabel `wilayah` (opsional).
3. **Integrasi API Wilayah** — endpoint proxy/cache Provinsi → Kabupaten → Kecamatan → Desa.
4. **Form publik** — UI form + validasi client-side (termasuk logika umur real-time).
5. **Backend validasi & submit** — validasi umur server-side (jangan hanya client-side), simpan data.
6. **Halaman sukses** — UI ajakan join grup WhatsApp.
7. **Integrasi n8n** — webhook trigger + test pengiriman email Gmail.
8. **Dashboard admin** — login, tabel data, filter/search, export Excel/CSV.
9. **Testing end-to-end** — termasuk edge case tanggal lahir tepat di batas (1 Januari 2021).
10. **Deployment**.

## 14. Pertanyaan Terbuka (Perlu Konfirmasi Sebelum Development)

1. Link/grup WhatsApp yang dituju itu grup statis (satu link untuk semua), atau berbeda per wilayah/kloter?
2. Apakah dashboard admin perlu multi-role (misal Admin vs Panitia lapangan dengan akses terbatas), atau cukup satu role admin?
3. Apakah data yang tidak eligible (umur belum cukup) tetap **disimpan** ke database untuk arsip, atau memang tidak boleh tersimpan sama sekali (form diblokir total)?
