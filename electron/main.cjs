const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const { once } = require("node:events");
const AdmZip = require("adm-zip");
const yauzl = require("yauzl");
const execFileAsync = promisify(execFile);
const {
  getClientBlockedReason,
  getModAudience,
  isClientBlockedServerOnlyMod,
  isClientInstallableManifestMod
} = require("../shared/gdg-sync-core.cjs");

const DEFAULT_GAME_ID = "7dtd";
const GAME_PROFILES = {
  "7dtd": {
    id: "7dtd",
    name: "7 Days to Die",
    shortName: "7DTD",
    steamAppId: "251570",
    steamStoreSlug: "7_Days_to_Die",
    envInstall: "GDG_7DTD_INSTALL",
    defaultServerId: "gdg-test",
    copyFolderName: "7 Days To Die - GDG",
    modsPathSegments: ["Mods"],
    modArchive: "modinfo-folder",
    supportsEac: true,
    directExecutables: ["7DaysToDie.exe", "7DaysToDieServer.exe"],
    eacExecutables: ["7DaysToDie_EAC.exe"],
    rootSignals: ["7DaysToDie.exe", "7DaysToDie_EAC.exe", "7DaysToDie_Data", "7DaysToDieServer.exe"],
    steamCommonNames: ["7 Days To Die", "7 Days to Die", "7 Days To Die Dedicated Server"],
    extraCandidateRoots: () => [path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie")],
    excludedCopyPaths: ["Mods", ".gdg-mod-loader"],
    supportLogName: "7 Days to Die",
    logCandidateRoots: () => [
      path.join(os.homedir(), "AppData", "LocalLow", "The Fun Pimps", "7 Days To Die"),
      path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie"),
      path.join(os.homedir(), "AppData", "Roaming", "7DaysToDie", "logs")
    ]
  },
  repo: {
    id: "repo",
    name: "R.E.P.O.",
    shortName: "R.E.P.O.",
    steamAppId: "3241660",
    steamStoreSlug: "REPO",
    envInstall: "GDG_REPO_INSTALL",
    defaultServerId: "gdg-repo",
    copyFolderName: "R.E.P.O. - GDG",
    modsPathSegments: ["BepInEx", "plugins"],
    modArchive: "generic-folder",
    supportsEac: false,
    directExecutables: ["REPO.exe"],
    eacExecutables: [],
    rootSignals: ["REPO.exe", "REPO_Data"],
    steamCommonNames: ["REPO", "R.E.P.O."],
    extraCandidateRoots: () => [],
    excludedCopyPaths: ["BepInEx", "doorstop_config.ini", "winhttp.dll", ".doorstop_version", ".gdg-mod-loader"],
    excludedCopyPatterns: [
      ".agents",
      ".claude",
      ".git",
      "bepinex.zip",
      "publish-repo-*.sh",
      "repo-publish-*.tgz",
      "temp_*",
      "tmp_*"
    ],
    bootstrapRequiredPaths: ["winhttp.dll", "doorstop_config.ini", "BepInEx/core/BepInEx.dll"],
    bootstrapInstallPaths: ["winhttp.dll", "doorstop_config.ini", ".doorstop_version", "BepInEx/core", "BepInEx/config/BepInEx.cfg"],
    supportLogName: "R.E.P.O.",
    logCandidateRoots: () => [
      path.join(os.homedir(), "AppData", "LocalLow", "semiwork", "REPO"),
      path.join(os.homedir(), "AppData", "LocalLow", "semiwork", "R.E.P.O.")
    ]
  },
  minecraft: {
    id: "minecraft",
    name: "Minecraft Java",
    shortName: "Minecraft",
    platform: "prism",
    steamAppId: "",
    steamStoreSlug: "",
    envInstall: "GDG_MINECRAFT_INSTANCE",
    defaultServerId: "gdg-minecraft-otherworld",
    copyFolderName: "",
    modsPathSegments: ["minecraft", "mods"],
    modArchive: "generic-folder",
    managesModsExternally: true,
    supportsEac: false,
    supportsCopy: false,
    directExecutables: [],
    eacExecutables: [],
    rootSignals: ["instance.cfg", "mmc-pack.json", "minecraft"],
    rootSignalMode: "all",
    steamCommonNames: [],
    extraCandidateRoots: () => [
      path.join(os.homedir(), "AppData", "Roaming", "PrismLauncher", "instances", "Otherworld [Dungeons & Dragons]"),
      path.join(os.homedir(), "curseforge", "minecraft", "Instances", "Otherworld [Dungeons & Dragons]")
    ],
    excludedCopyPaths: [],
    supportLogName: "Minecraft Java",
    launchServer: "goldendays.mcsh.io",
    prismPackProjectId: "1418133",
    prismPackVersionId: "8074976",
    prismPackVersionName: "Otherworld v8 HF2",
    prismPackMinimumInstalledAddons: 390,
    prismPackMinimumModFiles: 390,
    prismPackRequiredPaths: ["manifest.json", "config", "mods", "configureddefaults"],
    priorGdgPacks: [
      {
        name: "SUPERIOR - RPG",
        projectId: "1293866"
      },
      {
        name: "FTB Presents Stoneblock 2",
        projectId: "310396"
      }
    ],
    bootstrapManifestPath: path.join(__dirname, "..", "server-directory", "minecraft-bootstrap.json"),
    bundledAddons: [
      {
        sourcePath: path.join(__dirname, "..", "server-directory", "addons", "GDG-Quick-Join.jar"),
        targetName: "GDG-Quick-Join.jar",
        ownedPrefix: "gdg-quick-join"
      }
    ],
    launcherCandidates: () => [
      path.join(getManagedMinecraftRoot(), "runtime", "11.0.3", "prismlauncher.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "PrismLauncher", "prismlauncher.exe"),
      path.join(os.homedir(), "scoop", "apps", "prismlauncher", "current", "prismlauncher.exe"),
      "C:\\Program Files\\PrismLauncher\\prismlauncher.exe"
    ],
    curseForgeLauncherCandidates: () => [
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "CurseForge Windows", "CurseForge.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "CurseForge", "CurseForge.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CurseForge", "CurseForge.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "CurseForge", "CurseForge.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "CurseForge", "CurseForge.exe")
    ],
    curseForgeGameId: 432,
    logCandidateRoots: () => [
      path.join(os.homedir(), "AppData", "Roaming", "PrismLauncher", "logs"),
      path.join(getManagedPrismDataRoot(), "logs"),
      path.join(os.homedir(), "AppData", "Roaming", "CurseForge", "logs"),
      path.join(os.homedir(), "AppData", "Roaming", "CurseForge", "agent", "logs", "CurseClient")
    ]
  }
};
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
    const detected = await detectGameInstall(config.gameId);
    return { config, detected };
  });

  ipcMain.handle("gdg:save-config", async (_event, patch) => {
    return saveConfig(patch);
  });

  ipcMain.handle("gdg:detect-game", async (_event, payload = {}) => {
    const gameId = payload?.gameId || (await loadConfig()).gameId;
    return detectGameInstall(gameId);
  });

  ipcMain.handle("gdg:provision-minecraft", async (event, payload = {}) => {
    return provisionMinecraftInstance(payload, (progress) => {
      sendIpcProgress(event, "gdg:sync-progress", progress);
    });
  });

  ipcMain.handle("gdg:select-game-folder", async () => {
    const profile = getGameProfile((await loadConfig()).gameId);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${profile.name} folder`,
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedPath = result.filePaths[0];
    return {
      canceled: false,
      path: selectedPath,
      valid: await isGameRoot(selectedPath, profile.id)
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
    return getGameVersionInfo(payload.gamePath, await resolvePayloadGameId(payload));
  });

  ipcMain.handle("gdg:clone-game-install", async (event, payload) => {
    return cloneGameInstall(payload, (progress) => {
      sendIpcProgress(event, "gdg:clone-progress", progress);
    });
  });

  ipcMain.handle("gdg:scan-mods", async (_event, payload) => {
    return scanMods(payload.gamePath, { hash: false, gameId: await resolvePayloadGameId(payload) });
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
    const profile = getGameProfile((await loadConfig()).gameId);
    if (profile.platform === "prism") {
      try {
        const config = await loadConfig();
        const gamePath = path.resolve(String(config.gamePath || ""));
        if (await getMinecraftInstanceManager(gamePath) === "curseforge") {
          const executable = await findCurseForgeLauncher(profile);
          const child = spawn(executable, [], {
            cwd: path.dirname(executable),
            detached: true,
            stdio: "ignore",
            windowsHide: false
          });
          child.unref();
          return { ok: true, target: "launcher", manager: "curseforge" };
        }
        const executable = await findPrismLauncher(profile, gamePath);
        const prismRoot = path.dirname(path.dirname(gamePath));
        const child = spawn(executable, ["--dir", prismRoot, "--show", path.basename(gamePath)], {
          cwd: path.dirname(executable),
          detached: true,
          stdio: "ignore",
          windowsHide: false
        });
        child.unref();
        return { ok: true, target: "launcher", manager: "prism" };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    try {
      await shell.openExternal(`steam://nav/games/details/${profile.steamAppId}`);
      return { ok: true, target: "steam" };
    } catch (error) {
      try {
        await shell.openExternal(`https://store.steampowered.com/app/${profile.steamAppId}/${profile.steamStoreSlug}/`);
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

  ipcMain.handle("gdg:copy-file-to-clipboard", async (_event, payload) => {
    try {
      const result = await copyFileToClipboard(payload?.filePath);
      return { ok: true, ...result };
    } catch (error) {
      await appendDiagnosticLog("gdg:copy-file-to-clipboard", error);
      return { ok: false, error: error.message || "File could not be copied." };
    }
  });

  ipcMain.handle("gdg:open-path", async (_event, payload) => {
    if (!payload?.filePath) {
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
        {
          label: "Open Support Bundle Folder",
          click: () => {
            void openSupportBundlesFolderFromMenu();
          }
        },
        {
          label: "Clean Up Support Bundle Folder...",
          click: () => {
            void cleanSupportBundlesFolderFromMenu();
          }
        },
        { type: "separator" },
        { role: "quit" }
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

function getSupportBundlesFolder() {
  return path.join(app.getPath("userData"), "support-bundles");
}

async function openSupportBundlesFolder() {
  const folderPath = getSupportBundlesFolder();
  await fsp.mkdir(folderPath, { recursive: true });
  const result = await shell.openPath(folderPath);
  if (result) {
    throw new Error(result);
  }
}

async function openSupportBundlesFolderFromMenu() {
  try {
    await openSupportBundlesFolder();
  } catch (error) {
    await appendDiagnosticLog("menu:open-support-bundles-folder", error);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Support folder failed",
      message: "The support bundle folder could not be opened.",
      detail: error.message || String(error)
    });
  }
}

async function cleanSupportBundlesFolderFromMenu() {
  try {
    const folderPath = getSupportBundlesFolder();
    await fsp.mkdir(folderPath, { recursive: true });
    const entries = await fsp.readdir(folderPath, { withFileTypes: true });
    const zipFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));

    if (zipFiles.length === 0) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Support bundle folder is clean",
        message: "No support bundle ZIP files were found."
      });
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Delete ZIP Files", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Clean up support bundles",
      message: `Delete ${zipFiles.length} support bundle ZIP file${zipFiles.length === 1 ? "" : "s"}?`,
      detail: `This only deletes ZIP files in:\n${folderPath}`
    });

    if (choice.response !== 0) {
      return;
    }

    let deleted = 0;
    const resolvedFolder = path.resolve(folderPath);
    for (const entry of zipFiles) {
      const filePath = path.join(folderPath, entry.name);
      const resolvedPath = path.resolve(filePath);
      const relativePath = path.relative(resolvedFolder, resolvedPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        continue;
      }
      await fsp.rm(resolvedPath, { force: true });
      deleted += 1;
    }

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Support bundles cleaned",
      message: `Deleted ${deleted} support bundle ZIP file${deleted === 1 ? "" : "s"}.`
    });
  } catch (error) {
    await appendDiagnosticLog("menu:clean-support-bundles-folder", error);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Support cleanup failed",
      message: "The support bundle folder could not be cleaned.",
      detail: error.message || String(error)
    });
  }
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

async function copyFileToClipboard(filePath) {
  const rawPath = String(filePath || "").trim();
  if (!rawPath) {
    throw new Error("Missing support ZIP path.");
  }

  const resolvedPath = path.resolve(normalizeLocalPath(rawPath));
  if (!(await exists(resolvedPath))) {
    throw new Error("Support ZIP was not found.");
  }

  const stats = await fsp.stat(resolvedPath);
  if (!stats.isFile()) {
    throw new Error("Only files can be copied to Discord.");
  }

  return new Promise((resolve, reject) => {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      "$target = [Environment]::GetEnvironmentVariable('GDG_CLIPBOARD_FILE')",
      "if (-not $target) { throw 'Missing clipboard file path.' }",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$files = New-Object System.Collections.Specialized.StringCollection",
      "[void] $files.Add($target)",
      "[System.Windows.Forms.Clipboard]::SetFileDropList($files)"
    ].join("; ");
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-Sta",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript
    ], {
      windowsHide: true,
      env: {
        ...process.env,
        GDG_CLIPBOARD_FILE: resolvedPath
      }
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ path: resolvedPath });
        return;
      }

      reject(new Error(stderr.trim() || `Clipboard copy failed with exit code ${code}.`));
    });
  });
}

async function createSupportBundle(onProgress = () => {}) {
  const createdAt = new Date();
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const folderPath = getSupportBundlesFolder();
  const fileName = `GDG-Support-Bundle-${timestamp}.zip`;
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
  const profile = getGameProfile(config.gameId);
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
      gameId: profile.id,
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
  reportSupportBundleProgress(onProgress, "scanning", `Collecting recent ${profile.name} logs.`, 6, totalSteps);
  await addRecentGameLogsToZip(zip, config, errors);

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
    const config = await loadConfig();
    addJsonToZip(zip, "detected-game.json", await detectGameInstall(config.gameId));
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
    addJsonToZip(zip, "local-game-version.json", await getGameVersionInfo(config.gamePath, config.gameId));
  } catch (error) {
    errors.push({ section: "local-game-version", error: error.message });
  }

  try {
    addJsonToZip(zip, "local-disk-space.json", await getDiskSpace(config.gamePath));
  } catch (error) {
    errors.push({ section: "local-disk-space", error: error.message });
  }

  try {
    addJsonToZip(zip, "local-mods.json", await scanMods(config.gamePath, { hash: false, gameId: config.gameId }));
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
    validateManifest(manifest, config.gameId);
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
      gameId: config.gameId,
      gamePath: config.gamePath,
      manifestInput: config.manifestInput
    });
    addJsonToZip(zip, "sync-preview.json", preview);
    addJsonToZip(zip, "skipped-server-only.json", preview.skippedServerOnly || []);
    addJsonToZip(zip, "preflight-doctor.json", await runPreflightDoctor({
      gameId: config.gameId,
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

async function addRecentGameLogsToZip(zip, config, errors) {
  const profile = getGameProfile(config.gameId);
  try {
    const logs = await collectRecentGameLogs(config.gamePath, profile.id);
    addJsonToZip(zip, "game-logs/index.json", logs.map((log) => ({
      sourcePath: log.path,
      sizeBytes: log.size,
      modifiedAt: log.modifiedAt
    })));

    for (const log of logs) {
      const safeName = sanitizeZipSegment(`${log.modifiedAt.replace(/[:.]/g, "-")}-${path.basename(log.path)}`);
      addTextToZip(zip, `game-logs/${safeName}`, await readTextTail(log.path, 5 * 1024 * 1024));
    }
  } catch (error) {
    errors.push({ section: "game-logs", error: error.message });
  }
}

async function collectRecentGameLogs(gamePath, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const candidates = [
    ...profile.logCandidateRoots()
  ];

  if (gamePath) {
    for (const signal of profile.rootSignals.filter((item) => item.endsWith("_Data"))) {
      candidates.push(path.join(gamePath, signal));
    }
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
  const profile = getGameProfile(config.gameId);
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

  if (!isGdgCopyPathForGame(gamePath, profile.id) || !(await isGameRoot(gamePath, profile.id))) {
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["OK"],
      title: "Delete GDG Copy",
      message: "GDG refused to delete the selected folder.",
      detail: `This option only deletes folders named "${profile.copyFolderName}".\n\nSelected folder:\n${gamePath}`
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
    const detected = await detectGameInstall(profile.id);

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

function getGameProfile(gameId) {
  return GAME_PROFILES[String(gameId || DEFAULT_GAME_ID).toLowerCase()] || GAME_PROFILES[DEFAULT_GAME_ID];
}

function assertLoaderModWritesAllowed(gameId) {
  const profile = getGameProfile(gameId);
  if (profile.managesModsExternally) {
    throw new Error(`${profile.name} pack files are managed by the selected Minecraft launcher. Update or repair the pack there.`);
  }
}

async function resolvePayloadGameId(payload = {}) {
  if (payload?.gameId) {
    return getGameProfile(payload.gameId).id;
  }

  const config = await loadConfig();
  return getGameProfile(config.gameId).id;
}

function getGameModsPath(gamePath, gameId) {
  const profile = getGameProfile(gameId);
  if (profile.id === "minecraft") {
    const resolved = path.resolve(String(gamePath || ""));
    return fs.existsSync(path.join(resolved, "minecraftinstance.json"))
      ? path.join(resolved, "mods")
      : path.join(resolved, ...profile.modsPathSegments);
  }
  return path.join(path.resolve(String(gamePath || "")), ...profile.modsPathSegments);
}

function getGameCopyLabel(gameId) {
  return `${getGameProfile(gameId).shortName} GDG copy`;
}

function isGdgCopyPathForGame(candidatePath, gameId) {
  const profile = getGameProfile(gameId);
  return path.basename(String(candidatePath || "")).toLowerCase() === profile.copyFolderName.toLowerCase();
}

function defaultManifestGameId(manifest) {
  return getGameProfile(manifest?.game).id;
}

async function loadConfig() {
  const filePath = getConfigPath();
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = {
      ...getDefaultConfig(),
      ...JSON.parse(raw)
    };
    const profile = getGameProfile(parsed.gameId);
    return {
      ...parsed,
      gameId: profile.id,
      lastServerId: parsed.lastServerId || profile.defaultServerId
    };
  } catch {
    return getDefaultConfig();
  }
}

async function saveConfig(patch) {
  const current = await loadConfig();
  const profile = getGameProfile(patch?.gameId || current.gameId);
  const next = {
    ...current,
    ...patch,
    gameId: profile.id,
    configVersion: CONFIG_VERSION
  };

  await fsp.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fsp.writeFile(getConfigPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getDefaultConfig() {
  const profile = getGameProfile(DEFAULT_GAME_ID);
  return {
    configVersion: CONFIG_VERSION,
    gameId: profile.id,
    gamePath: "",
    manifestInput: "",
    serverDirectoryInput: DEFAULT_SERVER_DIRECTORY,
    lastServerId: profile.defaultServerId,
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

async function detectGameInstall(gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const candidateRoots = [];
  if (process.env[profile.envInstall]) {
    candidateRoots.push({ path: process.env[profile.envInstall], priority: -10 });
  }

  const steamAppsFolders = profile.platform === "prism" ? [] : await detectSteamAppsFolders();

  for (const steamApps of steamAppsFolders) {
    const installedDir = await readSteamInstallDir(steamApps, profile.steamAppId);
    if (installedDir) {
      candidateRoots.push({ path: path.join(steamApps, "common", installedDir), priority: -2 });
    }
    for (const commonName of profile.steamCommonNames) {
      candidateRoots.push({ path: path.join(steamApps, "common", commonName), priority: 0 });
    }
  }

  const extraCandidateRoots = [...profile.extraCandidateRoots()];
  if (profile.platform === "prism") {
    const instanceRoots = [
      path.join(os.homedir(), "AppData", "Roaming", "PrismLauncher", "instances"),
      path.join(getManagedPrismDataRoot(), "instances")
    ];
    for (const instancesRoot of instanceRoots) {
      try {
        const entries = await fsp.readdir(instancesRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            extraCandidateRoots.push(path.join(instancesRoot, entry.name));
          }
        }
      } catch {
        // Prism and the GDG-managed data root are optional until Minecraft setup runs.
      }
    }
    for (const candidatePath of await discoverCurseForgeMinecraftInstances()) {
      extraCandidateRoots.push(candidatePath);
    }
  }

  for (const candidatePath of extraCandidateRoots) {
    const isCurseForgeMinecraft = profile.id === "minecraft"
      && await exists(path.join(candidatePath, "minecraftinstance.json"));
    candidateRoots.push({ path: candidatePath, priority: isCurseForgeMinecraft ? 70 : 80 });
  }

  const validCandidates = [];
  for (const candidate of dedupeCandidates(candidateRoots)) {
    if (await isGameRoot(candidate.path, profile.id) && await isMatchingPrismPack(candidate.path, profile, profile.platform === "prism")) {
      const isGdgCopy = isGdgCopyPathForGame(candidate.path, profile.id);
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
      gameId: profile.id,
      name: profile.name,
      path: best.path,
      modsPath: getGameModsPath(best.path, profile.id),
      isGdgCopy: best.isGdgCopy
    };
  }

  return {
    found: false,
    gameId: profile.id,
    name: profile.name,
    path: "",
    modsPath: "",
    isGdgCopy: false
  };
}

async function isMatchingPrismPack(candidatePath, profile, requireExactVersion = false) {
  if (profile.platform !== "prism" || !profile.prismPackProjectId) {
    return true;
  }

  const curseForgeMetadataPath = path.join(candidatePath, "minecraftinstance.json");
  if (await exists(curseForgeMetadataPath)) {
    try {
      if (await exists(path.join(candidatePath, "install-journal.json"))) {
        return false;
      }
      const metadata = JSON.parse(await fsp.readFile(curseForgeMetadataPath, "utf8"));
      const projectMatches = String(metadata.projectID || "") === String(profile.prismPackProjectId);
      const versionMatches = String(metadata.fileID || "") === String(profile.prismPackVersionId);
      if (!projectMatches || (requireExactVersion && !versionMatches)) {
        return false;
      }
      const completion = await inspectCurseForgeInstanceCompletion(candidatePath, metadata, {
        projectId: profile.prismPackProjectId,
        fileId: profile.prismPackVersionId,
        minimumInstalledAddons: profile.prismPackMinimumInstalledAddons,
        minimumModFiles: profile.prismPackMinimumModFiles,
        requiredPaths: profile.prismPackRequiredPaths || ["manifest.json", "config", "mods"]
      });
      return completion.ok;
    } catch {
      return false;
    }
  }

  try {
    const values = parseSimpleIni(await fsp.readFile(path.join(candidatePath, "instance.cfg"), "utf8"));
    const projectMatches = String(values.ManagedPackID || "") === String(profile.prismPackProjectId);
    const versionMatches = String(values.ManagedPackVersionID || "") === String(profile.prismPackVersionId);
    return projectMatches && (!requireExactVersion || versionMatches);
  } catch {
    return false;
  }
}

async function discoverCurseForgeMinecraftInstances() {
  const candidates = new Set();
  const defaultInstancesRoot = path.join(os.homedir(), "curseforge", "minecraft", "Instances");
  try {
    const entries = await fsp.readdir(defaultInstancesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.add(path.join(defaultInstancesRoot, entry.name));
      }
    }
  } catch {
    // CurseForge is optional until Minecraft setup runs.
  }

  const databasePath = path.join(os.homedir(), "AppData", "Roaming", "CurseForge", "agent", "GameInstances", "MinecraftGameInstance.json");
  try {
    const instances = JSON.parse(await fsp.readFile(databasePath, "utf8"));
    for (const instance of Array.isArray(instances) ? instances : []) {
      const installPath = String(instance?.installPath || "").trim();
      if (installPath) {
        candidates.add(path.resolve(installPath));
      }
    }
  } catch {
    // The instance database does not exist on a clean CurseForge install.
  }

  return [...candidates];
}

async function discoverPriorGdgMinecraftInstances(profile = GAME_PROFILES.minecraft) {
  const candidates = new Set(await discoverCurseForgeMinecraftInstances());
  const prismInstanceRoots = [
    path.join(os.homedir(), "AppData", "Roaming", "PrismLauncher", "instances"),
    path.join(getManagedPrismDataRoot(), "instances")
  ];

  for (const instancesRoot of prismInstanceRoots) {
    try {
      const entries = await fsp.readdir(instancesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.add(path.join(instancesRoot, entry.name));
        }
      }
    } catch {
      // Prism is optional and may not have an instances folder.
    }
  }

  const priorPacks = Array.isArray(profile.priorGdgPacks) ? profile.priorGdgPacks : [];
  const matches = [];
  for (const candidatePath of candidates) {
    const identity = await readMinecraftPackIdentity(candidatePath);
    const priorPack = priorPacks.find((pack) => String(pack.projectId) === identity.projectId);
    if (!priorPack || !(await isSafeMinecraftInstanceDirectory(candidatePath, identity.manager))) {
      continue;
    }
    matches.push({
      path: path.resolve(candidatePath),
      manager: identity.manager,
      name: identity.name || priorPack.name,
      projectId: identity.projectId,
      fileId: identity.fileId
    });
  }

  const deduped = new Map();
  for (const match of matches) {
    deduped.set(match.path.toLowerCase(), match);
  }
  return [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function readMinecraftPackIdentity(instancePath) {
  try {
    const metadata = JSON.parse(await fsp.readFile(path.join(instancePath, "minecraftinstance.json"), "utf8"));
    return {
      manager: "curseforge",
      name: String(metadata.name || metadata.baseModLoader?.name || path.basename(instancePath)).trim(),
      projectId: String(metadata.projectID || ""),
      fileId: String(metadata.fileID || "")
    };
  } catch {
    // Try Prism metadata below.
  }

  try {
    const values = parseSimpleIni(await fsp.readFile(path.join(instancePath, "instance.cfg"), "utf8"));
    return {
      manager: "prism",
      name: String(values.name || path.basename(instancePath)).trim(),
      projectId: String(values.ManagedPackID || ""),
      fileId: String(values.ManagedPackVersionID || "")
    };
  } catch {
    return { manager: "", name: "", projectId: "", fileId: "" };
  }
}

async function isSafeMinecraftInstanceDirectory(instancePath, manager) {
  try {
    const resolvedPath = path.resolve(instancePath);
    const stats = await fsp.lstat(resolvedPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return false;
    }
    const realPath = await fsp.realpath(resolvedPath);
    if (realPath.toLowerCase() !== resolvedPath.toLowerCase()) {
      return false;
    }
    if (manager === "curseforge") {
      return await exists(path.join(resolvedPath, "minecraftinstance.json"))
        && await exists(path.join(resolvedPath, "manifest.json"))
        && await exists(path.join(resolvedPath, "mods"));
    }
    if (manager === "prism") {
      return await isGameRoot(resolvedPath, "minecraft");
    }
    return false;
  } catch {
    return false;
  }
}

async function readSteamInstallDir(steamApps, appId) {
  const manifestPath = path.join(steamApps, `appmanifest_${appId}.acf`);
  if (!(await exists(manifestPath))) {
    return "";
  }

  const values = parseSteamAppManifest(await fsp.readFile(manifestPath, "utf8"));
  return values.installdir || "";
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

async function isGameRoot(candidatePath, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  if (!candidatePath || !(await exists(candidatePath))) {
    return false;
  }

  if (profile.id === "minecraft") {
    if (await exists(path.join(candidatePath, "minecraftinstance.json"))) {
      return true;
    }
    const prismSignals = await Promise.all(profile.rootSignals.map((signal) => exists(path.join(candidatePath, signal))));
    return prismSignals.every(Boolean);
  }

  const signalResults = await Promise.all(profile.rootSignals.map((signal) => exists(path.join(candidatePath, signal))));
  return profile.rootSignalMode === "all" ? signalResults.every(Boolean) : signalResults.some(Boolean);
}

async function cloneGameInstall(payload = {}, onProgress = () => {}) {
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  reportCloneProgress(onProgress, {
    phase: "preparing",
    message: `Preparing ${getGameCopyLabel(gameId)}.`,
    current: 0,
    total: 0,
    percent: 0
  });

  if (!payload.sourcePath) {
    throw new Error(`A detected ${profile.name} folder is required before creating a GDG copy.`);
  }

  const sourcePath = path.resolve(String(payload.sourcePath));
  const folderName = sanitizeFolderName(payload.folderName || profile.copyFolderName);
  const targetPath = path.join(path.dirname(sourcePath), folderName);

  if (!(await isGameRoot(sourcePath, gameId))) {
    throw new Error(`The detected folder does not look like a ${profile.name} install.`);
  }

  if (sourcePath.toLowerCase() === path.resolve(targetPath).toLowerCase()) {
    throw new Error("The GDG copy needs to be separate from the detected game folder.");
  }

  let created = false;
  if (await exists(targetPath)) {
    if (!(await isGameRoot(targetPath, gameId))) {
      throw new Error(`The target folder already exists and is not a ${profile.name} install: ${targetPath}`);
    }
    reportCloneProgress(onProgress, {
      phase: "complete",
      message: `Existing ${getGameCopyLabel(gameId)} is ready.`,
      current: 1,
      total: 1,
      percent: 100
    });
  } else {
    await copyDirectoryWithProgress(sourcePath, targetPath, onProgress, gameId);
    created = true;
  }

  await fsp.mkdir(getGameModsPath(targetPath, gameId), { recursive: true });

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
      shortcutPath = await createGameShortcut(targetPath, folderName, gameId);
    } catch (error) {
      shortcutError = error.message;
    }
  }

  reportCloneProgress(onProgress, {
    phase: "complete",
    message: created ? `${getGameCopyLabel(gameId)} created.` : `${getGameCopyLabel(gameId)} selected.`,
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

async function copyDirectoryWithProgress(sourceRoot, targetRoot, onProgress, gameId = DEFAULT_GAME_ID) {
  reportCloneProgress(onProgress, {
    phase: "scanning",
    message: "Scanning game files. Existing mods will not be copied.",
    current: 0,
    total: 0,
    percent: 1
  });

  const plan = await buildCopyPlan(sourceRoot, targetRoot, gameId);
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

async function buildCopyPlan(sourceRoot, targetRoot, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const directories = [];
  const files = [];
  let totalBytes = 0;

  async function visit(currentSource) {
    const entries = await fsp.readdir(currentSource, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath);
      if (isExcludedGameCopyPath(relativePath, profile)) {
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

function isExcludedGameCopyPath(relativePath, profile = getGameProfile(DEFAULT_GAME_ID)) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").toLowerCase();
  const excludedByPath = profile.excludedCopyPaths.some((excludedPath) => {
    const excluded = String(excludedPath || "").replace(/\\/g, "/").toLowerCase();
    return normalized === excluded || normalized.startsWith(`${excluded}/`);
  });
  if (excludedByPath) {
    return true;
  }

  return (profile.excludedCopyPatterns || []).some((pattern) => matchesCopyExcludePattern(normalized, pattern));
}

function matchesCopyExcludePattern(normalizedRelativePath, pattern) {
  const normalizedPattern = String(pattern || "").replace(/\\/g, "/").toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  const firstSegment = normalizedRelativePath.split("/")[0] || normalizedRelativePath;
  const candidate = normalizedPattern.includes("/") ? normalizedRelativePath : firstSegment;
  if (!normalizedPattern.includes("*")) {
    return candidate === normalizedPattern || normalizedRelativePath.startsWith(`${normalizedPattern}/`);
  }

  const expression = new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, ".*")}$`);
  return expression.test(candidate);
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

async function copyFileWithProgress(sourcePath, targetPath, onChunk) {
  const readStream = fs.createReadStream(sourcePath);
  readStream.on("data", (chunk) => onChunk(chunk.length));
  await pipeline(readStream, fs.createWriteStream(targetPath, { flags: "wx" }));
}

async function createGameShortcut(gamePath, shortcutName, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  if (process.platform !== "win32" || typeof shell.writeShortcutLink !== "function") {
    throw new Error("Desktop shortcuts are currently supported on Windows.");
  }

  const target = await findGameExecutable(gamePath, { gameId, eacEnabled: false });
  const shortcutPath = path.join(app.getPath("desktop"), `${sanitizeFolderName(shortcutName)}.lnk`);
  const created = shell.writeShortcutLink(shortcutPath, {
    target,
    cwd: gamePath,
    description: `Launch ${profile.name} with the GDG mod setup`,
    icon: target
  });

  if (!created) {
    throw new Error("Desktop shortcut could not be created.");
  }

  return shortcutPath;
}

async function findGameExecutable(gamePath, options = {}) {
  const profile = getGameProfile(options.gameId);
  const eacEnabled = Boolean(options.eacEnabled);
  const eacCandidates = profile.eacExecutables.map((name) => path.join(gamePath, name));
  const directCandidates = profile.directExecutables.map((name) => path.join(gamePath, name));
  const candidates = eacEnabled ? [...eacCandidates, ...directCandidates] : directCandidates;

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  if (profile.supportsEac && !eacEnabled) {
    throw new Error(`No non-EAC ${profile.name} executable was found. Verify this GDG copy in Steam or recreate it before launching with EAC off.`);
  }

  throw new Error(`No ${profile.name} executable was found.`);
}

function getManagedMinecraftRoot() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "GoldenDaysGaming", "Minecraft");
}

function getManagedPrismDataRoot() {
  return path.join(getManagedMinecraftRoot(), "PrismData");
}

async function loadMinecraftBootstrapManifest(profile = GAME_PROFILES.minecraft) {
  const raw = await fsp.readFile(profile.bootstrapManifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const launcher = manifest?.launcher || {};
  const pack = manifest?.pack || {};
  const requiredFields = [
    [launcher.name, "launcher name"],
    [launcher.url, "launcher URL"],
    [launcher.expectedPublisher, "launcher publisher"],
    [pack.name, "pack name"],
    [pack.projectId, "pack project ID"],
    [pack.fileId, "pack file ID"],
    [pack.installUri, "pack install URI"]
  ];
  const missing = requiredFields.find(([value]) => !String(value || "").trim());
  if (missing) {
    throw new Error(`Minecraft bootstrap manifest is missing ${missing[1]}.`);
  }
  if (!/^https:\/\//i.test(launcher.url)) {
    throw new Error("The CurseForge installer download must use HTTPS.");
  }
  const expectedInstallUri = `curseforge://install?addonId=${pack.projectId}&fileId=${pack.fileId}`;
  if (pack.installUri !== expectedInstallUri) {
    throw new Error("Minecraft bootstrap install URI does not match the selected pack identity.");
  }
  return manifest;
}

async function provisionMinecraftInstance(payload = {}, onProgress = () => {}) {
  const profile = getGameProfile("minecraft");
  const manifest = await loadMinecraftBootstrapManifest(profile);
  if (String(manifest.pack.projectId) !== String(profile.prismPackProjectId) || String(manifest.pack.fileId) !== String(profile.prismPackVersionId)) {
    throw new Error("Minecraft bootstrap pack identity does not match the selected GDG server.");
  }

  const existing = await detectGameInstall(profile.id);
  if (existing.found) {
    await ensureBundledAddons(existing.path, profile);
    const manager = await getMinecraftInstanceManager(existing.path);
    const runtime = manager === "curseforge" ? await findCurseForgeRuntime(profile) : null;
    return {
      ok: true,
      created: false,
      instancePath: existing.path,
      modsPath: getGameModsPath(existing.path, profile.id),
      launcherPath: manager === "curseforge"
        ? runtime.launcherPath || "curseforge://"
        : await findPrismLauncher(profile, existing.path),
      manager,
      managed: manager === "curseforge" || isPathInside(existing.path, getManagedPrismDataRoot()),
      recycledInstances: []
    };
  }

  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Automatic Minecraft setup currently supports Windows x64. You can still browse to an existing Prism or CurseForge instance.");
  }

  const migration = await choosePriorGdgMinecraftMigration(profile, manifest.pack);
  if (migration.canceled) {
    return { ok: false, canceled: true };
  }

  const managedRoot = getManagedMinecraftRoot();
  const cacheRoot = path.join(managedRoot, "cache");
  const minimumFreeBytes = Number(manifest.minimumFreeBytes || 0);
  const diskSpace = await getDiskSpace(managedRoot);
  if (minimumFreeBytes && diskSpace.freeBytes < minimumFreeBytes) {
    throw new Error(`Minecraft setup needs at least ${formatBytes(minimumFreeBytes)} free, but this drive has ${formatBytes(diskSpace.freeBytes)}.`);
  }
  await fsp.mkdir(cacheRoot, { recursive: true });

  reportSyncProgress(onProgress, {
    phase: "preparing",
    message: "Preparing CurseForge for the Golden Days Minecraft profile.",
    current: 0,
    total: 3
  });

  const runtime = await ensureCurseForgeRuntime(manifest.launcher, cacheRoot, onProgress);

  reportSyncProgress(onProgress, {
    phase: "installing",
    message: `CurseForge is installing ${manifest.pack.name}. Complete CurseForge sign-in if prompted; GDG will wait until the exact pack is installed.`,
    modName: manifest.pack.name,
    current: 2,
    total: 3
  });

  await openCurseForgeUri(manifest.pack.installUri, runtime);

  const timeoutMs = Math.max(Number(manifest.confirmationTimeoutMinutes || 30), 1) * 60 * 1000;
  const installed = await waitForMatchingCurseForgeInstance(profile, manifest.pack, timeoutMs, onProgress, async () => {
    await openCurseForgeUri(manifest.pack.installUri, runtime);
  });
  await ensureBundledAddons(installed.path, profile);

  reportSyncProgress(onProgress, {
    phase: "complete",
    message: `${manifest.pack.name} is ready in CurseForge with every required pack file.`,
    current: 3,
    total: 3
  });

  return {
    ok: true,
    created: true,
    instancePath: installed.path,
    modsPath: getGameModsPath(installed.path, profile.id),
    launcherPath: runtime.launcherPath || "curseforge://",
    manager: "curseforge",
    managed: true,
    dataRoot: path.dirname(path.dirname(installed.path)),
    sourcePage: manifest.pack.sourcePage || "",
    licenseUrl: manifest.launcher.downloadPage || "",
    recycledInstances: migration.recycledInstances
  };
}

async function choosePriorGdgMinecraftMigration(profile, nextPack) {
  const priorInstances = await discoverPriorGdgMinecraftInstances(profile);
  if (priorInstances.length === 0) {
    return { canceled: false, recycledInstances: [] };
  }

  const instanceList = priorInstances
    .map((instance) => `${instance.name} (${instance.manager === "curseforge" ? "CurseForge" : "Prism"})\n${instance.path}`)
    .join("\n\n");
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Keep Old & Create Otherworld", "Move Old to Recycle Bin & Create Otherworld", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: "Choose what to do with the old GDG modpack",
    message: `An older Golden Days Minecraft instance was found. How should GDG set up ${nextPack.name}?`,
    detail: `Keep preserves the old instance and creates/selects Otherworld separately. Recycle removes only the verified prior GDG Superior or Stoneblock instance shown below; unrelated Minecraft modpacks are never touched.\n\n${instanceList}`
  });

  if (choice.response === 2) {
    return { canceled: true, recycledInstances: [] };
  }
  if (choice.response === 0) {
    return { canceled: false, recycledInstances: [] };
  }

  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Move to Recycle Bin", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "Recycle the old GDG Minecraft instance?",
    message: `Move ${priorInstances.length === 1 ? "the old GDG instance" : `${priorInstances.length} old GDG instances`} to the Recycle Bin?`,
    detail: `This is recoverable from the Windows Recycle Bin. Close Minecraft for these instances first. CurseForge or Prism may need to be refreshed afterward.\n\n${instanceList}`
  });
  if (confirmation.response !== 0) {
    return { canceled: true, recycledInstances: [] };
  }

  const recycledInstances = [];
  for (const instance of priorInstances) {
    const identity = await readMinecraftPackIdentity(instance.path);
    const isKnownPriorPack = profile.priorGdgPacks.some((pack) => String(pack.projectId) === identity.projectId);
    if (!isKnownPriorPack || identity.manager !== instance.manager || !(await isSafeMinecraftInstanceDirectory(instance.path, instance.manager))) {
      throw new Error(`GDG stopped before removing an instance because its identity changed:\n${instance.path}`);
    }
    await shell.trashItem(instance.path);
    recycledInstances.push(instance.path);
  }

  return { canceled: false, recycledInstances };
}

async function ensureCurseForgeRuntime(launcher, cacheRoot, onProgress = () => {}) {
  try {
    return await findCurseForgeRuntime(GAME_PROFILES.minecraft);
  } catch {
    // Install the signed standalone client below.
  }

  const installerPath = await downloadSignedCurseForgeInstaller(launcher, cacheRoot, (download) => {
    reportSyncProgress(onProgress, {
      phase: "downloading",
      message: `Downloading the signed ${launcher.name} installer.`,
      modName: launcher.name,
      current: 1,
      total: 3,
      ...download
    });
  });

  reportSyncProgress(onProgress, {
    phase: "installing",
    message: `Installing ${launcher.name}.`,
    modName: launcher.name,
    current: 1,
    total: 3
  });
  const child = spawn(installerPath, [], {
    cwd: path.dirname(installerPath),
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const runtime = await findCurseForgeRuntime(GAME_PROFILES.minecraft);
      await delay(2000);
      return runtime;
    } catch {
      reportSyncProgress(onProgress, {
        phase: "installing",
        message: `Waiting for ${launcher.name} installation to finish.`,
        modName: launcher.name,
        current: 1,
        total: 3
      });
      await delay(1000);
    }
  }
  throw new Error("CurseForge installation timed out. Finish or retry the CurseForge installer, then run Make Me Ready again.");
}

async function downloadSignedCurseForgeInstaller(launcher, cacheRoot, onDownload = () => {}) {
  const fileName = sanitizeFolderName(launcher.fileName || "CurseForgeInstaller.exe");
  const targetPath = path.join(cacheRoot, fileName);
  const maxSizeBytes = Math.max(Number(launcher.maxSizeBytes || 0), 10 * 1024 * 1024);

  if (await exists(targetPath)) {
    try {
      await verifyWindowsPublisher(targetPath, launcher.expectedPublisher);
      const stats = await fsp.stat(targetPath);
      onDownload({ bytesReceived: stats.size, bytesTotal: stats.size });
      return targetPath;
    } catch {
      await fsp.rm(targetPath, { force: true });
    }
  }

  const partialPath = `${targetPath}.part`;
  await fsp.rm(partialPath, { force: true });
  const response = await fetch(launcher.url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "User-Agent": "GDG-Mod-Loader" }
  });
  if (!response.ok) {
    throw new Error(`Download failed for ${launcher.name}: HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxSizeBytes) {
    throw new Error(`${launcher.name} installer exceeded the allowed download size.`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error(`Download stream was unavailable for ${launcher.name}.`);
  }

  const writeStream = fs.createWriteStream(partialPath, { flags: "wx" });
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      receivedBytes += chunk.length;
      if (receivedBytes > maxSizeBytes) {
        throw new Error(`${launcher.name} installer exceeded the allowed download size.`);
      }
      if (!writeStream.write(chunk)) {
        await once(writeStream, "drain");
      }
      onDownload({ bytesReceived: receivedBytes, bytesTotal: contentLength || 0 });
    }
    await new Promise((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.once("error", reject);
    });
  } catch (error) {
    writeStream.destroy();
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }

  await verifyWindowsPublisher(partialPath, launcher.expectedPublisher);
  await fsp.rename(partialPath, targetPath);
  return targetPath;
}

async function verifyWindowsPublisher(filePath, expectedPublisher) {
  if (process.platform !== "win32") {
    throw new Error("Authenticode verification is only available on Windows.");
  }
  const escapedPath = String(filePath).replace(/'/g, "''");
  const command = `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; [pscustomobject]@{ Status = [string]$signature.Status; Subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const signature = JSON.parse(String(stdout || "{}").trim() || "{}");
  if (signature.Status !== "Valid" || !String(signature.Subject || "").toLowerCase().includes(String(expectedPublisher || "").toLowerCase())) {
    throw new Error(`CurseForge installer signature verification failed. Expected a valid ${expectedPublisher} signature.`);
  }
  return signature;
}

async function waitForMatchingCurseForgeInstance(profile, pack, timeoutMs, onProgress = () => {}, reopenInstall = null) {
  const deadline = Date.now() + timeoutMs;
  let nextReopenAt = Date.now() + 15_000;
  let lastIssues = [];
  while (Date.now() < deadline) {
    const candidates = await discoverCurseForgeMinecraftInstances();
    for (const candidatePath of candidates) {
      const metadataPath = path.join(candidatePath, "minecraftinstance.json");
      try {
        const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
        if (String(metadata.projectID || "") !== String(pack.projectId) || String(metadata.fileID || "") !== String(pack.fileId)) {
          continue;
        }
        const completion = await inspectCurseForgeInstanceCompletion(candidatePath, metadata, pack);
        lastIssues = completion.issues;
        if (completion.ok && await isGameRoot(candidatePath, profile.id)) {
          return { found: true, path: candidatePath, metadata };
        }
      } catch {
        // CurseForge writes instance metadata while installation is still in progress.
      }
    }

    if (typeof reopenInstall === "function" && Date.now() >= nextReopenAt) {
      await reopenInstall();
      nextReopenAt = Date.now() + 60_000;
    }

    reportSyncProgress(onProgress, {
      phase: "installing",
      message: lastIssues.length
        ? `CurseForge is finishing ${pack.name}: ${lastIssues[0]}`
        : `Waiting for CurseForge sign-in and the complete ${pack.name} profile.`,
      modName: pack.name,
      current: 2,
      total: 3
    });
    await delay(2000);
  }
  const detail = lastIssues.length ? ` ${lastIssues.join(" ")}` : "";
  throw new Error(`Minecraft setup timed out before CurseForge completed ${pack.name}.${detail} Finish CurseForge sign-in or installation, then run Make Me Ready again.`);
}

async function inspectCurseForgeInstanceCompletion(instancePath, metadata, pack) {
  const issues = [];
  if (String(metadata.projectID || "") !== String(pack.projectId || "") || String(metadata.fileID || "") !== String(pack.fileId || "")) {
    issues.push("The installed project or file does not match the required pack.");
  }
  if (await exists(path.join(instancePath, "install-journal.json"))) {
    issues.push("CurseForge is still writing the install journal.");
  }
  if (metadata.isValid !== true || metadata.isEnabled !== true) {
    issues.push("CurseForge has not marked the instance valid and enabled yet.");
  }
  const installedFileId = String(metadata.installedModpack?.installedFile?.id || "");
  if (installedFileId !== String(pack.fileId || "")) {
    issues.push("CurseForge has not confirmed the required pack file yet.");
  }
  const status = Number(metadata.installedModpack?.status || 0);
  if (status !== 4) {
    issues.push("CurseForge still reports the modpack installation as incomplete.");
  }
  const minimumInstalledAddons = Number(pack.minimumInstalledAddons || 0);
  if (minimumInstalledAddons && (!Array.isArray(metadata.installedAddons) || metadata.installedAddons.length < minimumInstalledAddons)) {
    issues.push(`Only ${Array.isArray(metadata.installedAddons) ? metadata.installedAddons.length : 0} of at least ${minimumInstalledAddons} pack addons are registered.`);
  }
  const requiredPaths = Array.isArray(pack.requiredPaths) ? pack.requiredPaths : [];
  for (const relativePath of requiredPaths) {
    if (!(await exists(path.join(instancePath, relativePath)))) {
      issues.push(`Required pack path is missing: ${relativePath}.`);
    }
  }
  const minimumModFiles = Number(pack.minimumModFiles || 0);
  if (minimumModFiles) {
    let modFileCount = 0;
    try {
      const entries = await fsp.readdir(path.join(instancePath, "mods"), { withFileTypes: true });
      modFileCount = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar")).length;
    } catch {
      modFileCount = 0;
    }
    if (modFileCount < minimumModFiles) {
      issues.push(`Only ${modFileCount} of at least ${minimumModFiles} mod files are installed.`);
    }
  }
  const missingFiles = await findMissingMinecraftPackFiles(instancePath, pack.requiredFileNames || []);
  if (missingFiles.length) {
    issues.push(`Required pack files are still missing: ${missingFiles.join(", ")}.`);
  }
  return { ok: issues.length === 0, issues };
}

async function findMissingMinecraftPackFiles(instancePath, requiredFileNames) {
  const required = new Map(requiredFileNames.map((name) => [String(name).toLowerCase(), String(name)]));
  if (required.size === 0) {
    return [];
  }
  const pending = [instancePath];
  while (pending.length && required.size) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        pending.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        required.delete(entry.name.toLowerCase());
      }
    }
  }
  return [...required.values()];
}

function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function findPrismLauncher(profile = GAME_PROFILES.minecraft, gamePath = "") {
  const candidates = profile.launcherCandidates?.() || [];
  if (gamePath && isPathInside(gamePath, getManagedPrismDataRoot())) {
    candidates.sort((a, b) => Number(!isPathInside(a, getManagedMinecraftRoot())) - Number(!isPathInside(b, getManagedMinecraftRoot())));
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error("Prism Launcher was not found. Install Prism Launcher, then retry.");
}

async function findCurseForgeLauncher(profile = GAME_PROFILES.minecraft) {
  for (const candidate of profile.curseForgeLauncherCandidates?.() || []) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  throw new Error("CurseForge standalone was not found. Run Make Me Ready to install it.");
}

async function isCurseForgeProtocolRegistered() {
  if (process.platform !== "win32") {
    return false;
  }
  const command = "$paths = @('Registry::HKEY_CURRENT_USER\\Software\\Classes\\curseforge\\shell\\open\\command','Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\curseforge\\shell\\open\\command','Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Classes\\curseforge\\shell\\open\\command'); if ($paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1) { 'true' } else { 'false' }";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 64 * 1024
    });
    return String(stdout || "").trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function findCurseForgeRuntime(profile = GAME_PROFILES.minecraft) {
  let launcherPath = "";
  try {
    launcherPath = await findCurseForgeLauncher(profile);
  } catch {
    // A registered CurseForge protocol handler is also a valid existing install.
  }
  const protocolRegistered = await isCurseForgeProtocolRegistered();
  if (!launcherPath && !protocolRegistered) {
    throw new Error("CurseForge was not found. Run Make Me Ready to install it.");
  }
  return { launcherPath, protocolRegistered };
}

async function openCurseForgeUri(uri, runtime) {
  if (runtime?.protocolRegistered) {
    await shell.openExternal(uri);
    return;
  }
  const launcherPath = String(runtime?.launcherPath || "").trim();
  if (!launcherPath) {
    throw new Error("CurseForge is installed, but GDG could not open its registered link handler.");
  }
  const child = spawn(launcherPath, [uri], {
    cwd: path.dirname(launcherPath),
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

async function getMinecraftInstanceManager(gamePath) {
  return await exists(path.join(path.resolve(String(gamePath || "")), "minecraftinstance.json"))
    ? "curseforge"
    : "prism";
}

async function launchGame(payload = {}) {
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  if (!payload.gamePath) {
    throw new Error(`Select a ${profile.name} folder before launching.`);
  }

  const gamePath = path.resolve(String(payload.gamePath));
  if (!(await isGameRoot(gamePath, gameId))) {
    throw new Error(`That folder does not look like a ${profile.name} install.`);
  }

  if (profile.platform === "prism") {
    await ensureBundledAddons(gamePath, profile);
    const manager = await getMinecraftInstanceManager(gamePath);
    if (manager === "curseforge") {
      const metadata = JSON.parse(await fsp.readFile(path.join(gamePath, "minecraftinstance.json"), "utf8"));
      const instanceId = String(metadata.guid || "").trim();
      const gameTypeId = Number(metadata.gameTypeID || profile.curseForgeGameId || 432);
      if (!instanceId) {
        throw new Error("CurseForge instance metadata is missing its instance ID. Repair the profile in CurseForge, then retry.");
      }
      const runtime = await findCurseForgeRuntime(profile);
      const launchUri = `curseforge://launch-game?instanceId=${encodeURIComponent(instanceId)}&gameId=${gameTypeId}`;
      await openCurseForgeUri(launchUri, runtime);
      return {
        ok: true,
        gamePath,
        executable: runtime.launcherPath || "curseforge://",
        manager,
        requestedEac: false,
        eacEnabled: false
      };
    }

    const executable = await findPrismLauncher(profile, gamePath);
    const instanceId = path.basename(gamePath);
    const prismRoot = path.dirname(path.dirname(gamePath));
    const launchArgs = ["--dir", prismRoot, "--launch", instanceId];
    const serverAddress = String(payload.serverAddress || profile.launchServer || "").trim();
    if (serverAddress) {
      launchArgs.push("--server", serverAddress);
    }
    const child = spawn(executable, launchArgs, {
      cwd: path.dirname(executable),
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();

    return {
      ok: true,
      gamePath,
      executable,
      manager,
      requestedEac: false,
      eacEnabled: false
    };
  }

  const eacEnabled = profile.supportsEac && Boolean(payload.eacEnabled);
  const executable = await findGameExecutable(gamePath, { gameId, eacEnabled });
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

async function ensureBundledAddons(gamePath, profile) {
  const addons = profile.bundledAddons || [];
  if (addons.length === 0) {
    return;
  }

  const modsPath = getGameModsPath(gamePath, profile.id);
  await fsp.mkdir(modsPath, { recursive: true });

  for (const addon of addons) {
    if (!(await exists(addon.sourcePath))) {
      throw new Error(`Bundled Minecraft addon is missing: ${path.basename(addon.sourcePath)}`);
    }

    const targetPath = path.join(modsPath, addon.targetName);
    const sourceBytes = await fsp.readFile(addon.sourcePath);
    const sourceHash = crypto.createHash("sha256").update(sourceBytes).digest("hex");
    const targetHash = await exists(targetPath) ? await hashFile(targetPath) : "";
    if (sourceHash === targetHash) {
      continue;
    }

    const entries = await fsp.readdir(modsPath, { withFileTypes: true });
    for (const entry of entries) {
      const normalized = entry.name.toLowerCase();
      if (entry.isFile() && normalized.startsWith(addon.ownedPrefix) && normalized.endsWith(".jar") && entry.name !== addon.targetName) {
        await fsp.rm(path.join(modsPath, entry.name), { force: true });
      }
    }

    await fsp.writeFile(targetPath, sourceBytes);
  }
}

async function scanMods(gamePath, options = {}) {
  const profile = getGameProfile(options.gameId);
  if (!gamePath) {
    throw new Error("Game path is required.");
  }

  const modsPath = getGameModsPath(gamePath, profile.id);
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
    if (entry.name.startsWith(".")) {
      continue;
    }

    const folderPath = path.join(modsPath, entry.name);
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }

    const info = entry.isDirectory()
      ? await readModMetadataFromDirectory(folderPath, entry.name, profile)
      : getLooseFileModMetadata(entry.name);
    if (!info) {
      continue;
    }

    const dllFiles = entry.isDirectory()
      ? await findDllFiles(folderPath)
      : path.extname(entry.name).toLowerCase() === ".dll" ? [entry.name] : [];
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
      mod.folderSha256 = entry.isDirectory() ? await hashDirectory(folderPath) : await hashFile(folderPath);
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

async function readModMetadataFromDirectory(folderPath, fallbackName, profile) {
  const modInfoPath = path.join(folderPath, "ModInfo.xml");
  if (profile.modArchive === "modinfo-folder") {
    if (!(await exists(modInfoPath))) {
      return null;
    }

    return parseModInfo(await fsp.readFile(modInfoPath, "utf8"));
  }

  if (await exists(modInfoPath)) {
    return parseModInfo(await fsp.readFile(modInfoPath, "utf8"));
  }

  return {
    name: fallbackName,
    displayName: fallbackName,
    author: "",
    version: "",
    description: ""
  };
}

function getLooseFileModMetadata(fileName) {
  const extension = path.extname(fileName);
  return {
    name: path.basename(fileName, extension) || fileName,
    displayName: path.basename(fileName, extension) || fileName,
    author: "",
    version: "",
    description: ""
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
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  const { gamePath, manifestInput } = payload;

  if (!gamePath) {
    throw new Error(`Select a ${profile.name} folder first.`);
  }

  if (!(await isGameRoot(gamePath, gameId))) {
    throw new Error(`That folder does not look like a ${profile.name} install.`);
  }

  if (!manifestInput) {
    throw new Error("Add a server manifest URL or file path.");
  }

  const manifest = await loadManifest(manifestInput);
  validateManifest(manifest, gameId);

  const gameCompatibility = compareGameCompatibility(manifest, await getGameVersionInfo(gamePath, gameId), gameId);
  const local = await scanMods(gamePath, { hash: manifest.mods.some((mod) => Boolean(mod.folderSha256)), gameId });
  const plan = profile.platform === "prism" ? buildSyncPlan(manifest, []) : buildSyncPlan(manifest, local.mods);
  const bootstrap = await getGameBootstrapStatus(gamePath, manifest, gameId);
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
    bootstrap,
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
  assertLoaderModWritesAllowed(await resolvePayloadGameId(payload));
  const preview = await previewSync(payload);
  const gameId = defaultManifestGameId(preview.manifest);
  const profile = getGameProfile(gameId);
  const repairMode = Boolean(payload?.repair);
  if (preview.gameCompatibility.checked && !preview.gameCompatibility.ok) {
    const versionManager = profile.platform === "prism" ? "Minecraft launcher" : "Steam";
    throw new Error(`${preview.gameCompatibility.reason} Match ${profile.name} to the server version in ${versionManager} before continuing.`);
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

  const modsPath = getGameModsPath(payload.gamePath, gameId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workRoot = getSyncWorkRoot(payload.gamePath);
  const backupRoot = path.join(workRoot, "backups", timestamp);
  const stagingRoot = path.join(workRoot, "staging", timestamp);
  const log = [];
  const failures = [];

  await fsp.mkdir(modsPath, { recursive: true });
  await fsp.mkdir(stagingRoot, { recursive: true });
  log.push(`Using sync workspace: ${workRoot}`);
  const bootstrapResult = await ensureGameBootstrap(payload.gamePath, preview.manifest, stagingRoot, backupRoot, onProgress);
  if (bootstrapResult.required) {
    log.push(bootstrapResult.installed ? "Installed R.E.P.O. BepInEx bootstrap." : "R.E.P.O. BepInEx bootstrap already present.");
  }

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
      const sourceFolder = await extractModArchive(archivePath, stagingRoot, item.mod, gameId);
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
  assertLoaderModWritesAllowed(await resolvePayloadGameId(payload));
  const preview = await previewSync(payload);
  const gameId = defaultManifestGameId(preview.manifest);
  const modsPath = getGameModsPath(payload.gamePath, gameId);
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
  const gameId = await resolvePayloadGameId(payload);
  assertLoaderModWritesAllowed(gameId);
  const profile = getGameProfile(gameId);
  const rawGamePath = String(payload?.gamePath || "").trim();

  if (!rawGamePath) {
    throw new Error(`Select a ${profile.name} folder first.`);
  }

  const gamePath = path.resolve(rawGamePath);

  if (!(await isGameRoot(gamePath, gameId))) {
    throw new Error(`That folder does not look like a ${profile.name} install.`);
  }

  const modsPath = getGameModsPath(gamePath, gameId);
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

  const nextScan = await scanMods(gamePath, { hash: false, gameId });
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
  const gameId = await resolvePayloadGameId(payload);
  assertLoaderModWritesAllowed(gameId);
  const profile = getGameProfile(gameId);
  const gamePath = path.resolve(String(payload?.gamePath || ""));
  if (!gamePath || !(await isGameRoot(gamePath, gameId))) {
    throw new Error(`Select a valid ${profile.name} folder first.`);
  }

  const mode = payload?.mode === "delete" ? "delete" : "backup";
  const scope = payload?.scope === "extra" ? "extra" : "all";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getSyncWorkRoot(gamePath), "backups", timestamp, scope === "extra" ? "extra-managed-mods" : "managed-mods");
  const modsPath = getGameModsPath(gamePath, gameId);
  let preview = null;
  let local = await scanMods(gamePath, { hash: false, gameId });
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
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  const gamePath = path.resolve(String(payload.gamePath || ""));
  const checks = [];
  let preview = null;
  let local = null;
  let diskSpace = null;

  function addCheck(id, label, status, detail, action = "") {
    checks.push({ id, label, status, detail, action });
  }

  if (!payload.gamePath) {
    addCheck("game-folder", "Game folder", "fail", `No ${profile.name} folder is selected.`, "Choose a game folder.");
    return { ok: false, checks, preview: null };
  }

  const validGameRoot = await isGameRoot(gamePath, gameId);
  addCheck(
    "game-folder",
    "Game folder",
    validGameRoot ? "pass" : "fail",
    validGameRoot ? `Selected folder looks like ${profile.name}.` : `Selected folder does not look like a ${profile.name} install.`,
    validGameRoot ? "" : `Browse to the ${profile.name} install folder.`
  );

  if (!validGameRoot) {
    return { ok: false, checks, preview: null };
  }

  const modsPath = getGameModsPath(gamePath, gameId);
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
    local = await scanMods(gamePath, { hash: false, gameId });
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
          preview.gameCompatibility.ok ? "" : `Match ${profile.name} to the server version in ${profile.platform === "prism" ? "the Minecraft launcher" : "Steam"}, then retry the check.`
        );
      } else {
        addCheck("game-version", "Game version", "warn", preview.gameCompatibility.reason, profile.platform === "prism" ? "Publish Minecraft pack metadata for stricter checks." : "Publish a Steam build id for stricter checks.");
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

    if (profile.supportsEac) {
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
    }

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
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  const gamePath = path.resolve(String(payload?.gamePath || ""));
  const backupPath = path.resolve(String(payload?.backupPath || ""));
  if (!gamePath || !(await isGameRoot(gamePath, gameId))) {
    throw new Error(`Select a valid ${profile.name} folder first.`);
  }

  assertManagedBackupPath(gamePath, backupPath);
  if (!(await exists(backupPath))) {
    throw new Error("Backup folder does not exist.");
  }

  const modsPath = getGameModsPath(gamePath, gameId);
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
  const gameId = await resolvePayloadGameId(payload);
  const profile = getGameProfile(gameId);
  const gamePath = path.resolve(String(payload.gamePath || ""));
  const backupPath = path.resolve(String(payload.backupPath || ""));
  if (!gamePath || !(await isGameRoot(gamePath, gameId))) {
    throw new Error(`Select a valid ${profile.name} folder first.`);
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const display = unitIndex === 0 || size >= 10 ? Math.round(size) : size.toFixed(1);
  return `${display} ${units[unitIndex]}`;
}

async function loadManifest(input) {
  const trimmed = String(input || "").trim();

  if (trimmed.startsWith("bundled://")) {
    const fileName = trimmed.slice("bundled://".length);
    if (!fileName || path.basename(fileName) !== fileName) {
      throw new Error("Bundled manifest name is invalid.");
    }
    const filePath = path.join(__dirname, "..", "server-directory", fileName);
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return loadRemoteManifest(trimmed);
  }

  const filePath = normalizeLocalPath(trimmed);
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadServerDirectory(input) {
  const source = String(input || DEFAULT_SERVER_DIRECTORY).trim();
  let directory = /^https?:\/\//i.test(source)
    ? await fetchJson(source)
    : JSON.parse(await fsp.readFile(normalizeLocalPath(source), "utf8"));

  if (directory && !/^https?:\/\//i.test(source) && path.basename(normalizeLocalPath(source)).toLowerCase() === "gdg.servers.local.json") {
    const bundled = JSON.parse(await fsp.readFile(DEFAULT_SERVER_DIRECTORY, "utf8"));
    const existingIds = new Set((directory.servers || []).map((server) => String(server.id || "")));
    directory = {
      ...directory,
      servers: [
        ...(directory.servers || []),
        ...(bundled.servers || []).filter((server) => !existingIds.has(String(server.id || "")))
      ]
    };
  }

  if (!directory || !Array.isArray(directory.servers)) {
    throw new Error("Server directory must include a servers array.");
  }

  for (const server of directory.servers) {
    if (!server.id || !server.name || !server.syncUrl) {
      throw new Error("Every server directory entry needs id, name, and syncUrl.");
    }
    server.game = getGameProfile(server.game || directory.game || DEFAULT_GAME_ID).id;
  }

  return directory;
}

async function checkServerHealth(server) {
  const gameStatusPromise = checkGameServerStatus(server);

  try {
    const manifest = await loadManifest(server.syncUrl);
    validateManifest(manifest, server.game || manifest.game || DEFAULT_GAME_ID);
    const clientMods = (manifest.mods || []).filter(isClientInstallableManifestMod);
    const gameStatus = await gameStatusPromise;
    return {
      serverId: server.id,
      ok: true,
      status: "online",
      ...gameStatus,
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
    const gameStatus = await gameStatusPromise;
    return {
      serverId: server.id,
      ok: false,
      status: "offline",
      ...gameStatus,
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

async function checkGameServerStatus(server) {
  const host = String(server?.host || "").trim();
  const gamePort = Number(server?.gamePort || 26900);
  const queryPort = server?.game === "minecraft" ? Number(server?.queryPort || 0) : Number(server?.queryPort || gamePort + 1);
  const hasGamePort = Number.isFinite(gamePort) && gamePort > 0;

  if (!host || (!hasGamePort && (!Number.isFinite(queryPort) || queryPort <= 0))) {
    return {
      gameOk: false,
      gameStatus: "unknown",
      gameQueryPort: 0,
      gameError: "No game server query endpoint published."
    };
  }

  const errors = [];

  try {
    if (Number.isFinite(queryPort) && queryPort > 0) {
      await querySteamServerInfo(host, queryPort, 1200);
      return {
        gameOk: true,
        gameStatus: "online",
        gameQueryPort: queryPort,
        gameError: ""
      };
    }
  } catch (error) {
    errors.push(`query ${queryPort}: ${error.message}`);
  }

  try {
    if (hasGamePort) {
      await probeTcpPort(host, gamePort, 1200);
      return {
        gameOk: true,
        gameStatus: "online",
        gameQueryPort: queryPort,
        gameError: errors.length > 0 ? `Steam query did not respond; game port ${gamePort} is reachable.` : ""
      };
    }
  } catch (error) {
    errors.push(`game ${gamePort}: ${error.message}`);
  }

  return {
    gameOk: false,
    gameStatus: "offline",
    gameQueryPort: queryPort,
    gameError: errors.join("; ") || "Game server did not respond."
  };
}

function probeTcpPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error("Game port timed out."));
    }, timeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.on("connect", () => finish());
    socket.on("error", finish);
  });
}

function querySteamServerInfo(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    let triedChallenge = false;

    const timeout = setTimeout(() => {
      finish(new Error("Steam query timed out."));
    }, timeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function sendInfo(challenge = Buffer.alloc(0)) {
      const query = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
        Buffer.from("Source Engine Query\0", "binary"),
        challenge
      ]);
      socket.send(query, port, host, (error) => {
        if (error) {
          finish(error);
        }
      });
    }

    socket.on("message", (message) => {
      const responseType = message[4];
      if (responseType === 0x41 && message.length >= 9 && !triedChallenge) {
        triedChallenge = true;
        sendInfo(message.subarray(5, 9));
        return;
      }

      if (responseType === 0x49 || responseType === 0x6d) {
        finish();
        return;
      }

      finish(new Error("Unexpected Steam query response."));
    });

    socket.on("error", finish);
    sendInfo();
  });
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

async function getGameVersionInfo(gamePath, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const resolvedGamePath = path.resolve(String(gamePath || ""));
  if (profile.id === "minecraft") {
    return getMinecraftInstanceVersionInfo(resolvedGamePath, profile);
  }
  const appManifestPath = findSteamAppManifestPath(resolvedGamePath, gameId);
  const version = {
    gamePath: resolvedGamePath,
    steamAppId: profile.steamAppId,
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

async function getMinecraftInstanceVersionInfo(instancePath, profile = GAME_PROFILES.minecraft) {
  return await getMinecraftInstanceManager(instancePath) === "curseforge"
    ? getCurseForgeInstanceVersionInfo(instancePath, profile)
    : getPrismInstanceVersionInfo(instancePath, profile);
}

async function getCurseForgeInstanceVersionInfo(instancePath, profile = GAME_PROFILES.minecraft) {
  const metadataPath = path.join(instancePath, "minecraftinstance.json");
  const version = {
    gamePath: instancePath,
    steamAppId: profile.prismPackProjectId || "",
    steamAppManifestPath: metadataPath,
    steamBuildId: "",
    steamUpdateState: "",
    steamInstallDir: path.basename(instancePath),
    canOpenSteamUpdate: process.platform === "win32",
    versionSource: "curseforge",
    minecraftVersion: "",
    modLoaderVersion: "",
    managedPackId: "",
    managedPackVersionId: "",
    managedPackVersionName: ""
  };

  try {
    const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
    const managedPackVersionId = String(metadata.fileID || "");
    const loaderName = String(metadata.baseModLoader?.name || "");
    return {
      ...version,
      steamBuildId: managedPackVersionId,
      steamUpdateState: "managed",
      minecraftVersion: String(metadata.gameVersion || metadata.baseModLoader?.minecraftVersion || ""),
      modLoaderVersion: loaderName.replace(/^forge-/i, ""),
      managedPackId: String(metadata.projectID || ""),
      managedPackVersionId,
      managedPackVersionName: profile.prismPackVersionName || String(metadata.name || "")
    };
  } catch {
    return version;
  }
}

async function getPrismInstanceVersionInfo(instancePath, profile = GAME_PROFILES.minecraft) {
  const cfgPath = path.join(instancePath, "instance.cfg");
  const packPath = path.join(instancePath, "mmc-pack.json");
  const version = {
    gamePath: instancePath,
    steamAppId: profile.prismPackProjectId || "",
    steamAppManifestPath: cfgPath,
    steamBuildId: "",
    steamUpdateState: "",
    steamInstallDir: path.basename(instancePath),
    canOpenSteamUpdate: process.platform === "win32",
    versionSource: "prism",
    minecraftVersion: "",
    modLoaderVersion: "",
    managedPackId: "",
    managedPackVersionId: "",
    managedPackVersionName: ""
  };

  try {
    const values = parseSimpleIni(await fsp.readFile(cfgPath, "utf8"));
    const pack = JSON.parse(await fsp.readFile(packPath, "utf8"));
    const components = Array.isArray(pack.components) ? pack.components : [];
    const minecraft = components.find((component) => component.uid === "net.minecraft");
    const forge = components.find((component) => component.uid === "net.minecraftforge");
    const managedPackVersionId = String(values.ManagedPackVersionID || "");

    return {
      ...version,
      steamBuildId: managedPackVersionId,
      steamUpdateState: values.ManagedPack ? "managed" : "custom",
      minecraftVersion: String(minecraft?.version || minecraft?.cachedVersion || ""),
      modLoaderVersion: String(forge?.version || forge?.cachedVersion || ""),
      managedPackId: String(values.ManagedPackID || ""),
      managedPackVersionId,
      managedPackVersionName: String(values.ManagedPackVersionName || profile.prismPackVersionName || "")
    };
  } catch {
    return version;
  }
}

function parseSimpleIni(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([^=;#\[][^=]*)=(.*)$/.exec(line);
    if (match) {
      values[match[1].trim()] = match[2].trim();
    }
  }
  return values;
}

function findSteamAppManifestPath(gamePath, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  if (!gamePath) {
    return "";
  }

  const normalized = path.resolve(gamePath);
  const commonDir = path.dirname(normalized);
  if (path.basename(commonDir).toLowerCase() !== "common") {
    return "";
  }

  const steamAppsDir = path.dirname(commonDir);
  return path.join(steamAppsDir, `appmanifest_${profile.steamAppId}.acf`);
}

function parseSteamAppManifest(text) {
  const values = {};
  const matches = String(text || "").matchAll(/"([^"]+)"\s+"([^"]*)"/g);
  for (const match of matches) {
    values[match[1]] = match[2];
  }
  return values;
}

function compareGameCompatibility(manifest, localVersion, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const gameVersionMap = normalizeGameVersionMap(manifest.server?.gameVersionMap);
  const requiredSteamBuildId = String(manifest.server?.steamBuildId || "").trim();
  const requiredGameVersion = String(manifest.server?.gameVersion || gameVersionMap[requiredSteamBuildId] || "").trim();
  const requiredLabel = formatGameVersionLabel(requiredSteamBuildId, requiredGameVersion, gameVersionMap);

  if (profile.platform === "prism") {
    const requiredPack = manifest.server?.prismPack || {};
    const mismatches = [];
    if (requiredPack.projectId && localVersion.managedPackId !== String(requiredPack.projectId)) {
      mismatches.push(`CurseForge project ${requiredPack.projectId}`);
    }
    if (requiredPack.versionId && localVersion.managedPackVersionId !== String(requiredPack.versionId)) {
      mismatches.push(requiredPack.versionName || `pack file ${requiredPack.versionId}`);
    }
    if (requiredPack.minecraftVersion && localVersion.minecraftVersion !== String(requiredPack.minecraftVersion)) {
      mismatches.push(`Minecraft ${requiredPack.minecraftVersion}`);
    }
    if (requiredPack.forgeVersion && localVersion.modLoaderVersion !== String(requiredPack.forgeVersion)) {
      mismatches.push(`Forge ${requiredPack.forgeVersion}`);
    }

    return {
      ok: mismatches.length === 0,
      checked: true,
      reason: mismatches.length === 0
        ? `Minecraft instance matches ${requiredPack.versionName || requiredGameVersion || "the required pack"}.`
        : `This Minecraft instance does not match the server. Required: ${mismatches.join(", ")}.`,
      local: localVersion,
      requiredGameVersion,
      requiredSteamBuildId,
      gameVersionMap
    };
  }

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
        reason: `Steam build could not be detected for this ${profile.name} folder.`,
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

async function getGameBootstrapStatus(gamePath, manifest, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const requiredPaths = profile.bootstrapRequiredPaths || [];
  if (requiredPaths.length === 0) {
    return {
      required: false,
      ok: true,
      missing: [],
      available: false
    };
  }

  const missing = [];
  for (const requiredPath of requiredPaths) {
    if (!(await exists(path.join(gamePath, requiredPath)))) {
      missing.push(requiredPath);
    }
  }

  return {
    required: true,
    ok: missing.length === 0,
    missing,
    available: Boolean(manifest?.bootstrap?.source?.url)
  };
}

async function ensureGameBootstrap(gamePath, manifest, stagingRoot, backupRoot, onProgress = () => {}) {
  const gameId = defaultManifestGameId(manifest);
  const profile = getGameProfile(gameId);
  let status = await getGameBootstrapStatus(gamePath, manifest, gameId);
  if (!status.required || status.ok) {
    return { ...status, installed: false };
  }

  if (!manifest?.bootstrap?.source?.url) {
    throw new Error(`${profile.name} is missing BepInEx bootstrap files (${status.missing.join(", ")}), and this server manifest does not include a bootstrap package.`);
  }

  const bootstrapMod = {
    id: manifest.bootstrap.id || `${gameId}-bepinex-bootstrap`,
    name: manifest.bootstrap.name || `${profile.shortName} BepInEx Bootstrap`,
    source: manifest.bootstrap.source
  };

  reportSyncProgress(onProgress, {
    phase: "downloading",
    message: `Downloading ${bootstrapMod.name}.`,
    modName: bootstrapMod.name,
    modKey: "bootstrap",
    current: 0,
    total: 1
  });
  const archivePath = await downloadModArchive(bootstrapMod, stagingRoot, (download) => {
    reportSyncProgress(onProgress, {
      phase: "downloading",
      message: `Downloading ${bootstrapMod.name}.`,
      modName: bootstrapMod.name,
      modKey: "bootstrap",
      current: 0,
      total: 1,
      bytesReceived: download.bytesReceived,
      bytesTotal: download.bytesTotal
    });
  });

  reportSyncProgress(onProgress, {
    phase: "extracting",
    message: `Unpacking ${bootstrapMod.name}.`,
    modName: bootstrapMod.name,
    modKey: "bootstrap",
    current: 1,
    total: 1
  });

  const extractRoot = path.join(stagingRoot, sanitizeFolderName(`${bootstrapMod.id}-extract`));
  await fsp.rm(extractRoot, { recursive: true, force: true });
  await fsp.mkdir(extractRoot, { recursive: true });
  await extractZipToDirectory(archivePath, extractRoot);
  const sourceRoot = await findGenericPackageRoot(extractRoot);
  if (!sourceRoot) {
    throw new Error(`${bootstrapMod.name} did not contain installable files.`);
  }

  reportSyncProgress(onProgress, {
    phase: "installing",
    message: `Installing ${bootstrapMod.name}.`,
    modName: bootstrapMod.name,
    modKey: "bootstrap",
    current: 1,
    total: 1
  });

  const installPaths = manifest.bootstrap.paths || profile.bootstrapInstallPaths || [];
  for (const relativePath of installPaths) {
    await installBootstrapPath(sourceRoot, gamePath, backupRoot, relativePath);
  }

  status = await getGameBootstrapStatus(gamePath, manifest, gameId);
  if (!status.ok) {
    throw new Error(`${profile.name} bootstrap install finished but required files are still missing: ${status.missing.join(", ")}.`);
  }

  return { ...status, installed: true };
}

async function installBootstrapPath(sourceRoot, gamePath, backupRoot, relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error(`Bootstrap package requested an unsafe install path: ${relativePath}`);
  }

  const sourcePath = path.join(sourceRoot, normalized);
  if (!(await exists(sourcePath))) {
    return;
  }

  const targetPath = path.join(gamePath, normalized);
  if (await exists(targetPath)) {
    const backupPath = path.join(backupRoot, "bootstrap", normalized);
    await fsp.mkdir(path.dirname(backupPath), { recursive: true });
    await fsp.rm(backupPath, { recursive: true, force: true });
    await fsp.cp(targetPath, backupPath, { recursive: true });
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.rm(targetPath, { recursive: true, force: true });
  await fsp.cp(sourcePath, targetPath, { recursive: true });
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
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });
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

function validateManifest(manifest, expectedGameId = DEFAULT_GAME_ID) {
  const expectedProfile = getGameProfile(expectedGameId);
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a JSON object.");
  }

  if (!GAME_PROFILES[manifest.game]) {
    throw new Error(`Manifest game must be one of: ${Object.keys(GAME_PROFILES).join(", ")}.`);
  }

  if (manifest.game !== expectedProfile.id) {
    throw new Error(`Manifest game "${manifest.game}" does not match selected game "${expectedProfile.id}".`);
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
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
      }
    });
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

async function extractModArchive(archivePath, stagingRoot, mod, gameId = DEFAULT_GAME_ID) {
  const profile = getGameProfile(gameId);
  const extractRoot = path.join(stagingRoot, sanitizeFolderName(`${mod.id || mod.name}-extract`));
  await fsp.rm(extractRoot, { recursive: true, force: true });
  await fsp.mkdir(extractRoot, { recursive: true });

  await extractZipToDirectory(archivePath, extractRoot);

  const candidate = profile.modArchive === "modinfo-folder"
    ? await findFolderWithModInfo(extractRoot)
    : await findGenericPackageRoot(extractRoot);
  if (!candidate) {
    throw new Error(profile.modArchive === "modinfo-folder"
      ? "Archive did not contain a folder with ModInfo.xml."
      : "Archive did not contain installable files.");
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

async function findGenericPackageRoot(root) {
  const entries = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() || entry.isFile());

  if (entries.length === 0) {
    return "";
  }

  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(root, entries[0].name);
  }

  return root;
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
