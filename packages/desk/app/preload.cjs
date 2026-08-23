const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("neoDesk", {
  platform: process.platform,
  apiBase: "",
  canRunLocal: true,
  getToken: () => ipcRenderer.invoke("desk:getToken"),
  setToken: (token) => ipcRenderer.invoke("desk:setToken", token),
  clearToken: () => ipcRenderer.invoke("desk:clearToken"),
  pickFolder: () => ipcRenderer.invoke("desk:pickFolder"),
  getTarget: () => ipcRenderer.invoke("desk:getTarget"),
  setTarget: (target) => ipcRenderer.invoke("desk:setTarget", target),
  notify: (title, body) => ipcRenderer.invoke("desk:notify", title, body),
  openPath: (filePath) => ipcRenderer.invoke("desk:openPath", filePath),
  onDeepLink: (cb) => {
    const listen = (_event, url) => cb(url);
    ipcRenderer.on("desk:deep-link", listen);
    return () => ipcRenderer.removeListener("desk:deep-link", listen);
  },
});
