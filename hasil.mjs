// Membaca kembali file hasil (.xlsx atau .csv) yang pernah diunduh dari aplikasi ini.

import ExcelJS from "exceljs";
import { InputError, websiteKind } from "./lib.mjs";

const MAX_ROWS = 5000;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Header Excel memakai label ("Nama Usaha"), header CSV memakai nama kolom ("nama").
const ALIAS = {
  nama: "nama", namausaha: "nama", potensi: "potensi", skor: "skor", skormaps: "skor_maps",
  jeniskelompok: "jenis_kelompok", kelompokjenis: "jenis_kelompok", faktorjenis: "faktor_jenis",
  telepon: "telepon", website: "website", jeniswebsite: "jenis_website", jualanonline: "jualan_online",
  kategori: "kategori", harga: "harga", reservasi: "reservasi", badanhukum: "badan_hukum",
  cabangdihasil: "cabang_di_hasil", alamat: "alamat", rating: "rating", jumlahrating: "jumlah_rating",
  alasan: "alasan", sumberkueri: "sumber_kueri", sumberpencarian: "sumber_kueri", linkmaps: "link_maps",
};
const NUMBERS = new Set(["skor", "skor_maps", "rating", "jumlah_rating", "cabang_di_hasil"]);
const LINKS = new Set(["website", "link_maps"]);
const KIND = {
  "belum ada": "tidak ada", "hanya sosmed": "sosmed", "punya website": "website",
  "tidak ada": "tidak ada", sosmed: "sosmed", website: "website",
};

function blankRow() {
  return {
    nama: "", potensi: "", skor: 0, skor_maps: 0, jenis_kelompok: "", faktor_jenis: "", telepon: "", website: "",
    jenis_website: "", jualan_online: "", kategori: "", harga: "", reservasi: "", badan_hukum: "",
    cabang_di_hasil: 1, alamat: "", rating: "", jumlah_rating: 0, alasan: "", sumber_kueri: "", link_maps: "",
  };
}

// Sel Excel bisa berisi hyperlink, teks berformat, atau hasil rumus.
function cellText(v, preferLink) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (preferLink && v.hyperlink) return v.hyperlink;
  if (v.richText) return v.richText.map((p) => p.text).join("");
  if (v.text != null) return String(v.text);
  if (v.result != null) return String(v.result);
  return "";
}

export function parseCsv(text) {
  const table = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    table.push(row);
  }
  return table;
}

function toRows(table) {
  const keys = (table[0] ?? []).map((h) => ALIAS[norm(cellText(h))]);
  if (!keys.includes("nama")) {
    throw new InputError("Kolom nama usaha tidak ditemukan. Pakai file yang diunduh dari aplikasi ini.");
  }
  if (table.length - 1 > MAX_ROWS) throw new InputError(`File terlalu besar (maks. ${MAX_ROWS} baris).`);
  const rows = [];
  for (const cells of table.slice(1)) {
    const row = blankRow();
    keys.forEach((key, i) => {
      if (!key) return;
      const text = cellText(cells[i], LINKS.has(key)).trim();
      if (!NUMBERS.has(key)) {
        row[key] = text;
        return;
      }
      const n = Number(text.replace(",", "."));
      if (text !== "" && Number.isFinite(n)) row[key] = n;
    });
    if (!row.nama) continue;
    row.jenis_website = KIND[row.jenis_website.toLowerCase()] ?? websiteKind(row.website);
    rows.push(row);
  }
  return rows;
}

export async function parseResultFile(buffer, fileName) {
  const ext = String(fileName).toLowerCase().match(/\.(xlsx|csv)$/)?.[1];
  if (ext === "csv") return toRows(parseCsv(buffer.toString("utf8").replace(/^﻿/, "")));
  if (ext !== "xlsx") throw new InputError("Format file harus .xlsx atau .csv.");

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new InputError("File Excel tidak bisa dibaca. Pastikan file tidak rusak.");
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw new InputError("File Excel kosong.");
  const table = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    table.push(Array.from({ length: ws.columnCount }, (_, i) => r.getCell(i + 1).value));
  });
  return toRows(table);
}
