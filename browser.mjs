// Mode tanpa API: mengendalikan browser sungguhan (Chrome/Edge) yang membuka Google Maps.
// Jendela browser akan terlihat. Bila Google meminta verifikasi (CAPTCHA), selesaikan sendiri di jendela itu.

import { chromium } from "playwright-core";
import { join } from "node:path";
import { dir, finalizeRows } from "./lib.mjs";

const PROFILE_DIR = join(dir, ".browser-profile");
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
    return {
      nama: document.querySelector("h1")?.innerText.trim() ?? "",
      telepon: after(attrOf('button[data-item-id^="phone"]')),
      website: document.querySelector('a[data-item-id="authority"]')?.href ?? "",
      alamat: after(attrOf('button[data-item-id="address"]')),
      rating: rating.replace(",", "."),
      jumlah_rating: Number(reviews.replace(/[^\d]/g, "")) || 0,
    };
  });
}

export async function searchBrowser({ jenis, kota, maks = 40, tanpaWebsite = false, onProgress }) {
  const context = await launch();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const query = `${jenis} di ${kota}`;
    onProgress?.("Membuka Google Maps...");
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=id`, {
      waitUntil: "domcontentloaded",
    });
    await passChallenges(page, onProgress);

    const links = await collectLinks(page, maks, onProgress);
    const rows = [];
    for (const [i, link] of links.entries()) {
      onProgress?.(`Membaca detail usaha ${i + 1}/${links.length}`);
      try {
        const row = await readPlace(page, link);
        await passChallenges(page, onProgress);
        if (row.nama) rows.push({ ...row, link_maps: link });
      } catch {
        // Lewati usaha yang gagal dibaca, lanjut ke berikutnya.
      }
    }
    return finalizeRows(rows, tanpaWebsite);
  } finally {
    await context.close();
  }
}
