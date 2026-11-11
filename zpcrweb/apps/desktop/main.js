"use strict";

/**
 * Desktop shell for the zpcrweb qPCR reader.
 *
 * The web app is a plain static bundle: `apps/web/dist` built by Vite. There is no Node code in
 * it and it needs no server, so the shell only has to (a) answer `app://bundle/...` out of that
 * directory and (b) open a window pointing at it.
 *
 * Why a custom scheme rather than `file://`: the bundle is ES modules loaded with absolute paths
 * (`/assets/index-*.js`), and `file://` gives every module an opaque origin, which breaks them.
 * A privileged `app:` scheme behaves like `http://localhost` — same origin, real MIME types,
 * `fetch()` works, `IndexedDB` and `localStorage` persist per app.
 */

const { app, BrowserWindow, Menu, dialog, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Built web app. Packaged builds carry it in `Contents/Resources/web-dist` (see the `extraResources`
 * entry in package.json); a source checkout reads the Vite output in place.
 */
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, "web-dist")
  : path.join(__dirname, "..", "web", "dist");

/**
 * The CFX Manager standard-edition archive password, the same one the launch script passes on the
 * URL. It is not a secret the app tries to keep from its user — it is what makes "double-click and
 * read a .pcrd" work without a prompt — but it does not belong in the upstream repository either,
 * so it stays here, in the shell of this local build.
 */
const CFX_PASSWORD = "SecureCompressDecompressKeyiQ5V4Files!!##$$";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".zpcr": "application/octet-stream",
  ".pcrd": "application/octet-stream",
  ".pltd": "application/octet-stream",
  ".prcl": "application/octet-stream",
};

/** Files handed to us before the window is ready (Finder "open with", `open -a`). */
const pendingPaths = [];

// --- temporary launch diagnostics -------------------------------------------------
const LOG = "/tmp/qpcr-main.log";
function log(message) {
  try {
    require("node:fs").appendFileSync(
      LOG,
      `${new Date().toISOString()} pid=${process.pid} ${message}\n`,
    );
  } catch {}
}
log(`start argv=${JSON.stringify(process.argv)} cwd=${process.cwd()} resources=${process.resourcesPath}`);
process.on("uncaughtException", (error) => log(`uncaught ${error && error.stack}`));
process.on("unhandledRejection", (error) => log(`rejection ${error && error.stack}`));
app.on("will-quit", () => log("will-quit"));
app.on("window-all-closed", () => log("window-all-closed"));
app.on("open-file", (_e, p) => log(`open-file ${p}`));
// ----------------------------------------------------------------------------------


const gotLock = app.requestSingleInstanceLock();
log(`lock=${gotLock}`);
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // Re-opening the app is how you pick up a freshly packaged build: an app that is already
    // running keeps the page it loaded, so without this a rebuild looks like it did nothing.
    // Reloading is cheap and loses nothing — the open files live in IndexedDB.
    const file = argvFile(argv);
    if (file) {
      void openInWindow(file);
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.reload();
    }
  });
}

/** The first non-flag argument that exists on disk, if any. */
function argvFile(argv) {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue;
    const resolved = path.resolve(arg);
    if (resolved.startsWith(app.getAppPath()) || resolved.includes(".app/Contents/")) continue;
    return resolved;
  }
  return null;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerBundleProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    // `app://bundle/<path>` — the host is fixed and carries no meaning beyond making the origin
    // standard; everything after it is a path inside the build output.
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const target = path.join(DIST, rel);
    // Refuse anything that escapes the build directory.
    if (!target.startsWith(DIST)) return new Response("not found", { status: 404 });
    try {
      const data = await fs.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      return new Response(data, { headers: { "content-type": type } });
    } catch {
      // Unknown path inside the SPA: hand back index.html so the router can handle it.
      try {
        const html = await fs.readFile(path.join(DIST, "index.html"));
        return new Response(html, { headers: { "content-type": "text/html" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0b0f14",
    title: "qPCR 读取器",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const url = new URL("app://bundle/index.html");
  url.searchParams.set("cfxPassword", CFX_PASSWORD);
  // The page sets its own English document title; keep the Chinese one from the window options.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  void mainWindow.loadURL(url.toString());

  // The app is a local file reader; nothing in it should navigate away. Links that do ask for a
  // new window (the About page's source links) belong in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith("app://bundle/")) {
      event.preventDefault();
      if (/^https?:/i.test(target)) void shell.openExternal(target);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Hand a file to the running page by faking the drop the app already understands.
 *
 * The alternative — teaching the renderer to read arbitrary disk paths — would mean handing a
 * sandboxed page a file-system bridge for one feature. The app takes drops everywhere and parses
 * in the renderer, so a synthetic `drop` with a real `File` is enough, and it costs no new API.
 */
async function openInWindow(filePath) {
  if (!mainWindow) {
    pendingPaths.push(filePath);
    return;
  }
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      message: "打不开这个文件",
      detail: `${filePath}\n${error && error.message ? error.message : String(error)}`,
    });
    return;
  }
  const name = path.basename(filePath);
  // The window exists as soon as it is created, but the page inside it does not: an argument handed
  // to `open` arrives before React has rendered the drop zone, and a drop dispatched now would land
  // on nothing. Wait for the load, then retry the dispatch a few times in case the first render is
  // still a frame away.
  log(`open ${filePath} loading=${mainWindow.webContents.isLoading()}`);
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }
  log("loaded");
  const base64 = bytes.toString("base64");
  const script = `(() => {
    const bin = atob(${JSON.stringify(base64)});
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], ${JSON.stringify(name)}, { type: "application/octet-stream" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target =
      document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        const chip = document.querySelector(".filechip, [class*='filechip']");
        resolve(Boolean(chip) || document.body.innerText.includes(${JSON.stringify(name)}));
      }, 600);
    });
  })()`;
  try {
    let landed = false;
    for (let attempt = 0; attempt < 10 && !landed; attempt += 1) {
      landed = await mainWindow.webContents
        .executeJavaScript(script, true)
        .then((ok) => ok === true, () => false);
      log(`drop attempt=${attempt} landed=${landed}`);
      if (!landed) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (error) {
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      message: "文件已读入，但页面没有接收",
      detail: `${name}\n${error && error.message ? error.message : String(error)}`,
    });
  }
}

function buildMenu() {
  const template = [
    {
      label: "qPCR 读取器",
      submenu: [
        { role: "about", label: "关于 qPCR 读取器" },
        { type: "separator" },
        { role: "hide", label: "隐藏" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "显示全部" },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "打开文件…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              title: "选择 qPCR 原始数据文件",
              properties: ["openFile", "multiSelections"],
              filters: [
                { name: "qPCR 原始数据", extensions: ["pcrd", "zpcr", "pltd", "prcl"] },
                { name: "全部文件", extensions: ["*"] },
              ],
            });
            for (const file of result.filePaths) await openInWindow(file);
          },
        },
        { type: "separator" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新载入" },
        { role: "forceReload", label: "强制重新载入" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "查看源码（GPL-3.0）",
          click: () => shell.openExternal("https://github.com/RByers/zpcrweb"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (mainWindow) void openInWindow(filePath);
  else pendingPaths.push(filePath);
});

app.whenReady().then(async () => {
  registerBundleProtocol();
  buildMenu();
  createWindow();

  const fromArgv = argvFile(process.argv);
  if (fromArgv) await openInWindow(fromArgv);
  while (pendingPaths.length) await openInWindow(pendingPaths.shift());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
