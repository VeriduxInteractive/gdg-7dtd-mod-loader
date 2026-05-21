import {
  AlertTriangle,
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
  LoaderConfig,
  ScanResult,
  ServerDirectory,
  ServerHealth,
  SyncPlanItem,
  SyncPreview
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

function App() {
  const [config, setConfig] = useState<LoaderConfig>(emptyConfig);
  const [detected, setDetected] = useState<DetectedGame | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [serverDirectory, setServerDirectory] = useState<ServerDirectory | null>(null);
  const [serverHealth, setServerHealth] = useState<Record<string, ServerHealth>>({});
  const [diskSpace, setDiskSpace] = useState<DiskSpace | null>(null);
  const [createShortcut, setCreateShortcut] = useState(true);
  const [lastClone, setLastClone] = useState<CloneGameResult | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("sync");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [error, setError] = useState("");

  useEffect(() => {
    void initialize();
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
      return "Preview sync";
    }

    const work = (preview.summary.install || 0) + (preview.summary.update || 0);
    if (preview.summary.blocked) {
      return `${preview.summary.blocked} blocked`;
    }

    if (work > 0) {
      return `${work} change${work === 1 ? "" : "s"} ready`;
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

  async function updateConfig(patch: Partial<LoaderConfig>) {
    const saved = await window.gdg.saveConfig(patch);
    setConfig(saved);
    return saved;
  }

  function clearSyncState() {
    setPreview(null);
    setApplyResult(null);
    setScan(null);
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

    await runTask("Creating GDG copy", async () => {
      const result = await window.gdg.cloneGameInstall({
        sourcePath: detected.path,
        folderName: "7 Days To Die - GDG",
        createShortcut
      });

      clearSyncState();
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
    await runTask("Previewing sync", async () => {
      const result = await window.gdg.previewSync({
        gamePath: config.gamePath,
        manifestInput: config.manifestInput
      });
      setPreview(result);
      setScan(result.local);
      setApplyResult(null);
      setActiveTab("sync");
    });
  }

  async function applySync() {
    await runTask("Syncing mods", async () => {
      const result = await window.gdg.applySync({
        gamePath: config.gamePath,
        manifestInput: config.manifestInput
      });
      setApplyResult(result);
      setPreview(result.preview);
      setScan(result.preview.local);
      setActiveTab("sync");
    });
  }

  async function updateLaunchWithEac(launchWithEac: boolean) {
    await runTask("Saving launch mode", async () => {
      await updateConfig({ launchWithEac });
    });
  }

  async function launchGame() {
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

  const working = Boolean(busy);
  const selectedHealth = selectedServer ? serverHealth[selectedServer.id] : null;
  const selectedServerName = selectedServer?.name || preview?.manifest.server.name || "Golden Days Gaming";
  const serverEacEnabled = typeof preview?.manifest.server.eacEnabled === "boolean" ? preview.manifest.server.eacEnabled : selectedHealth?.eacEnabled ?? null;
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
    : eacMismatch
      ? `Server EAC is ${serverEacEnabled ? "on" : "off"}. Match this before launching.`
    : hasDllMods
      ? `${dllMods.length} DLL mod${dllMods.length === 1 ? "" : "s"} detected. EAC off recommended.`
      : "No DLL mods detected in the selected install.";
  const serverEacLabel = typeof serverEacEnabled === "boolean" ? (serverEacEnabled ? "On" : "Off") : "Unknown";

  return (
    <main className="app-shell">
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
          <StatusRow icon={<UploadCloud size={17} />} label="Server sync" value={selectedHealth?.ok ? "Online" : config.manifestInput ? "Selected" : "Missing"} />
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
          <button className="sidebar-launch-button" type="button" onClick={launchGame} disabled={working || !config.gamePath}>
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
                  <span className="section-label">Sync Target</span>
                  <h3>{selectedServerName}</h3>
                </div>
                <button className="icon-button" type="button" onClick={previewSync} disabled={working} title="Refresh preview">
                  <RefreshCw size={18} />
                </button>
              </div>

              <div className="path-stack">
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

                {config.gamePath && (
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
                    <button className="primary launch-button" type="button" onClick={launchGame} disabled={working || !config.gamePath}>
                      <Play size={17} />
                      Launch
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
                          GDG can keep your normal game untouched by making a separate modded copy, or it can sync mods into the
                          detected install below.
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
                          <small>Make a separate folder named 7 Days To Die - GDG so vanilla stays clean.</small>
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

                <label>
                  <span>Server sync endpoint</span>
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
              </div>

              <div className="action-bar">
                <button className="secondary" type="button" onClick={scanLocalMods} disabled={working || !config.gamePath}>
                  <HardDrive size={17} />
                  Scan
                </button>
                <button className="secondary" type="button" onClick={previewSync} disabled={working || !config.gamePath || !config.manifestInput}>
                  <ListChecks size={17} />
                  Preview
                </button>
                <button className="primary" type="button" onClick={applySync} disabled={working || !preview || Boolean(preview.summary.blocked)}>
                  <Download size={17} />
                  Sync
                </button>
              </div>
            </section>

            <section className="panel compact">
              <span className="section-label">Server Match</span>
              <div className="metric-grid">
                <Metric label="Ready" value={preview?.summary.ready || 0} tone="green" />
                <Metric label="Install" value={preview?.summary.install || 0} tone="blue" />
                <Metric label="Update" value={preview?.summary.update || 0} tone="amber" />
                <Metric label="Blocked" value={preview?.summary.blocked || 0} tone="red" />
              </div>
              <div className="storage-grid">
                <StorageStat icon={<Database size={16} />} label="Server mods" value={serverSize.known ? formatBytes(serverSize.bytes) : "Unknown"} tone="gold" />
                <StorageStat icon={serverEacEnabled ? <ShieldCheck size={16} /> : <ShieldOff size={16} />} label="Server EAC" value={serverEacLabel} tone={serverEacEnabled === null ? "muted" : serverEacEnabled ? "green" : "amber"} />
                <StorageStat icon={<HardDrive size={16} />} label="Free space" value={diskSpace ? formatBytes(diskSpace.freeBytes) : "Unknown"} tone={freeSpaceTone} />
              </div>
            </section>

            <section className="panel full">
              <div className="panel-heading">
                <div>
                  <span className="section-label">Sync Plan</span>
                  <h3>{preview ? `${preview.plan.length} mod entries` : "No preview"}</h3>
                </div>
                <button className="secondary slim" type="button" onClick={openModsFolder} disabled={!config.gamePath}>
                  <FolderOpen size={16} />
                  Mods
                </button>
              </div>

              <div className="mod-table">
                {(preview?.plan || []).map((item) => (
                  <PlanRow key={`${item.action}-${item.mod.id}-${item.mod.folderName || item.mod.name}`} item={item} />
                ))}
              {!preview && <EmptyState icon={<ShieldCheck size={22} />} title="Preview pending" value="Select a GDG server sync endpoint" />}
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

function PlanRow({ item }: { item: SyncPlanItem }) {
  const icon = {
    ready: <CheckCircle2 size={18} />,
    install: <Download size={18} />,
    update: <RefreshCw size={18} />,
    blocked: <AlertTriangle size={18} />,
    keep: <HardDrive size={18} />
  }[item.action];

  return (
    <article className={`plan-row ${item.action}`}>
      <div className="plan-icon">{icon}</div>
      <div className="plan-main">
        <strong>{item.mod.name}</strong>
        <span>{item.mod.folderName || item.mod.id}</span>
      </div>
      <div className="plan-version">{item.mod.version || item.installed?.version || "No version"}</div>
      <div className="plan-reason">{item.reason}</div>
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
