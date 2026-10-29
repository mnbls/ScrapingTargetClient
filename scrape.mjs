// Versi terminal. Pakai: node scrape.mjs "<jenis usaha>" "<kota>" [--tanpa-api] [--tanpa-website] [--maks=60]
// Untuk versi tampilan web, jalankan start.bat (atau: node server.mjs).

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { dir, loadApiKey, search, toCsv, slug } from "./lib.mjs";
import { searchBrowser } from "./browser.mjs";

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));

const tanpaApi = flags.includes("--tanpa-api");
const apiKey = loadApiKey();
if (!tanpaApi && !apiKey) {
  console.error("API key belum diisi. Buat file .env berisi: GOOGLE_MAPS_API_KEY=isi_key_kamu");
  process.exit(1);
}

const jenis = positional[0] ?? (await ask("Jenis usaha (mis. restoran, salon, bengkel): "));
const kota = positional[1] ?? (await ask("Kota (mis. Yogyakarta): "));
if (!jenis || !kota) {
  console.error("Jenis usaha dan kota wajib diisi.");
  process.exit(1);
}

try {
  const maks = Number(flags.find((f) => f.startsWith("--maks="))?.split("=")[1] ?? (tanpaApi ? 40 : 60));
  const tanpaWebsite = flags.includes("--tanpa-website");
  const rows = tanpaApi
    ? await searchBrowser({ jenis, kota, maks, tanpaWebsite, onProgress: console.log })
    : await search({
        apiKey,
        jenis,
        kota,
        maks,
        tanpaWebsite,
        onProgress: (n) => console.log(`  terkumpul ${n} usaha`),
      });
  const out = join(dir, `${slug(jenis)}-${slug(kota)}.csv`);
  writeFileSync(out, toCsv(rows), "utf8");
  console.log(`Selesai: ${rows.length} usaha (${rows.filter((r) => r.jenis_website !== "website").length} belum punya website sendiri) -> ${out}`);
} catch (err) {
  console.error("Gagal:", err.message);
  process.exit(1);
}
