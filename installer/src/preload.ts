import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("installer", {
  getPlatformInfo: () => ipcRenderer.invoke("get-platform-info"),
  install: (components: { cli: boolean }) => ipcRenderer.invoke("install", components),
  onProgress: (cb: (msg: { step: string; progress?: number; error?: string; done?: boolean }) => void) => {
    ipcRenderer.on("install-progress", (_e, msg) => cb(msg));
  },
  openBrowser: () => ipcRenderer.invoke("open-browser"),
  quit: () => ipcRenderer.invoke("quit"),
});
