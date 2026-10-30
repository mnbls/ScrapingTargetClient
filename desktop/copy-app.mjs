// Menyalin file aplikasi dari folder induk ke desktop/app sebelum dijalankan atau dibangun.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..");
const to = join(here, "app");
const files = ["index.html", "style.css", "app.js", "lib.mjs", "browser.mjs", "server.mjs", "xlsx.mjs", "hasil.mjs"];

rmSync(to, { recursive: true, force: true });
mkdirSync(to);
for (const f of files) cpSync(join(from, f), join(to, f));
console.log(`Disalin ${files.length} file ke ${to}`);
