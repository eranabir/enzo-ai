import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("enzo", {
  getInfo: () => ipcRenderer.invoke("get-info"),
  install: (components: { webui: boolean; cli: boolean }) =>
    ipcRenderer.invoke("install", components),
  onProgress: (cb: (data: { step: string; progress: number; done?: boolean; error?: string }) => void) =>
    ipcRenderer.on("progress", (_e, data) => cb(data)),
});
