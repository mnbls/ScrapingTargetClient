// Server lokal untuk tampilan web. Hanya bisa diakses dari komputer ini (127.0.0.1).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dir, loadApiKey, saveApiKey, search, parseList, buildQueries, InputError } from "./lib.mjs";
import { searchBrowser } from "./browser.mjs";
import { buildXlsx } from "./xlsx.mjs";
import { parseResultFile } from "./hasil.mjs";

const PORT = Number(process.env.PORT ?? 3737);

// Hanya file ini yang disajikan sebagai halaman.
const PAGES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

// Dilempar dari onProgress untuk menghentikan pencarian tanpa mengubah logika pencariannya.
class CancelError extends Error {}

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

function readBody(req, limit = 10_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new InputError("File terlalu besar (maks. 10 MB)."));
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Input bersama untuk kedua mode. Daerah, minimal ulasan, dan minimal rating boleh kosong.
function searchInput(body) {
  const { jenis, kota, daerah, minUlasan, minRating, tanpaWebsite } = body;
  if (!parseList(jenis).length || !kota?.trim()) throw new InputError("Jenis usaha dan kota wajib diisi.");
  return {
    jenis,
    kota: kota.trim(),
    daerah: daerah ?? "",
    minUlasan: Math.max(0, Number(minUlasan) || 0),
    minRating: Math.max(0, Number(minRating) || 0),
    tanpaWebsite: Boolean(tanpaWebsite),
  };
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const page = req.method === "GET" && PAGES[req.url.split("?")[0]];
    if (page) return send(res, 200, readFileSync(join(dir, page[0]), "utf8"), page[1]);
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
      const body = await readJson(req);
      const input = searchInput(body);
      buildQueries(input.jenis, input.kota, input.daerah);
      const rows = await search({ apiKey, ...input, maks: Math.min(Number(body.maks) || 60, 60) });
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
      const body = await readJson(req);
      const input = searchInput(body);
      buildQueries(input.jenis, input.kota, input.daerah);
      const id = String(Date.now());
      const job = { status: "running", progress: "Memulai...", rows: [], error: "" };
      jobs.set(id, job);
      activeJob = id;
      searchBrowser({
        ...input,
        maks: Math.min(Number(body.maks) || 40, 100),
        onProgress: (text) => {
          if (job.cancelled) throw new CancelError();
          job.progress = text;
        },
      })
        .then((rows) => Object.assign(job, { status: "done", rows }))
        .catch((err) =>
          Object.assign(job, err instanceof CancelError ? { status: "cancelled" } : { status: "error", error: err.message }),
        )
        .finally(() => (activeJob = null));
      return send(res, 200, { id });
    }
    if (req.method === "POST" && req.url.startsWith("/api/job-cancel?id=")) {
      const job = jobs.get(req.url.split("=")[1]);
      if (!job) return send(res, 404, { error: "Job tidak ditemukan" });
      if (job.status === "running") job.cancelled = true;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/open-file") {
      const name = decodeURIComponent(req.headers["x-file-name"] ?? "");
      return send(res, 200, { rows: await parseResultFile(await readBody(req), name) });
    }
    if (req.method === "GET" && req.url.startsWith("/api/job?id=")) {
      const job = jobs.get(req.url.split("=")[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: "Job tidak ditemukan" });
    }
    send(res, 404, { error: "Tidak ditemukan" });
  } catch (err) {
    send(res, err instanceof InputError ? 400 : 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Berjalan di http://localhost:${PORT}  (tutup jendela ini untuk berhenti)`);
});
