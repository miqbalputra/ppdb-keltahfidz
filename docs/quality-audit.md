# Pemeriksaan kualitas aplikasi

Pemeriksaan lokal pada 29 Oktober 2026 menggunakan Bun 1.4.2, MariaDB 11.4.5, Node.js, dan Chrome. Database pengujian dan volume lampiran terpisah dari produksi.

## Hasil

- `bun run verify`: 97 tes lulus, 0 gagal, 907 assertion. Pemeriksaan tipe, HTML, JavaScript, audit dependensi (192 paket), dan konsistensi migrasi lulus.
- `bun run test:ui`: alur browser lulus pada delapan lebar layar: 1786, 1440, 1366, 1200, 1024, 768, 390, dan 360 piksel.
- Instalasi dengan `--frozen-lockfile` lulus untuk lingkungan pengembangan dan dependensi produksi.
- Skrip browser sudah ditambahkan ke workflow CI. Hasil lokal tidak menyatakan bahwa workflow untuk perubahan yang belum dipush sudah dijalankan di GitHub.

## Cakupan bukti

| Area | Pemeriksaan |
| --- | --- |
| Akun dan akses | Admin/Bendahara, password Argon2id, ganti password wajib, penonaktifan, pencabutan sesi, CSRF, penolakan akses, dan perlindungan Admin terakhir termasuk perubahan bersamaan |
| Pendaftar | Tambah/edit, validasi identitas/kontak/wilayah/persetujuan, arsip/pemulihan, versi data dan konflik, serta bukti transfer |
| Data lama | Usia yang belum tercatat dan keputusan kelayakan sebelumnya dipertahankan dalam bentuk terenkripsi yang sama saat tanggal lahir tetap; tanggal pendaftaran awal dipertahankan; perubahan tanggal lahir menghitung ulang usia |
| Pembayaran | Status pemeriksaan, nominal Rp150.000, tanggal WIB, catatan wajib, bukti tidak tersedia, pergantian bukti yang mengulang pemeriksaan, serta riwayat dan versi bukti |
| Analitik dan unduhan | Cakupan filter bersama, arsip, data kosong, batas hari WIB, 1.000 peserta, nominal terverifikasi, Excel dan PDF multipage pada tes integrasi |
| Alur browser | CRUD, pembayaran, arsip/pemulihan, akun Bendahara, delapan unduhan Excel/PDF, perubahan aturan usia, filter yang dapat dihapus, urutan tabel otomatis, draft yang belum disimpan, penguncian saat simpan, dan pemulihan layanan wilayah |
| Responsif | Ringkasan, peserta, pembayaran, analitik, akun, dan pengaturan pada delapan lebar layar tanpa overflow horizontal halaman |
| Publik | Halaman Segera Dibuka tampil dalam pemeriksaan browser; berkas tampilan publik tidak diubah |

## Perbaikan utama

Validasi edit sekarang membedakan koreksi data dengan perubahan tanggal lahir. Snapshot usia dan kelayakan lama dipertahankan ketika tanggal lahir tidak diubah, termasuk jika aturan penerimaan menjadi lebih ketat. Tanggal lahir di masa depan diperiksa memakai hari WIB.

Dialog memberi peringatan sebelum membuang draft dan menonaktifkan kontrol selama penyimpanan. Hasil pemeriksaan pembayaran terikat pada peserta yang sedang disimpan. Pemulihan pilihan wilayah menjaga input lain ketika layanan wilayah terganggu.

Kolom pencarian, kelompok filter, tombol, dan ukuran kontrol dirapikan. Filter aktif dapat dihapus satu per satu; pilihan urutan dan jumlah baris langsung diterapkan. Input password dapat ditampilkan sementara, dan riwayat menggunakan label yang lebih mudah dibaca.

## Batas pemeriksaan

Browser diuji dengan Chromium/Chrome. Layanan CAPTCHA, webhook, dan wilayah menggunakan fixture pada tes yang relevan; ini memeriksa perilaku aplikasi ketika layanan berhasil atau gagal, bukan ketersediaan layanan pihak ketiga saat ini. Docker tidak tersedia pada host lokal, sehingga build image tetap menjadi pemeriksaan CI. Data produksi dan hasil deployment belum diperiksa langsung.

Lihat README untuk menjalankan pemeriksaan ulang, persyaratan database pengujian, dan persiapan backup sebelum deployment.
