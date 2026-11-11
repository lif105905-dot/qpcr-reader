"use strict";

/**
 * The only bridge the pages get: the home page asks for the other tool by name. Everything else —
 * files, menus, windows — stays in the main process, so the sandboxed renderers keep no ability to
 * touch the disk or spawn processes on their own.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("labkit", {
  /** Open (or focus) the qPCR reader window. */
  openQpcr: () => ipcRenderer.send("labkit:open-qpcr"),
});
