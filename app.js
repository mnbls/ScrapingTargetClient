"use strict";

const $ = (id) => document.getElementById(id);
const MAX_QUERIES = 20;
const NS = "http://www.w3.org/2000/svg";
const num = new Intl.NumberFormat("id-ID");

// Satu-satunya tempat membaca dan menulis localStorage. Bisa saja diblokir, jadi selalu dibungkus try.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("pck." + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("pck." + key, JSON.stringify(value));
    } catch {}
  },
};

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
}

function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

// ---------- Data dan keadaan ----------

const COLUMNS = [
  { id: "nama", label: "Usaha", fixed: true },
  { id: "potensi", label: "Potensi", fixed: true },
  { id: "kontak", label: "Kontak", on: true },
  { id: "website", label: "Website", on: true },
  { id: "rating", label: "Rating dan ulasan", on: true },
  { id: "alamat", label: "Alamat" },
  { id: "kategori", label: "Kategori" },
  { id: "harga", label: "Harga" },
  { id: "reservasi", label: "Reservasi" },
  { id: "badan_hukum", label: "PT/CV" },
  { id: "cabang", label: "Cabang di hasil" },
  { id: "marketplace", label: "Marketplace" },
  { id: "skor_maps", label: "Skor Maps" },
  { id: "faktor", label: "Faktor jenis usaha" },
  { id: "sumber", label: "Sumber pencarian" },
  { id: "aksi", label: "Aksi", fixed: true },
];

const CSV_HEAD = [
  "nama", "potensi", "skor", "skor_maps", "jenis_kelompok", "faktor_jenis", "telepon", "website", "jenis_website",
  "jualan_online", "kategori", "harga", "reservasi", "badan_hukum", "cabang_di_hasil", "alamat", "rating",
  "jumlah_rating", "alasan", "sumber_kueri", "link_maps",
];

const DEFAULT_SORT = { key: "skor", dir: "desc" };
const emptyFilters = () => ({ q: "", potensi: "", web: "", kategori: "", wa: false, minSkor: "" });

const state = {
  rows: [],
  shown: [],
  name: "hasil",
  source: "",
  sort: { ...DEFAULT_SORT },
  filters: emptyFilters(),
  visible: new Set(store.get("kolom", COLUMNS.filter((c) => c.on || c.fixed).map((c) => c.id))),
  hasKey: false,
  busy: false,
  job: null,
};

// ---------- Pembantu ----------

function waNumber(text) {
  let d = String(text ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return /^628\d{7,12}$/.test(d) ? d : "";
}
const isMobile = (text) => Boolean(waNumber(text));

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

function msg(text, isErr = false) {
  const m = $("msg");
  m.textContent = text;
  m.className = "msg" + (isErr ? " err" : "");
  m.setAttribute("role", isErr ? "alert" : "status");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el("textarea", { "aria-hidden": "true" });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  toast("Nomor disalin");
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listOf = (t) => String(t).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
const mode = () => document.querySelector('input[name="mode"]:checked').value;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- Formulir ----------

const FORM_FIELDS = ["jenis", "kota", "daerah", "maks", "minUlasan", "minRating"];

function saveForm() {
  const f = Object.fromEntries(FORM_FIELDS.map((id) => [id, $(id).value]));
  store.set("form", { ...f, mode: mode(), tanpa: $("tanpa").checked, adv: $("adv").open });
}

function restoreForm() {
  const f = store.get("form", null);
  if (!f) return;
  for (const id of FORM_FIELDS) if (typeof f[id] === "string") $(id).value = f[id];
  const radio = document.querySelector(`input[name="mode"][value="${f.mode}"]`);
  if (radio) radio.checked = true;
  $("tanpa").checked = Boolean(f.tanpa);
  $("adv").open = Boolean(f.adv);
}

const queryCount = () => listOf($("jenis").value).length * Math.max(1, listOf($("daerah").value).length);
const minutes = (sec) => Math.max(1, Math.round(sec / 60));

function syncForm() {
  const useApi = mode() === "api";
  $("keyCard").classList.toggle("hidden", !useApi || state.hasKey);
  $("modeNote").classList.toggle("hidden", useApi);
  $("maks").max = useApi ? 60 : 100;
  if (useApi && Number($("maks").value) > 60) $("maks").value = 60;

  const n = queryCount();
  const est = $("estimate");
  est.classList.toggle("warn", n > MAX_QUERIES);
  if (!n) {
    est.textContent = "Isi jenis usaha untuk melihat perkiraan.";
  } else if (n > MAX_QUERIES) {
    est.textContent = `${n} pencarian terlalu banyak. Maksimal ${MAX_QUERIES} kombinasi jenis usaha x daerah sekali cari.`;
  } else if (useApi) {
    est.textContent = `${n} pencarian. Setiap pencarian memakai request Google API yang berbayar.`;
  } else {
    const maks = Number($("maks").value) || 40;
    const lo = minutes(n * (maks * 3 + 10));
    const hi = minutes(n * (maks * 4.5 + 10));
    est.textContent = `${n} pencarian, perkiraan ${lo === hi ? lo : lo + "-" + hi} menit bila tiap pencarian penuh ${maks} usaha.`;
  }
  saveForm();
}

// ---------- Progres ----------

const stage = { label: "", detail: "", warn: false };
let clock = null;

function setBar(frac) {
  const bar = $("progBar");
  bar.classList.toggle("indet", frac == null);
  if (frac == null) {
    bar.removeAttribute("aria-valuenow");
    bar.firstElementChild.style.width = "";
    $("progPct").textContent = "";
    return;
  }
  const pct = Math.min(100, Math.max(0, Math.round(frac * 100)));
  bar.setAttribute("aria-valuenow", pct);
  bar.firstElementChild.style.width = pct + "%";
  $("progPct").textContent = pct + "%";
}

// Teks dari server: "Pencarian 2/4: kafe di Seturan - membaca detail usaha 12/20",
// "Mengumpulkan daftar usaha: 18", atau pesan verifikasi Google.
function updateProgress(text) {
  const q = text.match(/^Pencarian (\d+)\/(\d+): (.*?)(?: - membaca detail usaha (\d+)\/(\d+))?$/);
  if (q) {
    const [, i, n, name, di, dn] = q;
    stage.q = [Number(i), Number(n)];
    stage.label = `Pencarian ${i}/${n}: ${name}`;
    stage.detail = di ? `Membaca detail usaha ${di}/${dn}` : "Mengumpulkan daftar usaha...";
    stage.d = di ? [Number(di), Number(dn)] : null;
    stage.warn = false;
  } else if (/daftar usaha: (\d+)/.test(text)) {
    stage.detail = `Mengumpulkan daftar usaha: ${text.match(/daftar usaha: (\d+)/)[1]}`;
    stage.d = null;
    stage.warn = false;
  } else {
    stage.detail = text;
    stage.warn = /verifikasi/i.test(text);
  }
  $("progStage").textContent = stage.label || text;
  $("progDetail").textContent = stage.detail;
  $("progDetail").classList.toggle("warn", stage.warn);

  if (!stage.q) return setBar(null);
  const [i, n] = stage.q;
  const within = stage.d ? 0.1 + 0.9 * (stage.d[0] / stage.d[1]) : 0.05;
  setBar((i - 1 + within) / n);
}

function startRun(text) {
  state.busy = true;
  stage.label = stage.detail = "";
  stage.q = stage.d = null;
  stage.warn = false;
  $("go").disabled = true;
  $("openFile").disabled = true;
  $("cancel").disabled = false;
  $("cancel").classList.toggle("hidden", mode() !== "browser");
  $("progress").classList.remove("hidden");
  $("progStage").textContent = text;
  $("progDetail").textContent = "";
  $("progDetail").classList.remove("warn");
  setBar(null);
  const t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $("progTime").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  tick();
  clock = setInterval(tick, 1000);
  $("empty").classList.add("hidden");
  $("result").classList.add("hidden");
}

function endRun() {
  state.busy = false;
  state.job = null;
  clearInterval(clock);
  $("go").disabled = false;
  $("openFile").disabled = false;
  $("progress").classList.add("hidden");
}

async function runBrowserJob(body) {
  const { id } = await api("/api/search-browser", body);
  state.job = id;
  for (;;) {
    await sleep(1500);
    const job = await api("/api/job?id=" + id);
    if (job.status === "error") throw new Error(job.error);
    if (job.status === "cancelled") return null;
    if (job.status === "done") return job.rows;
    updateProgress(job.progress);
  }
}

$("cancel").addEventListener("click", async () => {
  if (!state.job) return;
  $("cancel").disabled = true;
  $("progStage").textContent = "Membatalkan...";
  $("progDetail").textContent = "Menunggu langkah yang sedang berjalan selesai. Jendela Chrome akan menutup sendiri.";
  try {
    await api("/api/job-cancel?id=" + state.job, {});
  } catch (err) {
    msg(err.message, true);
  }
});

// ---------- Hasil ----------

function loadRows(rows, name, source) {
  state.rows = rows;
  state.name = name || "hasil";
  state.source = source;
  state.sort = { ...DEFAULT_SORT };
  state.filters = emptyFilters();
  const kategori = [...new Set(rows.map((r) => r.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));
  $("fkat").replaceChildren(el("option", { value: "", text: "Semua" }), ...kategori.map((k) => el("option", { value: k, text: k })));
  syncFilterInputs();
  renderSummary();
  render();
}

function syncFilterInputs() {
  const f = state.filters;
  $("fq").value = f.q;
  $("fpot").value = f.potensi;
  $("fweb").value = f.web;
  $("fkat").value = f.kategori;
  $("fwa").checked = f.wa;
  $("fskor").value = f.minSkor;
}

function compute() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const { key, dir } = state.sort;
  const m = dir === "asc" ? 1 : -1;
  state.shown = state.rows
    .filter((r) =>
      (!q || `${r.nama} ${r.alamat}`.toLowerCase().includes(q)) &&
      (!f.potensi || r.potensi === f.potensi) &&
      (!f.web || r.jenis_website === f.web) &&
      (!f.kategori || r.kategori === f.kategori) &&
      (!f.wa || isMobile(r.telepon)) &&
      (!f.minSkor || r.skor >= Number(f.minSkor)))
    .sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === "string" ? x.localeCompare(y, "id") : (Number(x) || 0) - (Number(y) || 0);
      return m * c || b.skor - a.skor || b.jumlah_rating - a.jumlah_rating;
    });
}

function renderSummary() {
  const rows = state.rows;
  const by = (p) => rows.filter((r) => r.potensi === p).length;
  const stat = (cls, value, label, potensi) => {
    const kids = [el("b", { text: num.format(value) }), el("span", { text: label })];
    return potensi
      ? el("button", { type: "button", class: `stat ${cls}`, "data-potensi": potensi, "aria-pressed": "false" }, ...kids)
      : el("div", { class: `stat ${cls}` }, ...kids);
  };
  $("summary").replaceChildren(
    stat("", rows.length, "Total usaha"),
    stat("hi", by("Tinggi"), "Potensi tinggi", "Tinggi"),
    stat("mid", by("Sedang"), "Potensi sedang", "Sedang"),
    stat("lo", by("Rendah"), "Potensi rendah", "Rendah"),
    stat("", rows.filter((r) => r.jenis_website !== "website").length, "Belum punya website sendiri"),
    stat("", rows.filter((r) => isMobile(r.telepon)).length, "Punya WhatsApp"),
  );
}

$("summary").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-potensi]");
  if (!b) return;
  state.filters.potensi = state.filters.potensi === b.dataset.potensi ? "" : b.dataset.potensi;
  $("fpot").value = state.filters.potensi;
  render();
});

function sortButton(key, label) {
  return el("button", { type: "button", class: "sort", "data-sort": key }, label, icon("sort"));
}

function renderHead() {
  const th = (id, label, ...kids) => el("th", { class: `c-${id}`, scope: "col", "data-keys": kids.length ? kids.map((k) => k.dataset.sort).join() : null }, ...(kids.length ? kids : [label]));
  const plain = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]));
  $("thead").replaceChildren(
    ...COLUMNS.map((c) => {
      if (c.id === "nama") return th(c.id, "", sortButton("nama", "Usaha"));
      if (c.id === "potensi") return th(c.id, "", sortButton("skor", "Potensi"));
      if (c.id === "rating") return th(c.id, "", sortButton("rating", "Rating"), el("span", { text: " / " }), sortButton("jumlah_rating", "Ulasan"));
      if (c.id === "aksi") return th(c.id, "", el("span", { class: "sr-only", text: "Aksi" }));
      return th(c.id, plain[c.id]);
    }),
  );
}

function updateSortUI() {
  for (const b of document.querySelectorAll("#thead .sort")) b.setAttribute("aria-pressed", b.dataset.sort === state.sort.key);
  for (const t of document.querySelectorAll("#thead th")) {
    const keys = (t.dataset.keys ?? "").split(",");
    if (keys.includes(state.sort.key)) t.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
    else t.removeAttribute("aria-sort");
  }
  const v = `${state.sort.key}:${state.sort.dir}`;
  $("fsort").value = [...$("fsort").options].some((o) => o.value === v) ? v : "skor:desc";
}

function chips(r) {
  const out = [];
  if (r.harga) out.push(["", "Harga " + r.harga]);
  if (r.reservasi === "ya") out.push(["good", "Reservasi"]);
  if (r.badan_hukum) out.push(["good", r.badan_hukum]);
  if (r.cabang_di_hasil >= 2) out.push(["good", `${r.cabang_di_hasil} cabang`]);
  if (r.jualan_online) out.push(["good", r.jualan_online]);
  return out.map(([cls, text]) => el("span", { class: "chip " + cls, text }));
}

function badge(r) {
  const cls = { Tinggi: "hi", Sedang: "mid", Rendah: "lo" }[r.potensi];
  return cls ? [el("span", { class: "badge " + cls, text: r.potensi }), el("span", { class: "score", text: r.skor })] : ["-"];
}

function websiteCell(r) {
  const out = [];
  if (r.website) out.push(el("a", { href: r.website, target: "_blank", rel: "noopener", text: hostOf(r.website) }));
  if (r.jenis_website !== "website") {
    out.push(el("span", { class: "chip need", style: r.website ? "margin-left:6px" : null, text: r.website ? "Hanya sosmed" : "Belum ada" }));
  }
  return out.length ? out : ["-"];
}

function actionsCell(r) {
  const wa = waNumber(r.telepon);
  const maps = r.link_maps && r.link_maps !== "#";
  return el("div", { class: "actions" },
    wa && el("a", { class: "icon-btn wa", href: "https://wa.me/" + wa, target: "_blank", rel: "noopener", title: "Buka WhatsApp", "aria-label": `Buka WhatsApp ${r.nama}` }, icon("wa")),
    maps && el("a", { class: "icon-btn", href: r.link_maps, target: "_blank", rel: "noopener", title: "Buka Google Maps", "aria-label": `Buka Google Maps ${r.nama}` }, icon("pin")),
    r.telepon && el("button", { type: "button", class: "icon-btn", "data-copy": r.telepon, title: "Salin nomor", "aria-label": `Salin nomor ${r.nama}` }, icon("copy")),
  );
}

function buildRow(r, i) {
  const td = (id, label, ...kids) => el("td", { class: `c-${id}`, "data-label": label }, ...kids);
  return el("tr", { "data-i": i },
    td("nama", "Usaha",
      el("button", { type: "button", class: "linkish", text: r.nama }),
      r.kategori && el("div", { class: "sub-line", text: r.kategori }),
      (() => {
        const c = chips(r);
        return c.length ? el("div", { class: "chips" }, ...c) : null;
      })()),
    td("potensi", "Potensi", ...badge(r)),
    td("kontak", "Kontak", r.telepon || "-"),
    td("website", "Website", ...websiteCell(r)),
    td("rating", "Rating", r.rating === "" ? "-" : `${r.rating} `, el("span", { class: "sub-line", text: `(${num.format(r.jumlah_rating)} ulasan)` })),
    td("alamat", "Alamat", r.alamat || "-"),
    td("kategori", "Kategori", r.kategori || "-"),
    td("harga", "Harga", r.harga || "-"),
    td("reservasi", "Reservasi", r.reservasi || "-"),
    td("badan_hukum", "PT/CV", r.badan_hukum || "-"),
    td("cabang", "Cabang di hasil", String(r.cabang_di_hasil)),
    td("marketplace", "Marketplace", r.jualan_online || "-"),
    td("skor_maps", "Skor Maps", r.skor_maps ? String(r.skor_maps) : "-"),
    td("faktor", "Faktor jenis usaha", r.faktor_jenis ? `${r.faktor_jenis} (${r.jenis_kelompok})` : "-"),
    td("sumber", "Sumber pencarian", r.sumber_kueri || "-"),
    td("aksi", "Aksi", actionsCell(r)),
  );
}

function render() {
  compute();
  const n = state.shown.length, total = state.rows.length;
  const has = total > 0;
  $("empty").classList.toggle("hidden", has || state.busy);
  $("result").classList.toggle("hidden", !has);
  if (!has) return;

  $("source").textContent = state.source;
  $("count").replaceChildren(
    `Menampilkan ${num.format(n)} dari ${num.format(total)} usaha`,
  );
  for (const b of document.querySelectorAll("#summary button[data-potensi]")) {
    b.setAttribute("aria-pressed", b.dataset.potensi === state.filters.potensi);
  }
  $("dlx").lastElementChild.textContent = `Unduh Excel (${num.format(Math.min(n, 500))})`;
  $("dl").lastElementChild.textContent = `Unduh CSV (${num.format(n)})`;
  $("dlx").disabled = $("dl").disabled = n === 0;
  $("dlNote").classList.toggle("hidden", n <= 500);
  $("noMatch").classList.toggle("hidden", n > 0);
  $("table").classList.toggle("hidden", n === 0);
  $("rows").replaceChildren(...state.shown.map((r, i) => buildRow(r, i)));
  updateSortUI();
}

// Empty state umum: sebelum mencari, hasil nol.
function showEmpty(title, text, actionLabel, action) {
  $("emptyTitle").textContent = title;
  $("emptyText").textContent = text;
  const b = $("emptyAction");
  b.classList.toggle("hidden", !actionLabel);
  b.textContent = actionLabel ?? "";
  b.onclick = action ?? null;
  $("empty").classList.remove("hidden");
}

// ---------- Kolom ----------

function renderColumnMenu() {
  $("colBody").replaceChildren(
    ...COLUMNS.filter((c) => !c.fixed).map((c) =>
      el("label", {},
        el("input", { type: "checkbox", "data-col": c.id, checked: state.visible.has(c.id) }),
        c.label),
    ),
  );
  applyColumns();
}

function applyColumns() {
  const hidden = COLUMNS.filter((c) => !c.fixed && !state.visible.has(c.id)).map((c) => `.c-${c.id}{display:none}`);
  let style = $("colStyle");
  if (!style) {
    style = el("style", { id: "colStyle" });
    document.head.append(style);
  }
  style.textContent = hidden.join("");
}

$("colBody").addEventListener("change", (e) => {
  const id = e.target.dataset.col;
  if (!id) return;
  e.target.checked ? state.visible.add(id) : state.visible.delete(id);
  store.set("kolom", [...state.visible]);
  applyColumns();
});

document.addEventListener("click", (e) => {
  if (!$("colMenu").contains(e.target)) $("colMenu").open = false;
});

// ---------- Filter dan urutan ----------

function bindFilter(id, key, event, read) {
  $(id).addEventListener(event, () => {
    state.filters[key] = read($(id));
    render();
  });
}
bindFilter("fq", "q", "input", (n) => n.value);
bindFilter("fpot", "potensi", "change", (n) => n.value);
bindFilter("fweb", "web", "change", (n) => n.value);
bindFilter("fkat", "kategori", "change", (n) => n.value);
bindFilter("fwa", "wa", "change", (n) => n.checked);
bindFilter("fskor", "minSkor", "input", (n) => n.value);

function resetFilters() {
  state.filters = emptyFilters();
  syncFilterInputs();
  render();
}
$("freset").addEventListener("click", resetFilters);
$("noMatchReset").addEventListener("click", resetFilters);

$("thead").addEventListener("click", (e) => {
  const b = e.target.closest(".sort");
  if (!b) return;
  const key = b.dataset.sort;
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "nama" ? "asc" : "desc" };
  render();
});

$("fsort").addEventListener("change", () => {
  const [key, dir] = $("fsort").value.split(":");
  state.sort = { key, dir };
  render();
});

// ---------- Aksi pada baris dan panel detail ----------

$("rows").addEventListener("click", (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) return void copyText(copy.dataset.copy);
  if (e.target.closest("a")) return;
  const tr = e.target.closest("tr");
  if (tr) openDetail(state.shown[Number(tr.dataset.i)]);
});

function openDetail(r) {
  const reasons = String(r.alasan ?? "").split("; ").filter(Boolean);
  const hasCalc = r.skor_maps && r.faktor_jenis;
  const wa = waNumber(r.telepon);
  const pair = (k, v) => [el("dt", { text: k }), el("dd", {}, v || "-")];
  const box = (value, label, cls = "") => el("div", { class: "box " + cls }, el("b", { text: value }), el("span", { text: label }));

  const body = el("div", {},
    el("div", { class: "dlg-head" },
      el("div", {}, el("h2", { id: "dName", text: r.nama }), r.kategori && el("div", { class: "sub-line", text: r.kategori })),
      el("button", { type: "button", class: "icon-btn", "aria-label": "Tutup panel", onclick: () => $("detail").close() }, icon("close")),
    ),
    el("section", {},
      el("h3", { text: "Potensi" }),
      hasCalc
        ? el("div", { class: "calc" },
            box(r.skor_maps, "Skor Maps"), "x",
            box(r.faktor_jenis, `Jenis ${r.jenis_kelompok}`), "=",
            box(r.skor, r.potensi, "final"))
        : el("div", {}, ...badge(r)),
      reasons.length
        ? el("ul", { class: "reasons" }, ...reasons.filter((x) => !hasCalc || !x.startsWith("jenis usaha")).map((x) => el("li", { text: x })))
        : null,
    ),
    el("section", {},
      el("h3", { text: "Kontak" }),
      el("dl", { class: "kv" },
        ...pair("Telepon", r.telepon),
        ...pair("Website", r.website ? el("a", { href: r.website, target: "_blank", rel: "noopener", text: r.website }) : "Belum ada"),
        ...pair("Alamat", r.alamat),
      ),
      el("div", { class: "actions" },
        wa && el("a", { class: "btn small", href: "https://wa.me/" + wa, target: "_blank", rel: "noopener" }, icon("wa"), "Buka WhatsApp"),
        r.link_maps && r.link_maps !== "#" && el("a", { class: "btn ghost small", href: r.link_maps, target: "_blank", rel: "noopener" }, icon("pin"), "Google Maps"),
        r.telepon && el("button", { type: "button", class: "btn ghost small", onclick: () => copyText(r.telepon) }, icon("copy"), "Salin nomor"),
      ),
    ),
    el("section", {},
      el("h3", { text: "Sinyal" }),
      el("dl", { class: "kv" },
        ...pair("Rating", r.rating === "" ? "" : `${r.rating} dari ${num.format(r.jumlah_rating)} ulasan`),
        ...pair("Harga", r.harga),
        ...pair("Reservasi", r.reservasi),
        ...pair("PT/CV", r.badan_hukum),
        ...pair("Cabang di hasil", String(r.cabang_di_hasil)),
        ...pair("Marketplace", r.jualan_online),
        ...pair("Sumber", r.sumber_kueri),
      ),
    ),
  );
  $("dBody").replaceChildren(body);
  $("detail").showModal();
}

$("detail").addEventListener("click", (e) => {
  if (e.target === $("detail")) $("detail").close();
});

// ---------- Unduh ----------

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function saveBlob(blob, filename) {
  const a = el("a", { href: URL.createObjectURL(blob), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
}

$("dl").addEventListener("click", () => {
  const lines = [CSV_HEAD, ...state.shown.map((r) => CSV_HEAD.map((h) => r[h]))].map((row) => row.map(csvCell).join(","));
  saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), state.name + ".csv");
});

$("dlx").addEventListener("click", async () => {
  $("dlx").disabled = true;
  try {
    const res = await fetch("/api/xlsx", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: state.shown }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Gagal membuat file Excel");
    saveBlob(await res.blob(), state.name + ".xlsx");
  } catch (err) {
    msg(err.message, true);
  } finally {
    $("dlx").disabled = state.shown.length === 0;
  }
});

// ---------- Buka file hasil lama ----------

$("openFile").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async () => {
  const file = $("fileInput").files[0];
  $("fileInput").value = "";
  if (!file) return;
  msg("Membuka " + file.name + "...");
  try {
    const res = await fetch("/api/open-file", {
      method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "File tidak bisa dibuka");
    loadRows(data.rows, file.name.replace(/\.(xlsx|csv)$/i, ""), "Dibuka dari file: " + file.name);
    if (!data.rows.length) showEmpty("File ini tidak berisi usaha", "Tidak ada baris data yang terbaca.", "Pilih file lain", () => $("fileInput").click());
    msg("");
  } catch (err) {
    msg(err.message, true);
  }
});

// ---------- Cari ----------

$("keyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/key", { key: $("key").value });
    $("key").value = "";
    state.hasKey = true;
    syncForm();
    msg("API key tersimpan. Silakan mulai mencari.");
  } catch (err) {
    msg(err.message, true);
  }
});

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const jenis = $("jenis").value.trim(), kota = $("kota").value.trim();
  if (!listOf(jenis).length || !kota) return msg("Jenis usaha dan kota wajib diisi.", true);
  if (queryCount() > MAX_QUERIES) return msg(`Terlalu banyak kombinasi. Maksimal ${MAX_QUERIES} pencarian sekali cari.`, true);
  if (mode() === "api" && !state.hasKey) {
    $("keyCard").classList.remove("hidden");
    $("key").focus();
    return msg("Mode Google API butuh API key. Isi dulu di atas, atau pilih mode tanpa API.", true);
  }

  const body = {
    jenis, kota, daerah: $("daerah").value.trim(), maks: Number($("maks").value) || 40, tanpaWebsite: $("tanpa").checked,
    minUlasan: Number($("minUlasan").value) || 0, minRating: Number($("minRating").value) || 0,
  };
  msg("");
  startRun(mode() === "browser" ? "Memulai pencarian..." : "Mencari lewat Google API...");
  let rows = null;
  let failed = false;
  try {
    rows = mode() === "browser" ? await runBrowserJob(body) : (await api("/api/search", body)).rows;
  } catch (err) {
    failed = true;
    msg(err.message, true);
  }
  endRun();

  const slug = `${jenis}-${kota}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (rows === null && !failed) {
    msg("Pencarian dibatalkan. Hasil sementara tidak disimpan.");
  } else if (rows) {
    loadRows(rows, slug, `Hasil pencarian: ${jenis} di ${body.daerah ? body.daerah + ", " : ""}${kota}`);
  }
  if (state.rows.length) return render(); // gagal atau batal: tampilkan lagi hasil sebelumnya
  if (failed) showEmpty("Pencarian gagal", "Periksa pesan di atas, lalu coba lagi.");
  else if (rows) {
    showEmpty("Tidak ada usaha ditemukan", "Coba kata kunci lain, tambah jenis usaha serupa, atau longgarkan min. ulasan dan min. rating.");
  } else showEmpty("Belum ada hasil", "Isi jenis usaha dan kota di atas lalu klik Cari, atau buka file hasil yang pernah diunduh.");
});

for (const id of [...FORM_FIELDS, "tanpa"]) $(id).addEventListener("input", syncForm);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", syncForm));
$("adv").addEventListener("toggle", saveForm);

// ---------- Mulai ----------

renderHead();
renderColumnMenu();
restoreForm();
syncForm();
api("/api/status").then((s) => {
  state.hasKey = s.hasKey;
  syncForm();
}).catch(() => {});
