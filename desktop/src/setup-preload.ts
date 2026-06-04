import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  installCli: () => ipcRenderer.invoke("setup:install-cli"),
  completeSetup: () => ipcRenderer.invoke("setup:complete"),
});
