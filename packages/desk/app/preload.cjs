const { contextBridge, ipcRenderer } = require("electron");

const packaged = process.env.NEO_DESK_PACKAGED === "1";
const apiBase = (
  process.env.NEO_CONTROL_PLANE_URL ||
  process.env.CONTROL_PLANE_URL ||
  (packaged ? "http://62.234.211.200" : "http://127.0.0.1:8080")
).replace(/\/$/, "");

function on(channel, cb) {
  const listen = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listen);
  return () => ipcRenderer.removeListener(channel, listen);
}

contextBridge.exposeInMainWorld("neoDesk", {
  apiBase,
  canRunLocal: true,
  proxyApi: packaged,
  getToken: () => ipcRenderer.invoke("desk:getToken"),
  setToken: (token) => ipcRenderer.invoke("desk:setToken", token),
  clearToken: () => ipcRenderer.invoke("desk:clearToken"),
  pickFolder: () => ipcRenderer.invoke("desk:pickFolder"),
  listWorkspaces: () => ipcRenderer.invoke("desk:listWorkspaces"),
  unbindWorkspace: (workspaceId) => ipcRenderer.invoke("desk:unbindWorkspace", workspaceId),
  getTarget: () => ipcRenderer.invoke("desk:getTarget"),
  setTarget: (target) => ipcRenderer.invoke("desk:setTarget", target),
  getPrefs: () => ipcRenderer.invoke("desk:getPrefs"),
  setPrefs: (next) => ipcRenderer.invoke("desk:setPrefs", next),
  startRun: (assignment, folder) => ipcRenderer.invoke("desk:startRun", assignment, folder),
  takeAssignment: (runId, folder) => ipcRenderer.invoke("desk:takeAssignment", runId, folder),
  stopRun: (runId) => ipcRenderer.invoke("desk:stopRun", runId),
  openPath: (filePath) => ipcRenderer.invoke("desk:openPath", filePath),
  listDir: (input) => ipcRenderer.invoke("desk:listDir", input),
  listSkills: (input) => ipcRenderer.invoke("desk:listSkills", input),
  writeFile: (input) => ipcRenderer.invoke("desk:writeFile", input),
  diffStat: (folder) => ipcRenderer.invoke("desk:diffStat", folder),
  termOpen: (folder) => ipcRenderer.invoke("desk:termOpen", folder),
  termWrite: (id, data) => ipcRenderer.invoke("desk:termWrite", { id, data }),
  termClose: (id) => ipcRenderer.invoke("desk:termClose", id),
  onRunStatus: (cb) => on("desk:run-status", cb),
  onDispatched: (cb) => on("desk:dispatched", cb),
  onTarget: (cb) => on("desk:target", cb),
  onInboxState: (cb) => on("desk:inbox-state", cb),
  onTermData: (cb) => on("desk:term-data", cb),
  onTermExit: (cb) => on("desk:term-exit", cb),
});
