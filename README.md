# ScrapingTargetClient

Pencari calon klien pembuatan website dari Google Maps. Isi jenis usaha dan kota, hasilnya berupa tabel
(nama usaha, telepon, website, alamat, rating, jumlah rating) yang bisa diunduh sebagai Excel (.xlsx) atau CSV.

Kolom hasil: nama, telepon, website, jenis_website (tidak ada / sosmed / website), alamat, rating, jumlah_rating, link_maps.
Usaha yang websitenya hanya Instagram, Facebook, linktr.ee, dan sejenisnya ditandai `sosmed` dan tetap dihitung sebagai calon klien.

Dua mode:

- **Tanpa API**: membuka Chrome/Edge lewat Playwright dan membaca Google Maps. Gratis, tapi lebih lambat dan
  bisa kena CAPTCHA. Scraping langsung melanggar ketentuan layanan Google, pakai dengan risiko sendiri.
- **Google API**: memakai Places API (New). Butuh API key dan billing aktif.

## Cara cepat (Windows, tanpa coding)

1. Pasang [Node.js](https://nodejs.org) versi LTS dan pastikan Chrome atau Edge ada di komputer.
2. Di halaman GitHub repo ini, klik **Code > Download ZIP**, lalu ekstrak.
3. Klik dua kali `start.bat`. Pertama kali akan memasang kebutuhan sendiri (1-2 menit), lalu browser terbuka di `http://localhost:3737`.
4. Isi jenis usaha dan kota, klik **Cari**. Jendela hitam jangan ditutup selama dipakai.

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

Opsi: `--tanpa-website` (hanya usaha tanpa website), `--maks=40` (jumlah usaha maksimum).

Untuk mode Google API, salin `.env.example` menjadi `.env` dan isi `GOOGLE_MAPS_API_KEY`.


