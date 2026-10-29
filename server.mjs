// Server lokal untuk tampilan web. Hanya bisa diakses dari komputer ini (127.0.0.1).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dir, loadApiKey, saveApiKey, search } from "./lib.mjs";
import { searchBrowser } from "./browser.mjs";
import { buildXlsx } from "./xlsx.mjs";

const PORT = Number(process.env.PORT ?? 3737);

// Mode tanpa API berjalan lama, jadi dijalankan sebagai job dan dipantau lewat polling.
// Hanya satu job sekaligus karena memakai satu profil browser.
const jobs = new Map();
let activeJob = null;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error("Permintaan terlalu besar"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON tidak valid"));
      }
    });
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return send(res, 200, readFileSync(join(dir, "index.html"), "utf8"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && req.url === "/api/status") {
      return send(res, 200, { hasKey: Boolean(loadApiKey()) });
    }
    if (req.method === "POST" && req.url === "/api/key") {
      const { key } = await readJson(req);
      if (typeof key !== "string" || key.trim().length < 20) {
        return send(res, 400, { error: "API key tidak valid." });
      }
      saveApiKey(key);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/search") {
      const apiKey = loadApiKey();
      if (!apiKey) return send(res, 400, { error: "API key belum diisi." });
      const { jenis, kota, maks, tanpaWebsite } = await readJson(req);
      if (!jenis?.trim() || !kota?.trim()) {
        return send(res, 400, { error: "Jenis usaha dan kota wajib diisi." });
      }
      const rows = await search({
        apiKey,
        jenis: jenis.trim(),
        kota: kota.trim(),
        maks: Math.min(Number(maks) || 60, 60),
        tanpaWebsite: Boolean(tanpaWebsite),
      });
      return send(res, 200, { rows });
    }
    if (req.method === "POST" && req.url === "/api/xlsx") {
      const { rows } = await readJson(req);
      if (!Array.isArray(rows) || rows.length === 0) {
        return send(res, 400, { error: "Tidak ada data untuk diunduh." });
      }
      const buffer = await buildXlsx(rows.slice(0, 500));
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": buffer.length,
      });
      return res.end(buffer);
    }
    if (req.method === "POST" && req.url === "/api/search-browser") {
      if (activeJob) return send(res, 409, { error: "Masih ada pencarian yang berjalan." });
      const { jenis, kota, maks, tanpaWebsite } = await readJson(req);
      if (!jenis?.trim() || !kota?.trim()) {
        return send(res, 400, { error: "Jenis usaha dan kota wajib diisi." });
      }
      const id = String(Date.now());
      const job = { status: "running", progress: "Memulai...", rows: [], error: "" };
      jobs.set(id, job);
      activeJob = id;
      searchBrowser({
        jenis: jenis.trim(),
        kota: kota.trim(),
        maks: Math.min(Number(maks) || 40, 100),
        tanpaWebsite: Boolean(tanpaWebsite),
        onProgress: (text) => (job.progress = text),
      })
        .then((rows) => Object.assign(job, { status: "done", rows }))
        .catch((err) => Object.assign(job, { status: "error", error: err.message }))
        .finally(() => (activeJob = null));
      return send(res, 200, { id });
    }
    if (req.method === "GET" && req.url.startsWith("/api/job?id=")) {
      const job = jobs.get(req.url.split("=")[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: "Job tidak ditemukan" });
    }
    send(res, 404, { error: "Tidak ditemukan" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Berjalan di http://localhost:${PORT}  (tutup jendela ini untuk berhenti)`);
});
