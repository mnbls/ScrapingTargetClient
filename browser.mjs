// Mode tanpa API: mengendalikan browser sungguhan (Chrome/Edge) yang membuka Google Maps.
// Jendela browser akan terlihat. Bila Google meminta verifikasi (CAPTCHA), selesaikan sendiri di jendela itu.

import { chromium } from "playwright-core";
import { join } from "node:path";
import { dataDir, buildQueries, placeKey, searchAll } from "./lib.mjs";

const PROFILE_DIR = join(dataDir, ".browser-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const opts = { headless: false, locale: "id-ID", viewport: { width: 1280, height: 860 } };
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel });
    } catch (err) {
      if (channel === "msedge") throw new Error(`Chrome/Edge tidak bisa dibuka: ${err.message}`);
    }
  }
}

async function passChallenges(page, onProgress) {
  if (page.url().includes("consent.google")) {
    const btn = page.getByRole("button", { name: /tolak semua|reject all/i }).first();
    await btn.click({ timeout: 5000 }).catch(() => {});
  }
  if (page.url().includes("/sorry/")) {
    onProgress?.("Google meminta verifikasi. Selesaikan di jendela browser (maks. 2 menit)...");
    await page.waitForURL((u) => !u.href.includes("/sorry/"), { timeout: 120_000 });
  }
}

async function collectLinks(page, maks, onProgress) {
  const feed = page.locator('div[role="feed"]');
  await feed.waitFor({ timeout: 20_000 }).catch(() => {});
  if (!(await feed.count())) {
    // Hasil tunggal: Maps langsung membuka halaman usaha.
    return page.url().includes("/maps/place/") ? [page.url()] : [];
  }
  let stalled = 0;
  let last = 0;
  while (stalled < 4) {
    const links = await page.$$eval("a.hfpxzc", (els) => els.map((a) => a.href));
    onProgress?.(`Mengumpulkan daftar usaha: ${links.length}`);
    if (links.length >= maks) break;
    stalled = links.length === last ? stalled + 1 : 0;
    last = links.length;
    const ended = await page.getByText(/telah mencapai akhir daftar|reached the end of the list/i).count();
    if (ended) break;
    await feed.evaluate((el) => el.scrollBy(0, el.scrollHeight));
    await sleep(1200);
  }
  const all = await page.$$eval("a.hfpxzc", (els) => els.map((a) => a.href));
  return [...new Set(all)].slice(0, maks);
}

// Ubah teks harga Maps ke label yang sama dengan mode API. Batas rupiah per orang ini perkiraan.
export function priceLabel(text) {
  if (!text) return "";
  if (/^\$+$/.test(text)) return ["murah", "sedang", "mahal", "sangat mahal"][text.length - 1];
  const nums = [...text.matchAll(/([\d.,]+)\s?(rb|ribu|jt)?/gi)].map(([, n, unit]) => {
    const value = Number(n.replace(/\./g, "").replace(",", "."));
    return /jt/i.test(unit ?? "") ? value * 1_000_000 : /rb|ribu/i.test(unit ?? "") ? value * 1000 : value;
  });
  // "Rp 25–50 rb": satuan hanya ditulis di angka terakhir.
  const unitAll = /jt/i.test(text) ? 1_000_000 : /rb|ribu/i.test(text) ? 1000 : 1;
  const top = Math.max(...nums.map((n) => (n < 1000 ? n * unitAll : n)));
  if (!top) return "";
  return top <= 50_000 ? "murah" : top <= 150_000 ? "sedang" : top <= 400_000 ? "mahal" : "sangat mahal";
}

async function readPlace(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 15_000 });
  await sleep(900);
  return page.evaluate(() => {
    const after = (s) => (s ?? "").replace(/^[^:]*:\s*/, "").trim();
    const attrOf = (sel) => document.querySelector(sel)?.getAttribute("aria-label");
    const ratingBox = document.querySelector("div.F7nice")?.innerText ?? "";
    const rating = ratingBox.match(/(\d[.,]\d)/)?.[1] ?? "";
    const reviews = ratingBox.match(/\(([\d.,\s]+)\)/)?.[1] ?? "";
    // Baris di bawah nama: "4,5 (40.780) Restoran Indonesia · Rp 25–50 rb". Harga tidak selalu ditampilkan.
    const headLine = document.querySelector("div.F7nice")?.parentElement?.parentElement?.innerText ?? "";
    const reservable = Boolean(
      document.querySelector('a[href*="/maps/reserve/"]') ||
        [...document.querySelectorAll("button[aria-label], a[aria-label]")].some((el) =>
          /reservasi|pesan tempat|reserve/i.test(el.getAttribute("aria-label")),
        ),
    );
    return {
      nama: document.querySelector("h1")?.innerText.trim() ?? "",
      kategori: document.querySelector('button[jsaction*="category"]')?.innerText.trim() ?? "",
      harga_teks: headLine.match(/Rp\s?[\d.,]+\s?(?:rb|ribu|jt)?\s?[–-]\s?[\d.,]+\s?(?:rb|ribu|jt)?|Rp\s?[\d.,]+\s?(?:rb|ribu|jt)?\+?|\${1,4}/i)?.[0] ?? "",
      reservasi: reservable ? "ya" : "tidak",
      telepon: after(attrOf('button[data-item-id^="phone"]')),
      website: document.querySelector('a[data-item-id="authority"]')?.href ?? "",
      alamat: after(attrOf('button[data-item-id="address"]')),
      rating: rating.replace(",", "."),
      jumlah_rating: Number(reviews.replace(/[^\d]/g, "")) || 0,
    };
  });
}

export async function searchBrowser({ maks = 40, onProgress, ...opts }) {
  buildQueries(opts.jenis, opts.kota, opts.daerah); // cek jumlah kombinasi sebelum membuka browser
  const context = await launch();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const read = new Set();
    let label = "";
    return await searchAll({
      ...opts,
      onProgress: (text) => {
        label = text;
        onProgress?.(text);
      },
      fetchQuery: async (jenis, tempat) => {
        // Usaha yang sudah dibaca di pencarian sebelumnya tidak dibuka lagi.
        const links = (await openSearch(page, `${jenis} ${tempat}`, maks, onProgress)).filter((l) => !read.has(placeKey(l)));
        links.forEach((l) => read.add(placeKey(l)));
        return readPlaces(page, links, onProgress, (i) => onProgress?.(`${label} - membaca detail usaha ${i}/${links.length}`));
      },
    });
  } finally {
    await context.close();
  }
}

async function openSearch(page, query, maks, onProgress) {
  // Tanpa kata "di": untuk sebagian kota Maps menafsirkannya sebagai pencarian rute.
  await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=id`, {
    waitUntil: "domcontentloaded",
  });
  await passChallenges(page, onProgress);
  return collectLinks(page, maks, onProgress);
}

async function readPlaces(page, links, onProgress, onEach) {
  const rows = [];
  for (const [i, link] of links.entries()) {
    onEach(i + 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { harga_teks, ...row } = await readPlace(page, link);
        await passChallenges(page, onProgress);
        if (row.nama) rows.push({ ...row, harga: priceLabel(harga_teks), link_maps: link });
        break;
      } catch (err) {
        // Coba sekali lagi, lalu lewati usaha itu dan lanjut ke berikutnya.
        if (attempt === 1) console.warn(`Lewati ${link}: ${err.message.split("\n")[0]}`);
      }
    }
  }
  return rows;
}
