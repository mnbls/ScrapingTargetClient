// Pembungkus desktop (Electron): menjalankan server.mjs di dalam aplikasi dan menampilkannya di jendela sendiri.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const net = require("node:net");

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox("Pencari Calon Klien gagal dibuka", err.stack || String(err));
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function start() {
  // Folder instalasi tidak boleh ditulis, jadi API key dan profil browser disimpan di folder data pengguna.
  process.env.APP_DATA_DIR = app.getPath("userData");
  const port = Number(process.env.PORT) || (await freePort());
  process.env.PORT = String(port);
  await import(pathToFileURL(join(__dirname, "app", "server.mjs")).href);

  Menu.setApplicationMenu(null);
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    title: "Pencari Calon Klien",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Link ke WhatsApp, Google Maps, dan website usaha dibuka di browser biasa, bukan di jendela aplikasi.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.on("closed", () => (win = null));
  await win.loadURL(origin + "/");
}
