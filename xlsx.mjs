// Membuat file Excel (.xlsx) dari hasil pencarian.

import ExcelJS from "exceljs";

const COLUMNS = [
  { header: "Nama Usaha", key: "nama", width: 38 },
  { header: "Potensi", key: "potensi", width: 10 },
  { header: "Skor", key: "skor", width: 7 },
  { header: "Telepon", key: "telepon", width: 18 },
  { header: "Website", key: "website", width: 34 },
  { header: "Jenis Website", key: "jenis_website", width: 15 },
  { header: "Alamat", key: "alamat", width: 56 },
  { header: "Rating", key: "rating", width: 9 },
  { header: "Jumlah Rating", key: "jumlah_rating", width: 14 },
  { header: "Alasan", key: "alasan", width: 52 },
  { header: "Link Maps", key: "link_maps", width: 16 },
];

const POTENSI_FILL = { Tinggi: "FFC6EFCE", Sedang: "FFFFEB9C", Rendah: "FFE7E6E6" };

const LABEL = { "tidak ada": "Belum ada", sosmed: "Hanya sosmed", website: "Punya website" };

export async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Calon Klien", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS;

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  head.alignment = { vertical: "middle" };
  head.height = 22;

  for (const r of rows) {
    const row = ws.addRow({
      nama: r.nama,
      potensi: r.potensi ?? "",
      skor: Number(r.skor) || 0,
      alasan: r.alasan ?? "",
      telepon: String(r.telepon ?? ""),
      website: r.website ? { text: r.website, hyperlink: r.website } : "",
      jenis_website: LABEL[r.jenis_website] ?? "",
      alamat: r.alamat,
      rating: r.rating === "" || r.rating == null ? null : Number(r.rating),
      jumlah_rating: Number(r.jumlah_rating) || 0,
      link_maps: r.link_maps ? { text: "Buka di Maps", hyperlink: r.link_maps } : "",
    });
    for (const key of ["website", "link_maps"]) {
      if (row.getCell(key).value) row.getCell(key).font = { color: { argb: "FF0563C1" }, underline: true };
    }
    if (POTENSI_FILL[r.potensi]) {
      row.getCell("potensi").fill = { type: "pattern", pattern: "solid", fgColor: { argb: POTENSI_FILL[r.potensi] } };
      row.getCell("potensi").font = { bold: true };
    }
    if (r.jenis_website !== "website") {
      row.getCell("jenis_website").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    }
    row.alignment = { vertical: "top", wrapText: true };
  }

  ws.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
