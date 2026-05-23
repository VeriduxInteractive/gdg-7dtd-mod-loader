import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FolderOpen,
  Gamepad2,
  HardDrive,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  UploadCloud,
  Wifi,
  Wrench,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ApplyResult,
  CloneGameResult,
  DetectedGame,
  DiskSpace,
  DirectoryServer,
  GameVersionInfo,
  LoaderConfig,
  ScanResult,
  ServerDirectory,
  ServerHealth,
  SyncPlanItem,
  SyncPreview,
  SyncProgress
} from "./types";

const emptyConfig: LoaderConfig = {
  configVersion: 1,
  gameId: "7dtd",
  gamePath: "",
  manifestInput: "",
  serverDirectoryInput: "",
  lastServerId: "gdg-test",
  launchWithEac: true
};

const sampleSyncEndpoint = "http://40.160.20.5:8787/gdg-sync/manifest.json";

type Tab = "sync" | "installed" | "settings";
type LivePlanStatus = "active" | "ready" | "failed";
type GuidedStepId = "setup" | "check" | "install" | "launch";

function App() {
  const [config, setConfig] = useState<LoaderConfig>(emptyConfig);
  const [detected, setDetected] = useState<DetectedGame | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [serverDirectory, setServerDirectory] = useState<ServerDirectory | null>(null);
  const [serverHealth, setServerHealth] = useState<Record<string, ServerHealth>>({});
  const [diskSpace, setDiskSpace] = useState<DiskSpace | null>(null);
  const [gameVersion, setGameVersion] = useState<GameVersionInfo | null>(null);
  const [createShortcut, setCreateShortcut] = useState(true);
  const [lastClone, setLastClone] = useState<CloneGameResult | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("sync");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [error, setError] = useState("");
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [livePlanStatuses, setLivePlanStatuses] = useState<Record<string, LivePlanStatus>>({});
  const [openStep, setOpenStep] = useState<GuidedStepId | "">("setup");

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    const removeSyncProgress = window.gdg.onSyncProgress((progress) => {
      setSyncProgress(progress);
      updateLivePlanStatus(progress);
    });
    const removeCloneProgress = window.gdg.onCloneProgress((progress) => {
      setSyncProgress(progress);
    });
    const removeGameCopyDeleted = window.gdg.onGameCopyDeleted((payload) => {
      setConfig(payload.config);
      setDetected(payload.detected);
      setLastClone(null);
      setSetupDismissed(false);
      setMessage("GDG copy deleted");
      setActiveTab("sync");
      clearSyncState();
    });

    return () => {
      removeSyncProgress();
      removeCloneProgress();
      removeGameCopyDeleted();
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadDiskSpace() {
      if (!config.gamePath) {
        setDiskSpace(null);
        return;
      }

      try {
        const result = await window.gdg.getDiskSpace(config.gamePath);
        if (!canceled) {
          setDiskSpace(result);
        }
      } catch {
        if (!canceled) {
          setDiskSpace(null);
        }
      }
    }

    void loadDiskSpace();

    return () => {
      canceled = true;
    };
  }, [config.gamePath]);

  useEffect(() => {
    let canceled = false;

    async function inspectGameVersion() {
      if (!config.gamePath) {
        setGameVersion(null);
        return;
      }

      try {
        const result = await window.gdg.getGameVersion(config.gamePath);
        if (!canceled) {
          setGameVersion(result);
        }
      } catch {
        if (!canceled) {
          setGameVersion(null);
        }
      }
    }

    void inspectGameVersion();

    return () => {
      canceled = true;
    };
  }, [config.gamePath]);

  useEffect(() => {
    let canceled = false;

    async function inspectInstalledMods() {
      if (!config.gamePath) {
        setScan(null);
        return;
      }

      try {
        const result = await window.gdg.scanMods(config.gamePath);
        if (!canceled) {
          setScan(result);
        }
      } catch {
        if (!canceled) {
          setScan(null);
        }
      }
    }

    void inspectInstalledMods();

    return () => {
      canceled = true;
    };
  }, [config.gamePath]);

  const nextAction = useMemo(() => {
    if (!preview) {
      return "Check mods";
    }

    const work = (preview.summary.install || 0) + (preview.summary.update || 0);
    const localOnly = preview.summary.keep || 0;
    if (preview.summary.blocked) {
      return `${preview.summary.blocked} blocked`;
    }

    if (work > 0) {
      return `${work} change${work === 1 ? "" : "s"} ready`;
    }

    if (localOnly > 0) {
      return `${localOnly} local-only`;
    }

    return "In sync";
  }, [preview]);

  const selectedServer = useMemo(() => {
    return serverDirectory?.servers.find((server) => server.id === config.lastServerId) || serverDirectory?.servers[0] || null;
  }, [config.lastServerId, serverDirectory]);
  const installProfile = useMemo(() => getInstallProfile(config.gamePath, detected?.path), [config.gamePath, detected?.path]);
  const showSetupChoices = Boolean(detected?.found && !config.gamePath && !setupDismissed);
  const detectedSetupLabel = detected?.isGdgCopy ? "Detected GDG copy" : "Detected game";

  async function initialize() {
    await runTask("Loading", async () => {
      const initial = await window.gdg.getInitialState();
      const nextConfig = initial.config || emptyConfig;
      setDetected(initial.detected);
      setConfig(nextConfig);
      const directory = await loadDirectory(nextConfig.serverDirectoryInput);

      const savedServerExists = directory.servers.some((server) => server.id === nextConfig.lastServerId);
      if ((!nextConfig.manifestInput || !savedServerExists) && directory.servers.length > 0) {
        const firstServer = directory.servers[0];
        const saved = await window.gdg.saveConfig({
          lastServerId: firstServer.id,
          manifestInput: firstServer.syncUrl
        });
        setConfig(saved);
      }

      setSetupDismissed(Boolean(nextConfig.gamePath));
    });
  }

  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage(label);

    try {
      await task();
      setMessage("Ready");
    } catch (taskError) {
      const nextError = taskError instanceof Error ? taskError.message : String(taskError);
      setError(nextError);
      setMessage("Needs attention");
    } finally {
      setBusy("");
    }
  }

  function guardBusyInteraction(event: React.SyntheticEvent<HTMLElement>) {
    if (!working) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  async function updateConfig(patch: Partial<LoaderConfig>) {
    const saved = await window.gdg.saveConfig(patch);
    setConfig(saved);
    return saved;
  }

  function clearSyncState(clearProgress = true) {
    setPreview(null);
    setApplyResult(null);
    setScan(null);
    if (clearProgress) {
      setSyncProgress(null);
    }
    setLivePlanStatuses({});
  }

  async function updateGamePath(gamePath: string) {
    clearSyncState();
    setLastClone(null);
    const saved = await updateConfig({ gamePath });
    setSetupDismissed(Boolean(gamePath));
    return saved;
  }

  async function updateManifestInput(manifestInput: string) {
    clearSyncState();
    return updateConfig({ manifestInput });
  }

  async function loadDirectory(input?: string) {
    const directory = await window.gdg.loadServerDirectory(input);
    const visibleDirectory = {
      ...directory,
      servers: directory.servers.filter((server) => !isLocalDevServer(server))
    };
    setServerDirectory(visibleDirectory);

    const healthEntries = await Promise.all(
      visibleDirectory.servers.map(async (server) => {
        const health = await window.gdg.checkServerHealth(server);
        return [server.id, health] as const;
      })
    );
    setServerHealth(Object.fromEntries(healthEntries));
    return visibleDirectory;
  }

  async function refreshServerDirectory() {
    await runTask("Checking servers", async () => {
      await loadDirectory(config.serverDirectoryInput);
    });
  }

  async function selectServer(server: DirectoryServer) {
    await updateConfig({
      lastServerId: server.id,
      manifestInput: server.syncUrl
    });
    setPreview(null);
    setApplyResult(null);
    setActiveTab("sync");
  }

  async function detectGame() {
    await runTask("Detecting game", async () => {
      const result = await window.gdg.detectGame();
      setDetected(result);
      if (result.found && config.gamePath) {
        await updateConfig({ gamePath: result.path });
      } else if (result.found) {
        setSetupDismissed(false);
      }
    });
  }

  async function browseGameFolder() {
    await runTask("Selecting folder", async () => {
      const result = await window.gdg.selectGameFolder();
      if (!result.canceled) {
        await updateGamePath(result.path);
        if (!result.valid) {
          setError("Folder selected. It does not look like a 7 Days to Die install yet.");
        }
      }
    });
  }

  async function useDetectedInstall() {
    if (!detected?.found) {
      setError("No detected 7 Days to Die install.");
      return;
    }

    await runTask("Selecting existing install", async () => {
      await updateGamePath(detected.path);
    });
  }

  async function createGdgCopy() {
    if (!detected?.found) {
      setError("No detected 7 Days to Die install.");
      return;
    }

    setSyncProgress({
      phase: "preparing",
      message: "Preparing GDG copy.",
      current: 0,
      total: 0,
      percent: 0
    });

    await runTask("Creating GDG copy", async () => {
      const result = await window.gdg.cloneGameInstall({
        sourcePath: detected.path,
        folderName: "7 Days To Die - GDG",
        createShortcut
      });

      clearSyncState(false);
      setLastClone(result);
      await updateConfig({ gamePath: result.targetPath });
      setSetupDismissed(true);

      if (result.shortcutError) {
        setError(`GDG copy is ready, but shortcut failed: ${result.shortcutError}`);
      }
    });
  }

  async function declineGameSetup() {
    await runTask("Skipping setup", async () => {
      await updateGamePath("");
      setSetupDismissed(true);
    });
  }

  async function changeInstallSetup() {
    await runTask("Changing install setup", async () => {
      const result = await window.gdg.detectGame();
      setDetected(result);
      await updateGamePath("");
      setSetupDismissed(false);
      setActiveTab("sync");

      if (!result.found) {
        throw new Error("No 7 Days to Die install was detected. Use the folder browser to choose one.");
      }
    });
  }

  async function openGameFolder() {
    if (config.gamePath) {
      await window.gdg.openPath(config.gamePath);
    }
  }

  async function openLastCloneFolder() {
    if (lastClone?.targetPath) {
      await window.gdg.openPath(lastClone.targetPath);
    }
  }

  async function browseManifestFile() {
    await runTask("Selecting manifest", async () => {
      const result = await window.gdg.selectManifestFile();
      if (!result.canceled) {
        await updateManifestInput(result.path);
      }
    });
  }

  async function scanLocalMods() {
    await runTask("Scanning mods", async () => {
      const result = await window.gdg.scanMods(config.gamePath);
      setScan(result);
      setActiveTab("installed");
    });
  }

  async function previewSync() {
    setSyncProgress({
      phase: "scanning",
      message: "Checking your Mods folder against the server list.",
      current: 0,
      total: 1,
      percent: 8
    });

    await runTask("Checking server mods", async () => {
      const result = await window.gdg.previewSync({
        gamePath: config.gamePath,
        manifestInput: config.manifestInput
      });
      setLivePlanStatuses({});
      setPreview(result);
      setScan(result.local);
      setApplyResult(null);
      setActiveTab("sync");
      setSyncProgress({
        phase: "complete",
        message: "Server mod check complete.",
        current: 1,
        total: 1,
        percent: 100
      });
    });
  }

  async function applySync() {
    setLivePlanStatuses({});
    setSyncProgress({
      phase: "preparing",
      message: "Starting mod sync.",
      current: 0,
      total: Math.max((preview?.summary.install || 0) + (preview?.summary.update || 0), 1),
      percent: 0
    });

    await runTask("Syncing mods", async () => {
      const result = await window.gdg.applySync({
        gamePath: config.gamePath,
        manifestInput: config.manifestInput
      });
      setApplyResult(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      setActiveTab("sync");
      if (!result.ok) {
        setError(`${result.failedCount || 1} mod install${result.failedCount === 1 ? "" : "s"} failed. Check the sync log below.`);
      }
    });
  }

  async function cleanLocalMods(mode: "backup" | "delete") {
    setSyncProgress({
      phase: "preparing",
      message: mode === "delete" ? "Preparing to delete local-only mods." : "Preparing to move local-only mods to backup.",
      current: 0,
      total: Math.max(localOnlyMods, 1),
      percent: 0
    });

    await runTask(mode === "delete" ? "Deleting local-only mods" : "Cleaning local-only mods", async () => {
      const result = await window.gdg.cleanLocalMods({
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        mode
      });
      setApplyResult(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      setActiveTab("sync");

      if (result.canceled) {
        setMessage("Clean canceled");
      } else if (!result.ok) {
        setError(`${result.failedCount || 1} local-only mod${result.failedCount === 1 ? "" : "s"} could not be ${mode === "delete" ? "deleted" : "moved"}. Check the log below.`);
      } else if (mode === "delete") {
        setMessage("Local-only mods deleted");
      } else {
        setMessage("Local-only mods moved to backup");
      }
    });
  }

  function updateLivePlanStatus(progress: SyncProgress) {
    const statusKey = progress.modKey || progress.modName;
    if (!statusKey) {
      return;
    }

    if (["downloading", "extracting", "backing-up", "installing"].includes(progress.phase)) {
      setLivePlanStatuses((current) => ({ ...current, [statusKey]: "active" }));
    } else if (progress.phase === "installed") {
      setLivePlanStatuses((current) => ({ ...current, [statusKey]: "ready" }));
    } else if (progress.phase === "failed") {
      setLivePlanStatuses((current) => ({ ...current, [statusKey]: "failed" }));
    }
  }

  async function updateLaunchWithEac(launchWithEac: boolean) {
    await runTask("Saving launch mode", async () => {
      await updateConfig({ launchWithEac });
    });
  }

  async function launchGame() {
    if (gameVersionMismatch) {
      setError("Update 7 Days to Die in Steam before launching this GDG modpack.");
      setOpenStep("check");
      return;
    }

    setBusy("Launching game");
    setError("");
    setMessage("Launching game");

    try {
      const result = await window.gdg.launchGame({
        gamePath: config.gamePath,
        eacEnabled: Boolean(config.launchWithEac)
      });
      setMessage(result.eacEnabled ? "Launched with EAC" : "Launched with EAC off");
    } catch (launchError) {
      const nextError = launchError instanceof Error ? launchError.message : String(launchError);
      setError(nextError);
      setMessage("Needs attention");
    } finally {
      setBusy("");
    }
  }

  async function openModsFolder() {
    if (scan?.modsPath) {
      await window.gdg.openPath(scan.modsPath);
    } else if (config.gamePath) {
      await window.gdg.openPath(`${config.gamePath}\\Mods`);
    }
  }

  async function openSteamUpdate() {
    await runTask("Opening Steam", async () => {
      const result = await window.gdg.openSteamUpdate();
      if (!result.ok) {
        throw new Error(result.error || "Steam could not be opened.");
      }
      setMessage("Steam opened. Update 7 Days to Die, then check server mods again.");
    });
  }

  async function openDiagnosticLog() {
    await runTask("Opening diagnostics", async () => {
      const result = await window.gdg.openDiagnosticLog();
      if (!result.ok) {
        throw new Error(result.error || "Diagnostic log could not be opened.");
      }
      setMessage("Diagnostic log opened");
    });
  }

  const working = Boolean(busy);
  const selectedHealth = selectedServer ? serverHealth[selectedServer.id] : null;
  const selectedServerName = selectedServer?.name || preview?.manifest.server.name || "Golden Days Gaming";
  const serverEacEnabled = typeof preview?.manifest.server.eacEnabled === "boolean" ? preview.manifest.server.eacEnabled : selectedHealth?.eacEnabled ?? null;
  const requiredSteamBuildId = preview?.gameCompatibility.requiredSteamBuildId || selectedHealth?.steamBuildId || "";
  const gameVersionMap = preview?.gameCompatibility.gameVersionMap || preview?.manifest.server.gameVersionMap || selectedHealth?.gameVersionMap || {};
  const mappedRequiredGameVersion = getGameVersionForBuild(requiredSteamBuildId, gameVersionMap);
  const requiredGameVersion = preview?.gameCompatibility.requiredGameVersion || selectedHealth?.gameVersion || mappedRequiredGameVersion;
  const mappedLocalGameVersion = getGameVersionForBuild(gameVersion?.steamBuildId || "", gameVersionMap);
  const serverVersionLabel = requiredGameVersion || (requiredSteamBuildId ? `Build ${requiredSteamBuildId}` : "Not set");
  const localBuildMatchesServer = Boolean(requiredSteamBuildId && gameVersion?.steamBuildId === requiredSteamBuildId);
  const localGameVersionLabel =
    mappedLocalGameVersion
      ? mappedLocalGameVersion
      : requiredGameVersion && localBuildMatchesServer
        ? requiredGameVersion
        : gameVersion?.steamBuildId
          ? `Build ${gameVersion.steamBuildId}`
          : "Unknown";
  const localGameVersionWithBuild =
    mappedLocalGameVersion && gameVersion?.steamBuildId
      ? `${mappedLocalGameVersion} (Steam build ${gameVersion.steamBuildId})`
      : gameVersion?.steamBuildId
        ? `Steam build ${gameVersion.steamBuildId}`
        : "";
  const serverGameVersionWithBuild =
    requiredGameVersion && requiredSteamBuildId
      ? `${requiredGameVersion} (Steam build ${requiredSteamBuildId})`
      : requiredGameVersion
        ? requiredGameVersion
        : requiredSteamBuildId
          ? `Steam build ${requiredSteamBuildId}`
          : "";
  const localVersionStatus =
    localBuildMatchesServer && requiredGameVersion
      ? `This PC matches ${serverGameVersionWithBuild}.`
      : mappedLocalGameVersion && gameVersion?.steamBuildId
        ? `This PC has ${localGameVersionWithBuild}.`
        : gameVersion?.steamBuildId
          ? `This PC has Steam build ${gameVersion.steamBuildId}.`
          : "Steam build not detected for this folder.";
  const gameCompatibility = preview?.gameCompatibility || null;
  const gameVersionMismatch = Boolean(gameCompatibility?.checked && !gameCompatibility.ok);
  const gameVersionKnown = Boolean(gameVersion?.steamBuildId);
  const serverSize = getServerSize(preview, selectedHealth);
  const freeSpaceTone = getFreeSpaceTone(diskSpace?.freeBytes, serverSize.bytes, serverSize.known);
  const currentScan = scan && normalizePath(scan.gamePath) === normalizePath(config.gamePath) ? scan : null;
  const scanMatchesGame = Boolean(currentScan);
  const dllMods = currentScan ? currentScan.mods.filter((mod) => mod.hasDll) : [];
  const hasDllMods = dllMods.length > 0;
  const eacMismatch = typeof serverEacEnabled === "boolean" && serverEacEnabled !== Boolean(config.launchWithEac);
  const eacWarning = (hasDllMods && Boolean(config.launchWithEac)) || eacMismatch;
  const launchHint = !scanMatchesGame
    ? "Checking installed mods for DLL files."
    : gameVersionMismatch
      ? "Update 7 Days to Die in Steam before launching."
    : eacMismatch
      ? `Server EAC is ${serverEacEnabled ? "on" : "off"}. Match this before launching.`
    : hasDllMods
      ? `${dllMods.length} DLL mod${dllMods.length === 1 ? "" : "s"} detected. EAC off recommended.`
      : "No DLL mods detected in the selected install.";
  const serverEacLabel = typeof serverEacEnabled === "boolean" ? (serverEacEnabled ? "On" : "Off") : "Unknown";
  const modsToInstall = preview ? (preview.summary.install || 0) + (preview.summary.update || 0) : 0;
  const localOnlyMods = preview?.summary.keep || 0;
  const setupStepState = config.gamePath ? "done" : "active";
  const checkStepState = preview ? "done" : config.gamePath && config.manifestInput ? "active" : "waiting";
  const installStepState = !preview ? "waiting" : modsToInstall > 0 ? "active" : "done";
  const launchStepState = preview && modsToInstall === 0 && !preview.summary.blocked && !gameVersionMismatch ? "active" : "waiting";

  useEffect(() => {
    if (!config.gamePath) {
      setOpenStep("setup");
    } else if (!preview) {
      setOpenStep("check");
    } else if (modsToInstall > 0 || preview.summary.blocked > 0 || localOnlyMods > 0) {
      setOpenStep("install");
    } else {
      setOpenStep("launch");
    }
  }, [config.gamePath, preview, modsToInstall, localOnlyMods]);

  return (
    <main
      className={`app-shell ${working ? "is-busy" : ""}`}
      onClickCapture={guardBusyInteraction}
      onContextMenuCapture={guardBusyInteraction}
      onDoubleClickCapture={guardBusyInteraction}
      onPointerDownCapture={guardBusyInteraction}
    >
      {working && (
        <div className="busy-click-shield" aria-hidden="true">
          <span>{busy}</span>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand-mark">
          <div className="brand-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>GDG Mod Loader</h1>
            <span>7 Days to Die</span>
          </div>
        </div>

        <section className="server-list" aria-label="Server profiles">
          <div className="server-list-heading">
            <div className="section-label">GDG Servers</div>
            <button className="mini-icon" type="button" onClick={refreshServerDirectory} title="Refresh server status">
              <RefreshCw size={15} />
            </button>
          </div>
          {(serverDirectory?.servers || []).map((server) => {
            const health = serverHealth[server.id];
            const active = selectedServer?.id === server.id;

            return (
              <button className={`server-profile ${active ? "active" : ""}`} type="button" key={server.id} onClick={() => void selectServer(server)}>
                <Server size={18} />
                <span>
                  <strong>{server.name}</strong>
                  <small>{server.host}:{server.gamePort || 26900}</small>
                  <small className={health?.ok ? "sync-online" : "sync-offline"}>
                    {health ? (health.ok ? `Sync online - ${health.modCount} mods - ${formatKnownBytes(health.installedBytes, health.installedSizeKnown)}` : "Sync offline") : "Checking sync"}
                  </small>
                </span>
              </button>
            );
          })}
        </section>

        <section className="health-panel" aria-label="Loader status">
          <StatusRow icon={<Gamepad2 size={17} />} label="Game" value={config.gamePath ? "Selected" : detected?.found ? "Choose" : "Missing"} />
          <StatusRow icon={<RefreshCw size={17} />} label="Game version" value={localGameVersionLabel} />
          <StatusRow icon={<UploadCloud size={17} />} label="Server sync" value={selectedHealth?.ok ? "Online" : config.manifestInput ? "Selected" : "Missing"} />
          <StatusRow icon={<RefreshCw size={17} />} label="Server version" value={serverVersionLabel} />
          <StatusRow icon={serverEacEnabled ? <ShieldCheck size={17} /> : <ShieldOff size={17} />} label="Server EAC" value={serverEacLabel} />
          <StatusRow icon={config.launchWithEac ? <ShieldCheck size={17} /> : <ShieldOff size={17} />} label="Launch EAC" value={config.launchWithEac ? "On" : "Off"} />
          <StatusRow icon={<ListChecks size={17} />} label="Action" value={nextAction} />
        </section>

        <section className={`sidebar-launch-panel ${eacWarning ? "warn" : ""}`} aria-label="Launch game">
          <div>
            <span className="section-label">Play</span>
            <strong>{config.gamePath ? "Ready to launch" : "Choose game folder"}</strong>
            <small>Launch EAC {config.launchWithEac ? "on" : "off"} - server {serverEacLabel.toLowerCase()}</small>
          </div>
          <button className="sidebar-launch-button" type="button" onClick={launchGame} disabled={working || !config.gamePath || gameVersionMismatch}>
            <Play size={17} />
            Launch Game
          </button>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">Golden Days Gaming</div>
            <h2>Player Mod Sync</h2>
          </div>

          <div className={`status-pill ${error ? "danger" : working ? "working" : "ok"}`}>
            {working ? <Loader2 size={16} className="spin" /> : error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <span>{error || busy || message}</span>
          </div>
        </header>

        <nav className="tabs" aria-label="Workspace tabs">
          <button className={activeTab === "sync" ? "active" : ""} type="button" onClick={() => setActiveTab("sync")}>
            <RefreshCw size={16} />
            Sync
          </button>
          <button className={activeTab === "installed" ? "active" : ""} type="button" onClick={() => setActiveTab("installed")}>
            <HardDrive size={16} />
            Installed
          </button>
          <button className={activeTab === "settings" ? "active" : ""} type="button" onClick={() => setActiveTab("settings")}>
            <Settings size={16} />
            Settings
          </button>
        </nav>

        {activeTab === "sync" && (
          <div className="content-grid">
            <section className="panel wide">
              <div className="panel-heading">
                <div>
                  <span className="section-label">Guided Setup</span>
                  <h3>{selectedServerName}</h3>
                  <p className="panel-description">Follow these steps from top to bottom. GDG will check your game folder, compare it to the server, then install only what is missing.</p>
                </div>
                <button className="icon-button" type="button" onClick={previewSync} disabled={working || !config.gamePath || !config.manifestInput} title="Check server mods">
                  <RefreshCw size={18} />
                </button>
              </div>

              <div className="step-sections">
                <StepSection
                  number="1"
                  title="Choose Game Folder"
                  summary={config.gamePath ? `${installProfile.label} selected` : "Pick where GDG should prepare 7 Days to Die"}
                  state={setupStepState}
                  open={openStep === "setup"}
                  onToggle={() => setOpenStep(openStep === "setup" ? "" : "setup")}
                >
                  <div className="step-body">
                    <p className="step-copy">
                      GDG can keep vanilla untouched by making a separate copy, or it can install mods into your existing 7 Days to Die folder.
                    </p>

                    {config.gamePath && (
                      <div className={`install-summary ${installProfile.tone}`}>
                        <HardDrive size={18} />
                        <span>
                          <strong>{installProfile.label}</strong>
                          <small>{config.gamePath}</small>
                          <small>{diskSpace ? `${formatBytes(diskSpace.freeBytes)} free on this drive` : "Checking free space"}</small>
                        </span>
                        <button className="secondary slim" type="button" onClick={openGameFolder}>
                          <FolderOpen size={16} />
                          Open
                        </button>
                        <button className="secondary slim" type="button" onClick={changeInstallSetup} disabled={working}>
                          <RotateCcw size={16} />
                          Change
                        </button>
                      </div>
                    )}

                    {lastClone?.targetPath === config.gamePath && (
                      <div className="copy-result">
                        <CheckCircle2 size={18} />
                        <span>
                          <strong>{lastClone.created ? "GDG copy created" : "GDG copy selected"}</strong>
                          <small>{lastClone.targetPath}</small>
                        </span>
                        <button className="secondary slim" type="button" onClick={openLastCloneFolder}>
                          <FolderOpen size={16} />
                          Open
                        </button>
                      </div>
                    )}

                    {showSetupChoices && (
                      <div className="setup-panel">
                        <div className="setup-heading">
                          <div>
                            <span className="section-label">Game Setup</span>
                            <strong>Choose how GDG should prepare 7 Days to Die.</strong>
                            <p>
                              A GDG copy is safest for most players. It creates a separate folder beside the detected game and starts with a clean Mods folder.
                            </p>
                            <small>{detectedSetupLabel}: {detected?.path}</small>
                            {detected?.isGdgCopy && <small>This already looks like a GDG copy. Browse for your Steam install if you want to overwrite vanilla.</small>}
                          </div>
                        </div>

                        <div className="setup-options">
                          <button className="setup-option overwrite" type="button" onClick={useDetectedInstall} disabled={working}>
                            <AlertTriangle size={20} />
                            <span>
                              <strong>{detected?.isGdgCopy ? "Use detected GDG copy" : "Overwrite existing"}</strong>
                              <small>
                                {detected?.isGdgCopy
                                  ? "Select the detected modded copy. This will not point at your vanilla Steam folder."
                                  : "Use your current 7 Days to Die folder. GDG mods will be installed into this game."}
                              </small>
                            </span>
                          </button>
                          <button className="setup-option copy" type="button" onClick={createGdgCopy} disabled={working}>
                            <Copy size={20} />
                            <span>
                              <strong>Create GDG copy <em>Recommended</em></strong>
                              <small>Make a separate folder named 7 Days To Die - GDG with a clean Mods folder.</small>
                            </span>
                          </button>
                          <button className="setup-option decline" type="button" onClick={declineGameSetup} disabled={working}>
                            <XCircle size={20} />
                            <span>
                              <strong>Decline</strong>
                              <small>Skip setup for now. You can browse for a folder or change setup later.</small>
                            </span>
                          </button>
                        </div>

                        <label className="shortcut-toggle">
                          <input type="checkbox" checked={createShortcut} onChange={(event) => setCreateShortcut(event.target.checked)} />
                          <span>Create desktop shortcut for the GDG copy</span>
                        </label>
                      </div>
                    )}

                    <label>
                      <span>Game folder</span>
                      <small className="field-help">This is the 7 Days to Die folder GDG will check, sync, and launch.</small>
                      <div className="input-row">
                        <input
                          value={config.gamePath}
                          onChange={(event) => void updateGamePath(event.target.value)}
                          placeholder="C:\Program Files (x86)\Steam\steamapps\common\7 Days To Die"
                        />
                        <button type="button" onClick={detectGame} disabled={working} title="Detect game">
                          <Search size={17} />
                        </button>
                        <button type="button" onClick={browseGameFolder} disabled={working} title="Browse game folder">
                          <FolderOpen size={17} />
                        </button>
                      </div>
                    </label>
                  </div>
                </StepSection>

                <StepSection
                  number="2"
                  title="Check Server Mods"
                  summary={preview ? `${preview.plan.length} mods checked against ${selectedServerName}` : "Compare your folder with the selected GDG server"}
                  state={checkStepState}
                  open={openStep === "check"}
                  onToggle={() => setOpenStep(openStep === "check" ? "" : "check")}
                >
                  <div className="step-body">
                    <p className="step-copy">
                      This checks the server mod list and your selected folder. It does not install anything yet.
                    </p>

                    {selectedServer && (
                      <div className={`server-status-band ${selectedHealth?.ok ? "online" : "offline"}`}>
                        <Wifi size={18} />
                        <strong>{selectedHealth?.ok ? "Sync online" : "Sync not confirmed"}</strong>
                        <span>
                          {selectedHealth?.ok
                            ? `${selectedHealth.modCount} client-safe mods - ${formatKnownBytes(selectedHealth.installedBytes, selectedHealth.installedSizeKnown)}${selectedHealth.generatedAt ? ` - updated ${formatDate(selectedHealth.generatedAt)}` : ""}`
                            : selectedHealth?.error || "Refresh server status"}
                        </span>
                      </div>
                    )}

                    {(requiredGameVersion || requiredSteamBuildId || gameVersionKnown || gameVersionMismatch) && (
                      <div className={`version-guard ${gameVersionMismatch ? "warn" : "ok"}`}>
                        {gameVersionMismatch ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                        <span>
                          <strong>{gameVersionMismatch ? "Game update needed" : "Game version check"}</strong>
                          <small>
                            {gameVersionMismatch
                              ? gameCompatibility?.reason
                              : requiredGameVersion
                                ? `Server expects ${requiredGameVersion}${requiredSteamBuildId ? ` / Steam build ${requiredSteamBuildId}` : ""}.`
                                : requiredSteamBuildId
                                  ? `Server expects Steam build ${requiredSteamBuildId}.`
                                  : "Server has not published a required game version yet."}
                          </small>
                          <small>{localVersionStatus}</small>
                        </span>
                        {gameVersionMismatch && (
                          <button className="secondary slim" type="button" onClick={openSteamUpdate} disabled={working}>
                            <RefreshCw size={16} />
                            Open Steam
                          </button>
                        )}
                        {gameVersionMismatch && (
                          <div className="steam-update-help">
                            <strong>Steam controls game updates.</strong>
                            <ol>
                              <li>Open Steam and select 7 Days to Die.</li>
                              <li>Go to Properties, then Betas.</li>
                              <li>Choose the public/current branch or the server version shown above.</li>
                              <li>Wait for Steam to finish updating, then come back and click Check Server Mods.</li>
                            </ol>
                          </div>
                        )}
                      </div>
                    )}

                    <label>
                      <span>Server sync endpoint</span>
                      <small className="field-help">This is the server mod list. Most players should leave the GDG server URL as-is.</small>
                      <div className="input-row">
                        <input
                          value={config.manifestInput}
                          onChange={(event) => void updateManifestInput(event.target.value)}
                          placeholder={sampleSyncEndpoint}
                        />
                        <button type="button" onClick={browseManifestFile} disabled={working} title="Browse manifest">
                          <FolderOpen size={17} />
                        </button>
                      </div>
                    </label>

                    <div className="step-actions">
                      <button className="secondary" type="button" onClick={previewSync} disabled={working || !config.gamePath || !config.manifestInput}>
                        <ListChecks size={17} />
                        Check Server Mods
                      </button>
                    </div>
                  </div>
                </StepSection>

                <StepSection
                  number="3"
                  title="Install Missing Mods"
                  summary={
                    preview
                      ? modsToInstall > 0
                        ? `${modsToInstall} change${modsToInstall === 1 ? "" : "s"} ready to install`
                        : localOnlyMods > 0
                          ? `${localOnlyMods} local-only mod${localOnlyMods === 1 ? "" : "s"} to review`
                          : "No install needed"
                      : "Check server mods first"
                  }
                  state={installStepState}
                  open={openStep === "install"}
                  onToggle={() => setOpenStep(openStep === "install" ? "" : "install")}
                >
                  <div className="step-body">
                    <p className="step-copy">
                      GDG will download missing packages, back up updated folders, and mark each mod ready as it finishes. Local-only mods are shown below but are not removed automatically.
                    </p>
                    {localOnlyMods > 0 && (
                      <div className="local-only-warning">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>{localOnlyMods} local-only mod{localOnlyMods === 1 ? "" : "s"} detected</strong>
                          <small>These are installed on this PC but are not part of the selected server package.</small>
                        </span>
                      </div>
                    )}
                    <div className="step-actions">
                      <button className="secondary" type="button" onClick={() => void cleanLocalMods("backup")} disabled={working || !preview || localOnlyMods === 0}>
                        <HardDrive size={17} />
                        Move Local-Only to Backup
                      </button>
                      <button className="secondary danger" type="button" onClick={() => void cleanLocalMods("delete")} disabled={working || !preview || localOnlyMods === 0}>
                        <Trash2 size={17} />
                        Delete Local-Only
                      </button>
                      <button className="primary" type="button" onClick={applySync} disabled={working || !preview || gameVersionMismatch || Boolean(preview.summary.blocked) || modsToInstall === 0}>
                        <Download size={17} />
                        Install Missing Mods
                      </button>
                    </div>
                  </div>
                </StepSection>

                <StepSection
                  number="4"
                  title="Launch 7 Days to Die"
                  summary={config.gamePath ? `Launch EAC ${config.launchWithEac ? "on" : "off"} - server ${serverEacLabel.toLowerCase()}` : "Choose a game folder first"}
                  state={launchStepState}
                  open={openStep === "launch"}
                  onToggle={() => setOpenStep(openStep === "launch" ? "" : "launch")}
                >
                  <div className="step-body">
                    {config.gamePath ? (
                      <div className={`launch-card ${eacWarning ? "warn" : "ready"}`}>
                        <div className="launch-copy">
                          {config.launchWithEac ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
                          <span>
                            <strong>Launch 7 Days to Die</strong>
                            <small>{launchHint}</small>
                            {hasDllMods && <small>DLL mods: {dllMods.map((mod) => mod.displayName).join(", ")}</small>}
                          </span>
                        </div>
                        <div className="eac-toggle" role="group" aria-label="Easy Anti-Cheat launch mode">
                          <button
                            className={config.launchWithEac ? "active" : ""}
                            type="button"
                            onClick={() => void updateLaunchWithEac(true)}
                            disabled={working}
                          >
                            <ShieldCheck size={16} />
                            EAC On
                          </button>
                          <button
                            className={!config.launchWithEac ? "active" : ""}
                            type="button"
                            onClick={() => void updateLaunchWithEac(false)}
                            disabled={working}
                          >
                            <ShieldOff size={16} />
                            EAC Off
                          </button>
                        </div>
                        <button className="primary launch-button" type="button" onClick={launchGame} disabled={working || !config.gamePath || gameVersionMismatch}>
                          <Play size={17} />
                          Launch
                        </button>
                      </div>
                    ) : (
                      <EmptyState icon={<Gamepad2 size={22} />} title="Game folder needed" value="Complete Step 1 before launching." />
                    )}
                  </div>
                </StepSection>
              </div>
            </section>

            <section className="panel compact">
              <span className="section-label">Server Match</span>
              <div className="metric-grid">
                <Metric label="Server ready" value={preview?.summary.ready || 0} tone="green" />
                <Metric label="Install" value={preview?.summary.install || 0} tone="blue" />
                <Metric label="Update" value={preview?.summary.update || 0} tone="amber" />
                <Metric label="Local only" value={preview?.summary.keep || 0} tone="violet" />
                <Metric label="Blocked" value={preview?.summary.blocked || 0} tone="red" />
              </div>
              <div className="storage-grid">
                <StorageStat icon={<Database size={16} />} label="Server mods" value={serverSize.known ? formatBytes(serverSize.bytes) : "Unknown"} tone="gold" />
                <StorageStat icon={serverEacEnabled ? <ShieldCheck size={16} /> : <ShieldOff size={16} />} label="Server EAC" value={serverEacLabel} tone={serverEacEnabled === null ? "muted" : serverEacEnabled ? "green" : "amber"} />
                <StorageStat icon={<HardDrive size={16} />} label="Free space" value={diskSpace ? formatBytes(diskSpace.freeBytes) : "Unknown"} tone={freeSpaceTone} />
              </div>
            </section>

            {syncProgress && (
              <section className={`panel full sync-progress-panel ${syncProgress.phase}`}>
                <div className="sync-progress-heading">
                  <div>
                    <span className="section-label">Progress</span>
                    <h3>{getProgressTitle(syncProgress)}</h3>
                  </div>
                  <strong>{syncProgress.percent}%</strong>
                </div>
                <div className="gold-progress-track" aria-label="Sync progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress.percent}>
                  <div className="gold-progress-fill" style={{ width: `${syncProgress.percent}%` }} />
                </div>
                <div className="sync-progress-details">
                  <span>{syncProgress.message}</span>
                  <strong>
                    {syncProgress.total > 0
                      ? `${Math.min(syncProgress.current, syncProgress.total)} of ${syncProgress.total}`
                      : "Ready"}
                  </strong>
                  {syncProgress.bytesTotal ? (
                    <small>{formatBytes(syncProgress.bytesReceived || 0)} / {formatBytes(syncProgress.bytesTotal)}</small>
                  ) : (
                    <small>{formatSyncPhase(syncProgress.phase)}</small>
                  )}
                </div>
              </section>
            )}

            <section className="panel full">
              <div className="panel-heading">
                <div>
                  <span className="section-label">Sync Plan</span>
                  <h3>{preview ? `${preview.plan.length} checked mods` : "Mods not checked yet"}</h3>
                  <p className="panel-description">Green rows match the server. Local-only rows are extra mods on this PC and are not removed automatically.</p>
                </div>
                <button className="secondary slim" type="button" onClick={openModsFolder} disabled={!config.gamePath}>
                  <FolderOpen size={16} />
                  Mods
                </button>
              </div>

              <div className="mod-table">
                {(preview?.plan || []).map((item) => (
                  <PlanRow key={`${item.action}-${item.mod.id}-${item.mod.folderName || item.mod.name}`} item={item} liveStatus={livePlanStatuses[getPlanKey(item)]} />
                ))}
              {!preview && <EmptyState icon={<ShieldCheck size={22} />} title="Check pending" value="Click Check Server Mods to compare your game folder with the server." />}
              </div>
            </section>

            {applyResult && (
              <section className="panel full">
                <div className="panel-heading">
                  <div>
                    <span className="section-label">Sync Log</span>
                    <h3>{applyResult.backupRoot ? "Backup created" : "No backup needed"}</h3>
                  </div>
                  {applyResult.backupRoot && (
                    <button className="secondary slim" type="button" onClick={() => void window.gdg.openPath(applyResult.backupRoot)}>
                      <FolderOpen size={16} />
                      Backup
                    </button>
                  )}
                  <button className="secondary slim" type="button" onClick={openDiagnosticLog}>
                    <FolderOpen size={16} />
                    Diagnostics
                  </button>
                </div>
                <div className="log-list">
                  {applyResult.log.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "installed" && (
          <section className="panel full installed-view">
            <div className="panel-heading">
              <div>
                <span className="section-label">Local Mods</span>
                <h3>{scan?.mods.length || 0} detected</h3>
              </div>
              <div className="button-pair">
                <button className="secondary slim" type="button" onClick={openModsFolder} disabled={!config.gamePath}>
                  <FolderOpen size={16} />
                  Mods
                </button>
                <button className="secondary slim" type="button" onClick={scanLocalMods} disabled={working || !config.gamePath}>
                  <RefreshCw size={16} />
                  Scan
                </button>
              </div>
            </div>

            <div className="installed-list">
              {(scan?.mods || []).map((mod) => (
                <article className="mod-card" key={mod.folderPath}>
                  <div className="mod-icon">
                    <Wrench size={18} />
                  </div>
                  <div>
                    <strong>{mod.displayName}</strong>
                    <span>{mod.folderName}</span>
                  </div>
                  <small>{mod.hasDll ? `${mod.version || "No version"} - DLL` : mod.version || "No version"}</small>
                </article>
              ))}
              {!scan && <EmptyState icon={<HardDrive size={22} />} title="No scan yet" value="Local mods" />}
              {scan && scan.mods.length === 0 && <EmptyState icon={<HardDrive size={22} />} title="Empty Mods folder" value={scan.modsPath} />}
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="panel full settings-view">
            <div className="panel-heading">
              <div>
                <span className="section-label">Settings</span>
                <h3>Local preferences</h3>
              </div>
              <div className="button-pair">
                <button className="secondary slim" type="button" onClick={openGameFolder} disabled={!config.gamePath}>
                  <FolderOpen size={16} />
                  Game
                </button>
                <button className="secondary slim" type="button" onClick={changeInstallSetup} disabled={working}>
                  <RotateCcw size={16} />
                  Change install setup
                </button>
              </div>
            </div>

            <div className="settings-grid">
              <SettingItem label="Detected install" value={detected?.found ? detected.path : "Not found"} />
              <SettingItem label="Install type" value={installProfile.label} />
              <SettingItem label="Saved game folder" value={config.gamePath || "Not set"} />
              <SettingItem label="Local game version" value={localGameVersionLabel} />
              <SettingItem label="Local Steam build" value={gameVersion?.steamBuildId || "Unknown"} />
              <SettingItem label="Server game version" value={requiredGameVersion || "Not published"} />
              <SettingItem label="Server Steam build" value={requiredSteamBuildId || "Not published"} />
              <SettingItem label="Server EAC" value={serverEacLabel} />
              <SettingItem label="Launch EAC" value={config.launchWithEac ? "On" : "Off"} />
              <SettingItem label="DLL mod warning" value={hasDllMods ? `${dllMods.length} mod${dllMods.length === 1 ? "" : "s"} detected` : scanMatchesGame ? "No DLL mods detected" : "Checking"} />
              <SettingItem label="Free disk space" value={diskSpace ? `${formatBytes(diskSpace.freeBytes)} free of ${formatBytes(diskSpace.totalBytes)}` : "Unknown"} />
              <SettingItem label="Selected server mods" value={serverSize.known ? formatBytes(serverSize.bytes) : "Unknown"} />
              <SettingItem label="Selected sync endpoint" value={config.manifestInput || "Not set"} />
              <SettingItem label="Server directory" value={config.serverDirectoryInput || "Built-in sample"} />
              <SettingItem label="Game adapter" value="7dtd" />
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function StatusRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="status-row">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getGameVersionForBuild(buildId: string, versionMap: Record<string, string> = {}) {
  const key = String(buildId || "").trim();
  if (!key) {
    return "";
  }

  return String(versionMap[key] || "").trim();
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StorageStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className={`storage-stat ${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StepSection({
  number,
  title,
  summary,
  state,
  open,
  onToggle,
  children
}: {
  number: string;
  title: string;
  summary: string;
  state: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className={`step-section ${state} ${open ? "open" : ""}`}>
      <button className="step-section-header" type="button" onClick={onToggle} aria-expanded={open}>
        <div className="step-number">{state === "done" ? <CheckCircle2 size={17} /> : number}</div>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={18} />
      </button>
      {open && <div className="step-section-content">{children}</div>}
    </article>
  );
}

function PlanRow({ item, liveStatus }: { item: SyncPlanItem; liveStatus?: LivePlanStatus }) {
  const action = liveStatus === "ready" ? "ready" : liveStatus === "failed" ? "blocked" : item.action;
  const icon =
    liveStatus === "active" ? (
      <Loader2 size={18} className="spin" />
    ) : (
      {
        ready: <CheckCircle2 size={18} />,
        install: <Download size={18} />,
        update: <RefreshCw size={18} />,
        blocked: <AlertTriangle size={18} />,
        keep: <HardDrive size={18} />
      }[action]
    );
  const reason =
    liveStatus === "active"
      ? "Installing now"
      : liveStatus === "ready"
        ? "Ready"
        : liveStatus === "failed"
          ? "Failed"
          : item.reason;

  return (
    <article className={`plan-row ${item.action} ${liveStatus || ""}`}>
      <div className="plan-icon">{icon}</div>
      <div className="plan-main">
        <strong>{item.mod.name}</strong>
        <span>{item.mod.folderName || item.mod.id}</span>
      </div>
      <div className="plan-version">{item.mod.version || item.installed?.version || "No version"}</div>
      <div className="plan-reason">{reason}</div>
    </article>
  );
}

function EmptyState({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{value}</span>
    </div>
  );
}

function SettingItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatKnownBytes(bytes: number | undefined, known: boolean | undefined) {
  if (!known) {
    return "size unknown";
  }

  return formatBytes(bytes || 0);
}

function formatBytes(bytes: number) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  for (const unit of units) {
    if (next < 1024 || unit === units[units.length - 1]) {
      return `${next.toFixed(next >= 10 ? 1 : 2)} ${unit}`;
    }
    next /= 1024;
  }

  return `${value} B`;
}

function formatSyncPhase(phase: SyncProgress["phase"]) {
  const labels: Record<SyncProgress["phase"], string> = {
    preparing: "Preparing files",
    scanning: "Measuring game folder",
    copying: "Copying game files",
    shortcut: "Creating shortcut",
    downloading: "Downloading package",
    extracting: "Unpacking package",
    "backing-up": "Saving backup",
    installing: "Installing mod",
    installed: "Mod ready",
    verifying: "Verifying install",
    complete: "Done",
    failed: "Needs attention"
  };

  return labels[phase];
}

function getPlanKey(item: SyncPlanItem) {
  return String(item.mod.folderName || item.mod.id || item.mod.name || "").toLowerCase();
}

function getProgressTitle(progress: SyncProgress) {
  const message = progress.message.toLowerCase();
  if (message.includes("local-only") || message.includes("moving") || message.includes("deleting")) {
    if (progress.phase === "complete") {
      return message.includes("deleted") ? "Local-only mods deleted" : "Local-only mods moved";
    }
    return message.includes("delete") || message.includes("deleting") ? "Deleting local-only mods" : "Moving local-only mods";
  }

  if (progress.message.toLowerCase().includes("server mod check") || progress.message.toLowerCase().includes("server list")) {
    return progress.phase === "complete" ? "Server mods checked" : "Checking server mods";
  }

  if (progress.message.toLowerCase().includes("gdg copy")) {
    return progress.phase === "complete" ? "GDG copy ready" : "Creating GDG copy";
  }

  if (progress.phase === "scanning" || progress.phase === "copying" || progress.phase === "shortcut") {
    return "Creating GDG copy";
  }

  if (progress.phase === "complete") {
    return "Finished syncing";
  }

  if (progress.phase === "failed") {
    return "Sync needs attention";
  }

  return "Installing server mods";
}

function getServerSize(preview: SyncPreview | null, selectedHealth: ServerHealth | null) {
  if (preview) {
    return {
      bytes: preview.installedBytes || preview.downloadBytes || 0,
      known: preview.installedSizeKnown || preview.downloadSizeKnown
    };
  }

  if (selectedHealth) {
    return {
      bytes: selectedHealth.installedBytes || selectedHealth.downloadBytes || 0,
      known: selectedHealth.installedSizeKnown || selectedHealth.downloadSizeKnown
    };
  }

  return {
    bytes: 0,
    known: false
  };
}

function getFreeSpaceTone(freeBytes: number | undefined, neededBytes: number, known: boolean) {
  if (!freeBytes || !known) {
    return "muted";
  }

  if (freeBytes < neededBytes) {
    return "red";
  }

  if (freeBytes < neededBytes * 2) {
    return "amber";
  }

  return "green";
}

function getInstallProfile(gamePath: string, detectedPath?: string) {
  if (!gamePath) {
    return {
      label: "Not selected",
      tone: "missing"
    };
  }

  const folderName = getFolderName(gamePath).toLowerCase();
  if (folderName.includes("gdg")) {
    return {
      label: "GDG copy",
      tone: "copy"
    };
  }

  if (detectedPath && normalizePath(gamePath) === normalizePath(detectedPath)) {
    return {
      label: "Existing install",
      tone: "existing"
    };
  }

  return {
    label: "Custom install",
    tone: "custom"
  };
}

function isLocalDevServer(server: DirectoryServer) {
  const syncUrl = server.syncUrl || "";
  return server.id === "gdg-local-dev" || syncUrl.includes("127.0.0.1:8787") || syncUrl.includes("localhost:8787");
}

function normalizePath(value: string) {
  return value.replace(/[\\/]+$/g, "").toLowerCase();
}

function getFolderName(value: string) {
  return value.replace(/[\\/]+$/g, "").split(/[\\/]/).pop() || value;
}

export default App;
