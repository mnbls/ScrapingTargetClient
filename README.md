# ScrapingTargetClient

Pencari calon klien pembuatan website dari Google Maps. Isi jenis usaha dan kota, hasilnya berupa tabel
(nama usaha, telepon, website, alamat, rating, jumlah rating) yang bisa diunduh sebagai Excel (.xlsx) atau CSV.

Kolom hasil: nama, potensi, skor, telepon, website, jenis_website (tidak ada / sosmed / website), jualan_online, kategori,
harga, reservasi, badan_hukum, cabang_di_hasil, alamat, rating, jumlah_rating, alasan, link_maps.
Usaha yang websitenya hanya Instagram, Facebook, linktr.ee, marketplace, dan sejenisnya ditandai `sosmed` dan tetap dihitung sebagai calon klien.

Kolom tambahan dan batasannya:

| Kolom | Sumber | Batasan |
|---|---|---|
| `jualan_online` | Link website di Maps | Hanya terdeteksi bila link mengarah ke Shopee, Tokopedia, Lazada, Blibli, Bukalapak, GoFood, atau GrabFood |
| `kategori` | Places API (`primaryTypeDisplayName`), atau tombol kategori di halaman Maps | - |
| `harga` | Places API (`priceLevel`), atau teks harga di bawah nama usaha | Sering kosong karena Maps tidak selalu menampilkan harga. Di mode tanpa API, "Rp ..." diubah ke label dengan batas perkiraan per orang: sampai 50 rb murah, 150 rb sedang, 400 rb mahal, di atasnya sangat mahal |
| `reservasi` | Places API (`reservable`), atau tombol "Reservasi" di halaman Maps | Di mode API field ini masuk SKU yang lebih mahal, hapus dari `FIELD_MASK` di `lib.mjs` bila ingin hemat |
| `badan_hukum` | Nama usaha | Hanya terdeteksi bila "PT" atau "CV" tertulis di nama |
| `cabang_di_hasil` | Nama usaha | Hanya menghitung usaha bernama sama di hasil pencarian yang sama |

## Skor potensi

Setiap usaha diberi skor 0-100 (Tinggi >= 70, Sedang 45-69, Rendah < 45) dan hasil diurutkan dari yang paling
mungkin menerima penawaran website. Kolom `alasan` menjelaskan asal skornya. Komponen skor:

| Sinyal | Poin |
|---|---|
| Belum punya website / hanya sosmed | 45 / 35 |
| Ada nomor HP/WhatsApp (nomor telepon biasa) | 20 (15) |
| Jumlah ulasan (usaha aktif), skala log | sampai 20 |
| Rating 4.5+ / 4.0+ / 3.5+ (bobot naik sampai 20 ulasan) | 15 / 10 / 5 |
| Tiap sinyal tambahan: 2+ cabang di hasil, PT/CV, harga mahal, menerima reservasi, jualan di marketplace | 5 |

Skor akhir = skor dari data Maps x faktor jenis usaha. Jenis usaha diambil dari kategori Maps, atau dari kata pencarian
bila kategori kosong. Kolom `skor_maps` menyimpan skor sebelum dikali.

| Kelompok | Faktor | Contoh |
|---|---|---|
| Tinggi | 100% | Hotel, villa, klinik, dokter gigi, sekolah, kursus, wedding, katering, travel, rental, properti, kontraktor, konsultan |
| Sedang | 80% | Restoran, kafe, kedai kopi, bakery, salon, barbershop, spa, gym, toko, bengkel |
| Rendah | 50% | Warung, toko kelontong, fotokopi, tambal ban, laundry, angkringan |
| Tidak dikenali | 80% | Kategori yang tidak ada di daftar |

Daftar dan faktornya adalah penilaian umum, bukan hasil data. Ubah di `BUSINESS_GROUPS` di `lib.mjs`.

Batas: tanpa nomor kontak maksimal 60, sudah punya website maksimal 40 (sebelum dikali faktor jenis). Ini perkiraan dari data publik untuk
menentukan urutan prospek, bukan jaminan usaha akan setuju.

Dua mode:

- **Tanpa API**: membuka Chrome/Edge lewat Playwright dan membaca Google Maps. Gratis, tapi lebih lambat dan
  bisa kena CAPTCHA. Scraping langsung melanggar ketentuan layanan Google, pakai dengan risiko sendiri.
- **Google API**: memakai Places API (New). Butuh API key dan billing aktif.

## Cara cepat (Windows, tanpa coding)

1. Pasang [Node.js](https://nodejs.org) versi LTS dan pastikan Chrome atau Edge ada di komputer.
2. Di halaman GitHub repo ini, klik **Code > Download ZIP**, lalu ekstrak.
3. Klik dua kali `start.bat`. Pertama kali akan memasang kebutuhan sendiri (1-2 menit), lalu browser terbuka di `http://localhost:3737`.
4. Isi jenis usaha dan kota, klik **Cari**. Jendela hitam jangan ditutup selama dipakai.

## Aplikasi desktop (Windows .exe)

Folder `desktop/` membungkus aplikasi ini dengan Electron, jadi bisa dipasang seperti program biasa tanpa Node.js dan
tanpa terminal. Jendela aplikasi menampilkan halaman yang sama. Mode tanpa API tetap butuh Chrome atau Edge di komputer.

Membuat installer (butuh Node.js 18+, hanya sekali oleh pembuatnya):

```bash
cd desktop
npm install
npm run dist
```

Hasilnya `desktop/dist/Pencari Calon Klien Setup 1.0.0.exe` (sekitar 130 MB). Kirim file itu ke pengguna lain, lalu
mereka tinggal menjalankannya. `npm run pack` hanya membuat folder `dist/win-unpacked` untuk uji coba, dan
`npm start` menjalankan aplikasinya langsung tanpa installer.

- API key dan profil browser disimpan di `%APPDATA%\Pencari Calon Klien`, bukan di folder instalasi.
- Installer belum ditandatangani, jadi Windows SmartScreen bisa menampilkan peringatan. Pilih **More info > Run anyway**.
- Memakai ikon bawaan Electron. Untuk ikon sendiri, isi `build.win.icon` di `desktop/package.json`.
- `desktop/app/` adalah salinan file aplikasi yang dibuat otomatis oleh `npm run pack` dan `npm run dist`, jadi jangan diedit.

## Isian pencarian

| Isian | Wajib | Keterangan |
|---|---|---|
| Jenis usaha | Ya | Boleh lebih dari satu, pisahkan dengan koma, mis. `kafe, kedai kopi, coffee shop` |
| Kota | Ya | Mis. `Yogyakarta` |
| Kecamatan atau daerah | Tidak | Boleh lebih dari satu, mis. `Depok, Seturan`. Kosong berarti seluruh kota |
| Maks. per pencarian | Tidak | Batas usaha untuk setiap kombinasi jenis x daerah (API maks. 60, tanpa API maks. 100) |
| Min. ulasan, min. rating | Tidak | Usaha di bawah batas dibuang. Usaha tanpa rating ikut terbuang bila min. rating diisi |

Setiap jenis usaha dicari di setiap daerah, maksimal 20 kombinasi sekali cari. Usaha yang muncul di beberapa pencarian
digabung jadi satu, dan kolom `sumber_kueri` mencatat pencarian pertama yang menemukannya. Di mode API, setiap
kombinasi memakai request sendiri, jadi biaya ikut naik. Di mode tanpa API, setiap kombinasi menambah waktu 2-3 menit.

## Tampilan hasil

- **Formulir:** isian utama di atas, opsi lanjutan (cara mencari, maks., min. ulasan, min. rating, hanya tanpa website)
  dalam bagian yang bisa dibuka-tutup. Di bawahnya tampil perkiraan jumlah pencarian dan waktu. Isian terakhir diingat
  di browser.
- **Progres:** progress bar dengan tahap pencarian, waktu berjalan, dan tombol **Batalkan** (mode tanpa API). Saat
  dibatalkan, pencarian berhenti di langkah berikutnya dan hasil sementara tidak disimpan.
- **Ringkasan:** jumlah usaha, per potensi, yang belum punya website sendiri, dan yang punya WhatsApp. Kartu potensi
  bisa diklik untuk memfilter.
- **Tabel:** klik judul kolom untuk mengurutkan (usaha, potensi, rating, ulasan). Filter: potensi, jenis website,
  kategori, min. skor, punya WhatsApp, dan pencarian nama atau alamat. Tombol **Kolom** memilih kolom yang tampil
  (disimpan di browser). Klik baris untuk membuka panel detail berisi rincian skor dan semua data.
- **WhatsApp:** tombol WhatsApp hanya muncul untuk nomor HP (08xx atau 628xx). Telepon rumah hanya bisa disalin.
- **Unduh:** Excel dan CSV mengikuti filter dan urutan yang sedang aktif. Excel dibatasi 500 baris.
- **Buka file hasil:** tombol di kanan atas memuat file `.xlsx` atau `.csv` yang pernah diunduh dari aplikasi ini,
  dengan tabel dan filter yang sama.
- Di layar HP (lebar di bawah 760 px) tabel berubah menjadi daftar kartu. Tema terang dan gelap mengikuti pengaturan
  perangkat.

File tampilan: `index.html`, `style.css`, `app.js`. Pembaca file hasil: `hasil.mjs`.

## Pakai (lewat terminal)

Butuh Node.js 18+ dan Chrome atau Edge.

```bash
npm install
node server.mjs      # lalu buka http://localhost:3737 (di Windows: klik dua kali start.bat)
```

Versi terminal:

```bash
node scrape.mjs "salon" "Yogyakarta" --tanpa-api
node scrape.mjs "salon" "Yogyakarta"            # mode Google API, butuh .env
```

```bash
node scrape.mjs "kafe, kedai kopi" "Yogyakarta" --daerah="Depok,Seturan" --min-ulasan=50 --min-rating=4
```

Opsi: `--tanpa-website` (hanya usaha tanpa website), `--maks=40` (jumlah usaha maksimum per pencarian),
`--daerah=`, `--min-ulasan=`, `--min-rating=`.

Untuk mode Google API, salin `.env.example` menjadi `.env` dan isi `GOOGLE_MAPS_API_KEY`.


