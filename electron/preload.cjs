const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gdg", {
  getInitialState: () => ipcRenderer.invoke("gdg:get-initial-state"),
  saveConfig: (config) => ipcRenderer.invoke("gdg:save-config", config),
  detectGame: () => ipcRenderer.invoke("gdg:detect-game"),
  selectGameFolder: () => ipcRenderer.invoke("gdg:select-game-folder"),
  selectManifestFile: () => ipcRenderer.invoke("gdg:select-manifest-file"),
  loadServerDirectory: (input) => ipcRenderer.invoke("gdg:load-server-directory", { input }),
  checkServerHealth: (server) => ipcRenderer.invoke("gdg:check-server-health", { server }),
  getDiskSpace: (gamePath) => ipcRenderer.invoke("gdg:get-disk-space", { gamePath }),
  getGameVersion: (gamePath) => ipcRenderer.invoke("gdg:get-game-version", { gamePath }),
  cloneGameInstall: (payload) => ipcRenderer.invoke("gdg:clone-game-install", payload),
  onCloneProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("gdg:clone-progress", listener);
    return () => ipcRenderer.removeListener("gdg:clone-progress", listener);
  },
  scanMods: (gamePath) => ipcRenderer.invoke("gdg:scan-mods", { gamePath }),
  previewSync: (payload) => ipcRenderer.invoke("gdg:preview-sync", payload),
  applySync: (payload) => ipcRenderer.invoke("gdg:apply-sync", payload),
  cleanLocalMods: (payload) => ipcRenderer.invoke("gdg:clean-local-mods", payload),
  purgeModsFolder: (payload) => ipcRenderer.invoke("gdg:purge-mods-folder", payload),
  cleanManagedMods: (payload) => ipcRenderer.invoke("gdg:clean-managed-mods", payload),
  resetAndReinstall: (payload) => ipcRenderer.invoke("gdg:reset-and-reinstall", payload),
  runDoctor: (payload) => ipcRenderer.invoke("gdg:run-doctor", payload),
  listBackups: (gamePath) => ipcRenderer.invoke("gdg:list-backups", { gamePath }),
  restoreBackup: (payload) => ipcRenderer.invoke("gdg:restore-backup", payload),
  deleteBackup: (payload) => ipcRenderer.invoke("gdg:delete-backup", payload),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("gdg:sync-progress", listener);
    return () => ipcRenderer.removeListener("gdg:sync-progress", listener);
  },
  onSupportBundleProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("gdg:support-bundle-progress", listener);
    return () => ipcRenderer.removeListener("gdg:support-bundle-progress", listener);
  },
  onGameCopyDeleted: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("gdg:game-copy-deleted", listener);
    return () => ipcRenderer.removeListener("gdg:game-copy-deleted", listener);
  },
  launchGame: (payload) => ipcRenderer.invoke("gdg:launch-game", payload),
  openSteamUpdate: () => ipcRenderer.invoke("gdg:open-steam-update"),
  openDiagnosticLog: () => ipcRenderer.invoke("gdg:open-diagnostic-log"),
  createSupportBundle: () => ipcRenderer.invoke("gdg:create-support-bundle"),
  copyFileToClipboard: (filePath) => ipcRenderer.invoke("gdg:copy-file-to-clipboard", { filePath }),
  openPath: (filePath) => ipcRenderer.invoke("gdg:open-path", { filePath })
});
