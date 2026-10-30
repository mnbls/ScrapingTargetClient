// Versi terminal. Pakai: node scrape.mjs "<jenis usaha, pisah koma>" "<kota>" [--daerah="Depok,Seturan"]
//   [--min-ulasan=50] [--min-rating=4] [--tanpa-api] [--tanpa-website] [--maks=60]
// Untuk versi tampilan web, jalankan start.bat (atau: node server.mjs).

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { dir, loadApiKey, search, toCsv, slug } from "./lib.mjs";
import { searchBrowser } from "./browser.mjs";
import { buildXlsx } from "./xlsx.mjs";

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

const jenis = positional[0] ?? (await ask("Jenis usaha, pisahkan dengan koma (mis. kafe, kedai kopi): "));
const kota = positional[1] ?? (await ask("Kota (mis. Yogyakarta): "));
if (!jenis || !kota) {
  console.error("Jenis usaha dan kota wajib diisi.");
  process.exit(1);
}

const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);

try {
  const opts = {
    jenis,
    kota,
    daerah: flag("daerah") ?? "",
    minUlasan: Number(flag("min-ulasan")) || 0,
    minRating: Number(flag("min-rating")) || 0,
    maks: Number(flag("maks") ?? (tanpaApi ? 40 : 60)),
    tanpaWebsite: flags.includes("--tanpa-website"),
    onProgress: console.log,
  };
  const rows = tanpaApi ? await searchBrowser(opts) : await search({ apiKey, ...opts });
  const out = join(dir, `${slug(jenis)}-${slug(kota)}.csv`);
  writeFileSync(out, toCsv(rows), "utf8");
  writeFileSync(out.replace(/\.csv$/, ".xlsx"), await buildXlsx(rows));
  console.log(`Selesai: ${rows.length} usaha (${rows.filter((r) => r.jenis_website !== "website").length} belum punya website sendiri) -> ${out}`);
} catch (err) {
  console.error("Gagal:", err.message);
  process.exit(1);
}
