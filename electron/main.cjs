const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const AdmZip = require("adm-zip");

const GAME_ID = "7dtd";
const GAME_NAME = "7 Days to Die";
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
  error: ""
};

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
    void checkForLoaderUpdate({ silent: true });
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

  ipcMain.handle("gdg:clone-game-install", async (event, payload) => {
    return cloneGameInstall(payload, (progress) => {
      event.sender.send("gdg:clone-progress", progress);
    });
  });

  ipcMain.handle("gdg:scan-mods", async (_event, payload) => {
    return scanMods(payload.gamePath, { hash: false });
  });

  ipcMain.handle("gdg:preview-sync", async (_event, payload) => {
    return previewSync(payload);
  });

  ipcMain.handle("gdg:apply-sync", async (event, payload) => {
    return applySync(payload, (progress) => {
      event.sender.send("gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:launch-game", async (_event, payload) => {
    return launchGame(payload);
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
          label: updateState.updateAvailable ? `Download v${updateState.latestVersion}` : "Open Releases",
          click: () => {
            void shell.openExternal(updateState.releaseUrl || LOADER_RELEASES_URL);
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

function getUpdateStatusLabel() {
  if (updateState.status === "checking") {
    return "Checking for updates...";
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

    updateState = {
      status: "ready",
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url || LOADER_RELEASES_URL,
      error: ""
    };
    updateApplicationMenu();

    if (!options.silent && mainWindow) {
      if (updateAvailable) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "info",
          buttons: ["Download", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "GDG Mod Loader Update",
          message: `GDG Mod Loader v${latestVersion} is available.`,
          detail: `You are currently running v${currentVersion}. Download the newest release from GitHub.`
        });

        if (result.response === 0) {
          await shell.openExternal(updateState.releaseUrl);
        }
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
    message: "Scanning game files.",
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

  const local = await scanMods(gamePath, { hash: true });
  const plan = buildSyncPlan(manifest, local.mods);
  const sizeSummary = getManifestSizeSummary(manifest);

  return {
    manifest,
    local,
    plan,
    summary: summarizePlan(plan),
    ...sizeSummary
  };
}

async function applySync(payload, onProgress = () => {}) {
  const preview = await previewSync(payload);
  const modsPath = path.join(payload.gamePath, "Mods");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(app.getPath("userData"), "backups", timestamp);
  const stagingRoot = path.join(app.getPath("temp"), "gdg-mod-loader", timestamp);
  const log = [];

  await fsp.mkdir(modsPath, { recursive: true });
  await fsp.mkdir(stagingRoot, { recursive: true });

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
    try {
      log.push(`Preparing ${modName}.`);
      reportSyncProgress(onProgress, {
        phase: "downloading",
        message: `Downloading ${modName}.`,
        modName,
        current,
        total
      });
      const archivePath = await downloadModArchive(item.mod, stagingRoot, (download) => {
        reportSyncProgress(onProgress, {
          phase: "downloading",
          message: `Downloading ${modName}.`,
          modName,
          current,
          total,
          bytesReceived: download.bytesReceived,
          bytesTotal: download.bytesTotal
        });
      });
      reportSyncProgress(onProgress, {
        phase: "extracting",
        message: `Unpacking ${modName}.`,
        modName,
        current,
        total
      });
      const sourceFolder = await extractModArchive(archivePath, stagingRoot, item.mod);
      const folderName = sanitizeFolderName(item.mod.folderName || path.basename(sourceFolder));
      const targetFolder = path.join(modsPath, folderName);

      if (await exists(targetFolder)) {
        reportSyncProgress(onProgress, {
          phase: "backing-up",
          message: `Backing up ${folderName}.`,
          modName,
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
        current,
        total
      });
      await fsp.cp(sourceFolder, targetFolder, { recursive: true });
      log.push(`${item.action === "install" ? "Installed" : "Updated"} ${folderName}.`);
    } catch (error) {
      reportSyncProgress(onProgress, {
        phase: "failed",
        message: `Failed ${modName}: ${error.message}`,
        modName,
        current,
        total
      });
      log.push(`Failed ${modName}: ${error.message}`);
    }
  }

  reportSyncProgress(onProgress, {
    phase: "verifying",
    message: "Checking installed mods.",
    current: total,
    total
  });
  const nextPreview = await previewSync(payload);
  reportSyncProgress(onProgress, {
    phase: "complete",
    message: "Sync complete.",
    current: total,
    total
  });

  return {
    ok: true,
    backupRoot: (await exists(backupRoot)) ? backupRoot : "",
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
      const chunks = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = Buffer.from(value);
        receivedBytes += chunk.length;
        chunks.push(chunk);
        onDownload({ bytesReceived: receivedBytes, bytesTotal: totalBytes });
      }

      await fsp.writeFile(archivePath, Buffer.concat(chunks));
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

  const zip = new AdmZip(archivePath);
  assertSafeZipEntries(zip, extractRoot);
  zip.extractAllTo(extractRoot, true);

  const candidate = await findFolderWithModInfo(extractRoot);
  if (!candidate) {
    throw new Error("Archive did not contain a folder with ModInfo.xml.");
  }

  return candidate;
}

function assertSafeZipEntries(zip, extractRoot) {
  const safeRoot = path.resolve(extractRoot);
  const safePrefix = `${safeRoot}${path.sep}`;

  for (const entry of zip.getEntries()) {
    const destination = path.resolve(extractRoot, entry.entryName);
    if (destination !== safeRoot && !destination.startsWith(safePrefix)) {
      throw new Error("Archive contains an unsafe file path.");
    }
  }
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
