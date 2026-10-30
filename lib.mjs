// Inti pencarian Google Places API, dipakai oleh server.mjs (tampilan web) dan scrape.mjs (CLI).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const dir = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(dir, ".env");
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "places.priceLevel",
  // Termasuk SKU harga yang lebih mahal (Atmosphere). Hapus baris ini bila ingin menekan biaya.
  "places.reservable",
  "nextPageToken",
].join(",");

export const CSV_HEADER = [
  "nama", "potensi", "skor", "skor_maps", "jenis_kelompok", "faktor_jenis", "telepon", "website", "jenis_website", "jualan_online", "kategori", "harga", "reservasi",
  "badan_hukum", "cabang_di_hasil", "alamat", "rating", "jumlah_rating", "alasan", "sumber_kueri", "link_maps",
];

const PRICE_LABEL = {
  PRICE_LEVEL_FREE: "gratis",
  PRICE_LEVEL_INEXPENSIVE: "murah",
  PRICE_LEVEL_MODERATE: "sedang",
  PRICE_LEVEL_EXPENSIVE: "mahal",
  PRICE_LEVEL_VERY_EXPENSIVE: "sangat mahal",
};

export function loadApiKey() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*GOOGLE_MAPS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

export function saveApiKey(key) {
  writeFileSync(ENV_FILE, `GOOGLE_MAPS_API_KEY=${key.trim()}\n`, "utf8");
}

async function searchPage(apiKey, textQuery, pageToken) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "id",
      regionCode: "ID",
      pageSize: 20,
      ...(pageToken && { pageToken }),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Google API error ${res.status}`);
  return data;
}

export async function search({ apiKey, maks = 60, ...opts }) {
  return searchAll({
    ...opts,
    fetchQuery: async (jenis, tempat) => {
      const seen = new Map();
      let pageToken;
      do {
        const data = await searchPage(apiKey, `${jenis} di ${tempat}`, pageToken);
        for (const p of data.places ?? []) {
          if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
          seen.set(p.googleMapsUri, p);
        }
        pageToken = data.nextPageToken;
      } while (pageToken && seen.size < maks);
      return [...seen.values()].map(fromPlace);
    },
  });
}

// "kafe, kedai kopi" -> ["kafe", "kedai kopi"]
export function parseList(text) {
  return String(text ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const MAX_QUERIES = 20;

// Kesalahan isian pengguna, ditampilkan apa adanya (HTTP 400).
export class InputError extends Error {}

// Daftar pencarian: setiap jenis usaha x setiap daerah. Daerah boleh kosong, berarti cari di seluruh kota.
export function buildQueries(jenis, kota, daerah) {
  const tempat = parseList(daerah).map((d) => `${d} ${kota}`);
  if (!tempat.length) tempat.push(kota);
  const queries = parseList(jenis).flatMap((j) => tempat.map((t) => ({ jenis: j, tempat: t })));
  if (queries.length > MAX_QUERIES) {
    throw new InputError(`Terlalu banyak kombinasi (${queries.length}). Maksimal ${MAX_QUERIES} jenis usaha x daerah sekali cari.`);
  }
  return queries;
}

// Kunci unik usaha supaya hasil dari beberapa pencarian bisa digabung.
export function placeKey(link) {
  const id = String(link ?? "").match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  return id ?? String(link ?? "").split("?")[0];
}

// Menjalankan semua pencarian, menggabungkan usaha yang sama, lalu menyaring dan memberi skor.
// fetchQuery(jenis, tempat) mengembalikan baris mentah; usaha yang sudah ada di baris lain boleh ikut, nanti dibuang.
export async function searchAll({
  jenis, kota, daerah = "", minUlasan = 0, minRating = 0, tanpaWebsite = false, fetchQuery, onProgress,
}) {
  const queries = buildQueries(jenis, kota, daerah);
  const seen = new Map();
  for (const [i, q] of queries.entries()) {
    onProgress?.(`Pencarian ${i + 1}/${queries.length}: ${q.jenis} di ${q.tempat}`);
    for (const r of await fetchQuery(q.jenis, q.tempat)) {
      const key = placeKey(r.link_maps);
      if (!seen.has(key)) seen.set(key, { ...r, sumber_kueri: `${q.jenis} di ${q.tempat}`, jenis_cari: q.jenis });
    }
  }
  const rows = [...seen.values()].filter(
    (r) => (Number(r.jumlah_rating) || 0) >= minUlasan && (Number(r.rating) || 0) >= minRating,
  );
  return finalizeRows(rows, tanpaWebsite);
}

export function fromPlace(p) {
  return {
    nama: p.displayName?.text ?? "",
    telepon: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    kategori: p.primaryTypeDisplayName?.text ?? "",
    harga: PRICE_LABEL[p.priceLevel] ?? "",
    reservasi: p.reservable === true ? "ya" : p.reservable === false ? "tidak" : "",
    alamat: p.formattedAddress ?? "",
    rating: p.rating ?? "",
    jumlah_rating: p.userRatingCount ?? 0,
    link_maps: p.googleMapsUri ?? "",
  };
}

// Link ini bukan website milik usaha sendiri, jadi usahanya tetap calon klien.
const NON_WEBSITE_HOSTS =
  /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|linktr\.ee|linktree\.com|beacons\.ai|lynk\.id|bio\.link|wa\.me|whatsapp\.com|shopee\.co\.id|tokopedia\.com|tokopedia\.link|lazada\.co\.id|blibli\.com|bukalapak\.com|gofood\.co\.id|gojek\.com|grab\.com|maps\.app\.goo\.gl|goo\.gl|bit\.ly)$/i;

const MARKETPLACE_HOSTS = [
  [/(^|\.)shopee\.co\.id$/i, "Shopee"],
  [/(^|\.)tokopedia\.(com|link)$/i, "Tokopedia"],
  [/(^|\.)lazada\.co\.id$/i, "Lazada"],
  [/(^|\.)blibli\.com$/i, "Blibli"],
  [/(^|\.)bukalapak\.com$/i, "Bukalapak"],
  [/(^|\.)(gofood\.co\.id|gojek\.com)$/i, "GoFood"],
  [/(^|\.)grab\.com$/i, "GrabFood"],
];

// Hanya terdeteksi bila link website di Maps mengarah ke marketplace.
export function marketplaceOf(url) {
  if (!url) return "";
  try {
    const host = new URL(url).hostname;
    return MARKETPLACE_HOSTS.find(([re]) => re.test(host))?.[1] ?? "";
  } catch {
    return "";
  }
}

// Hanya dari nama usaha, jadi banyak PT/CV yang tidak tertulis di Maps tidak terdeteksi.
export function legalForm(nama) {
  return String(nama ?? "").match(/\b(PT|CV)\b/)?.[1] ?? "";
}

// Nama brand tanpa keterangan cabang, mis. "Kopi Kenangan - Jl. Kaliurang" -> "kopi kenangan".
export function brandKey(nama) {
  const key = String(nama ?? "")
    .split(/\s[-–|•]\s|[,(]/)[0]
    .toLowerCase()
    .replace(/\b(pt|cv|cabang)\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key.length >= 3 ? key : "";
}

export function websiteKind(url) {
  if (!url) return "tidak ada";
  try {
    return NON_WEBSITE_HOSTS.test(new URL(url).hostname) ? "sosmed" : "website";
  } catch {
    return "website";
  }
}

// Skor 0-100 seberapa besar peluang usaha menerima penawaran website, dari sinyal publik di Google Maps:
//   kebutuhan (belum punya website) + bisa dihubungi + usaha aktif (ulasan) + reputasi (rating).
// Ini perkiraan untuk menentukan urutan prospek, bukan jaminan.
export function scoreLead(r) {
  const alasan = [];
  let skor = 0;

  if (r.jenis_website === "tidak ada") {
    skor += 45;
    alasan.push("belum punya website");
  } else if (r.jenis_website === "sosmed") {
    skor += 35;
    alasan.push("website hanya sosmed");
  } else {
    alasan.push("sudah punya website");
  }

  const digits = String(r.telepon ?? "").replace(/\D/g, "");
  if (digits) {
    skor += 15;
    if (digits.startsWith("08") || digits.startsWith("628")) {
      skor += 5;
      alasan.push("ada nomor HP/WhatsApp");
    } else {
      alasan.push("ada nomor telepon");
    }
  } else {
    alasan.push("tidak ada nomor kontak");
  }

  const ulasan = Number(r.jumlah_rating) || 0;
  skor += Math.min(20, Math.round(Math.log10(ulasan + 1) * 7));
  if (ulasan > 0) alasan.push(`${ulasan.toLocaleString("id-ID")} ulasan`);

  // Rating dari sedikit ulasan kurang bisa dipercaya, jadi bobotnya naik bertahap sampai 20 ulasan.
  const rating = Number(r.rating) || 0;
  const bonusRating = rating >= 4.5 ? 15 : rating >= 4.0 ? 10 : rating >= 3.5 ? 5 : 0;
  skor += Math.round(bonusRating * Math.min(1, ulasan / 20));
  if (rating) alasan.push(`rating ${rating}`);

  // Sinyal tambahan bila datanya ada: usaha lebih besar, mampu bayar, atau butuh sistem. Masing-masing 5 poin.
  const tambahan = [];
  if (r.cabang_di_hasil >= 2) tambahan.push(`${r.cabang_di_hasil} cabang di hasil`);
  if (r.badan_hukum) tambahan.push(`badan usaha ${r.badan_hukum}`);
  if (r.harga === "mahal" || r.harga === "sangat mahal") tambahan.push(`harga ${r.harga}`);
  if (r.reservasi === "ya") tambahan.push("menerima reservasi");
  if (r.jualan_online) tambahan.push(`jualan di ${r.jualan_online}`);
  skor = Math.min(100, skor + tambahan.length * 5);
  alasan.push(...tambahan);

  // Tanpa kontak sulit didekati; yang sudah punya website kebutuhannya kecil.
  if (!digits) skor = Math.min(skor, 60);
  if (r.jenis_website === "website") skor = Math.min(skor, 40);

  return { skor, potensi: potensiOf(skor), alasan: alasan.join("; ") };
}

const potensiOf = (skor) => (skor >= 70 ? "Tinggi" : skor >= 45 ? "Sedang" : "Rendah");

// Seberapa umum jenis usaha ini memakai website. Ini penilaian umum, bukan hasil data, jadi silakan disesuaikan.
// Dicek berurutan: kelompok pertama yang cocok yang dipakai.
const BUSINESS_GROUPS = [
  {
    kelompok: "tinggi",
    faktor: 1,
    pola: /\b(hotel|villa|vila|homestay|penginapan|resort|guest ?house|klinik|dokter|gigi|dental|kecantikan|estetika?|skincare|rumah sakit|sekolah|kursus|bimbel|bimbingan belajar|les|pelatihan|universitas|kampus|wedding|pernikahan|katering|catering|event|fotografer|fotografi|studio foto|travel|tour|rental|sewa|properti|real estate|perumahan|developer|kontraktor|konstruksi|arsitek|interior|dealer|showroom|notaris|konsultan|pengacara|advokat|akuntan|ekspedisi|logistik)\b/i,
  },
  {
    kelompok: "rendah",
    faktor: 0.5,
    pola: /\b(warung|kelontong|sembako|fotokopi|fotocopy|tambal ban|laundry|binatu|angkringan|kaki lima|pedagang)\b/i,
  },
  {
    kelompok: "sedang",
    faktor: 0.8,
    pola: /\b(restoran|rumah makan|kafe|cafe|kedai|kopi|bakery|roti|kue|salon|barber|barbershop|pangkas|spa|pijat|gym|fitness|butik|toko|bengkel|percetakan|apotek)\b/i,
  },
];
const UNKNOWN_GROUP = { kelompok: "tidak dikenali", faktor: 0.8 };

export function businessGroup(text) {
  return BUSINESS_GROUPS.find((g) => g.pola.test(text ?? "")) ?? UNKNOWN_GROUP;
}

// Skor akhir = skor dari data Maps x faktor jenis usaha. Jenis diambil dari kategori Maps, atau kata pencarian bila kosong.
export function finalizeRows(rows, tanpaWebsite, jenis = "") {
  // Cabang hanya dihitung dari hasil pencarian ini, bukan seluruh Google Maps.
  const brands = new Map();
  for (const r of rows) {
    const key = brandKey(r.nama);
    if (key) brands.set(key, (brands.get(key) ?? 0) + 1);
  }
  const scored = rows.map((r) => {
    const withKind = {
      kategori: "",
      harga: "",
      reservasi: "",
      ...r,
      jenis_website: websiteKind(r.website),
      jualan_online: marketplaceOf(r.website),
      badan_hukum: legalForm(r.nama),
      cabang_di_hasil: brands.get(brandKey(r.nama)) ?? 1,
    };
    const dariMaps = scoreLead(withKind);
    const group = businessGroup(withKind.kategori || withKind.jenis_cari || jenis);
    const skor = Math.round(dariMaps.skor * group.faktor);
    return {
      ...withKind,
      skor,
      potensi: potensiOf(skor),
      skor_maps: dariMaps.skor,
      jenis_kelompok: group.kelompok,
      faktor_jenis: `${Math.round(group.faktor * 100)}%`,
      alasan: `${dariMaps.alasan}; jenis usaha ${group.kelompok}: x${Math.round(group.faktor * 100)}%`,
    };
  });
  const kept = tanpaWebsite ? scored.filter((r) => r.jenis_website !== "website") : scored;
  return kept.sort((a, b) => b.skor - a.skor || b.jumlah_rating - a.jumlah_rating);
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const lines = [CSV_HEADER, ...rows.map((r) => CSV_HEADER.map((h) => r[h]))];
  // BOM supaya Excel membaca UTF-8 dengan benar.
  return "﻿" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
