const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const yauzl = require("yauzl");

const GAME_ID = "7dtd";
const GAME_NAME = "7 Days to Die";
const STEAM_APP_ID = "251570";
const CONFIG_VERSION = 1;
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

  ipcMain.handle("gdg:launch-game", async (_event, payload) => {
    return launchGame(payload);
  });

  ipcMain.handle("gdg:open-steam-update", async () => {
    try {
      await shell.openExternal(`steam://validate/${STEAM_APP_ID}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
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
          label: "Open Diagnostic Log",
          click: () => {
            void openDiagnosticLog();
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
  return normalized === "mods" || normalized.startsWith("mods/");
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
    const mod = {
      folderName: entry.name,
      folderPath,
      name: info.name || entry.name,
      displayName: info.displayName || info.name || entry.name,
      author: info.author || "",
      version: info.version || "",
      description: info.description || "",
      hasDll: dllFiles.length > 0,
      dllFiles
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

  return {
    manifest,
    local,
    gameCompatibility,
    plan,
    summary: summarizePlan(plan),
    ...sizeSummary
  };
}

async function applySync(payload, onProgress = () => {}) {
  const preview = await previewSync(payload);
  if (preview.gameCompatibility.checked && !preview.gameCompatibility.ok) {
    throw new Error(`${preview.gameCompatibility.reason} Update 7 Days to Die in Steam before installing GDG mods.`);
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

  const actionable = preview.plan.filter((item) => item.action === "install" || item.action === "update");
  const total = actionable.length;

  reportSyncProgress(onProgress, {
    phase: total > 0 ? "preparing" : "complete",
    message: total > 0 ? `Preparing ${total} mod${total === 1 ? "" : "s"}.` : "Everything is already in sync.",
    current: 0,
    total
  });

  for (const [index, item] of actionable.entries()) {
    const current = index + 1;
    const modName = item.mod.name || item.mod.id;
    const modKey = getProgressModKey(item.mod);
    const tempPaths = [];

    try {
      log.push(`Preparing ${modName}.`);
      reportSyncProgress(onProgress, {
        phase: "downloading",
        message: `Downloading ${modName}.`,
        modName,
        modKey,
        current,
        total
      });
      const archivePath = await downloadModArchive(item.mod, stagingRoot, (download) => {
        reportSyncProgress(onProgress, {
          phase: "downloading",
          message: `Downloading ${modName}.`,
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
        message: `Unpacking ${modName}.`,
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
          message: `Backing up ${folderName}.`,
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
        message: `Installing ${folderName}.`,
        modName,
        modKey,
        current,
        total
      });
      await fsp.cp(sourceFolder, targetFolder, { recursive: true });
      log.push(`${item.action === "install" ? "Installed" : "Updated"} ${folderName}.`);
      reportSyncProgress(onProgress, {
        phase: "installed",
        message: `${item.action === "install" ? "Installed" : "Updated"} ${folderName}.`,
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
  return path.join(path.dirname(path.resolve(String(gamePath || os.homedir()))), ".gdg-mod-loader");
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
    return {
      serverId: server.id,
      ok: true,
      status: "online",
      modCount: manifest.mods.length,
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
    manifest.mods.map((mod) => String(mod.folderName || mod.id || mod.name).toLowerCase())
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
