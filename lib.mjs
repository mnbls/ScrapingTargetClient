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
  "nextPageToken",
].join(",");

export const CSV_HEADER = ["nama", "telepon", "website", "jenis_website", "alamat", "rating", "jumlah_rating", "link_maps"];

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

export async function search({ apiKey, jenis, kota, maks = 60, tanpaWebsite = false, onProgress }) {
  const query = `${jenis} di ${kota}`;
  const seen = new Map();
  let pageToken;
  do {
    const data = await searchPage(apiKey, query, pageToken);
    for (const p of data.places ?? []) {
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      seen.set(p.googleMapsUri, p);
    }
    pageToken = data.nextPageToken;
    onProgress?.(seen.size);
  } while (pageToken && seen.size < maks);

  let rows = [...seen.values()].map((p) => ({
    nama: p.displayName?.text ?? "",
    telepon: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    alamat: p.formattedAddress ?? "",
    rating: p.rating ?? "",
    jumlah_rating: p.userRatingCount ?? 0,
    link_maps: p.googleMapsUri ?? "",
  }));
  return finalizeRows(rows, tanpaWebsite);
}

// Link ini bukan website milik usaha sendiri, jadi usahanya tetap calon klien.
const NON_WEBSITE_HOSTS =
  /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|linktr\.ee|linktree\.com|beacons\.ai|lynk\.id|bio\.link|wa\.me|whatsapp\.com|shopee\.co\.id|tokopedia\.com|gofood\.co\.id|grab\.com|maps\.app\.goo\.gl|goo\.gl|bit\.ly)$/i;

export function websiteKind(url) {
  if (!url) return "tidak ada";
  try {
    return NON_WEBSITE_HOSTS.test(new URL(url).hostname) ? "sosmed" : "website";
  } catch {
    return "website";
  }
}

export function finalizeRows(rows, tanpaWebsite) {
  const withKind = rows.map((r) => ({ ...r, jenis_website: websiteKind(r.website) }));
  const kept = tanpaWebsite ? withKind.filter((r) => r.jenis_website !== "website") : withKind;
  return kept.sort((a, b) => b.jumlah_rating - a.jumlah_rating);
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
