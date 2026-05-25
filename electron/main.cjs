const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const AdmZip = require("adm-zip");
const yauzl = require("yauzl");
const {
  getClientBlockedReason,
  getModAudience,
  isClientBlockedServerOnlyMod,
  isClientInstallableManifestMod
} = require("../shared/gdg-sync-core.cjs");

const GAME_ID = "7dtd";
const GAME_NAME = "7 Days to Die";
const STEAM_APP_ID = "251570";
const CONFIG_VERSION = 1;
const INSTALL_STATE_VERSION = 1;
const OPERATION_HISTORY_LIMIT = 80;
const BACKUP_CATEGORY_NAMES = new Set(["purged-mods", "local-only-mods", "managed-mods", "extra-managed-mods", "restore-overwritten"]);
const DEFAULT_SERVER_DIRECTORY = path.join(__dirname, "..", "server-directory", "gdg.servers.sample.json");
const LOADER_RELEASE_API_URL = "https://api.github.com/repos/VeriduxInteractive/gdg-7dtd-mod-loader/releases/latest";
const LOADER_RELEASES_URL = "https://github.com/VeriduxInteractive/gdg-7dtd-mod-loader/releases";
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow;
let updateState = {
  status: "idle",
  currentVersion: "",
  latestVersion: "",
  updateAvailable: false,
  releaseUrl: LOADER_RELEASES_URL,
  assetName: "",
  assetUrl: "",
  assetKind: "",
  error: ""
};

let promptedUpdateVersion = "";

process.on("uncaughtException", (error) => {
  void appendDiagnosticLog("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  void appendDiagnosticLog("unhandledRejection", error);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f6f7f9",
    title: "GDG Mod Loader",
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function getAppIconPath() {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  return app.isPackaged ? path.join(process.resourcesPath, iconFile) : path.join(__dirname, "..", "build", iconFile);
}

app.whenReady().then(() => {
  registerIpc();
  updateState.currentVersion = app.getVersion();
  updateApplicationMenu();
  createWindow();
  setTimeout(() => {
    void checkForLoaderUpdate({ silent: true, promptOnUpdate: true });
  }, 1500);
  setInterval(() => {
    void checkForLoaderUpdate({ silent: true });
  }, UPDATE_CHECK_INTERVAL_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpc() {
  ipcMain.handle("gdg:get-initial-state", async () => {
    const config = await loadConfig();
    const detected = await detectSevenDaysInstall();
    return { config, detected };
  });

  ipcMain.handle("gdg:save-config", async (_event, patch) => {
    return saveConfig(patch);
  });

  ipcMain.handle("gdg:detect-game", async () => {
    return detectSevenDaysInstall();
  });

  ipcMain.handle("gdg:select-game-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select 7 Days to Die folder",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedPath = result.filePaths[0];
    return {
      canceled: false,
      path: selectedPath,
      valid: await isSevenDaysGameRoot(selectedPath)
    };
  });

  ipcMain.handle("gdg:select-manifest-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select server manifest",
      filters: [{ name: "JSON manifests", extensions: ["json"] }],
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle("gdg:load-server-directory", async (_event, payload) => {
    return loadServerDirectory(payload.input);
  });

  ipcMain.handle("gdg:check-server-health", async (_event, payload) => {
    return checkServerHealth(payload.server);
  });

  ipcMain.handle("gdg:get-disk-space", async (_event, payload) => {
    return getDiskSpace(payload.gamePath);
  });

  ipcMain.handle("gdg:get-game-version", async (_event, payload) => {
    return getGameVersionInfo(payload.gamePath);
  });

  ipcMain.handle("gdg:clone-game-install", async (event, payload) => {
    return cloneGameInstall(payload, (progress) => {
      sendIpcProgress(event, "gdg:clone-progress", progress);
    });
  });

  ipcMain.handle("gdg:scan-mods", async (_event, payload) => {
    return scanMods(payload.gamePath, { hash: false });
  });

  ipcMain.handle("gdg:preview-sync", async (_event, payload) => {
    return previewSync(payload);
  });

  ipcMain.handle("gdg:apply-sync", async (event, payload) => {
    try {
      return await applySync(payload, (progress) => {
        sendIpcProgress(event, "gdg:sync-progress", progress);
      });
    } catch (error) {
      await appendDiagnosticLog("gdg:apply-sync", error, {
        gamePath: payload?.gamePath,
        manifestInput: payload?.manifestInput
      });
      return createFailedApplyResult(payload, error, (progress) => {
        sendIpcProgress(event, "gdg:sync-progress", progress);
      });
    }
  });

  ipcMain.handle("gdg:clean-local-mods", async (event, payload) => {
    return cleanLocalMods(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:purge-mods-folder", async (event, payload) => {
    return purgeModsFolder(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:clean-managed-mods", async (event, payload) => {
    return cleanManagedMods(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:reset-and-reinstall", async (event, payload) => {
    return resetAndReinstall(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:run-doctor", async (_event, payload) => {
    return runPreflightDoctor(payload);
  });

  ipcMain.handle("gdg:list-backups", async (_event, payload) => {
    return listBackups(payload.gamePath);
  });

  ipcMain.handle("gdg:restore-backup", async (event, payload) => {
    return restoreBackup(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:delete-backup", async (_event, payload) => {
    return deleteBackup(payload);
  });

  ipcMain.handle("gdg:launch-game", async (_event, payload) => {
    return launchGame(payload);
  });

  ipcMain.handle("gdg:open-steam-update", async () => {
    try {
      await shell.openExternal(`steam://nav/games/details/${STEAM_APP_ID}`);
      return { ok: true, target: "steam" };
    } catch (error) {
      try {
        await shell.openExternal(`https://store.steampowered.com/app/${STEAM_APP_ID}/7_Days_to_Die/`);
        return { ok: true, target: "web" };
      } catch (fallbackError) {
        return { ok: false, error: fallbackError.message || error.message };
      }
    }
  });

  ipcMain.handle("gdg:open-diagnostic-log", async () => {
    const logPath = getDiagnosticLogPath();
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    if (!(await exists(logPath))) {
      await fsp.writeFile(logPath, "GDG Mod Loader diagnostic log\n", "utf8");
    }

    const result = await shell.openPath(logPath);
    return result ? { ok: false, error: result, path: logPath } : { ok: true, path: logPath };
  });

  ipcMain.handle("gdg:create-support-bundle", async (event) => {
    try {
      const bundle = await createSupportBundle((progress) => {
        sendIpcProgress(event, "gdg:support-bundle-progress", progress);
      });
      shell.showItemInFolder(bundle.path);
      return { ok: true, ...bundle };
    } catch (error) {
      await appendDiagnosticLog("gdg:create-support-bundle", error);
      return {
        ok: false,
        error: error.message || "Support bundle could not be created.",
        path: "",
        folderPath: "",
        fileName: ""
      };
    }
  });

  ipcMain.handle("gdg:open-path", async (_event, payload) => {
    if (!payload.filePath) {
      return { ok: false, error: "Missing path." };
    }

    const result = await shell.openPath(payload.filePath);
    return result ? { ok: false, error: result } : { ok: true };
  });
}

function updateApplicationMenu() {
  const updateLabel = updateState.updateAvailable ? "Update Available" : "Update";
  const updateStatusLabel = getUpdateStatusLabel();
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Delete Existing GDG Copy...",
          click: () => {
            void deleteSelectedGdgCopy();
          }
        },
        {
          label: "Purge Selected Mods Folder",
          submenu: [
            {
              label: "Move Mods to Backup...",
              click: () => {
                void purgeSelectedModsFolderFromMenu("backup");
              }
            },
            {
              label: "Delete Mods Permanently...",
              click: () => {
                void purgeSelectedModsFolderFromMenu("delete");
              }
            }
          ]
        },
        {
          label: "Open Diagnostic Log",
          click: () => {
            void openDiagnosticLog();
          }
        },
        {
          label: "Create Support Bundle...",
          click: () => {
            void createSupportBundleFromMenu();
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: updateLabel,
      submenu: [
        {
          label: updateStatusLabel,
          enabled: false
        },
        { type: "separator" },
        {
          label: updateState.updateAvailable ? `Install v${updateState.latestVersion}` : "Open Releases",
          click: () => {
            if (updateState.updateAvailable && updateState.assetUrl) {
              void installLoaderUpdate();
            } else {
              void shell.openExternal(updateState.releaseUrl || LOADER_RELEASES_URL);
            }
          }
        },
        {
          label: "Check for Updates",
          click: () => {
            void checkForLoaderUpdate({ silent: false });
          }
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openDiagnosticLog() {
  const logPath = getDiagnosticLogPath();
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  if (!(await exists(logPath))) {
    await fsp.writeFile(logPath, "GDG Mod Loader diagnostic log\n", "utf8");
  }
  await shell.openPath(logPath);
}

async function createSupportBundleFromMenu() {
  try {
    const bundle = await createSupportBundle((progress) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("gdg:support-bundle-progress", progress);
        }
      } catch (error) {
        void appendDiagnosticLog("menu:support-bundle-progress", error);
      }
    });
    shell.showItemInFolder(bundle.path);

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Support bundle created",
      message: "GDG support bundle created",
      detail: `Send this zip to GDG support:\n${bundle.path}`
    });
  } catch (error) {
    await appendDiagnosticLog("menu:create-support-bundle", error);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Support bundle failed",
      message: "The support bundle could not be created.",
      detail: error.message || String(error)
    });
  }
}

async function createSupportBundle(onProgress = () => {}) {
  const createdAt = new Date();
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const folderPath = path.join(app.getPath("userData"), "support-bundles");
  const fileName = `GDG-Mod-Loader-support-${timestamp}.zip`;
  const bundlePath = path.join(folderPath, fileName);
  const zip = new AdmZip();
  const errors = [];
  const totalSteps = 7;

  reportSupportBundleProgress(onProgress, "preparing", "Preparing support bundle.", 0, totalSteps);

  await fsp.mkdir(folderPath, { recursive: true });

  const config = await loadConfig().catch((error) => {
    errors.push({ section: "config", error: error.message });
    return getDefaultConfig();
  });
  reportSupportBundleProgress(onProgress, "preparing", "Loaded mod loader settings.", 1, totalSteps);

  const summary = {
    createdAt: createdAt.toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname()
    },
    selected: {
      gamePath: config.gamePath || "",
      manifestInput: config.manifestInput || "",
      serverDirectoryInput: config.serverDirectoryInput || "",
      lastServerId: config.lastServerId || "",
      launchWithEac: Boolean(config.launchWithEac)
    },
    errors
  };

  addJsonToZip(zip, "config.json", config);
  addJsonToZip(zip, "update-state.json", updateState);

  reportSupportBundleProgress(onProgress, "scanning", "Collecting GDG diagnostic log.", 2, totalSteps);
  await addDiagnosticFileToZip(zip, errors);
  reportSupportBundleProgress(onProgress, "scanning", "Checking detected game folder.", 3, totalSteps);
  await addDetectedGameToZip(zip, errors);
  reportSupportBundleProgress(onProgress, "scanning", "Scanning local mods and game version.", 4, totalSteps);
  await addLocalGameContextToZip(zip, config, errors);
  reportSupportBundleProgress(onProgress, "verifying", "Checking selected server mod list.", 5, totalSteps);
  await addServerContextToZip(zip, config, errors);
  reportSupportBundleProgress(onProgress, "scanning", "Collecting recent 7 Days to Die logs.", 6, totalSteps);
  await addRecentSevenDaysLogsToZip(zip, config, errors);

  reportSupportBundleProgress(onProgress, "installing", "Writing support bundle zip.", 7, totalSteps);
  addJsonToZip(zip, "summary.json", summary);
  zip.writeZip(bundlePath);
  reportSupportBundleProgress(onProgress, "complete", "Support bundle created.", totalSteps, totalSteps);

  return {
    path: bundlePath,
    folderPath,
    fileName
  };
}

function reportSupportBundleProgress(onProgress, phase, message, current, total) {
  onProgress({
    phase,
    message,
    current,
    total,
    percent: total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0
  });
}

async function addDetectedGameToZip(zip, errors) {
  try {
    addJsonToZip(zip, "detected-game.json", await detectSevenDaysInstall());
  } catch (error) {
    errors.push({ section: "detected-game", error: error.message });
  }
}

async function addLocalGameContextToZip(zip, config, errors) {
  if (!config.gamePath) {
    errors.push({ section: "local-game", error: "No selected game folder." });
    return;
  }

  try {
    addJsonToZip(zip, "local-game-version.json", await getGameVersionInfo(config.gamePath));
  } catch (error) {
    errors.push({ section: "local-game-version", error: error.message });
  }

  try {
    addJsonToZip(zip, "local-disk-space.json", await getDiskSpace(config.gamePath));
  } catch (error) {
    errors.push({ section: "local-disk-space", error: error.message });
  }

  try {
    addJsonToZip(zip, "local-mods.json", await scanMods(config.gamePath, { hash: false }));
  } catch (error) {
    errors.push({ section: "local-mods", error: error.message });
  }

  try {
    addJsonToZip(zip, "install-state.json", await readInstallState(config.gamePath));
  } catch (error) {
    errors.push({ section: "install-state", error: error.message });
  }

  try {
    addJsonToZip(zip, "backup-index.json", await listBackups(config.gamePath));
  } catch (error) {
    errors.push({ section: "backup-index", error: error.message });
  }
}

async function addServerContextToZip(zip, config, errors) {
  if (!config.manifestInput) {
    errors.push({ section: "server-context", error: "No selected sync endpoint." });
    return;
  }

  try {
    const manifest = await loadManifest(config.manifestInput);
    validateManifest(manifest);
    addJsonToZip(zip, "server-manifest.json", manifest);
    addJsonToZip(zip, "server-size-summary.json", getManifestSizeSummary(manifest));
  } catch (error) {
    errors.push({ section: "server-manifest", error: error.message });
  }

  if (!config.gamePath) {
    return;
  }

  try {
    const preview = await previewSync({
      gamePath: config.gamePath,
      manifestInput: config.manifestInput
    });
    addJsonToZip(zip, "sync-preview.json", preview);
    addJsonToZip(zip, "skipped-server-only.json", preview.skippedServerOnly || []);
    addJsonToZip(zip, "preflight-doctor.json", await runPreflightDoctor({
      gamePath: config.gamePath,
      manifestInput: config.manifestInput,
      launchWithEac: config.launchWithEac
    }));
  } catch (error) {
    errors.push({ section: "sync-preview", error: error.message });
    addTextToZip(zip, "sync-preview-error.txt", serializeErrorText(error));
  }
}

async function addDiagnosticFileToZip(zip, errors) {
  const logPath = getDiagnosticLogPath();
  if (!(await exists(logPath))) {
    addTextToZip(zip, "diagnostics/gdg-mod-loader.log", "No GDG Mod Loader diagnostic log exists yet.\n");
    return;
  }

  try {
    addTextToZip(zip, "diagnostics/gdg-mod-loader.log", await readTextTail(logPath, 5 * 1024 * 1024));
  } catch (error) {
    errors.push({ section: "diagnostic-log", error: error.message });
  }
}

async function addRecentSevenDaysLogsToZip(zip, config, errors) {
  try {
    const logs = await collectRecentSevenDaysLogs(config.gamePath);
    addJsonToZip(zip, "7-days-logs/index.json", logs.map((log) => ({
      sourcePath: log.path,
      sizeBytes: log.size,
      modifiedAt: log.modifiedAt
    })));

    for (const log of logs) {
      const safeName = sanitizeZipSegment(`${log.modifiedAt.replace(/[:.]/g, "-")}-${path.basename(log.path)}`);
      addTextToZip(zip, `7-days-logs/${safeName}`, await readTextTail(log.path, 5 * 1024 * 1024));
    }
  } catch (error) {
    errors.push({ section: "7-days-logs", error: error.message });
  }
}

async function collectRecentSevenDaysLogs(gamePath) {
  const candidates = [
    path.join(os.homedir(), "AppData", "LocalLow", "The Fun Pimps", "7 Days To Die"),
    path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie"),
    path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie", "logs")
  ];

  if (gamePath) {
    candidates.push(path.join(gamePath, "7DaysToDie_Data"));
    candidates.push(path.join(gamePath, "logs"));
  }

  const byPath = new Map();
  for (const candidate of dedupe(candidates)) {
    for (const filePath of await collectLogFiles(candidate, 2)) {
      byPath.set(path.resolve(filePath).toLowerCase(), filePath);
    }
  }

  const logs = [];
  for (const filePath of byPath.values()) {
    const stats = await fsp.stat(filePath);
    logs.push({
      path: filePath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    });
  }

  logs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return logs.slice(0, 10);
}

async function collectLogFiles(root, depth) {
  if (!root || depth < 0 || !(await exists(root))) {
    return [];
  }

  const entries = await fsp.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectLogFiles(fullPath, depth - 1));
    } else if (entry.isFile() && isUsefulLogFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isUsefulLogFile(fileName) {
  const lower = fileName.toLowerCase();
  return (
    lower === "player.log" ||
    lower === "player-prev.log" ||
    lower.includes("output_log") ||
    (lower.includes("player") && (lower.endsWith(".log") || lower.endsWith(".txt"))) ||
    lower.endsWith(".log")
  );
}

async function readTextTail(filePath, maxBytes) {
  const stats = await fsp.stat(filePath);
  if (stats.size <= maxBytes) {
    return fsp.readFile(filePath, "utf8");
  }

  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    await handle.read(buffer, 0, maxBytes, stats.size - maxBytes);
    return `[Last ${maxBytes} bytes of ${stats.size} byte file]\n${buffer.toString("utf8")}`;
  } finally {
    await handle.close();
  }
}

function addJsonToZip(zip, zipPath, value) {
  addTextToZip(zip, zipPath, `${JSON.stringify(value, null, 2)}\n`);
}

function addTextToZip(zip, zipPath, text) {
  zip.addFile(zipPath.replace(/\\/g, "/"), Buffer.from(String(text || ""), "utf8"));
}

function sanitizeZipSegment(value) {
  return sanitizeFolderName(value).replace(/\s+/g, " ").slice(0, 180) || "log.txt";
}

function serializeErrorText(error) {
  const serialized = serializeError(error);
  return `${serialized.name}: ${serialized.message}\n\n${serialized.stack || ""}\n`;
}

function getUpdateStatusLabel() {
  if (updateState.status === "checking") {
    return "Checking for updates...";
  }

  if (updateState.status === "downloading") {
    return `Downloading v${updateState.latestVersion}...`;
  }

  if (updateState.updateAvailable) {
    return `Version ${updateState.latestVersion} is available`;
  }

  if (updateState.status === "error") {
    return `Update check failed: ${updateState.error}`;
  }

  if (updateState.latestVersion) {
    return `Up to date: v${updateState.currentVersion}`;
  }

  return `Current version: v${updateState.currentVersion || app.getVersion()}`;
}

async function checkForLoaderUpdate(options = {}) {
  updateState = {
    ...updateState,
    status: "checking",
    currentVersion: app.getVersion(),
    error: ""
  };
  updateApplicationMenu();

  try {
    const response = await fetch(LOADER_RELEASE_API_URL, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "GDG-Mod-Loader"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const release = await response.json();
    const latestVersion = normalizeVersion(release.tag_name || release.name || "");
    const currentVersion = normalizeVersion(app.getVersion());
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    const updateAsset = findLoaderUpdateAsset(release);

    updateState = {
      status: "ready",
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url || LOADER_RELEASES_URL,
      assetName: updateAsset?.name || "",
      assetUrl: updateAsset?.browser_download_url || "",
      assetKind: updateAsset?.kind || "",
      error: ""
    };
    updateApplicationMenu();

    const shouldPrompt =
      mainWindow &&
      updateAvailable &&
      (options.promptOnUpdate || !options.silent) &&
      promptedUpdateVersion !== latestVersion;

    if (shouldPrompt) {
      promptedUpdateVersion = latestVersion;
      await promptForLoaderUpdate();
    } else if (!options.silent && mainWindow) {
      if (updateAvailable) {
        await promptForLoaderUpdate();
      } else {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          buttons: ["OK"],
          title: "GDG Mod Loader Update",
          message: "GDG Mod Loader is up to date.",
          detail: `You are running v${currentVersion}.`
        });
      }
    }

    return updateState;
  } catch (error) {
    updateState = {
      ...updateState,
      status: "error",
      updateAvailable: false,
      error: error.message
    };
    updateApplicationMenu();

    if (!options.silent && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["OK"],
        title: "GDG Mod Loader Update",
        message: "Could not check for updates.",
        detail: error.message
      });
    }

    return updateState;
  }
}

function findLoaderUpdateAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const setup = assets.find((asset) => /setup\.exe$/i.test(asset.name || ""));
  if (setup) {
    return { ...setup, kind: "setup" };
  }

  const portable = assets.find((asset) => /portable\.exe$/i.test(asset.name || ""));
  if (portable) {
    return { ...portable, kind: "portable" };
  }

  return null;
}

async function promptForLoaderUpdate() {
  const hasInstaller = Boolean(updateState.assetUrl);
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    buttons: [hasInstaller ? "Install Update" : "Open Download Page", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "GDG Mod Loader Update",
    message: `GDG Mod Loader v${updateState.latestVersion} is available.`,
    detail: hasInstaller
      ? `You are currently running v${updateState.currentVersion}. GDG can download ${updateState.assetName} and start the update installer for you.`
      : `You are currently running v${updateState.currentVersion}. No installer asset was found, so GDG can open the release page.`
  });

  if (result.response !== 0) {
    return;
  }

  if (hasInstaller) {
    await installLoaderUpdate();
  } else {
    await shell.openExternal(updateState.releaseUrl || LOADER_RELEASES_URL);
  }
}

async function installLoaderUpdate() {
  if (!updateState.assetUrl) {
    await shell.openExternal(updateState.releaseUrl || LOADER_RELEASES_URL);
    return;
  }

  try {
    updateState = { ...updateState, status: "downloading", error: "" };
    updateApplicationMenu();

    const updatesDir = path.join(app.getPath("temp"), "gdg-mod-loader-updates");
    await fsp.mkdir(updatesDir, { recursive: true });
    const installerName = sanitizeFolderName(updateState.assetName || `GDG-Mod-Loader-${updateState.latestVersion}-setup.exe`);
    const installerPath = path.join(updatesDir, installerName);

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["OK"],
      title: "Installing Update",
      message: `Downloading GDG Mod Loader v${updateState.latestVersion}.`,
      detail: "The installer will open when the download finishes. Close GDG Mod Loader when the installer asks."
    });

    await downloadUrlToFile(updateState.assetUrl, installerPath);

    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Start Installer", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: `GDG Mod Loader v${updateState.latestVersion} is ready to install.`,
      detail:
        updateState.assetKind === "portable"
          ? "GDG downloaded the new portable app. Start it now and close this older version."
          : "GDG will start the installer now and close this older version."
    });

    if (result.response !== 0) {
      updateState = { ...updateState, status: "ready" };
      updateApplicationMenu();
      return;
    }

    const child = spawn(installerPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    setTimeout(() => app.quit(), 500);
  } catch (error) {
    updateState = { ...updateState, status: "error", error: error.message };
    updateApplicationMenu();
    await appendDiagnosticLog("loader-update-install", error, {
      assetName: updateState.assetName,
      assetUrl: updateState.assetUrl
    });
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Open Release Page", "OK"],
      defaultId: 0,
      title: "Update Install Failed",
      message: "GDG could not install the update automatically.",
      detail: error.message
    }).then((result) => {
      if (result.response === 0) {
        void shell.openExternal(updateState.releaseUrl || LOADER_RELEASES_URL);
      }
    });
  }
}

async function downloadUrlToFile(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "GDG-Mod-Loader"
    }
  });

  if (!response.ok) {
    throw new Error(`Update download failed: ${response.status}`);
  }

  await fsp.rm(targetPath, { force: true }).catch(() => {});

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const writeStream = fs.createWriteStream(targetPath, { flags: "wx" });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!writeStream.write(Buffer.from(value))) {
          await once(writeStream, "drain");
        }
      }
    } catch (error) {
      writeStream.destroy();
      await fsp.rm(targetPath, { force: true }).catch(() => {});
      throw error;
    }

    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.once("error", reject);
    });
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(targetPath, buffer);
  }

  return targetPath;
}

async function deleteSelectedGdgCopy() {
  const config = await loadConfig();
  const gamePath = config.gamePath;

  if (!gamePath) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["OK"],
      title: "Delete GDG Copy",
      message: "No GDG copy is currently selected.",
      detail: "Choose or create a GDG copy before using this option."
    });
    return;
  }

  if (!isGdgCopyPath(gamePath) || !(await isSevenDaysGameRoot(gamePath))) {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["OK"],
      title: "Delete GDG Copy",
      message: "GDG refused to delete the selected folder.",
      detail: `This option only deletes folders named "7 Days To Die - GDG".\n\nSelected folder:\n${gamePath}`
    });
    return;
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Delete GDG Copy", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete GDG Copy",
    message: "Delete the selected GDG copy?",
    detail: `This permanently deletes:\n${gamePath}\n\nYour vanilla Steam install is not touched.`
  });

  if (confirmation.response !== 0) {
    return;
  }

  try {
    await fsp.rm(gamePath, { recursive: true, force: true });
    const nextConfig = await saveConfig({ gamePath: "" });
    const detected = await detectSevenDaysInstall();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("gdg:game-copy-deleted", { config: nextConfig, detected, deletedPath: gamePath });
    }

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["OK"],
      title: "Delete GDG Copy",
      message: "GDG copy deleted.",
      detail: gamePath
    });
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      buttons: ["OK"],
      title: "Delete GDG Copy Failed",
      message: "GDG could not delete the selected copy.",
      detail: error.message
    });
  }
}

async function purgeSelectedModsFolderFromMenu(mode = "backup") {
  const config = await loadConfig();

  if (!config.gamePath) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["OK"],
      title: "Purge Mods Folder",
      message: "No game folder is currently selected.",
      detail: "Choose or create a GDG game folder before using this option."
    });
    return;
  }

  try {
    const result = await purgeModsFolder({ ...config, mode }, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("gdg:sync-progress", progress);
      }
    });

    if (result.canceled) {
      return;
    }

    await dialog.showMessageBox(mainWindow, {
      type: result.ok ? "info" : "warning",
      buttons: ["OK"],
      title: "Purge Mods Folder",
      message: result.ok ? "Mods folder purged." : "Mods folder purge finished with issues.",
      detail: result.backupRoot
        ? `Moved mods to backup:\n${result.backupRoot}\n\nRun Check Server Mods, then Install Missing Mods to redownload.`
        : `${result.log.join("\n")}\n\nRun Check Server Mods, then Install Missing Mods to redownload.`
    });
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      buttons: ["OK"],
      title: "Purge Mods Folder Failed",
      message: "GDG could not purge the selected Mods folder.",
      detail: error.message
    });
  }
}

function normalizeVersion(version) {
  const match = String(version || "").trim().match(/\d+(?:\.\d+)*/);
  return match ? match[0] : "0.0.0";
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number(part || 0));
  const rightParts = normalizeVersion(right).split(".").map((part) => Number(part || 0));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

async function loadConfig() {
  const filePath = getConfigPath();
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return {
      ...getDefaultConfig(),
      ...JSON.parse(raw)
    };
  } catch {
    return getDefaultConfig();
  }
}

async function saveConfig(patch) {
  const current = await loadConfig();
  const next = {
    ...current,
    ...patch,
    configVersion: CONFIG_VERSION
  };

  await fsp.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fsp.writeFile(getConfigPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getDefaultConfig() {
  return {
    configVersion: CONFIG_VERSION,
    gameId: GAME_ID,
    gamePath: "",
    manifestInput: "",
    serverDirectoryInput: DEFAULT_SERVER_DIRECTORY,
    lastServerId: "gdg-test",
    launchWithEac: true
  };
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "gdg-mod-loader-config.json");
}

function getDiagnosticLogPath() {
  const basePath = app.isReady() ? app.getPath("userData") : path.join(os.homedir(), "AppData", "Roaming", "GDG Mod Loader");
  return path.join(basePath, "logs", "gdg-mod-loader.log");
}

async function appendDiagnosticLog(scope, error, details = {}) {
  try {
    const logPath = getDiagnosticLogPath();
    const entry = {
      at: new Date().toISOString(),
      scope,
      error: serializeError(error),
      details
    };
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    await fsp.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Diagnostics should never become the user's real error.
  }
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || ""
    };
  }

  return {
    name: "Error",
    message: String(error || "Unknown error"),
    stack: ""
  };
}

function sendIpcProgress(event, channel, payload) {
  try {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, payload);
    }
  } catch (error) {
    void appendDiagnosticLog("ipc-progress-send", error, { channel, payload });
  }
}

async function detectSevenDaysInstall() {
  const candidateRoots = [];
  if (process.env.GDG_7DTD_INSTALL) {
    candidateRoots.push({ path: process.env.GDG_7DTD_INSTALL, priority: -10 });
  }

  const steamAppsFolders = await detectSteamAppsFolders();

  for (const steamApps of steamAppsFolders) {
    candidateRoots.push({ path: path.join(steamApps, "common", "7 Days To Die"), priority: 0 });
    candidateRoots.push({ path: path.join(steamApps, "common", "7 Days to Die"), priority: 0 });
    candidateRoots.push({ path: path.join(steamApps, "common", "7 Days To Die Dedicated Server"), priority: 30 });
  }

  candidateRoots.push({ path: path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie"), priority: 80 });

  const validCandidates = [];
  for (const candidate of dedupeCandidates(candidateRoots)) {
    if (await isSevenDaysGameRoot(candidate.path)) {
      const isGdgCopy = isGdgCopyPath(candidate.path);
      validCandidates.push({
        ...candidate,
        isGdgCopy,
        rank: candidate.priority + (isGdgCopy ? 60 : 0)
      });
    }
  }

  validCandidates.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  const best = validCandidates[0];
  if (best) {
    return {
      found: true,
      gameId: GAME_ID,
      name: GAME_NAME,
      path: best.path,
      modsPath: path.join(best.path, "Mods"),
      isGdgCopy: best.isGdgCopy
    };
  }

  return {
    found: false,
    gameId: GAME_ID,
    name: GAME_NAME,
    path: "",
    modsPath: "",
    isGdgCopy: false
  };
}

async function detectSteamAppsFolders() {
  const steamApps = new Set();
  const bases = getSteamAppsCandidateFolders();

  for (const base of bases) {
    if (await exists(base)) {
      steamApps.add(base);
      const vdf = path.join(base, "libraryfolders.vdf");
      const libraryRoots = await parseSteamLibraries(vdf);
      for (const root of libraryRoots) {
        steamApps.add(path.join(root, "steamapps"));
      }
    }
  }

  return [...steamApps];
}

function getSteamAppsCandidateFolders() {
  const candidates = new Set([
    "C:\\Program Files (x86)\\Steam\\steamapps",
    "C:\\Program Files\\Steam\\steamapps"
  ]);

  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      candidates.add(path.join(drive, "SteamLibrary", "steamapps"));
      candidates.add(path.join(drive, "Steam", "steamapps"));
      candidates.add(path.join(drive, "Games", "SteamLibrary", "steamapps"));
      candidates.add(path.join(drive, "Program Files (x86)", "Steam", "steamapps"));
      candidates.add(path.join(drive, "Program Files", "Steam", "steamapps"));
    }
  }

  return [...candidates];
}

async function parseSteamLibraries(vdfPath) {
  if (!(await exists(vdfPath))) {
    return [];
  }

  const text = await fsp.readFile(vdfPath, "utf8");
  const libraries = new Set();
  const matches = text.matchAll(/"path"\s+"([^"]+)"/gi);

  for (const match of matches) {
    libraries.add(match[1].replace(/\\\\/g, "\\"));
  }

  return [...libraries];
}

async function isSevenDaysGameRoot(candidatePath) {
  if (!candidatePath || !(await exists(candidatePath))) {
    return false;
  }

  const requiredSignals = [
    path.join(candidatePath, "7DaysToDie.exe"),
    path.join(candidatePath, "7DaysToDie_EAC.exe"),
    path.join(candidatePath, "7DaysToDie_Data"),
    path.join(candidatePath, "7DaysToDieServer.exe")
  ];

  for (const signal of requiredSignals) {
    if (await exists(signal)) {
      return true;
    }
  }

  return false;
}

async function cloneGameInstall(payload = {}, onProgress = () => {}) {
  reportCloneProgress(onProgress, {
    phase: "preparing",
    message: "Preparing GDG copy.",
    current: 0,
    total: 0,
    percent: 0
  });

  if (!payload.sourcePath) {
    throw new Error("A detected 7 Days to Die folder is required before creating a GDG copy.");
  }

  const sourcePath = path.resolve(String(payload.sourcePath));
  const folderName = sanitizeFolderName(payload.folderName || "7 Days To Die - GDG");
  const targetPath = path.join(path.dirname(sourcePath), folderName);

  if (!(await isSevenDaysGameRoot(sourcePath))) {
    throw new Error("The detected folder does not look like a 7 Days to Die install.");
  }

  if (sourcePath.toLowerCase() === path.resolve(targetPath).toLowerCase()) {
    throw new Error("The GDG copy needs to be separate from the detected game folder.");
  }

  let created = false;
  if (await exists(targetPath)) {
    if (!(await isSevenDaysGameRoot(targetPath))) {
      throw new Error(`The target folder already exists and is not a 7 Days to Die install: ${targetPath}`);
    }
    reportCloneProgress(onProgress, {
      phase: "complete",
      message: "Existing GDG copy is ready.",
      current: 1,
      total: 1,
      percent: 100
    });
  } else {
    await copyDirectoryWithProgress(sourcePath, targetPath, onProgress);
    created = true;
  }

  await fsp.mkdir(path.join(targetPath, "Mods"), { recursive: true });

  let shortcutPath = "";
  let shortcutError = "";
  if (payload.createShortcut) {
    try {
      reportCloneProgress(onProgress, {
        phase: "shortcut",
        message: "Creating desktop shortcut.",
        current: 1,
        total: 1,
        percent: 99
      });
      shortcutPath = await createGameShortcut(targetPath, folderName);
    } catch (error) {
      shortcutError = error.message;
    }
  }

  reportCloneProgress(onProgress, {
    phase: "complete",
    message: created ? "GDG copy created." : "GDG copy selected.",
    current: 1,
    total: 1,
    percent: 100
  });

  return {
    ok: true,
    sourcePath,
    targetPath,
    created,
    shortcutPath,
    ...(shortcutError ? { shortcutError } : {})
  };
}

async function copyDirectoryWithProgress(sourceRoot, targetRoot, onProgress) {
  reportCloneProgress(onProgress, {
    phase: "scanning",
    message: "Scanning game files. Existing mods will not be copied.",
    current: 0,
    total: 0,
    percent: 1
  });

  const plan = await buildCopyPlan(sourceRoot, targetRoot);
  let copiedFiles = 0;
  let copiedBytes = 0;

  await fsp.mkdir(targetRoot, { recursive: true });

  if (plan.files.length === 0) {
    reportCloneProgress(onProgress, {
      phase: "copying",
      message: "No files needed copying.",
      current: 0,
      total: 0,
      percent: 100,
      bytesReceived: 0,
      bytesTotal: 0
    });
    return;
  }

  for (const directory of plan.directories) {
    await fsp.mkdir(directory, { recursive: true });
  }

  for (const file of plan.files) {
    await fsp.mkdir(path.dirname(file.to), { recursive: true });
    await copyFileWithProgress(file.from, file.to, (chunkBytes) => {
      copiedBytes += chunkBytes;
      reportCloneProgress(onProgress, {
        phase: "copying",
        message: `Copying ${path.basename(file.from)}.`,
        current: Math.min(copiedFiles + 1, plan.files.length),
        total: plan.files.length,
        bytesReceived: copiedBytes,
        bytesTotal: plan.totalBytes
      });
    });
    copiedFiles += 1;
    reportCloneProgress(onProgress, {
      phase: "copying",
      message: `Copied ${path.basename(file.from)}.`,
      current: copiedFiles,
      total: plan.files.length,
      bytesReceived: copiedBytes,
      bytesTotal: plan.totalBytes
    });
  }
}

async function buildCopyPlan(sourceRoot, targetRoot) {
  const directories = [];
  const files = [];
  let totalBytes = 0;

  async function visit(currentSource) {
    const entries = await fsp.readdir(currentSource, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath);
      if (isExcludedGameCopyPath(relativePath)) {
        continue;
      }
      const targetPath = path.join(targetRoot, relativePath);

      if (entry.isDirectory()) {
        directories.push(targetPath);
        await visit(sourcePath);
      } else if (entry.isFile()) {
        const stats = await fsp.stat(sourcePath);
        files.push({
          from: sourcePath,
          to: targetPath,
          size: stats.size
        });
        totalBytes += stats.size;
      }
    }
  }

  await visit(sourceRoot);
  return { directories, files, totalBytes };
}

function isExcludedGameCopyPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").toLowerCase();
  return normalized === "mods" ||
    normalized.startsWith("mods/") ||
    normalized === ".gdg-mod-loader" ||
    normalized.startsWith(".gdg-mod-loader/");
}

async function copyFileWithProgress(sourcePath, targetPath, onChunk) {
  const readStream = fs.createReadStream(sourcePath);
  readStream.on("data", (chunk) => onChunk(chunk.length));
  await pipeline(readStream, fs.createWriteStream(targetPath, { flags: "wx" }));
}

async function createGameShortcut(gamePath, shortcutName) {
  if (process.platform !== "win32" || typeof shell.writeShortcutLink !== "function") {
    throw new Error("Desktop shortcuts are currently supported on Windows.");
  }

  const target = await findSevenDaysExecutable(gamePath, { eacEnabled: false });
  const shortcutPath = path.join(app.getPath("desktop"), `${sanitizeFolderName(shortcutName)}.lnk`);
  const created = shell.writeShortcutLink(shortcutPath, {
    target,
    cwd: gamePath,
    description: "Launch 7 Days to Die with the GDG mod setup",
    icon: target
  });

  if (!created) {
    throw new Error("Desktop shortcut could not be created.");
  }

  return shortcutPath;
}

async function findSevenDaysExecutable(gamePath, options = {}) {
  const eacEnabled = Boolean(options.eacEnabled);
  const eacCandidates = [
    path.join(gamePath, "7DaysToDie_EAC.exe")
  ];
  const directCandidates = [
    path.join(gamePath, "7DaysToDie.exe"),
    path.join(gamePath, "7DaysToDieServer.exe")
  ];
  const candidates = eacEnabled ? [...eacCandidates, ...directCandidates] : [...directCandidates, ...eacCandidates];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error("No 7 Days to Die executable was found.");
}

async function launchGame(payload = {}) {
  if (!payload.gamePath) {
    throw new Error("Select a 7 Days to Die folder before launching.");
  }

  const gamePath = path.resolve(String(payload.gamePath));
  if (!(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("That folder does not look like a 7 Days to Die install.");
  }

  const eacEnabled = Boolean(payload.eacEnabled);
  const executable = await findSevenDaysExecutable(gamePath, { eacEnabled });
  const actualEacEnabled = path.basename(executable).toLowerCase().includes("_eac");
  const child = spawn(executable, [], {
    cwd: gamePath,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });

  child.unref();

  return {
    ok: true,
    gamePath,
    executable,
    requestedEac: eacEnabled,
    eacEnabled: actualEacEnabled
  };
}

async function scanMods(gamePath, options = {}) {
  if (!gamePath) {
    throw new Error("Game path is required.");
  }

  const modsPath = path.join(gamePath, "Mods");
  if (!(await exists(modsPath))) {
    return {
      gamePath,
      modsPath,
      exists: false,
      mods: []
    };
  }

  const entries = await fsp.readdir(modsPath, { withFileTypes: true });
  const mods = [];
  const installState = await readInstallState(gamePath);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const folderPath = path.join(modsPath, entry.name);
    const modInfoPath = path.join(folderPath, "ModInfo.xml");
    if (!(await exists(modInfoPath))) {
      continue;
    }

    const xml = await fsp.readFile(modInfoPath, "utf8");
    const info = parseModInfo(xml);
    const dllFiles = await findDllFiles(folderPath);
    const managedRecord = installState.installedMods[getManagedModKey(entry.name)] || null;
    const mod = {
      folderName: entry.name,
      folderPath,
      name: info.name || entry.name,
      displayName: info.displayName || info.name || entry.name,
      author: info.author || "",
      version: info.version || "",
      description: info.description || "",
      hasDll: dllFiles.length > 0,
      dllFiles,
      managed: Boolean(managedRecord),
      managedRecord,
      serverOnly: isClientBlockedServerOnlyMod({
        id: entry.name,
        folderName: entry.name,
        name: info.name || entry.name,
        displayName: info.displayName || info.name || entry.name
      })
    };

    if (options.hash) {
      mod.folderSha256 = await hashDirectory(folderPath);
    }

    mods.push(mod);
  }

  mods.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    gamePath,
    modsPath,
    exists: true,
    mods
  };
}

async function findDllFiles(root) {
  const files = [];
  await collectDllFiles(root, root, files);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function collectDllFiles(root, current, files) {
  const entries = await fsp.readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectDllFiles(root, fullPath, files);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".dll") {
      files.push(path.relative(root, fullPath).replace(/\\/g, "/"));
    }
  }
}

function parseModInfo(xml) {
  return {
    name: getModInfoValue(xml, "Name"),
    displayName: getModInfoValue(xml, "DisplayName"),
    author: getModInfoValue(xml, "Author"),
    version: getModInfoValue(xml, "Version"),
    description: getModInfoValue(xml, "Description")
  };
}

function getModInfoValue(xml, tagName) {
  const valueAttribute = new RegExp(`<${tagName}\\s+[^>]*value=["']([^"']+)["']`, "i").exec(xml);
  if (valueAttribute) {
    return decodeXml(valueAttribute[1]).trim();
  }

  const nodeValue = new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i").exec(xml);
  if (nodeValue) {
    return decodeXml(nodeValue[1]).trim();
  }

  return "";
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function previewSync(payload) {
  const { gamePath, manifestInput } = payload;

  if (!gamePath) {
    throw new Error("Select a 7 Days to Die folder first.");
  }

  if (!(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("That folder does not look like a 7 Days to Die install.");
  }

  if (!manifestInput) {
    throw new Error("Add a server manifest URL or file path.");
  }

  const manifest = await loadManifest(manifestInput);
  validateManifest(manifest);

  const gameCompatibility = compareGameCompatibility(manifest, await getGameVersionInfo(gamePath));
  const local = await scanMods(gamePath, { hash: true });
  const plan = buildSyncPlan(manifest, local.mods);
  const sizeSummary = getManifestSizeSummary(manifest);
  const installState = await readInstallState(gamePath);
  const clientManifestFolders = new Set(
    manifest.mods
      .filter(isClientInstallableManifestMod)
      .map((mod) => String(mod.folderName || mod.id || mod.name).toLowerCase())
  );
  const skippedServerOnly = plan.filter((item) => item.action === "blocked" && getClientBlockedReason(item.mod));
  const managedInstalled = local.mods.filter((mod) => mod.managed);
  const managedExtra = managedInstalled.filter((mod) => !clientManifestFolders.has(mod.folderName.toLowerCase()));
  const serverOnlyInstalled = local.mods.filter((mod) => mod.serverOnly);

  return {
    manifest,
    local,
    gameCompatibility,
    plan,
    summary: summarizePlan(plan),
    installState,
    skippedServerOnly,
    managedSummary: {
      installed: managedInstalled.length,
      extra: managedExtra.length,
      serverOnlyInstalled: serverOnlyInstalled.length,
      operationCount: installState.operations.length
    },
    ...sizeSummary
  };
}

async function applySync(payload, onProgress = () => {}) {
  const preview = await previewSync(payload);
  const repairMode = Boolean(payload?.repair);
  if (preview.gameCompatibility.checked && !preview.gameCompatibility.ok) {
    throw new Error(`${preview.gameCompatibility.reason} Update 7 Days to Die in Steam before installing GDG mods.`);
  }

  const spaceRequirement = getSyncSpaceRequirement(preview, { repairMode });
  if (spaceRequirement.known && spaceRequirement.bytes > 0) {
    const diskSpace = await getDiskSpace(payload.gamePath);
    if (diskSpace.freeBytes < spaceRequirement.bytes) {
      throw new Error(
        `Not enough free space on the selected game drive. GDG needs about ${formatBytes(spaceRequirement.bytes)} free for downloads, extraction, and backups, but only ${formatBytes(diskSpace.freeBytes)} is available.`
      );
    }
  }

  const modsPath = path.join(payload.gamePath, "Mods");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workRoot = getSyncWorkRoot(payload.gamePath);
  const backupRoot = path.join(workRoot, "backups", timestamp);
  const stagingRoot = path.join(workRoot, "staging", timestamp);
  const log = [];
  const failures = [];

  await fsp.mkdir(modsPath, { recursive: true });
  await fsp.mkdir(stagingRoot, { recursive: true });
  log.push(`Using sync workspace: ${workRoot}`);

  const actionable = getActionableSyncItems(preview, { repairMode });
  const total = actionable.length;

  reportSyncProgress(onProgress, {
    phase: total > 0 ? "preparing" : "complete",
    message: total > 0
      ? `${repairMode ? "Preparing repair for" : "Preparing"} ${total} mod${total === 1 ? "" : "s"}.`
      : "Everything is already in sync.",
    current: 0,
    total
  });

  for (const [index, item] of actionable.entries()) {
    const current = index + 1;
    const modName = item.mod.name || item.mod.id;
    const modKey = getProgressModKey(item.mod);
    const tempPaths = [];

    try {
      log.push(`${repairMode ? "Repairing" : "Preparing"} ${modName}.`);
      reportSyncProgress(onProgress, {
        phase: "downloading",
        message: repairMode ? `Repairing ${modName}: downloading package.` : `Downloading ${modName}.`,
        modName,
        modKey,
        current,
        total
      });
      const archivePath = await downloadModArchive(item.mod, stagingRoot, (download) => {
        reportSyncProgress(onProgress, {
          phase: "downloading",
          message: repairMode ? `Repairing ${modName}: downloading package.` : `Downloading ${modName}.`,
          modName,
          modKey,
          current,
          total,
          bytesReceived: download.bytesReceived,
          bytesTotal: download.bytesTotal
        });
      });
      tempPaths.push(archivePath);
      reportSyncProgress(onProgress, {
        phase: "extracting",
        message: repairMode ? `Repairing ${modName}: unpacking package.` : `Unpacking ${modName}.`,
        modName,
        modKey,
        current,
        total
      });
      const sourceFolder = await extractModArchive(archivePath, stagingRoot, item.mod);
      tempPaths.push(path.dirname(sourceFolder));
      const folderName = sanitizeFolderName(item.mod.folderName || path.basename(sourceFolder));
      const targetFolder = path.join(modsPath, folderName);

      if (await exists(targetFolder)) {
        reportSyncProgress(onProgress, {
          phase: "backing-up",
          message: repairMode ? `Repairing ${folderName}: saving backup.` : `Backing up ${folderName}.`,
          modName,
          modKey,
          current,
          total
        });
        await fsp.mkdir(backupRoot, { recursive: true });
        const backupTarget = path.join(backupRoot, folderName);
        await fsp.cp(targetFolder, backupTarget, { recursive: true });
        await fsp.rm(targetFolder, { recursive: true, force: true });
        log.push(`Backed up ${folderName}.`);
      }

      reportSyncProgress(onProgress, {
        phase: "installing",
        message: repairMode ? `Repairing ${folderName}: installing clean copy.` : `Installing ${folderName}.`,
        modName,
        modKey,
        current,
        total
      });
      await fsp.cp(sourceFolder, targetFolder, { recursive: true });
      log.push(`${getSyncActionVerb(item, repairMode)} ${folderName}.`);
      await markManagedModInstalled(payload.gamePath, item, folderName, getSyncActionVerb(item, repairMode), preview.manifest);
      reportSyncProgress(onProgress, {
        phase: "installed",
        message: `${getSyncActionVerb(item, repairMode)} ${folderName}.`,
        modName,
        modKey,
        current,
        total
      });
    } catch (error) {
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${modName}: ${error.message}`,
        modName,
        modKey,
        current,
        total
      });
      log.push(`Failed ${modName}: ${error.message}`);
      failures.push({ modName, error: error.message });
      await appendDiagnosticLog("gdg:apply-sync-mod", error, {
        modName,
        modId: item.mod.id,
        source: item.mod.source?.url || ""
      });
    } finally {
      await cleanupSyncTempPaths(tempPaths);
    }
  }

  reportSyncProgress(onProgress, {
    phase: "verifying",
    message: "Checking installed mods.",
    current: total,
    total
  });

  let nextPreview = preview;
  try {
    nextPreview = await previewSync(payload);
  } catch (error) {
    log.push(`Failed final verification: ${error.message}`);
    failures.push({ modName: "Final verification", error: error.message });
  }

  if (failures.length > 0) {
    reportSyncProgress(onProgress, {
      phase: "failed",
      message: `Sync finished with ${failures.length} failed install${failures.length === 1 ? "" : "s"}.`,
      current: total - failures.length,
      total
    });
  } else {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "Sync complete.",
      current: total,
      total
    });
  }

  await recordInstallOperation(payload.gamePath, {
    type: repairMode ? "repair-sync" : "sync",
    mode: repairMode ? "repair" : "install",
    manifestInput: payload.manifestInput || "",
    serverId: preview.manifest?.server?.id || "",
    serverName: preview.manifest?.server?.name || "",
    affectedCount: total,
    failedCount: failures.length,
    backupRoot: (await exists(backupRoot)) ? backupRoot : ""
  });

  return {
    ok: failures.length === 0,
    failedCount: failures.length,
    failures,
    backupRoot: (await exists(backupRoot)) ? backupRoot : "",
    diagnosticLogPath: failures.length > 0 ? getDiagnosticLogPath() : "",
    log,
    preview: nextPreview
  };
}

function getSyncWorkRoot(gamePath) {
  return path.join(path.resolve(String(gamePath || os.homedir())), ".gdg-mod-loader");
}

function getLegacySyncWorkRoot(gamePath) {
  return path.join(path.dirname(path.resolve(String(gamePath || os.homedir()))), ".gdg-mod-loader");
}

function getSyncWorkRoots(gamePath) {
  return dedupe([getSyncWorkRoot(gamePath), getLegacySyncWorkRoot(gamePath)]);
}

function getInstallStatePath(gamePath) {
  return path.join(getSyncWorkRoot(gamePath), "install-state.json");
}

function getDefaultInstallState(gamePath) {
  return {
    version: INSTALL_STATE_VERSION,
    gamePath: path.resolve(String(gamePath || "")),
    updatedAt: "",
    installedMods: {},
    operations: []
  };
}

async function readInstallState(gamePath) {
  const statePath = getInstallStatePath(gamePath);
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    return normalizeInstallState(JSON.parse(raw), gamePath);
  } catch {
    return getDefaultInstallState(gamePath);
  }
}

async function writeInstallState(gamePath, state) {
  const normalized = normalizeInstallState(state, gamePath);
  normalized.updatedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(getInstallStatePath(gamePath)), { recursive: true });
  await fsp.writeFile(getInstallStatePath(gamePath), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeInstallState(state, gamePath) {
  const normalized = {
    ...getDefaultInstallState(gamePath),
    ...(state && typeof state === "object" ? state : {})
  };

  if (!normalized.installedMods || typeof normalized.installedMods !== "object" || Array.isArray(normalized.installedMods)) {
    normalized.installedMods = {};
  }

  normalized.operations = Array.isArray(normalized.operations)
    ? normalized.operations.filter((operation) => operation && typeof operation === "object").slice(-OPERATION_HISTORY_LIMIT)
    : [];

  return normalized;
}

function getManagedModKey(folderName) {
  return String(folderName || "").trim().toLowerCase();
}

async function markManagedModInstalled(gamePath, item, folderName, action, manifest) {
  const key = getManagedModKey(folderName);
  if (!key) {
    return;
  }

  const state = await readInstallState(gamePath);
  const now = new Date().toISOString();
  const current = state.installedMods[key] || {};
  state.installedMods[key] = {
    ...current,
    folderName,
    modId: item.mod.id || "",
    name: item.mod.name || folderName,
    version: item.mod.version || "",
    folderSha256: item.mod.folderSha256 || "",
    sourceUrl: item.mod.source?.url || "",
    audience: getModAudience(item.mod),
    serverId: manifest?.server?.id || "",
    serverName: manifest?.server?.name || "",
    installedAt: current.installedAt || now,
    updatedAt: now,
    lastAction: action
  };
  await writeInstallState(gamePath, state);
}

async function removeManagedModRecords(gamePath, folderNames) {
  const names = (folderNames || []).map(getManagedModKey).filter(Boolean);
  if (names.length === 0) {
    return;
  }

  const state = await readInstallState(gamePath);
  let changed = false;
  for (const name of names) {
    if (state.installedMods[name]) {
      delete state.installedMods[name];
      changed = true;
    }
  }

  if (changed) {
    await writeInstallState(gamePath, state);
  }
}

async function recordInstallOperation(gamePath, operation) {
  if (!gamePath) {
    return;
  }

  const state = await readInstallState(gamePath);
  state.operations.push({
    at: new Date().toISOString(),
    ...operation
  });
  state.operations = state.operations.slice(-OPERATION_HISTORY_LIMIT);
  await writeInstallState(gamePath, state);
}

async function cleanupSyncTempPaths(tempPaths) {
  for (const tempPath of [...new Set(tempPaths.filter(Boolean))].reverse()) {
    await fsp.rm(tempPath, { recursive: true, force: true }).catch(() => {});
  }
}

async function createFailedApplyResult(payload, error, onProgress = () => {}) {
  const message = error?.message || String(error || "Unknown sync error");
  let preview = null;

  reportSyncProgress(onProgress, {
    phase: "failed",
    message: `Sync failed: ${message}`,
    current: 0,
    total: 1
  });

  try {
    if (payload?.gamePath && payload?.manifestInput) {
      preview = await previewSync(payload);
    }
  } catch (previewError) {
    await appendDiagnosticLog("gdg:apply-sync-preview-after-failure", previewError, {
      gamePath: payload?.gamePath,
      manifestInput: payload?.manifestInput
    });
  }

  return {
    ok: false,
    failedCount: 1,
    failures: [{ modName: "Sync", error: message }],
    backupRoot: "",
    diagnosticLogPath: getDiagnosticLogPath(),
    log: [
      `Sync failed: ${message}`,
      `Diagnostic log: ${getDiagnosticLogPath()}`
    ],
    preview
  };
}

async function cleanLocalMods(payload, onProgress = () => {}) {
  const preview = await previewSync(payload);
  const modsPath = path.resolve(payload.gamePath, "Mods");
  const localOnly = preview.plan.filter((item) => item.action === "keep" && item.installed?.folderPath);
  const mode = payload.mode === "delete" ? "delete" : "backup";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getSyncWorkRoot(payload.gamePath), "backups", timestamp, "local-only-mods");
  const log = [];
  const failures = [];
  const removedManagedFolders = [];

  if (localOnly.length === 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "No local-only mods found.",
      current: 1,
      total: 1
    });

    return {
      ok: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      log: ["No local-only mods found."],
      preview
    };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: [mode === "delete" ? "Delete Permanently" : "Move to Backup", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Clean Local-Only Mods",
    message:
      mode === "delete"
        ? `Permanently delete ${localOnly.length} local-only mod${localOnly.length === 1 ? "" : "s"}?`
        : `Move ${localOnly.length} local-only mod${localOnly.length === 1 ? "" : "s"} out of the selected Mods folder?`,
    detail:
      mode === "delete"
        ? "These extra mods are installed on this PC but are not part of the selected server package. This does not create a backup."
        : `GDG will move these extra mods into a backup folder:\n${backupRoot}\n\nThis does not delete them permanently.`
  });

  if (confirmation.response !== 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "Local-only cleanup canceled.",
      current: 1,
      total: 1
    });

    return {
      ok: false,
      canceled: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      log: ["Clean local-only mods canceled."],
      preview
    };
  }

  if (mode === "backup") {
    await fsp.mkdir(backupRoot, { recursive: true });
  }

  reportSyncProgress(onProgress, {
    phase: "preparing",
    message: mode === "delete" ? `Preparing to delete ${localOnly.length} local-only mod${localOnly.length === 1 ? "" : "s"}.` : `Preparing to move ${localOnly.length} local-only mod${localOnly.length === 1 ? "" : "s"} to backup.`,
    current: 0,
    total: localOnly.length
  });

  for (const item of localOnly) {
    const current = log.length + failures.length + 1;
    const folderName = sanitizeFolderName(item.installed.folderName);
    const sourcePath = path.resolve(item.installed.folderPath);
    const backupTarget = mode === "backup" ? path.join(backupRoot, folderName) : "";

    try {
      if (!sourcePath.toLowerCase().startsWith(`${modsPath.toLowerCase()}${path.sep}`)) {
        throw new Error("Mod folder is outside the selected Mods folder.");
      }

      if (mode === "backup") {
        reportSyncProgress(onProgress, {
          phase: "backing-up",
          message: `Moving ${folderName} to backup.`,
          modName: item.mod.name || folderName,
          modKey: getProgressModKey(item.mod),
          current,
          total: localOnly.length
        });
        await fsp.cp(sourcePath, backupTarget, { recursive: true });
      } else {
        reportSyncProgress(onProgress, {
          phase: "installing",
          message: `Deleting ${folderName}.`,
          modName: item.mod.name || folderName,
          modKey: getProgressModKey(item.mod),
          current,
          total: localOnly.length
        });
      }
      await fsp.rm(sourcePath, { recursive: true, force: true });
      removedManagedFolders.push(folderName);
      log.push(mode === "delete" ? `Deleted ${folderName}.` : `Moved ${folderName} to backup.`);
      reportSyncProgress(onProgress, {
        phase: "installed",
        message: mode === "delete" ? `Deleted ${folderName}.` : `Moved ${folderName} to backup.`,
        modName: item.mod.name || folderName,
        modKey: getProgressModKey(item.mod),
        current,
        total: localOnly.length
      });
    } catch (error) {
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${folderName}: ${error.message}`,
        modName: item.mod.name || folderName,
        modKey: getProgressModKey(item.mod),
        current,
        total: localOnly.length
      });
      log.push(`Failed ${folderName}: ${error.message}`);
      failures.push({ modName: item.mod.name || folderName, error: error.message });
    }
  }

  reportSyncProgress(onProgress, {
    phase: "verifying",
    message: "Checking local-only cleanup.",
    current: localOnly.length,
    total: localOnly.length
  });
  let nextPreview = preview;
  try {
    nextPreview = await previewSync(payload);
  } catch (error) {
    log.push(`Failed final verification: ${error.message}`);
    failures.push({ modName: "Final verification", error: error.message });
    await appendDiagnosticLog("gdg:clean-local-mods-final-preview", error, {
      gamePath: payload?.gamePath,
      manifestInput: payload?.manifestInput
    });
  }

  reportSyncProgress(onProgress, {
    phase: failures.length > 0 ? "failed" : "complete",
    message:
      failures.length > 0
        ? `Local-only cleanup finished with ${failures.length} failure${failures.length === 1 ? "" : "s"}.`
        : mode === "delete"
          ? "Local-only mods deleted."
          : "Local-only mods moved to backup.",
    current: localOnly.length - failures.length,
    total: localOnly.length
  });

  await removeManagedModRecords(payload.gamePath, removedManagedFolders);
  await recordInstallOperation(payload.gamePath, {
    type: "clean-local-only",
    mode,
    manifestInput: payload.manifestInput || "",
    affectedCount: removedManagedFolders.length,
    failedCount: failures.length,
    backupRoot: mode === "backup" ? backupRoot : ""
  });

  return {
    ok: failures.length === 0,
    failedCount: failures.length,
    failures,
    backupRoot: mode === "backup" ? backupRoot : "",
    diagnosticLogPath: failures.length > 0 ? getDiagnosticLogPath() : "",
    log,
    preview: nextPreview
  };
}

async function purgeModsFolder(payload, onProgress = () => {}) {
  const rawGamePath = String(payload?.gamePath || "").trim();

  if (!rawGamePath) {
    throw new Error("Select a 7 Days to Die folder first.");
  }

  const gamePath = path.resolve(rawGamePath);

  if (!(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("That folder does not look like a 7 Days to Die install.");
  }

  const modsPath = path.join(gamePath, "Mods");
  await fsp.mkdir(modsPath, { recursive: true });

  const entries = await fsp.readdir(modsPath, { withFileTypes: true });
  const purgeEntries = entries.filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink());
  const mode = payload?.mode === "delete" ? "delete" : "backup";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getSyncWorkRoot(gamePath), "backups", timestamp, "purged-mods");
  const log = [];
  const failures = [];
  const purgedFolderNames = [];

  if (purgeEntries.length === 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "Mods folder is already empty.",
      current: 1,
      total: 1
    });

    return {
      ok: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: ["Mods folder is already empty."],
      preview: await previewAfterOptionalPurge(payload, log)
    };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: [mode === "delete" ? "Delete Permanently" : "Move to Backup", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Purge Mods Folder",
    message:
      mode === "delete"
        ? `Permanently delete ${purgeEntries.length} item${purgeEntries.length === 1 ? "" : "s"} from the selected Mods folder?`
        : `Move ${purgeEntries.length} item${purgeEntries.length === 1 ? "" : "s"} out of the selected Mods folder?`,
    detail:
      mode === "delete"
        ? `GDG will permanently remove all immediate contents of:\n${modsPath}\n\nThis does not create a backup. The selected game copy is not deleted. Run Check Server Mods, then Install Missing Mods to redownload everything cleanly.`
        : `GDG will empty this folder:\n${modsPath}\n\nBackup location:\n${backupRoot}\n\nThe selected game copy is not deleted. Run Check Server Mods, then Install Missing Mods to redownload everything cleanly.`
  });

  if (confirmation.response !== 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "Mods folder purge canceled.",
      current: 1,
      total: 1
    });

    return {
      ok: false,
      canceled: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: ["Mods folder purge canceled."],
      preview: null
    };
  }

  if (mode === "backup") {
    await fsp.mkdir(backupRoot, { recursive: true });
  }

  reportSyncProgress(onProgress, {
    phase: "preparing",
    message:
      mode === "delete"
        ? `Preparing to delete ${purgeEntries.length} Mods folder item${purgeEntries.length === 1 ? "" : "s"}.`
        : `Preparing to move ${purgeEntries.length} Mods folder item${purgeEntries.length === 1 ? "" : "s"} to backup.`,
    current: 0,
    total: purgeEntries.length
  });

  const usedTargets = new Set();
  for (const [index, entry] of purgeEntries.entries()) {
    const current = index + 1;
    const sourcePath = path.resolve(modsPath, entry.name);
    const backupTarget = mode === "backup" ? getUniqueBackupTarget(backupRoot, sanitizeFolderName(entry.name), usedTargets) : "";

    try {
      if (!sourcePath.toLowerCase().startsWith(`${modsPath.toLowerCase()}${path.sep}`)) {
        throw new Error("Mods folder item is outside the selected Mods folder.");
      }

      reportSyncProgress(onProgress, {
        phase: mode === "delete" ? "installing" : "backing-up",
        message: mode === "delete" ? `Deleting ${entry.name}.` : `Moving ${entry.name} to backup.`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: purgeEntries.length
      });

      if (mode === "delete") {
        await fsp.rm(sourcePath, { recursive: true, force: true });
        log.push(`Deleted ${entry.name}.`);
      } else {
        await movePathToBackup(sourcePath, backupTarget);
        log.push(`Moved ${entry.name} to backup.`);
      }
      purgedFolderNames.push(entry.name);

      reportSyncProgress(onProgress, {
        phase: "installed",
        message: mode === "delete" ? `Deleted ${entry.name}.` : `Moved ${entry.name} to backup.`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: purgeEntries.length
      });
    } catch (error) {
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${entry.name}: ${error.message}`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: purgeEntries.length
      });
      log.push(`Failed ${entry.name}: ${error.message}`);
      failures.push({ modName: entry.name, error: error.message });
    }
  }

  reportSyncProgress(onProgress, {
    phase: "verifying",
    message: "Checking purged Mods folder.",
    current: purgeEntries.length,
    total: purgeEntries.length
  });

  const nextScan = await scanMods(gamePath, { hash: false });
  log.push(`${nextScan.mods.length} mod${nextScan.mods.length === 1 ? "" : "s"} remain after purge.`);
  const nextPreview = await previewAfterOptionalPurge(payload, log);
  await removeManagedModRecords(gamePath, purgedFolderNames);
  await recordInstallOperation(gamePath, {
    type: "purge-mods",
    mode,
    manifestInput: payload.manifestInput || "",
    affectedCount: purgedFolderNames.length,
    failedCount: failures.length,
    backupRoot: mode === "backup" && purgedFolderNames.length > 0 ? backupRoot : ""
  });

  reportSyncProgress(onProgress, {
    phase: failures.length > 0 ? "failed" : "complete",
    message:
      failures.length > 0
        ? `Mods folder purge finished with ${failures.length} failure${failures.length === 1 ? "" : "s"}.`
        : mode === "delete"
          ? "Mods folder deleted. Run Install Missing Mods to redownload."
          : "Mods folder moved to backup. Run Install Missing Mods to redownload.",
    current: purgeEntries.length - failures.length,
    total: purgeEntries.length
  });

  return {
    ok: failures.length === 0,
    failedCount: failures.length,
    failures,
    backupRoot: mode === "backup" && failures.length < purgeEntries.length ? backupRoot : "",
    diagnosticLogPath: failures.length > 0 ? getDiagnosticLogPath() : "",
    log,
    preview: nextPreview
  };
}

async function previewAfterOptionalPurge(payload, log) {
  if (!payload?.manifestInput) {
    return null;
  }

  try {
    return await previewSync(payload);
  } catch (error) {
    log.push(`Server mod check after purge failed: ${error.message}`);
    await appendDiagnosticLog("gdg:purge-mods-folder-preview", error, {
      gamePath: payload?.gamePath,
      manifestInput: payload?.manifestInput
    });
    return null;
  }
}

async function movePathToBackup(sourcePath, backupTarget) {
  try {
    await fsp.rename(sourcePath, backupTarget);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }

    await fsp.cp(sourcePath, backupTarget, { recursive: true, force: false });
    await fsp.rm(sourcePath, { recursive: true, force: true });
  }
}

function getUniqueBackupTarget(backupRoot, folderName, usedTargets) {
  const parsed = path.parse(folderName || "mod");
  let targetName = folderName || "mod";
  let suffix = 1;
  while (usedTargets.has(targetName.toLowerCase())) {
    targetName = `${parsed.name || "mod"}-${suffix}${parsed.ext || ""}`;
    suffix += 1;
  }
  usedTargets.add(targetName.toLowerCase());
  return path.join(backupRoot, targetName);
}

async function cleanManagedMods(payload, onProgress = () => {}) {
  const gamePath = path.resolve(String(payload?.gamePath || ""));
  if (!gamePath || !(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("Select a valid 7 Days to Die folder first.");
  }

  const mode = payload?.mode === "delete" ? "delete" : "backup";
  const scope = payload?.scope === "extra" ? "extra" : "all";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getSyncWorkRoot(gamePath), "backups", timestamp, scope === "extra" ? "extra-managed-mods" : "managed-mods");
  const modsPath = path.join(gamePath, "Mods");
  let preview = null;
  let local = await scanMods(gamePath, { hash: false });
  const log = [];
  const failures = [];
  const removedManagedFolders = [];

  if (payload?.manifestInput) {
    preview = await previewSync(payload);
    local = preview.local;
  }

  const manifestFolders = new Set(
    (preview?.manifest?.mods || [])
      .filter(isClientInstallableManifestMod)
      .map((mod) => String(mod.folderName || mod.id || mod.name).toLowerCase())
  );
  const targets = local.mods.filter((mod) => {
    const isManagedOrServerOnly = Boolean(mod.managed || mod.serverOnly);
    if (!isManagedOrServerOnly) {
      return false;
    }

    if (scope === "all") {
      return true;
    }

    return mod.serverOnly || !manifestFolders.has(mod.folderName.toLowerCase());
  });

  if (targets.length === 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: scope === "extra" ? "No extra GDG-managed mods found." : "No GDG-managed mods found.",
      current: 1,
      total: 1
    });

    return {
      ok: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: [scope === "extra" ? "No extra GDG-managed mods found." : "No GDG-managed mods found."],
      preview
    };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: [mode === "delete" ? "Delete Permanently" : "Move to Backup", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: scope === "extra" ? "Remove Extra GDG-Managed Mods" : "Remove GDG-Managed Mods",
    message:
      mode === "delete"
        ? `Permanently delete ${targets.length} GDG-managed or known server-only mod${targets.length === 1 ? "" : "s"}?`
        : `Move ${targets.length} GDG-managed or known server-only mod${targets.length === 1 ? "" : "s"} to backup?`,
    detail:
      mode === "delete"
        ? "Personal mods are skipped unless they are known server-only folders. This does not create a backup."
        : `Personal mods are skipped unless they are known server-only folders.\n\nBackup location:\n${backupRoot}`
  });

  if (confirmation.response !== 0) {
    reportSyncProgress(onProgress, {
      phase: "complete",
      message: "GDG-managed cleanup canceled.",
      current: 1,
      total: 1
    });

    return {
      ok: false,
      canceled: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: ["GDG-managed cleanup canceled."],
      preview
    };
  }

  if (mode === "backup") {
    await fsp.mkdir(backupRoot, { recursive: true });
  }

  reportSyncProgress(onProgress, {
    phase: "preparing",
    message: mode === "delete" ? `Preparing to delete ${targets.length} GDG-managed mod${targets.length === 1 ? "" : "s"}.` : `Preparing to move ${targets.length} GDG-managed mod${targets.length === 1 ? "" : "s"} to backup.`,
    current: 0,
    total: targets.length
  });

  const usedTargets = new Set();
  for (const [index, mod] of targets.entries()) {
    const current = index + 1;
    const folderName = sanitizeFolderName(mod.folderName);
    const sourcePath = path.resolve(mod.folderPath);
    const backupTarget = mode === "backup" ? getUniqueBackupTarget(backupRoot, folderName, usedTargets) : "";

    try {
      if (!sourcePath.toLowerCase().startsWith(`${modsPath.toLowerCase()}${path.sep}`)) {
        throw new Error("Mod folder is outside the selected Mods folder.");
      }

      reportSyncProgress(onProgress, {
        phase: mode === "delete" ? "installing" : "backing-up",
        message: mode === "delete" ? `Deleting ${folderName}.` : `Moving ${folderName} to backup.`,
        modName: mod.displayName || folderName,
        modKey: folderName,
        current,
        total: targets.length
      });

      if (mode === "delete") {
        await fsp.rm(sourcePath, { recursive: true, force: true });
        log.push(`Deleted ${folderName}.`);
      } else {
        await movePathToBackup(sourcePath, backupTarget);
        log.push(`Moved ${folderName} to backup.`);
      }

      removedManagedFolders.push(folderName);
      reportSyncProgress(onProgress, {
        phase: "installed",
        message: mode === "delete" ? `Deleted ${folderName}.` : `Moved ${folderName} to backup.`,
        modName: mod.displayName || folderName,
        modKey: folderName,
        current,
        total: targets.length
      });
    } catch (error) {
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${folderName}: ${error.message}`,
        modName: mod.displayName || folderName,
        modKey: folderName,
        current,
        total: targets.length
      });
      log.push(`Failed ${folderName}: ${error.message}`);
      failures.push({ modName: mod.displayName || folderName, error: error.message });
    }
  }

  await removeManagedModRecords(gamePath, removedManagedFolders);
  let nextPreview = preview;
  if (payload?.manifestInput) {
    try {
      nextPreview = await previewSync(payload);
    } catch (error) {
      log.push(`Server mod check after cleanup failed: ${error.message}`);
      await appendDiagnosticLog("gdg:clean-managed-mods-preview", error, {
        gamePath,
        manifestInput: payload?.manifestInput
      });
    }
  }

  await recordInstallOperation(gamePath, {
    type: scope === "extra" ? "clean-extra-managed" : "clean-managed",
    mode,
    manifestInput: payload?.manifestInput || "",
    affectedCount: removedManagedFolders.length,
    failedCount: failures.length,
    backupRoot: mode === "backup" && removedManagedFolders.length > 0 ? backupRoot : ""
  });

  reportSyncProgress(onProgress, {
    phase: failures.length > 0 ? "failed" : "complete",
    message:
      failures.length > 0
        ? `GDG-managed cleanup finished with ${failures.length} failure${failures.length === 1 ? "" : "s"}.`
        : mode === "delete"
          ? "GDG-managed mods deleted."
          : "GDG-managed mods moved to backup.",
    current: targets.length - failures.length,
    total: targets.length
  });

  return {
    ok: failures.length === 0,
    failedCount: failures.length,
    failures,
    backupRoot: mode === "backup" && removedManagedFolders.length > 0 ? backupRoot : "",
    diagnosticLogPath: failures.length > 0 ? getDiagnosticLogPath() : "",
    log,
    preview: nextPreview
  };
}

async function resetAndReinstall(payload, onProgress = () => {}) {
  const purgeResult = await purgeModsFolder(payload, onProgress);
  if (purgeResult.canceled || !purgeResult.ok) {
    return purgeResult;
  }

  const syncResult = await applySync(payload, onProgress);
  return {
    ...syncResult,
    ok: purgeResult.ok && syncResult.ok,
    failedCount: (purgeResult.failedCount || 0) + (syncResult.failedCount || 0),
    failures: [...(purgeResult.failures || []), ...(syncResult.failures || [])],
    backupRoot: purgeResult.backupRoot || syncResult.backupRoot || "",
    log: [
      ...purgeResult.log,
      "Reinstall started after purge.",
      ...syncResult.log
    ],
    preview: syncResult.preview
  };
}

async function runPreflightDoctor(payload = {}) {
  const gamePath = path.resolve(String(payload.gamePath || ""));
  const checks = [];
  let preview = null;
  let local = null;
  let diskSpace = null;

  function addCheck(id, label, status, detail, action = "") {
    checks.push({ id, label, status, detail, action });
  }

  if (!payload.gamePath) {
    addCheck("game-folder", "Game folder", "fail", "No 7 Days to Die folder is selected.", "Choose a game folder.");
    return { ok: false, checks, preview: null };
  }

  const validGameRoot = await isSevenDaysGameRoot(gamePath);
  addCheck(
    "game-folder",
    "Game folder",
    validGameRoot ? "pass" : "fail",
    validGameRoot ? "Selected folder looks like 7 Days to Die." : "Selected folder does not look like a 7 Days to Die install.",
    validGameRoot ? "" : "Browse to the 7 Days to Die install folder."
  );

  if (!validGameRoot) {
    return { ok: false, checks, preview: null };
  }

  const modsPath = path.join(gamePath, "Mods");
  try {
    await fsp.mkdir(modsPath, { recursive: true });
    const probePath = path.join(modsPath, `.gdg-write-test-${Date.now()}.tmp`);
    await fsp.writeFile(probePath, "ok", "utf8");
    await fsp.rm(probePath, { force: true });
    addCheck("write-permission", "Mods folder access", "pass", "GDG can write to the selected Mods folder.");
  } catch (error) {
    addCheck("write-permission", "Mods folder access", "fail", `GDG cannot write to the Mods folder: ${error.message}`, "Run as a user with write access or choose a writable GDG copy.");
  }

  try {
    diskSpace = await getDiskSpace(gamePath);
    addCheck("disk-space", "Free disk space", "pass", `${formatBytes(diskSpace.freeBytes)} free on the selected drive.`);
  } catch (error) {
    addCheck("disk-space", "Free disk space", "warn", `Free space could not be checked: ${error.message}`);
  }

  try {
    local = await scanMods(gamePath, { hash: false });
  } catch (error) {
    addCheck("local-mods", "Installed mods", "fail", `Installed mods could not be scanned: ${error.message}`);
  }

  if (!payload.manifestInput) {
    addCheck("manifest", "Server manifest", "fail", "No server sync endpoint is selected.", "Select a GDG server or manifest.");
  } else {
    try {
      preview = await previewSync(payload);
      local = preview.local;
      addCheck("manifest", "Server manifest", "pass", `${preview.manifest.mods.length} manifest entries loaded.`);

      if (preview.gameCompatibility.checked) {
        addCheck(
          "game-version",
          "Game version",
          preview.gameCompatibility.ok ? "pass" : "fail",
          preview.gameCompatibility.reason,
          preview.gameCompatibility.ok ? "" : "Update 7 Days to Die in Steam, then retry the check."
        );
      } else {
        addCheck("game-version", "Game version", "warn", preview.gameCompatibility.reason, "Publish a Steam build id for stricter checks.");
      }

      const skippedCount = preview.skippedServerOnly?.length || 0;
      addCheck(
        "manifest-audience",
        "Manifest audience",
        skippedCount > 0 ? "warn" : "pass",
        skippedCount > 0
          ? `${skippedCount} server-only manifest entr${skippedCount === 1 ? "y was" : "ies were"} blocked from client install.`
          : "Manifest contains only client-installable entries."
      );

      const neededSpace = getSyncSpaceRequirement(preview);
      if (diskSpace && neededSpace.known && neededSpace.bytes > 0) {
        addCheck(
          "sync-space",
          "Install space",
          diskSpace.freeBytes >= neededSpace.bytes ? "pass" : "fail",
          `Estimated need ${formatBytes(neededSpace.bytes)}; available ${formatBytes(diskSpace.freeBytes)}.`,
          diskSpace.freeBytes >= neededSpace.bytes ? "" : "Delete old backups or use Delete + Reinstall."
        );
      } else if (neededSpace.bytes > 0) {
        addCheck("sync-space", "Install space", "warn", "Some package sizes are missing, so required space is an estimate.");
      } else {
        addCheck("sync-space", "Install space", "pass", "No downloads are currently needed.");
      }
    } catch (error) {
      addCheck("manifest", "Server manifest", "fail", `Server manifest could not be checked: ${error.message}`, "Refresh server status or verify the sync URL.");
    }
  }

  if (local) {
    const serverOnlyLocal = local.mods.filter((mod) => mod.serverOnly);
    addCheck(
      "server-only-local",
      "Server-only local mods",
      serverOnlyLocal.length > 0 ? "fail" : "pass",
      serverOnlyLocal.length > 0
        ? `${serverOnlyLocal.length} known server-only mod${serverOnlyLocal.length === 1 ? "" : "s"} found locally: ${serverOnlyLocal.map((mod) => mod.folderName).join(", ")}.`
        : "No known server-only mods are installed locally.",
      serverOnlyLocal.length > 0 ? "Remove GDG-managed/server-only mods." : ""
    );

    const dllMods = local.mods.filter((mod) => mod.hasDll);
    const serverEacEnabled = typeof preview?.manifest?.server?.eacEnabled === "boolean" ? preview.manifest.server.eacEnabled : null;
    const requestedEac = payload.launchWithEac !== undefined ? Boolean(payload.launchWithEac) : true;
    const eacStatus = (serverEacEnabled !== null && serverEacEnabled !== requestedEac) || (requestedEac && dllMods.length > 0) ? "warn" : "pass";
    addCheck(
      "eac",
      "EAC launch mode",
      eacStatus,
      serverEacEnabled !== null && serverEacEnabled !== requestedEac
        ? `Server EAC is ${serverEacEnabled ? "on" : "off"}, but launcher is set to ${requestedEac ? "on" : "off"}.`
        : requestedEac && dllMods.length > 0
          ? `${dllMods.length} DLL mod${dllMods.length === 1 ? "" : "s"} detected while EAC launch is on.`
          : "EAC setting looks compatible with the current scan.",
      eacStatus === "warn" ? "Match the server EAC setting before launch." : ""
    );

    const managedExtra = preview?.managedSummary?.extra || 0;
    addCheck(
      "managed-extra",
      "Extra GDG-managed mods",
      managedExtra > 0 ? "warn" : "pass",
      managedExtra > 0
        ? `${managedExtra} GDG-managed mod${managedExtra === 1 ? " is" : "s are"} not part of the selected server package.`
        : "No extra GDG-managed mods found."
    );
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    preview
  };
}

async function listBackups(gamePath) {
  if (!gamePath) {
    return { backups: [] };
  }

  const backups = [];
  for (const workRoot of getSyncWorkRoots(gamePath)) {
    const backupsRoot = path.join(workRoot, "backups");
    if (!(await exists(backupsRoot))) {
      continue;
    }

    const timestampEntries = await fsp.readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
    for (const timestampEntry of timestampEntries) {
      if (!timestampEntry.isDirectory()) {
        continue;
      }

      const timestampPath = path.join(backupsRoot, timestampEntry.name);
      const childEntries = await fsp.readdir(timestampPath, { withFileTypes: true }).catch(() => []);
      const categoryEntries = childEntries.filter((entry) => entry.isDirectory() && BACKUP_CATEGORY_NAMES.has(entry.name.toLowerCase()));
      const backupFolders = categoryEntries.length > 0
        ? categoryEntries.map((entry) => path.join(timestampPath, entry.name))
        : [timestampPath];

      for (const backupPath of backupFolders) {
        const stat = await fsp.stat(backupPath);
        const entries = await fsp.readdir(backupPath, { withFileTypes: true }).catch(() => []);
        const sizeBytes = await getPathSize(backupPath);
        backups.push({
          id: Buffer.from(backupPath).toString("base64url"),
          path: backupPath,
          workRoot,
          name: path.basename(backupPath),
          createdAt: parseBackupTimestamp(timestampEntry.name) || stat.mtime.toISOString(),
          sizeBytes,
          itemCount: entries.filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()).length,
          legacy: path.resolve(workRoot).toLowerCase() === path.resolve(getLegacySyncWorkRoot(gamePath)).toLowerCase()
        });
      }
    }
  }

  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { backups };
}

async function restoreBackup(payload, onProgress = () => {}) {
  const gamePath = path.resolve(String(payload?.gamePath || ""));
  const backupPath = path.resolve(String(payload?.backupPath || ""));
  if (!gamePath || !(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("Select a valid 7 Days to Die folder first.");
  }

  assertManagedBackupPath(gamePath, backupPath);
  if (!(await exists(backupPath))) {
    throw new Error("Backup folder does not exist.");
  }

  const modsPath = path.join(gamePath, "Mods");
  const entries = (await fsp.readdir(backupPath, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink());
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const overwrittenBackupRoot = path.join(getSyncWorkRoot(gamePath), "backups", timestamp, "restore-overwritten");
  const log = [];
  const failures = [];

  if (entries.length === 0) {
    return {
      ok: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: ["Backup folder is empty."],
      preview: null
    };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Restore Backup", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Restore Mods Backup",
    message: `Restore ${entries.length} item${entries.length === 1 ? "" : "s"} from this backup?`,
    detail: `Source:\n${backupPath}\n\nExisting folders with the same name will be moved to:\n${overwrittenBackupRoot}`
  });

  if (confirmation.response !== 0) {
    return {
      ok: false,
      canceled: true,
      failedCount: 0,
      failures,
      backupRoot: "",
      diagnosticLogPath: "",
      log: ["Restore backup canceled."],
      preview: null
    };
  }

  await fsp.mkdir(modsPath, { recursive: true });
  reportSyncProgress(onProgress, {
    phase: "preparing",
    message: `Preparing to restore ${entries.length} backup item${entries.length === 1 ? "" : "s"}.`,
    current: 0,
    total: entries.length
  });

  for (const [index, entry] of entries.entries()) {
    const current = index + 1;
    const sourcePath = path.join(backupPath, entry.name);
    const targetPath = path.join(modsPath, entry.name);
    try {
      reportSyncProgress(onProgress, {
        phase: "installing",
        message: `Restoring ${entry.name}.`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: entries.length
      });

      if (await exists(targetPath)) {
        await fsp.mkdir(overwrittenBackupRoot, { recursive: true });
        await movePathToBackup(targetPath, getUniqueBackupTarget(overwrittenBackupRoot, sanitizeFolderName(entry.name), new Set()));
        log.push(`Moved existing ${entry.name} to restore-overwritten backup.`);
      }

      await fsp.cp(sourcePath, targetPath, { recursive: true });
      log.push(`Restored ${entry.name}.`);
      reportSyncProgress(onProgress, {
        phase: "installed",
        message: `Restored ${entry.name}.`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: entries.length
      });
    } catch (error) {
      failures.push({ modName: entry.name, error: error.message });
      log.push(`Failed ${entry.name}: ${error.message}`);
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${entry.name}: ${error.message}`,
        modName: entry.name,
        modKey: entry.name,
        current,
        total: entries.length
      });
    }
  }

  await recordInstallOperation(gamePath, {
    type: "restore-backup",
    mode: "copy",
    affectedCount: entries.length - failures.length,
    failedCount: failures.length,
    backupRoot: (await exists(overwrittenBackupRoot)) ? overwrittenBackupRoot : "",
    sourceBackup: backupPath
  });

  reportSyncProgress(onProgress, {
    phase: failures.length > 0 ? "failed" : "complete",
    message: failures.length > 0 ? "Backup restore finished with issues." : "Backup restored.",
    current: entries.length - failures.length,
    total: entries.length
  });

  return {
    ok: failures.length === 0,
    failedCount: failures.length,
    failures,
    backupRoot: (await exists(overwrittenBackupRoot)) ? overwrittenBackupRoot : "",
    diagnosticLogPath: failures.length > 0 ? getDiagnosticLogPath() : "",
    log,
    preview: null
  };
}

async function deleteBackup(payload = {}) {
  const gamePath = path.resolve(String(payload.gamePath || ""));
  const backupPath = path.resolve(String(payload.backupPath || ""));
  if (!gamePath || !(await isSevenDaysGameRoot(gamePath))) {
    throw new Error("Select a valid 7 Days to Die folder first.");
  }

  assertManagedBackupPath(gamePath, backupPath);
  if (!(await exists(backupPath))) {
    return { ok: true, deleted: false, path: backupPath };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Delete Backup", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete Mods Backup",
    message: "Permanently delete this backup?",
    detail: backupPath
  });

  if (confirmation.response !== 0) {
    return { ok: false, canceled: true, deleted: false, path: backupPath };
  }

  const sizeBytes = await getPathSize(backupPath).catch(() => 0);
  await fsp.rm(backupPath, { recursive: true, force: true });
  await recordInstallOperation(gamePath, {
    type: "delete-backup",
    mode: "delete",
    affectedCount: 1,
    failedCount: 0,
    backupPath,
    sizeBytes
  });
  return { ok: true, deleted: true, path: backupPath, sizeBytes };
}

function assertManagedBackupPath(gamePath, backupPath) {
  const allowedRoots = getSyncWorkRoots(gamePath).map((root) => path.join(root, "backups"));
  if (!allowedRoots.some((root) => isPathInsideOrEqual(root, backupPath))) {
    throw new Error("Backup path is outside the GDG backup folders.");
  }
}

function isPathInsideOrEqual(root, candidate) {
  const resolvedRoot = path.resolve(root).toLowerCase();
  const resolvedCandidate = path.resolve(candidate).toLowerCase();
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function parseBackupTimestamp(value) {
  const normalized = String(value || "").replace(/-(\d{3})Z$/, ".$1Z").replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/, "$1T$2:$3:$4");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function getPathSize(inputPath) {
  const stats = await fsp.stat(inputPath);
  if (stats.isFile()) {
    return stats.size;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  let total = 0;
  const entries = await fsp.readdir(inputPath, { withFileTypes: true });
  for (const entry of entries) {
    total += await getPathSize(path.join(inputPath, entry.name));
  }
  return total;
}

async function loadManifest(input) {
  const trimmed = String(input || "").trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return loadRemoteManifest(trimmed);
  }

  const filePath = normalizeLocalPath(trimmed);
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadServerDirectory(input) {
  const source = String(input || DEFAULT_SERVER_DIRECTORY).trim();
  const directory = /^https?:\/\//i.test(source)
    ? await fetchJson(source)
    : JSON.parse(await fsp.readFile(normalizeLocalPath(source), "utf8"));

  if (!directory || !Array.isArray(directory.servers)) {
    throw new Error("Server directory must include a servers array.");
  }

  for (const server of directory.servers) {
    if (!server.id || !server.name || !server.syncUrl) {
      throw new Error("Every server directory entry needs id, name, and syncUrl.");
    }
  }

  return directory;
}

async function checkServerHealth(server) {
  try {
    const manifest = await loadManifest(server.syncUrl);
    validateManifest(manifest);
    const clientMods = (manifest.mods || []).filter(isClientInstallableManifestMod);
    return {
      serverId: server.id,
      ok: true,
      status: "online",
      modCount: clientMods.length,
      blockedServerOnlyCount: (manifest.mods || []).length - clientMods.length,
      generatedAt: manifest.generatedAt || "",
      serverName: manifest.server?.name || server.name,
      eacEnabled: typeof manifest.server?.eacEnabled === "boolean" ? manifest.server.eacEnabled : null,
      gameVersion: manifest.server?.gameVersion || "",
      steamBuildId: manifest.server?.steamBuildId || "",
      gameVersionMap: normalizeGameVersionMap(manifest.server?.gameVersionMap),
      ...getManifestSizeSummary(manifest)
    };
  } catch (error) {
    return {
      serverId: server.id,
      ok: false,
      status: "offline",
      modCount: 0,
      generatedAt: "",
      serverName: server.name,
      downloadBytes: 0,
      downloadSizeKnown: false,
      installedBytes: 0,
      installedSizeKnown: false,
      eacEnabled: null,
      error: error.message
    };
  }
}

async function getDiskSpace(gamePath) {
  const probePath = await resolveExistingPath(gamePath || os.homedir());
  const stats = await fsp.statfs(probePath);
  const blockSize = Number(stats.bsize || 0);

  return {
    path: probePath,
    freeBytes: Number(stats.bavail || 0) * blockSize,
    totalBytes: Number(stats.blocks || 0) * blockSize
  };
}

async function getGameVersionInfo(gamePath) {
  const resolvedGamePath = path.resolve(String(gamePath || ""));
  const appManifestPath = findSteamAppManifestPath(resolvedGamePath);
  const version = {
    gamePath: resolvedGamePath,
    steamAppId: STEAM_APP_ID,
    steamAppManifestPath: "",
    steamBuildId: "",
    steamUpdateState: "",
    steamInstallDir: "",
    canOpenSteamUpdate: process.platform === "win32"
  };

  if (!appManifestPath || !(await exists(appManifestPath))) {
    return version;
  }

  const text = await fsp.readFile(appManifestPath, "utf8");
  const values = parseSteamAppManifest(text);

  return {
    ...version,
    steamAppManifestPath: appManifestPath,
    steamBuildId: values.buildid || "",
    steamUpdateState: values.StateFlags || values.stateflags || "",
    steamInstallDir: values.installdir || ""
  };
}

function findSteamAppManifestPath(gamePath) {
  if (!gamePath) {
    return "";
  }

  const normalized = path.resolve(gamePath);
  const commonDir = path.dirname(normalized);
  if (path.basename(commonDir).toLowerCase() !== "common") {
    return "";
  }

  const steamAppsDir = path.dirname(commonDir);
  return path.join(steamAppsDir, `appmanifest_${STEAM_APP_ID}.acf`);
}

function parseSteamAppManifest(text) {
  const values = {};
  const matches = String(text || "").matchAll(/"([^"]+)"\s+"([^"]*)"/g);
  for (const match of matches) {
    values[match[1]] = match[2];
  }
  return values;
}

function compareGameCompatibility(manifest, localVersion) {
  const gameVersionMap = normalizeGameVersionMap(manifest.server?.gameVersionMap);
  const requiredSteamBuildId = String(manifest.server?.steamBuildId || "").trim();
  const requiredGameVersion = String(manifest.server?.gameVersion || gameVersionMap[requiredSteamBuildId] || "").trim();
  const requiredLabel = formatGameVersionLabel(requiredSteamBuildId, requiredGameVersion, gameVersionMap);

  if (!requiredGameVersion && !requiredSteamBuildId) {
    return {
      ok: true,
      checked: false,
      reason: "Server has not published a required game version yet.",
      local: localVersion,
      requiredGameVersion,
      requiredSteamBuildId,
      gameVersionMap
    };
  }

  if (requiredGameVersion && !requiredSteamBuildId) {
    return {
      ok: true,
      checked: false,
      reason: `Server expects ${requiredGameVersion}, but no Steam build id was published for automatic comparison.`,
      local: localVersion,
      requiredGameVersion,
      requiredSteamBuildId,
      gameVersionMap
    };
  }

  if (requiredSteamBuildId) {
    if (!localVersion.steamBuildId) {
      return {
        ok: false,
        checked: true,
        reason: "Steam build could not be detected for this game folder.",
        local: localVersion,
        requiredGameVersion,
        requiredSteamBuildId,
        gameVersionMap
      };
    }

    if (localVersion.steamBuildId !== requiredSteamBuildId) {
      const localLabel = formatGameVersionLabel(localVersion.steamBuildId, gameVersionMap[localVersion.steamBuildId], gameVersionMap);
      return {
        ok: false,
        checked: true,
        reason: `This folder is ${localLabel}, but the server requires ${requiredLabel}.`,
        local: localVersion,
        requiredGameVersion,
        requiredSteamBuildId,
        gameVersionMap
      };
    }
  }

  return {
    ok: true,
    checked: true,
    reason: requiredGameVersion ? `Game version matches ${requiredGameVersion}.` : "Steam build matches the server.",
    local: localVersion,
    requiredGameVersion,
    requiredSteamBuildId,
    gameVersionMap
  };
}

function normalizeGameVersionMap(input) {
  const map = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return map;
  }

  for (const [buildId, label] of Object.entries(input)) {
    const key = String(buildId || "").trim();
    const value = String(label || "").trim();
    if (key && value) {
      map[key] = value;
    }
  }

  return map;
}

function formatGameVersionLabel(buildId, version, gameVersionMap = {}) {
  const normalizedBuild = String(buildId || "").trim();
  const label = String(version || gameVersionMap[normalizedBuild] || "").trim();
  if (label && normalizedBuild) {
    return `${label} (Steam build ${normalizedBuild})`;
  }
  if (label) {
    return label;
  }
  if (normalizedBuild) {
    return `Steam build ${normalizedBuild}`;
  }
  return "an unknown game version";
}

async function resolveExistingPath(inputPath) {
  let current = path.resolve(String(inputPath || os.homedir()));

  while (!(await exists(current))) {
    const parent = path.dirname(current);
    if (parent === current) {
      return os.homedir();
    }
    current = parent;
  }

  return current;
}

function getManifestSizeSummary(manifest) {
  let downloadBytes = 0;
  let installedBytes = 0;
  let missingDownloadSizes = 0;
  let missingInstalledSizes = 0;

  for (const mod of manifest.mods || []) {
    if (!isClientInstallableManifestMod(mod)) {
      continue;
    }

    const archiveSize = Number(mod.source?.archiveSizeBytes || mod.source?.sizeBytes || 0);
    const folderSize = Number(mod.folderSizeBytes || 0);

    if (archiveSize > 0) {
      downloadBytes += archiveSize;
    } else {
      missingDownloadSizes += 1;
    }

    if (folderSize > 0) {
      installedBytes += folderSize;
    } else if (archiveSize > 0) {
      installedBytes += archiveSize;
    } else {
      missingInstalledSizes += 1;
    }
  }

  return {
    downloadBytes,
    downloadSizeKnown: missingDownloadSizes === 0,
    installedBytes,
    installedSizeKnown: missingInstalledSizes === 0
  };
}

function getSyncSpaceRequirement(preview, options = {}) {
  let bytes = 0;
  let known = true;
  const actionable = getActionableSyncItems(preview, options);

  for (const item of actionable) {
    const mod = item.mod || {};
    const archiveBytes = Number(mod.source?.archiveSizeBytes || mod.source?.sizeBytes || 0);
    const folderBytes = Number(mod.folderSizeBytes || 0);
    const extractedBytes = folderBytes || archiveBytes;
    const packageBytes = archiveBytes || folderBytes;

    if (!packageBytes || !extractedBytes) {
      known = false;
    }

    // Peak usage includes download package, extracted staging copy, final install,
    // and for updates an extra backup copy before the old folder is removed.
    bytes += packageBytes + extractedBytes + extractedBytes;
    if (item.action === "update") {
      bytes += extractedBytes;
    }
  }

  if (bytes > 0) {
    bytes = Math.ceil(bytes * 1.1) + 256 * 1024 * 1024;
  }

  return { bytes, known };
}

function getActionableSyncItems(preview, options = {}) {
  const repairMode = Boolean(options.repairMode);
  return (preview?.plan || []).filter((item) => {
    if (item.action === "install" || item.action === "update") {
      return true;
    }

    return repairMode && item.action === "ready" && Boolean(item.mod?.source);
  });
}

function getSyncActionVerb(item, repairMode) {
  if (repairMode && item.action === "ready") {
    return "Repaired";
  }

  return item.action === "install" ? "Installed" : "Updated";
}

async function loadRemoteManifest(url) {
  let first;
  try {
    first = await fetchJson(url);
  } catch (error) {
    if (/\.json($|\?)/i.test(new URL(url).pathname)) {
      throw error;
    }

    const manifestUrl = new URL("/gdg-sync/manifest.json", url).href;
    return fetchJson(manifestUrl);
  }

  if (first && Array.isArray(first.mods)) {
    return first;
  }

  if (first?.manifestUrl) {
    const manifestUrl = new URL(first.manifestUrl, url).href;
    return fetchJson(manifestUrl);
  }

  if (!/\.json($|\?)/i.test(new URL(url).pathname)) {
    const manifestUrl = new URL("/gdg-sync/manifest.json", url).href;
    return fetchJson(manifestUrl);
  }

  return first;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeLocalPath(input) {
  if (input.startsWith("file://")) {
    return new URL(input).pathname;
  }

  return input;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a JSON object.");
  }

  if (manifest.game !== GAME_ID) {
    throw new Error(`Manifest game must be "${GAME_ID}".`);
  }

  if (!Array.isArray(manifest.mods)) {
    throw new Error("Manifest must include a mods array.");
  }

  for (const mod of manifest.mods) {
    if (!mod.id || !mod.name) {
      throw new Error("Every manifest mod needs an id and name.");
    }
  }
}

function buildSyncPlan(manifest, localMods) {
  const byFolder = new Map();
  const byName = new Map();

  for (const mod of localMods) {
    byFolder.set(mod.folderName.toLowerCase(), mod);
    byName.set(mod.name.toLowerCase(), mod);
    byName.set(mod.displayName.toLowerCase(), mod);
  }

  const plan = manifest.mods.map((mod) => {
    const desiredFolder = (mod.folderName || mod.id || mod.name).toLowerCase();
    const installed =
      byFolder.get(desiredFolder) ||
      byName.get(String(mod.id).toLowerCase()) ||
      byName.get(String(mod.name).toLowerCase());
    const blockedReason = getClientBlockedReason(mod);

    if (blockedReason) {
      return {
        action: "blocked",
        mod,
        installed,
        reason: blockedReason
      };
    }

    if (!installed) {
      return {
        action: mod.source ? "install" : "blocked",
        mod,
        installed: null,
        reason: mod.source ? "Missing locally" : "Missing source"
      };
    }

    if (mod.folderSha256 && installed.folderSha256 && mod.folderSha256 !== installed.folderSha256) {
      return {
        action: mod.source ? "update" : "blocked",
        mod,
        installed,
        reason: mod.source ? "Hash differs" : "Hash differs and no source is available"
      };
    }

    if (mod.version && installed.version && mod.version !== installed.version) {
      return {
        action: mod.source ? "update" : "blocked",
        mod,
        installed,
        reason: mod.source ? `Version ${installed.version} -> ${mod.version}` : "Version differs and no source is available"
      };
    }

    return {
      action: "ready",
      mod,
      installed,
      reason: "Ready"
    };
  });

  const manifestFolders = new Set(
    manifest.mods
      .filter(isClientInstallableManifestMod)
      .map((mod) => String(mod.folderName || mod.id || mod.name).toLowerCase())
  );
  const unmanaged = localMods
    .filter((mod) => !manifestFolders.has(mod.folderName.toLowerCase()))
    .map((mod) => ({
      action: "keep",
      mod: {
        id: mod.folderName,
        name: mod.displayName,
        folderName: mod.folderName,
        version: mod.version
      },
      installed: mod,
      reason: "Local only"
    }));

  return [...plan, ...unmanaged];
}

function summarizePlan(plan) {
  return plan.reduce(
    (summary, item) => {
      summary[item.action] = (summary[item.action] || 0) + 1;
      return summary;
    },
    { ready: 0, install: 0, update: 0, blocked: 0, keep: 0 }
  );
}

function getProgressModKey(mod) {
  return String(mod.folderName || mod.id || mod.name || "").toLowerCase();
}

function reportSyncProgress(onProgress, progress) {
  const total = Math.max(Number(progress.total || 0), 0);
  const current = Math.min(Math.max(Number(progress.current || 0), 0), total || 0);
  let percent = total > 0 ? Math.round((current / total) * 100) : 100;

  if (progress.phase === "downloading" && progress.bytesTotal > 0) {
    const stepStart = Math.max(current - 1, 0) / total;
    const stepSize = 1 / total;
    const byteProgress = Math.min(Math.max(progress.bytesReceived / progress.bytesTotal, 0), 1);
    percent = Math.round((stepStart + stepSize * byteProgress * 0.7) * 100);
  } else if (progress.phase === "downloading" && total > 0) {
    percent = Math.round((Math.max(current - 1, 0) / total) * 100);
  } else if (progress.phase === "extracting" && total > 0) {
    percent = Math.round(((Math.max(current - 1, 0) + 0.74) / total) * 100);
  } else if (progress.phase === "backing-up" && total > 0) {
    percent = Math.round(((Math.max(current - 1, 0) + 0.84) / total) * 100);
  } else if (progress.phase === "installing" && total > 0) {
    percent = Math.round(((Math.max(current - 1, 0) + 0.94) / total) * 100);
  } else if (progress.phase === "failed" && total > 0) {
    percent = Math.round((Math.max(current - 1, 0) / total) * 100);
  }

  onProgress({
    phase: progress.phase,
    message: progress.message,
    modName: progress.modName || "",
    modKey: progress.modKey || "",
    current,
    total,
    percent: Math.min(Math.max(percent, 0), 100),
    ...(progress.bytesReceived !== undefined ? { bytesReceived: progress.bytesReceived } : {}),
    ...(progress.bytesTotal !== undefined ? { bytesTotal: progress.bytesTotal } : {})
  });
}

function reportCloneProgress(onProgress, progress) {
  const total = Math.max(Number(progress.total || 0), 0);
  const current = Math.min(Math.max(Number(progress.current || 0), 0), total || 0);
  let percent = Number(progress.percent || 0);

  if (progress.phase === "copying" && progress.bytesTotal > 0) {
    percent = Math.round((progress.bytesReceived / progress.bytesTotal) * 98);
  } else if (total > 0 && !progress.percent) {
    percent = Math.round((current / total) * 100);
  }

  onProgress({
    phase: progress.phase,
    message: progress.message,
    modName: progress.modName || "",
    current,
    total,
    percent: Math.min(Math.max(percent, 0), 100),
    ...(progress.bytesReceived !== undefined ? { bytesReceived: progress.bytesReceived } : {}),
    ...(progress.bytesTotal !== undefined ? { bytesTotal: progress.bytesTotal } : {})
  });
}

async function downloadModArchive(mod, stagingRoot, onDownload = () => {}) {
  const maxAttempts = 3;
  let lastError;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    try {
      return await downloadModArchiveOnce(mod, stagingRoot, onDownload);
    } catch (error) {
      lastError = error;
      await appendDiagnosticLog("download-mod-archive", error, {
        mod: mod.name || mod.id,
        url: mod.source?.url || "",
        attempt,
        maxAttempts
      });
      const fileName = sanitizeFolderName(`${mod.id || mod.name}.zip`);
      await fsp.rm(path.join(stagingRoot, fileName), { force: true }).catch(() => {});
      if (attempt < maxAttempts && isRetryableDownloadError(error)) {
        await delay(750 * attempt);
        continue;
      }
      break;
    }
  }

  throw new Error(`Download failed after ${attemptsUsed} attempt${attemptsUsed === 1 ? "" : "s"}: ${lastError?.message || "Unknown download error"}`);
}

function isRetryableDownloadError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("terminated") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("download failed: 5")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadModArchiveOnce(mod, stagingRoot, onDownload = () => {}) {
  const source = mod.source || {};
  const url = source.url;

  if (!url) {
    throw new Error("No download source.");
  }

  const fileName = sanitizeFolderName(`${mod.id || mod.name}.zip`);
  const archivePath = path.join(stagingRoot, fileName);

  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const totalBytes = Number(response.headers.get("content-length") || source.archiveSizeBytes || source.sizeBytes || 0);
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const writeStream = fs.createWriteStream(archivePath);
      let receivedBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = Buffer.from(value);
          receivedBytes += chunk.length;
          if (!writeStream.write(chunk)) {
            await once(writeStream, "drain");
          }
          onDownload({ bytesReceived: receivedBytes, bytesTotal: totalBytes });
        }
      } catch (error) {
        writeStream.destroy();
        throw error;
      }

      await new Promise((resolve, reject) => {
        writeStream.end(resolve);
        writeStream.once("error", reject);
      });
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      onDownload({ bytesReceived: buffer.length, bytesTotal: totalBytes || buffer.length });
      await fsp.writeFile(archivePath, buffer);
    }
  } else {
    await fsp.copyFile(normalizeLocalPath(url), archivePath);
    const stats = await fsp.stat(archivePath);
    onDownload({ bytesReceived: stats.size, bytesTotal: Number(source.archiveSizeBytes || source.sizeBytes || stats.size) });
  }

  if (source.archiveSha256) {
    const actual = await hashFile(archivePath);
    if (actual.toLowerCase() !== source.archiveSha256.toLowerCase()) {
      throw new Error("Archive hash did not match manifest.");
    }
  }

  return archivePath;
}

async function extractModArchive(archivePath, stagingRoot, mod) {
  const extractRoot = path.join(stagingRoot, sanitizeFolderName(`${mod.id || mod.name}-extract`));
  await fsp.rm(extractRoot, { recursive: true, force: true });
  await fsp.mkdir(extractRoot, { recursive: true });

  await extractZipToDirectory(archivePath, extractRoot);

  const candidate = await findFolderWithModInfo(extractRoot);
  if (!candidate) {
    throw new Error("Archive did not contain a folder with ModInfo.xml.");
  }

  return candidate;
}

async function extractZipToDirectory(archivePath, extractRoot) {
  const zipFile = await openZipFile(archivePath);
  try {
    await new Promise((resolve, reject) => {
      zipFile.on("entry", (entry) => {
        void (async () => {
          try {
            const destination = getSafeZipDestination(extractRoot, entry.fileName);
            if (/\/$/.test(entry.fileName)) {
              await fsp.mkdir(destination, { recursive: true });
              zipFile.readEntry();
              return;
            }

            await fsp.mkdir(path.dirname(destination), { recursive: true });
            const readStream = await openZipReadStream(zipFile, entry);
            await pipeline(readStream, fs.createWriteStream(destination, { flags: "w" }));
            zipFile.readEntry();
          } catch (error) {
            reject(error);
          }
        })();
      });

      zipFile.once("end", resolve);
      zipFile.once("error", reject);
      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
}

function openZipFile(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        reject(error);
      } else {
        resolve(zipFile);
      }
    });
  });
}

function openZipReadStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error) {
        reject(error);
      } else {
        resolve(readStream);
      }
    });
  });
}

function getSafeZipDestination(extractRoot, entryName) {
  const safeRoot = path.resolve(extractRoot);
  const safePrefix = `${safeRoot}${path.sep}`;
  const destination = path.resolve(extractRoot, entryName);

  if (destination !== safeRoot && !destination.startsWith(safePrefix)) {
    throw new Error("Archive contains an unsafe file path.");
  }

  return destination;
}

async function findFolderWithModInfo(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });

  if (await exists(path.join(root, "ModInfo.xml"))) {
    return root;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childPath = path.join(root, entry.name);
    if (await exists(path.join(childPath, "ModInfo.xml"))) {
      return childPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nested = await findFolderWithModInfo(path.join(root, entry.name));
    if (nested) {
      return nested;
    }
  }

  return "";
}

async function hashDirectory(root) {
  const files = [];
  await collectFiles(root, files);
  files.sort((a, b) => a.localeCompare(b));

  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, "/");
    hash.update(relative);
    hash.update("\0");
    hash.update(await fsp.readFile(file));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function collectFiles(root, files) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fsp.readFile(filePath));
  return hash.digest("hex");
}

function sanitizeFolderName(value) {
  return String(value || "mod").replace(/[<>:"/\\|?*]+/g, "-").trim();
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeCandidates(candidates) {
  const byPath = new Map();
  for (const candidate of candidates) {
    if (!candidate?.path) {
      continue;
    }

    const key = path.resolve(candidate.path).toLowerCase();
    const existing = byPath.get(key);
    if (!existing || candidate.priority < existing.priority) {
      byPath.set(key, {
        path: candidate.path,
        priority: candidate.priority
      });
    }
  }

  return [...byPath.values()];
}

function isGdgCopyPath(candidatePath) {
  return /7 days to die\s*-\s*gdg$/i.test(path.basename(String(candidatePath || "")));
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}
