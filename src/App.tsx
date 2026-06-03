import {
  AlertTriangle,
  Archive,
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
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplyResult,
  BackupEntry,
  CloneGameResult,
  DetectedGame,
  DiskSpace,
  DoctorResult,
  DirectoryServer,
  GameVersionInfo,
  GameId,
  LoaderConfig,
  ScanResult,
  ServerDirectory,
  ServerHealth,
  SyncAction,
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
const gameDefinitions: Record<GameId, {
  id: GameId;
  name: string;
  shortName: string;
  folderPlaceholder: string;
  defaultServerId: string;
  supportsEac: boolean;
  copyName: string;
  modsLabel: string;
}> = {
  "7dtd": {
    id: "7dtd",
    name: "7 Days to Die",
    shortName: "7DTD",
    folderPlaceholder: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\7 Days To Die",
    defaultServerId: "gdg-test",
    supportsEac: true,
    copyName: "7 Days To Die - GDG",
    modsLabel: "Mods"
  },
  repo: {
    id: "repo",
    name: "R.E.P.O.",
    shortName: "R.E.P.O.",
    folderPlaceholder: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\REPO",
    defaultServerId: "gdg-repo",
    supportsEac: false,
    copyName: "R.E.P.O. - GDG",
    modsLabel: "BepInEx plugins"
  }
};
const gameOptions = Object.values(gameDefinitions);
type GameDefinition = (typeof gameDefinitions)[GameId];

type Tab = "sync" | "installed" | "settings";
type LivePlanStatus = "active" | "ready" | "failed";
type GuidedStepId = "setup" | "check" | "install" | "launch";
type PlanFilter = "all" | SyncAction | "managed";
type CleanupPreference = "ask" | "backup" | "delete";
type GuideAction = {
  title: string;
  detail: string;
  label: string;
  icon: React.ReactNode;
  tone: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  primaryLabel?: string;
  primaryTone?: "danger";
  workingLabel?: string;
  previewText?: string;
  secondaryAction?: {
    label: string;
    icon: React.ReactNode;
    tone?: "danger" | "neutral";
    onClick: () => void | Promise<void>;
    disabled?: boolean;
  };
  detailsAction?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
  };
  preference?: {
    value: CleanupPreference;
    onChange: (preference: CleanupPreference) => void;
  };
};
type ProblemCardInfo = GuideAction & {
  key: string;
};
type ReadinessSummary = {
  title: string;
  detail: string;
  value: string;
  tone: string;
};

const cleanupPreferenceOptions: Array<{ value: CleanupPreference; label: string }> = [
  { value: "ask", label: "Always ask me" },
  { value: "backup", label: "Always backup" },
  { value: "delete", label: "Always remove" }
];

const cleanupPreferenceKey = "gdg.cleanupPreference";

function getModChangeCopy(installCount: number, updateCount: number) {
  const total = installCount + updateCount;
  const hasInstall = installCount > 0;
  const hasUpdate = updateCount > 0;
  const missingLabel = `${installCount} missing mod${installCount === 1 ? "" : "s"}`;
  const updateLabel = `${updateCount} mod update${updateCount === 1 ? "" : "s"}`;

  if (hasInstall && hasUpdate) {
    return {
      total,
      hasInstall,
      hasUpdate,
      actionLabel: "Apply Server Changes",
      nextTitle: "Next up: apply server changes",
      detail: `${missingLabel} and ${updateLabel} are ready for this folder.`,
      previewText: `GDG will install ${missingLabel} and apply ${updateLabel}. Anything replaced is backed up first.`,
      workingVerb: "Applying",
      nextAction: `${total} changes ready`,
      readinessTitle: "Mod changes ready",
      readinessDetail: `${missingLabel} and ${updateLabel} will be applied.`,
      stepTitle: "Apply Server Changes",
      stepSummary: `${missingLabel} and ${updateLabel} ready`,
      stepCopy: "GDG will download missing and updated packages, back up folders it replaces, and mark each mod ready as it finishes. Local-only mods are on this PC but not required by this server; they may cause crashes or mismatches."
    };
  }

  if (hasUpdate) {
    return {
      total,
      hasInstall,
      hasUpdate,
      actionLabel: "Update Mods",
      nextTitle: "Next up: update mods",
      detail: `${updateLabel} ready for this folder.`,
      previewText: `GDG will download ${updateLabel} and back up anything it replaces.`,
      workingVerb: "Updating",
      nextAction: `${updateCount} update${updateCount === 1 ? "" : "s"} ready`,
      readinessTitle: "Mod updates ready",
      readinessDetail: `${updateLabel} will be applied.`,
      stepTitle: "Update Mods",
      stepSummary: `${updateLabel} ready`,
      stepCopy: "GDG will download updated packages, back up folders it replaces, and mark each mod ready as it finishes. Local-only mods are on this PC but not required by this server; they may cause crashes or mismatches."
    };
  }

  if (hasInstall) {
    return {
      total,
      hasInstall,
      hasUpdate,
      actionLabel: "Install Missing Mods",
      nextTitle: "Next up: install missing mods",
      detail: `${missingLabel} ready for this folder.`,
      previewText: `GDG will install ${missingLabel} and back up anything it replaces.`,
      workingVerb: "Installing",
      nextAction: `${missingLabel} ready`,
      readinessTitle: "Mods ready to install",
      readinessDetail: `${missingLabel} will be installed.`,
      stepTitle: "Install Missing Mods",
      stepSummary: `${missingLabel} ready to install`,
      stepCopy: "GDG will download missing packages, back up folders it replaces, and mark each mod ready as it finishes. Local-only mods are on this PC but not required by this server; they may cause crashes or mismatches."
    };
  }

  return {
    total,
    hasInstall,
    hasUpdate,
    actionLabel: "Apply Server Changes",
    nextTitle: "Next up: apply server changes",
    detail: "No mod installs or updates are needed.",
    previewText: "This folder already has the server mod versions it needs.",
    workingVerb: "Applying",
    nextAction: "In sync",
    readinessTitle: "Ready to play",
    readinessDetail: "No mod installs or updates are needed.",
    stepTitle: "Install or Update Mods",
    stepSummary: "No install or update needed",
    stepCopy: "GDG will show missing or outdated server mods here after a check. Local-only mods are on this PC but not required by this server; they may cause crashes or mismatches."
  };
}

function App() {
  const [config, setConfig] = useState<LoaderConfig>(emptyConfig);
  const [detected, setDetected] = useState<DetectedGame | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [supportBundle, setSupportBundle] = useState<{ path: string; folderPath: string; fileName: string } | null>(null);
  const [supportMessage, setSupportMessage] = useState("");
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
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
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [openStep, setOpenStep] = useState<GuidedStepId | "">("setup");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [guidedSetupOpen, setGuidedSetupOpen] = useState(false);
  const [cleanupPreference, setCleanupPreference] = useState<CleanupPreference>(readCleanupPreference);
  const progressPanelRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledProgressKey = useRef("");
  const lastVersionPromptKey = useRef("");
  const selectedGame = gameDefinitions[config.gameId] || gameDefinitions["7dtd"];

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
    const removeSupportBundleProgress = window.gdg.onSupportBundleProgress((progress) => {
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
      removeSupportBundleProgress();
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
    if (!syncProgress) {
      lastAutoScrolledProgressKey.current = "";
      return;
    }

    const progressKey = `${getProgressTitle(syncProgress)}:${syncProgress.total}`;
    const isStarting = syncProgress.current <= 1 || syncProgress.percent <= 5;
    if (!isStarting || lastAutoScrolledProgressKey.current === progressKey) {
      return;
    }

    lastAutoScrolledProgressKey.current = progressKey;
    window.setTimeout(() => {
      progressPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, [syncProgress]);

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

  useEffect(() => {
    let canceled = false;

    async function loadBackups() {
      if (!config.gamePath) {
        setBackups([]);
        return;
      }

      try {
        const result = await window.gdg.listBackups(config.gamePath);
        if (!canceled) {
          setBackups(result.backups || []);
        }
      } catch {
        if (!canceled) {
          setBackups([]);
        }
      }
    }

    void loadBackups();

    return () => {
      canceled = true;
    };
  }, [config.gamePath]);

  const nextAction = useMemo(() => {
    if (!preview) {
      return "Check mods";
    }

    const modChanges = getModChangeCopy(preview.summary.install || 0, preview.summary.update || 0);
    const localOnly = preview.summary.keep || 0;
    if (preview.summary.blocked) {
      return `${preview.summary.blocked} blocked`;
    }

    if (modChanges.total > 0) {
      return modChanges.nextAction;
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
  const showSetupChoices = Boolean(!config.gamePath && !setupDismissed && (detected?.found || guidedSetupOpen));
  const detectedSetupLabel = detected?.isGdgCopy ? "Detected GDG copy" : "Detected game";

  async function initialize() {
    await runTask("Loading", async () => {
      const initial = await window.gdg.getInitialState();
      const nextConfig = initial.config || emptyConfig;
      setDetected(initial.detected);
      setConfig(nextConfig);
      const directory = await loadDirectory(nextConfig.serverDirectoryInput, nextConfig.gameId);

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

  async function runTask(label: string, task: () => Promise<void | string>) {
    setBusy(label);
    setError("");
    setMessage(label);

    try {
      const successMessage = await task();
      setMessage(typeof successMessage === "string" ? successMessage : "Ready");
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

  function updateCleanupPreference(preference: CleanupPreference) {
    setCleanupPreference(preference);
    writeCleanupPreference(preference);
  }

  function showPlanDetails(filter: PlanFilter) {
    setAdvancedMode(true);
    setActiveTab("sync");
    setOpenStep("install");
    setPlanFilter(filter);
  }

  function clearSyncState(clearProgress = true) {
    setPreview(null);
    setApplyResult(null);
    setScan(null);
    setDoctor(null);
    setPlanFilter("all");
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

  async function changeGame(gameId: GameId) {
    if (gameId === config.gameId) {
      return;
    }

    await runTask("Changing game", async () => {
      clearSyncState();
      setBackups([]);
      setDiskSpace(null);
      setGameVersion(null);
      setLastClone(null);
      const game = gameDefinitions[gameId];
      const saved = await updateConfig({
        gameId,
        gamePath: "",
        manifestInput: "",
        lastServerId: game.defaultServerId,
        launchWithEac: game.supportsEac
      });
      const result = await window.gdg.detectGame({ gameId });
      setDetected(result);
      const directory = await loadDirectory(saved.serverDirectoryInput, gameId);
      if (directory.servers.length > 0) {
        const firstServer = directory.servers.find(isRecommendedServer) || directory.servers[0];
        const nextConfig = await updateConfig({
          lastServerId: firstServer.id,
          manifestInput: firstServer.syncUrl
        });
        setConfig(nextConfig);
      }
      setSetupDismissed(false);
      setGuidedSetupOpen(false);
      setOpenStep("setup");
      return `${game.name} selected`;
    });
  }

  async function loadDirectory(input?: string, gameId: GameId = config.gameId) {
    const directory = await window.gdg.loadServerDirectory(input);
    const visibleDirectory = {
      ...directory,
      servers: directory.servers.filter((server) => serverMatchesGame(server, gameId) && !isLocalDevServer(server))
    };
    setServerDirectory(visibleDirectory);

    const healthEntries = await Promise.all(
      visibleDirectory.servers.map(async (server) => {
        const health = await window.gdg.checkServerHealth(server);
        return [server.id, health] as const;
      })
    );
    const nextHealth = Object.fromEntries(healthEntries);
    setServerHealth(nextHealth);
    return Object.assign(visibleDirectory, { healthById: nextHealth });
  }

  async function refreshServerDirectory() {
    await runTask("Checking servers", async () => {
      const directory = await loadDirectory(config.serverDirectoryInput, config.gameId);
      const healthById = (directory as ServerDirectory & { healthById?: Record<string, ServerHealth> }).healthById || {};
      const syncCount = directory.servers.filter((server) => healthById[server.id]?.ok).length;
      const gameCount = directory.servers.filter((server) => getGameServerStatusValue(healthById[server.id]) === "online").length;
      return `${syncCount} sync feed${syncCount === 1 ? "" : "s"} available - ${gameCount} game server${gameCount === 1 ? "" : "s"} online`;
    });
  }

  async function refreshPreviewAfterAction(fallbackPreview?: SyncPreview | null) {
    if (!config.gamePath || !config.manifestInput) {
      if (fallbackPreview) {
        setPreview(fallbackPreview);
        setScan(fallbackPreview.local);
      }
      return;
    }

    try {
      const nextPreview = await window.gdg.previewSync({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput
      });
      setLivePlanStatuses({});
      setPreview(nextPreview);
      setScan(nextPreview.local);
      const doctorResult = await window.gdg.runDoctor({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        launchWithEac: config.launchWithEac
      });
      setDoctor(doctorResult);
    } catch {
      if (fallbackPreview) {
        setPreview(fallbackPreview);
        setScan(fallbackPreview.local);
      }
    }
  }

  async function selectServer(server: DirectoryServer) {
    await updateConfig({
      lastServerId: server.id,
      manifestInput: server.syncUrl
    });
    setPreview(null);
    setApplyResult(null);
    setPlanFilter("all");
    setActiveTab("sync");
  }

  async function detectGame() {
    await runTask("Detecting game", async () => {
      const result = await window.gdg.detectGame({ gameId: config.gameId });
      setDetected(result);
      if (result.found && config.gamePath) {
        await updateConfig({ gamePath: result.path });
      } else if (result.found) {
        setSetupDismissed(false);
      }
    });
  }

  async function startGuidedSetup() {
    setActiveTab("sync");
    setOpenStep("setup");

    if (detected?.found) {
      setSetupDismissed(false);
      setGuidedSetupOpen(true);
      setMessage("Choose game setup");
      return;
    }

    await runTask("Finding game", async () => {
      const result = await window.gdg.detectGame({ gameId: config.gameId });
      setDetected(result);
      setSetupDismissed(false);

      if (!result.found) {
        await updateGamePath("");
        setGuidedSetupOpen(true);
        return "Choose game folder";
      }

      setGuidedSetupOpen(true);
      return "Choose game setup";
    });
  }

  async function browseGameFolder() {
    await browseGameFolderInternal(false);
  }

  async function browseGameFolderAndContinue() {
    await browseGameFolderInternal(true);
  }

  async function browseGameFolderInternal(continueGuided: boolean) {
    await runTask("Selecting folder", async () => {
      const result = await window.gdg.selectGameFolder();
      if (!result.canceled) {
        const saved = await updateGamePath(result.path);
        if (!result.valid) {
          setError(`Folder selected. It does not look like a ${selectedGame.name} install yet.`);
          return;
        }

        setGuidedSetupOpen(false);
        if (continueGuided) {
          await continueGuidedFlow(saved.gamePath, saved.manifestInput, { forceCheck: true });
        }
      }
    });
  }

  async function useDetectedInstall() {
    await selectDetectedInstall(false);
  }

  async function useDetectedInstallAndContinue() {
    await selectDetectedInstall(true);
  }

  async function selectDetectedInstall(continueGuided: boolean) {
    if (!detected?.found) {
      setError(`No detected ${selectedGame.name} install.`);
      return;
    }

    await runTask("Selecting existing install", async () => {
      const saved = await updateGamePath(detected.path);
      setGuidedSetupOpen(false);
      if (continueGuided) {
        await continueGuidedFlow(saved.gamePath, saved.manifestInput, { forceCheck: true });
      }
    });
  }

  async function createGdgCopy() {
    await createGdgCopyInternal(false);
  }

  async function createGdgCopyAndContinue() {
    await createGdgCopyInternal(true);
  }

  async function createGdgCopyInternal(continueGuided: boolean) {
    if (!detected?.found) {
      setError(`No detected ${selectedGame.name} install.`);
      return;
    }

    setSyncProgress({
      phase: "preparing",
      message: `Preparing ${selectedGame.shortName} GDG copy.`,
      current: 0,
      total: 0,
      percent: 0
    });

    await runTask("Creating GDG copy", async () => {
      const result = await window.gdg.cloneGameInstall({
        gameId: config.gameId,
        sourcePath: detected.path,
        folderName: selectedGame.copyName,
        createShortcut
      });

      clearSyncState(false);
      setLastClone(result);
      const saved = await updateConfig({ gamePath: result.targetPath });
      setSetupDismissed(true);
      setGuidedSetupOpen(false);

      if (result.shortcutError) {
        setError(`GDG copy is ready, but shortcut failed: ${result.shortcutError}`);
      }

      if (continueGuided) {
        await continueGuidedFlow(saved.gamePath, saved.manifestInput, { forceCheck: true });
      }
    });
  }

  async function declineGameSetup() {
    await runTask("Skipping setup", async () => {
      await updateGamePath("");
      setSetupDismissed(true);
      setGuidedSetupOpen(false);
    });
  }

  async function changeInstallSetup() {
    await runTask("Changing install setup", async () => {
      const result = await window.gdg.detectGame({ gameId: config.gameId });
      setDetected(result);
      await updateGamePath("");
      setSetupDismissed(false);
      setGuidedSetupOpen(true);
      setActiveTab("sync");

      if (!result.found) {
        return "Choose game folder";
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

  async function refreshBackups() {
    if (!config.gamePath) {
      setBackups([]);
      return;
    }

    const result = await window.gdg.listBackups(config.gamePath);
    setBackups(result.backups || []);
  }

  async function runPreflightDoctor() {
    await runTask("Checking setup", async () => {
      const result = await window.gdg.runDoctor({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        launchWithEac: config.launchWithEac
      });
      setDoctor(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      setOpenStep(result.ok ? "install" : "check");
      return result.ok ? "Setup checks passed" : "Setup needs attention";
    });
  }

  async function previewSync(options: { promptSteam?: boolean; gamePath?: string; manifestInput?: string } = {}) {
    const effectiveGamePath = options.gamePath || config.gamePath;
    const effectiveManifestInput = options.manifestInput || config.manifestInput;
    let previewResult: SyncPreview | null = null;

    setSyncProgress({
      phase: "scanning",
      message: `Checking your ${selectedGame.modsLabel} against the server list.`,
      current: 0,
      total: 1,
      percent: 8
    });

    await runTask("Checking server mods", async () => {
      const result = await window.gdg.previewSync({
        gameId: config.gameId,
        gamePath: effectiveGamePath,
        manifestInput: effectiveManifestInput
      });
      previewResult = result;
      setLivePlanStatuses({});
      setPreview(result);
      setScan(result.local);
      setApplyResult(null);
      const doctorResult = await window.gdg.runDoctor({
        gameId: config.gameId,
        gamePath: effectiveGamePath,
        manifestInput: effectiveManifestInput,
        launchWithEac: config.launchWithEac
      });
      setDoctor(doctorResult);
      setActiveTab("sync");
      if (result.gameCompatibility.checked && !result.gameCompatibility.ok) {
        const promptKey = `${effectiveGamePath}|${effectiveManifestInput}|${result.gameCompatibility.reason}`;
        setOpenStep("check");
        setError(`${result.gameCompatibility.reason} Update ${selectedGame.name} in Steam before installing GDG mods.`);
        setMessage("Game update needed");

        if (options.promptSteam !== false && lastVersionPromptKey.current !== promptKey) {
          lastVersionPromptKey.current = promptKey;
          window.setTimeout(() => {
            const shouldOpenSteam = window.confirm(`${result.gameCompatibility.reason}\n\nOpen ${selectedGame.name} in Steam now so you can update it?`);
            if (shouldOpenSteam) {
              void openSteamUpdate();
            }
          }, 50);
        }
      }
      setSyncProgress({
        phase: "complete",
        message: "Server mod check complete.",
        current: 1,
        total: 1,
        percent: 100
      });
    });

    return previewResult;
  }

  async function continueGuidedFlow(gamePath: string = config.gamePath, manifestInput: string = config.manifestInput, options: { forceCheck?: boolean } = {}) {
    if (!gamePath) {
      await startGuidedSetup();
      return;
    }

    if (!manifestInput) {
      setOpenStep("check");
      setMessage("Choose a GDG server");
      return;
    }

    const nextPreview = !options.forceCheck && preview && normalizePath(preview.local.gamePath) === normalizePath(gamePath)
      ? preview
      : await previewSync({ gamePath, manifestInput });

    if (!nextPreview) {
      return;
    }

    const nextServerSize = getServerSize(nextPreview, selectedHealth);
    const nextSpaceRequirement = getSyncSpaceRequirement(nextPreview, nextServerSize);
    const nextModsToInstall = (nextPreview.summary.install || 0) + (nextPreview.summary.update || 0);
    const nextLocalOnlyMods = nextPreview.summary.keep || 0;
    const nextManagedExtraMods = nextPreview.managedSummary?.extra || 0;
    const nextGameVersionMismatch = Boolean(nextPreview.gameCompatibility.checked && !nextPreview.gameCompatibility.ok);
    const nextInstallBlocked = Boolean(nextPreview.summary.blocked || (nextPreview.skippedServerOnly?.length || 0) > 0);

    if (nextGameVersionMismatch) {
      setOpenStep("check");
      return;
    }

    if (diskSpace && nextModsToInstall > 0 && nextSpaceRequirement.known && diskSpace.freeBytes < nextSpaceRequirement.bytes) {
      setOpenStep("install");
      setError(`Not enough free space. GDG needs about ${formatBytes(nextSpaceRequirement.bytes)} free on this drive, but only ${formatBytes(diskSpace.freeBytes)} is available.`);
      return;
    }

    if (nextInstallBlocked) {
      await createSupportBundle();
      return;
    }

    if (nextLocalOnlyMods > 0) {
      setOpenStep("install");
      if (cleanupPreference === "backup" || cleanupPreference === "delete") {
        await cleanLocalMods(cleanupPreference, { gamePath, manifestInput, previewOverride: nextPreview });
      } else {
        setMessage("Choose how to handle extra mods");
      }
      return;
    }

    if (nextManagedExtraMods > 0) {
      setOpenStep("install");
      if (cleanupPreference === "backup" || cleanupPreference === "delete") {
        await cleanManagedMods(cleanupPreference, "extra", { gamePath, manifestInput, previewOverride: nextPreview });
      } else {
        setMessage("Choose how to handle old GDG mods");
      }
      return;
    }

    if (nextModsToInstall > 0) {
      await applySync({ gamePath, manifestInput, previewOverride: nextPreview });
      return;
    }

    const nextServerEacEnabled = selectedGame.supportsEac && typeof nextPreview.manifest.server.eacEnabled === "boolean" ? nextPreview.manifest.server.eacEnabled : null;
    if (typeof nextServerEacEnabled === "boolean" && nextServerEacEnabled !== Boolean(config.launchWithEac)) {
      await updateLaunchWithEac(nextServerEacEnabled);
      setMessage(`EAC set ${nextServerEacEnabled ? "on" : "off"}. Ready to launch.`);
      return;
    }

    setOpenStep("launch");
    setMessage("Ready to launch");
  }

  async function applySync(options: { gamePath?: string; manifestInput?: string; previewOverride?: SyncPreview } = {}) {
    const activePreview = options.previewOverride || preview;
    const activeServerSize = getServerSize(activePreview, selectedHealth);
    const activeSpaceRequirement = getSyncSpaceRequirement(activePreview, activeServerSize);
    const activeModsToInstall = activePreview ? (activePreview.summary.install || 0) + (activePreview.summary.update || 0) : modsToInstall;
    const effectiveGamePath = options.gamePath || config.gamePath;
    const effectiveManifestInput = options.manifestInput || config.manifestInput;

    if (diskSpace && activePreview && activeModsToInstall > 0 && activeSpaceRequirement.known && diskSpace.freeBytes < activeSpaceRequirement.bytes) {
      setError(`Not enough free space. GDG needs about ${formatBytes(activeSpaceRequirement.bytes)} free on this drive, but only ${formatBytes(diskSpace.freeBytes)} is available.`);
      setOpenStep("install");
      return;
    }

    setLivePlanStatuses({});
    setSyncProgress({
      phase: "preparing",
      message: "Starting mod sync.",
      current: 0,
      total: Math.max(activeModsToInstall, 1),
      percent: 0
    });

    await runTask("Syncing mods", async () => {
      const result = await window.gdg.applySync({
        gameId: config.gameId,
        gamePath: effectiveGamePath,
        manifestInput: effectiveManifestInput
      });
      setApplyResult(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      await refreshBackups();
      setActiveTab("sync");
      if (!result.ok) {
        setError(`${result.failedCount || 1} mod install${result.failedCount === 1 ? "" : "s"} failed. Check the sync log below.`);
      }
    });
  }

  async function repairSync() {
    if (repairSpaceBlocked && diskSpace) {
      setError(`Not enough free space for repair. GDG needs about ${formatBytes(repairSpaceRequirement.bytes)} free on this drive, but only ${formatBytes(diskSpace.freeBytes)} is available.`);
      setOpenStep("install");
      return;
    }

    setLivePlanStatuses({});
    setSyncProgress({
      phase: "preparing",
      message: "Starting repair sync.",
      current: 0,
      total: Math.max(repairableMods, 1),
      percent: 0
    });

    await runTask("Repairing mods", async () => {
      const result = await window.gdg.applySync({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        repair: true
      });
      setApplyResult(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      await refreshBackups();
      setActiveTab("sync");
      if (!result.ok) {
        setError(`${result.failedCount || 1} mod repair${result.failedCount === 1 ? "" : "s"} failed. Check the sync log below.`);
      }
    });
  }

  async function cleanLocalMods(mode: "backup" | "delete", options: { gamePath?: string; manifestInput?: string; previewOverride?: SyncPreview } = {}) {
    const activePreview = options.previewOverride || preview;
    const expected = activePreview?.summary.keep || localOnlyMods;
    const effectiveGamePath = options.gamePath || config.gamePath;
    const effectiveManifestInput = options.manifestInput || config.manifestInput;

    setSyncProgress({
      phase: "preparing",
      message: mode === "delete" ? "Preparing to delete local-only mods." : "Preparing to move local-only mods to backup.",
      current: 0,
      total: Math.max(expected, 1),
      percent: 0
    });

    await runTask(mode === "delete" ? "Deleting local-only mods" : "Cleaning local-only mods", async () => {
      const result = await window.gdg.cleanLocalMods({
        gameId: config.gameId,
        gamePath: effectiveGamePath,
        manifestInput: effectiveManifestInput,
        mode
      });
      setApplyResult(result);
      await refreshPreviewAfterAction(result.preview);
      await refreshBackups();
      setActiveTab("sync");

      if (result.canceled) {
        return "Clean canceled";
      } else if (!result.ok) {
        setError(`${result.failedCount || 1} local-only mod${result.failedCount === 1 ? "" : "s"} could not be ${mode === "delete" ? "deleted" : "moved"}. Check the log below.`);
        return "Needs attention";
      } else if (mode === "delete") {
        return "Local-only mods removed. Next step updated.";
      }

      return "Done. Your mods were kept in a backup.";
    });
  }

  async function purgeModsFolder(mode: "backup" | "delete") {
    setSyncProgress({
      phase: "preparing",
      message: mode === "delete" ? "Preparing to delete all mods." : "Preparing to move all mods to backup.",
      current: 0,
      total: Math.max(scan?.mods.length || 0, 1),
      percent: 0
    });

    await runTask(mode === "delete" ? "Deleting all mods" : "Backing up all mods", async () => {
      const result = await window.gdg.purgeModsFolder({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        mode
      });
      setApplyResult(result);

      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
        setActiveTab("sync");
      } else {
        const nextScan = await window.gdg.scanMods(config.gamePath);
        setScan(nextScan);
        setPreview(null);
        setPlanFilter("all");
        setActiveTab("installed");
      }
      await refreshBackups();

      if (result.canceled) {
        return "Purge canceled";
      }

      if (!result.ok) {
        setError(`${result.failedCount || 1} ${selectedGame.modsLabel} item${result.failedCount === 1 ? "" : "s"} could not be ${mode === "delete" ? "deleted" : "moved"}. Check the log below.`);
        return "Needs attention";
      }

      if (result.backupRoot) {
        return "Mods moved to backup. Install missing mods to redownload.";
      }

      return result.log.some((line) => line.startsWith("Deleted "))
        ? "Mods deleted. Install missing mods to redownload."
        : `${selectedGame.modsLabel} is already empty.`;
    });
  }

  async function cleanManagedMods(mode: "backup" | "delete", scope: "all" | "extra" = "all", options: { gamePath?: string; manifestInput?: string; previewOverride?: SyncPreview } = {}) {
    const activePreview = options.previewOverride || preview;
    const expected = scope === "extra" ? (activePreview?.managedSummary?.extra || managedExtraMods) : managedOrServerOnlyMods;
    const effectiveGamePath = options.gamePath || config.gamePath;
    const effectiveManifestInput = options.manifestInput || config.manifestInput;

    setSyncProgress({
      phase: "preparing",
      message: mode === "delete" ? "Preparing to delete GDG-managed mods." : "Preparing to move GDG-managed mods to backup.",
      current: 0,
      total: Math.max(expected, 1),
      percent: 0
    });

    await runTask(mode === "delete" ? "Deleting managed mods" : "Backing up managed mods", async () => {
      const result = await window.gdg.cleanManagedMods({
        gameId: config.gameId,
        gamePath: effectiveGamePath,
        manifestInput: effectiveManifestInput,
        mode,
        scope
      });
      setApplyResult(result);
      await refreshPreviewAfterAction(result.preview);
      await refreshBackups();
      setActiveTab("sync");

      if (result.canceled) {
        return "Managed cleanup canceled";
      }

      if (!result.ok) {
        setError(`${result.failedCount || 1} managed mod${result.failedCount === 1 ? "" : "s"} could not be ${mode === "delete" ? "deleted" : "moved"}. Check the log below.`);
        return "Needs attention";
      }

      return mode === "delete" ? "GDG-managed mods removed. Next step updated." : "Done. Your mods were kept in a backup.";
    });
  }

  async function resetAndReinstall(mode: "backup" | "delete") {
    setLivePlanStatuses({});
    setSyncProgress({
      phase: "preparing",
      message: mode === "delete" ? "Preparing to delete all mods and reinstall." : "Preparing to back up all mods and reinstall.",
      current: 0,
      total: Math.max((scan?.mods.length || 0) + (preview?.manifest.mods.length || 0), 1),
      percent: 0
    });

    await runTask(mode === "delete" ? "Deleting and reinstalling" : "Backing up and reinstalling", async () => {
      const result = await window.gdg.resetAndReinstall({
        gameId: config.gameId,
        gamePath: config.gamePath,
        manifestInput: config.manifestInput,
        mode
      });
      setApplyResult(result);
      if (result.preview) {
        setPreview(result.preview);
        setScan(result.preview.local);
      }
      await refreshBackups();
      setActiveTab("sync");

      if (result.canceled) {
        return "Reset canceled";
      }

      if (!result.ok) {
        setError(`${result.failedCount || 1} reset/reinstall step${result.failedCount === 1 ? "" : "s"} failed. Check the log below.`);
        return "Needs attention";
      }

      return "Mods reset and reinstalled";
    });
  }

  async function restoreBackup(backup: BackupEntry) {
    await restoreBackupPath(backup.path, backup.itemCount, "installed");
  }

  async function restoreBackupPath(backupPath: string, itemCount = 1, nextTab: Tab = "sync") {
    setSyncProgress({
      phase: "preparing",
      message: "Preparing to restore backup.",
      current: 0,
      total: Math.max(itemCount, 1),
      percent: 0
    });

    await runTask("Restoring backup", async () => {
      const result = await window.gdg.restoreBackup({
        gameId: config.gameId,
        gamePath: config.gamePath,
        backupPath
      });
      setApplyResult(result);
      const nextScan = await window.gdg.scanMods(config.gamePath);
      setScan(nextScan);
      await refreshBackups();
      setActiveTab(nextTab);

      if (result.canceled) {
        return "Restore canceled";
      }

      if (!result.ok) {
        setError(`${result.failedCount || 1} backup item${result.failedCount === 1 ? "" : "s"} could not be restored. Check the log below.`);
        return "Needs attention";
      }

      return "Backup restored";
    });
  }

  async function deleteBackup(backup: BackupEntry) {
    await runTask("Deleting backup", async () => {
      const result = await window.gdg.deleteBackup({
        gameId: config.gameId,
        gamePath: config.gamePath,
        backupPath: backup.path
      });
      await refreshBackups();

      if (result.canceled) {
        return "Backup delete canceled";
      }

      if (!result.ok) {
        throw new Error("Backup could not be deleted.");
      }

      return result.deleted ? "Backup deleted" : "Backup already gone";
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
      setError(`Update ${selectedGame.name} in Steam before launching this GDG modpack.`);
      setOpenStep("check");
      return;
    }

    setBusy("Launching game");
    setError("");
    setMessage("Launching game");

    try {
      const result = await window.gdg.launchGame({
        gameId: config.gameId,
        gamePath: config.gamePath,
        eacEnabled: Boolean(config.launchWithEac)
      });
      setMessage(selectedGame.supportsEac ? (result.eacEnabled ? "Launched with EAC" : "Launched with EAC off") : `${selectedGame.name} launched`);
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
      await window.gdg.openPath(config.gameId === "repo" ? `${config.gamePath}\\BepInEx\\plugins` : `${config.gamePath}\\Mods`);
    }
  }

  async function openSteamUpdate() {
    await runTask("Opening Steam", async () => {
      const result = await window.gdg.openSteamUpdate();
      if (!result.ok) {
        throw new Error(result.error || "Steam could not be opened.");
      }
      return result.target === "web"
        ? `Steam page opened. Update ${selectedGame.name}, then check server mods again.`
        : `Steam opened. Update ${selectedGame.name}, then check server mods again.`;
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

  async function createSupportBundle() {
    setSyncProgress({
      phase: "preparing",
      message: "Preparing support bundle.",
      current: 0,
      total: 7,
      percent: 0
    });

    await runTask("Creating support bundle", async () => {
      const result = await window.gdg.createSupportBundle();
      if (!result.ok) {
        throw new Error(result.error || "Support bundle could not be created.");
      }

      setSupportBundle({
        path: result.path,
        folderPath: result.folderPath,
        fileName: result.fileName
      });
      const nextSupportMessage = [
        "GDG Mod Loader help request",
        `Server: ${selectedServerName}`,
        `Status: ${readinessSummary.title}`,
        `Game folder: ${config.gamePath ? getFolderName(config.gamePath) : "Not selected"}`,
        `Support bundle: ${result.path}`
      ].join("\n");
      setSupportMessage(nextSupportMessage);

      try {
        await copySupportBundleZip(result.path);
        return "Support ZIP copied. Paste it into Discord.";
      } catch (copyError) {
        try {
          await navigator.clipboard?.writeText(nextSupportMessage);
          return "Support ZIP created. Details copied; attach the ZIP from Open Folder.";
        } catch {
          const reason = copyError instanceof Error ? copyError.message : String(copyError);
          return reason ? `Support ZIP created. Copy failed: ${reason}` : "Support ZIP created. Use Open Folder to attach it.";
        }
      }
    });
  }

  async function copySupportBundleZip(filePath: string) {
    const result = await window.gdg.copyFileToClipboard(filePath);
    if (!result.ok) {
      throw new Error(result.error || "Support ZIP could not be copied.");
    }
  }

  async function copySupportDetails(messageText: string) {
    if (!messageText) {
      return;
    }

    await navigator.clipboard?.writeText(messageText);
    setMessage("Support details copied");
  }

  const working = Boolean(busy);
  const selectedHealth = selectedServer ? serverHealth[selectedServer.id] : null;
  const selectedServerName = selectedServer?.name || preview?.manifest.server.name || "Golden Days Gaming";
  const showingSupportProgress = Boolean(syncProgress && isSupportBundleProgress(syncProgress));
  const serverEacEnabled = selectedGame.supportsEac
    ? typeof preview?.manifest.server.eacEnabled === "boolean" ? preview.manifest.server.eacEnabled : selectedHealth?.eacEnabled ?? null
    : null;
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
  const installCount = preview?.summary.install || 0;
  const updateCount = preview?.summary.update || 0;
  const modChangeCopy = getModChangeCopy(installCount, updateCount);
  const modsToInstall = modChangeCopy.total;
  const repairableMods = preview ? preview.plan.filter((item) => ["ready", "install", "update"].includes(item.action) && Boolean(item.mod.source)).length : 0;
  const syncSpaceRequirement = getSyncSpaceRequirement(preview, serverSize);
  const repairSpaceRequirement = getSyncSpaceRequirement(preview, serverSize, { repairMode: true });
  const syncSpaceBlocked = Boolean(preview && modsToInstall > 0 && diskSpace && syncSpaceRequirement.known && diskSpace.freeBytes < syncSpaceRequirement.bytes);
  const repairSpaceBlocked = Boolean(preview && repairableMods > 0 && diskSpace && repairSpaceRequirement.known && diskSpace.freeBytes < repairSpaceRequirement.bytes);
  const freeSpaceTone = getFreeSpaceTone(diskSpace?.freeBytes, syncSpaceRequirement.bytes || serverSize.bytes, syncSpaceRequirement.known || serverSize.known);
  const currentScan = scan && normalizePath(scan.gamePath) === normalizePath(config.gamePath) ? scan : null;
  const scanMatchesGame = Boolean(currentScan);
  const dllMods = currentScan ? currentScan.mods.filter((mod) => mod.hasDll) : [];
  const hasDllMods = dllMods.length > 0;
  const eacMismatch = selectedGame.supportsEac && typeof serverEacEnabled === "boolean" && serverEacEnabled !== Boolean(config.launchWithEac);
  const eacWarning = selectedGame.supportsEac && ((hasDllMods && Boolean(config.launchWithEac)) || eacMismatch);
  const launchHint = !scanMatchesGame
    ? "Checking installed mods for DLL files."
    : gameVersionMismatch
      ? `Update ${selectedGame.name} in Steam before launching.`
    : eacMismatch
      ? `Server EAC is ${serverEacEnabled ? "on" : "off"}. Match this before launching.`
    : selectedGame.supportsEac && hasDllMods
      ? `${dllMods.length} DLL mod${dllMods.length === 1 ? "" : "s"} detected. EAC off recommended.`
      : "No DLL mods detected in the selected install.";
  const serverEacLabel = typeof serverEacEnabled === "boolean" ? (serverEacEnabled ? "On" : "Off") : "Unknown";
  const localOnlyMods = preview?.summary.keep || 0;
  const managedInstalledMods = currentScan ? currentScan.mods.filter((mod) => mod.managed) : [];
  const planItems = preview?.plan || [];
  const managedPlanItems = planItems.filter((item) => Boolean(item.installed?.managed || item.installed?.managedRecord));
  const managedPlanCount = preview ? managedPlanItems.length : managedInstalledMods.length;
  const planFilterOptions: Array<{ id: Exclude<PlanFilter, "all">; label: string; count: number; tone: string }> = [
    { id: "ready", label: "Server ready", count: preview?.summary.ready || 0, tone: "green" },
    { id: "install", label: "Install", count: preview?.summary.install || 0, tone: "blue" },
    { id: "update", label: "Update", count: preview?.summary.update || 0, tone: "amber" },
    { id: "keep", label: "Local only", count: localOnlyMods, tone: "violet" },
    { id: "managed", label: "Managed", count: managedPlanCount, tone: "green" },
    { id: "blocked", label: "Blocked", count: preview?.summary.blocked || 0, tone: "red" }
  ];
  const allPlanFilterOptions: Array<{ id: PlanFilter; label: string; count: number; tone: string }> = [
    { id: "all", label: "All", count: planItems.length, tone: "neutral" },
    ...planFilterOptions
  ];
  const activePlanFilterOption = allPlanFilterOptions.find((option) => option.id === planFilter) || allPlanFilterOptions[0];
  const filteredPlanItems =
    planFilter === "all"
      ? planItems
      : planFilter === "managed"
        ? managedPlanItems
        : planItems.filter((item) => item.action === planFilter);
  const syncPlanTitle = !preview
    ? "Mods not checked yet"
    : planFilter === "all"
      ? `${planItems.length} checked mods`
      : `${filteredPlanItems.length} ${activePlanFilterOption.label.toLowerCase()} mod${filteredPlanItems.length === 1 ? "" : "s"}`;
  const serverOnlyInstalledMods = currentScan ? currentScan.mods.filter((mod) => mod.serverOnly) : [];
  const managedOrServerOnlyMods = new Set([
    ...managedInstalledMods.map((mod) => mod.folderName.toLowerCase()),
    ...serverOnlyInstalledMods.map((mod) => mod.folderName.toLowerCase())
  ]).size;
  const managedExtraMods = preview?.managedSummary?.extra || serverOnlyInstalledMods.length;
  const skippedServerOnlyMods = preview?.skippedServerOnly?.length || 0;
  const doctorFailures = doctor?.checks.filter((check) => check.status === "fail").length || 0;
  const doctorWarnings = doctor?.checks.filter((check) => check.status === "warn").length || 0;
  const backupTotalBytes = backups.reduce((total, backup) => total + (backup.sizeBytes || 0), 0);
  const visibleServers = serverDirectory?.servers || [];
  const syncAvailableCount = visibleServers.filter((server) => serverHealth[server.id]?.ok).length;
  const gameOnlineCount = visibleServers.filter((server) => getGameServerStatusValue(serverHealth[server.id]) === "online").length;
  const selectedGameServerStatus = getGameServerStatusLabel(selectedHealth);
  const recommendedServerId = visibleServers.find(isRecommendedServer)?.id || "";
  const selectedGameFolderLabel = config.gamePath ? getFolderName(config.gamePath) : detected?.found ? "Choose" : "Missing";
  const setupStepState = config.gamePath ? "done" : "active";
  const checkStepState = preview ? "done" : config.gamePath && config.manifestInput ? "active" : "waiting";
  const installStepState = !preview ? "waiting" : modsToInstall > 0 ? "active" : "done";
  const launchStepState = preview && modsToInstall === 0 && !preview.summary.blocked && !gameVersionMismatch ? "active" : "waiting";
  const installBlockedByServer = Boolean(preview?.summary.blocked);
  const showCheckFirstAction = !preview;
  const showUpdateGameActions = Boolean(preview && gameVersionMismatch);
  const showLocalCleanupActions = Boolean(preview && localOnlyMods > 0);
  const showManagedCleanupActions = Boolean(preview && managedExtraMods > 0);
  const showInstallMissingAction = Boolean(preview && modsToInstall > 0 && !gameVersionMismatch && !installBlockedByServer && !syncSpaceBlocked);
  const showLaunchStepAction = Boolean(preview && modsToInstall === 0 && localOnlyMods === 0 && managedExtraMods === 0 && !installBlockedByServer && !gameVersionMismatch);
  const showRepairActions = Boolean(advancedMode && preview && modsToInstall === 0 && repairableMods > 0 && !gameVersionMismatch && !installBlockedByServer && !repairSpaceBlocked);
  const cleanupMode = cleanupPreference === "delete" ? "delete" : "backup";
  const cleanupPrimaryLabel = cleanupMode === "delete" ? "Remove Local-Only" : "Move to Backup";
  const cleanupSecondaryLabel = cleanupMode === "delete" ? "Move to Backup" : "Remove Instead";
  const cleanupPrimaryIcon = cleanupMode === "delete" ? <Trash2 size={18} /> : <HardDrive size={18} />;
  const cleanupSecondaryIcon = cleanupMode === "delete" ? <HardDrive size={18} /> : <Trash2 size={18} />;
  const cleanupProgressLabel = getProgressButtonLabel(syncProgress, cleanupMode === "delete" ? "Removing" : "Moving");
  const managedCleanupPrimaryLabel = cleanupMode === "delete" ? "Remove Old Mods" : "Move to Backup";
  const managedCleanupSecondaryLabel = cleanupMode === "delete" ? "Move to Backup" : "Remove Instead";
  const managedCleanupProgressLabel = getProgressButtonLabel(syncProgress, cleanupMode === "delete" ? "Removing" : "Moving");
  const guidedAction: GuideAction = !config.gamePath
    ? detected?.found
      ? {
          tone: "gold",
          title: "Next up: choose game setup",
          detail: "Pick whether GDG should use this folder or make a separate copy.",
          label: "Choose Setup",
          icon: <ListChecks size={18} />,
          onClick: startGuidedSetup,
          previewText: "GDG will pause for this choice, then continue checking and installing what is needed.",
          disabled: working
        }
      : {
          tone: "gold",
          title: `Next up: find ${selectedGame.name}`,
          detail: "GDG needs the local game folder before it can compare mods.",
          label: "Detect Game",
          icon: <Search size={18} />,
          onClick: startGuidedSetup,
          disabled: working
        }
    : !config.manifestInput
      ? {
          tone: "warn",
          title: "Next up: choose a server",
          detail: "Pick a GDG server so the loader knows which mod list to use.",
          label: "Open Server Step",
          icon: <UploadCloud size={18} />,
          onClick: () => setOpenStep("check"),
          disabled: working
        }
      : !preview
        ? {
            tone: "gold",
            title: "Next up: check server mods",
            detail: "Compare this folder with the selected GDG server.",
            label: "Check Server Mods",
            icon: <ListChecks size={18} />,
            onClick: () => void continueGuidedFlow(),
            previewText: "GDG will check this folder, install safe missing mods, and stop if it needs your choice.",
            disabled: working
          }
        : gameVersionMismatch
          ? {
              tone: "warn",
              title: `Next up: update ${selectedGame.name}`,
              detail: "Steam needs to match the selected GDG server version before install.",
              label: "Open Steam",
              icon: <RefreshCw size={18} />,
              onClick: openSteamUpdate,
              previewText: `Steam will open so you can update ${selectedGame.name} to the server version.`,
              disabled: working
            }
          : syncSpaceBlocked
            ? {
                tone: "danger",
                title: "Next up: free disk space",
                detail: `This drive needs about ${formatBytes(syncSpaceRequirement.bytes)} free before syncing.`,
                label: "Open Game Folder",
                icon: <FolderOpen size={18} />,
                onClick: openGameFolder,
                disabled: working
              }
            : installBlockedByServer || skippedServerOnlyMods > 0
              ? {
                  tone: "danger",
                  title: "Next up: send diagnostics",
                  detail: "The selected server list has an entry the client should not install.",
                  label: "Create Support Bundle",
                  icon: <Archive size={18} />,
                  onClick: createSupportBundle,
                  previewText: "GDG will create a support zip and copy a short Discord message for staff.",
                  disabled: working
                }
              : localOnlyMods > 0
                ? {
                    tone: "warn",
                    title: "Next up: handle extra local mods",
                    detail: "Move them to a backup, or remove them if you do not want to keep them.",
                    label: cleanupPrimaryLabel,
                    primaryLabel: cleanupPrimaryLabel,
                    primaryTone: cleanupMode === "delete" ? "danger" : undefined,
                    icon: cleanupPrimaryIcon,
                    onClick: () => void cleanLocalMods(cleanupMode),
                    workingLabel: cleanupProgressLabel,
                    previewText:
                      cleanupMode === "delete"
                        ? `GDG will ask before permanently removing ${localOnlyMods} local-only mod${localOnlyMods === 1 ? "" : "s"} from this PC.`
                        : `GDG will move ${localOnlyMods} local-only mod${localOnlyMods === 1 ? "" : "s"} out of Mods and keep them in a backup.`,
                    secondaryAction: {
                      label: cleanupSecondaryLabel,
                      icon: cleanupSecondaryIcon,
                      tone: cleanupMode === "delete" ? "neutral" : "danger",
                      onClick: () => void cleanLocalMods(cleanupMode === "delete" ? "backup" : "delete"),
                      disabled: working
                    },
                    detailsAction: {
                      label: `Show ${localOnlyMods} Mod${localOnlyMods === 1 ? "" : "s"}`,
                      icon: <ListChecks size={18} />,
                      onClick: () => showPlanDetails("keep"),
                      disabled: !preview
                    },
                    preference: {
                      value: cleanupPreference,
                      onChange: updateCleanupPreference
                    },
                    disabled: working
                  }
                : managedExtraMods > 0
                  ? {
                      tone: "warn",
                      title: "Next up: handle old GDG mods",
                      detail: "Move old GDG-managed mods to backup, or remove them if you do not want to keep them.",
                      label: managedCleanupPrimaryLabel,
                      primaryLabel: managedCleanupPrimaryLabel,
                      primaryTone: cleanupMode === "delete" ? "danger" : undefined,
                      icon: cleanupPrimaryIcon,
                      onClick: () => void cleanManagedMods(cleanupMode, "extra"),
                      workingLabel: managedCleanupProgressLabel,
                      previewText:
                        cleanupMode === "delete"
                          ? `GDG will ask before permanently removing ${managedExtraMods} old GDG-managed mod${managedExtraMods === 1 ? "" : "s"}.`
                          : `GDG will move ${managedExtraMods} old GDG-managed mod${managedExtraMods === 1 ? "" : "s"} out of Mods and keep them in a backup.`,
                      secondaryAction: {
                        label: managedCleanupSecondaryLabel,
                        icon: cleanupSecondaryIcon,
                        tone: cleanupMode === "delete" ? "neutral" : "danger",
                        onClick: () => void cleanManagedMods(cleanupMode === "delete" ? "backup" : "delete", "extra"),
                        disabled: working
                      },
                      detailsAction: {
                        label: `Show ${managedExtraMods} Mod${managedExtraMods === 1 ? "" : "s"}`,
                        icon: <ListChecks size={18} />,
                        onClick: () => showPlanDetails("managed"),
                        disabled: !preview
                      },
                      preference: {
                        value: cleanupPreference,
                        onChange: updateCleanupPreference
                      },
                      disabled: working
                    }
                  : modsToInstall > 0
                    ? {
                        tone: "gold",
                        title: modChangeCopy.nextTitle,
                        detail: modChangeCopy.detail,
                        label: modChangeCopy.actionLabel,
                        icon: modChangeCopy.hasUpdate && !modChangeCopy.hasInstall ? <RefreshCw size={18} /> : <Download size={18} />,
                        onClick: () => void continueGuidedFlow(),
                        workingLabel: getProgressButtonLabel(syncProgress, modChangeCopy.workingVerb),
                        previewText: modChangeCopy.previewText,
                        detailsAction: {
                          label: "Show Changes",
                          icon: <ListChecks size={18} />,
                          onClick: () => showPlanDetails("all"),
                          disabled: !preview
                        },
                        disabled: working
                      }
                    : selectedGame.supportsEac && eacWarning && typeof serverEacEnabled === "boolean" && serverEacEnabled !== Boolean(config.launchWithEac)
                      ? {
                          tone: "warn",
                          title: "Next up: match EAC",
                          detail: `The selected server launches with EAC ${serverEacEnabled ? "on" : "off"}.`,
                          label: `Set EAC ${serverEacEnabled ? "On" : "Off"}`,
                          icon: serverEacEnabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />,
                          onClick: () => void continueGuidedFlow(),
                          disabled: working
                        }
                      : selectedGame.supportsEac && eacWarning && hasDllMods && config.launchWithEac
                        ? {
                            tone: "warn",
                            title: "Next up: turn EAC off",
                            detail: "DLL mods are installed in this folder.",
                            label: "Set EAC Off",
                            icon: <ShieldOff size={18} />,
                            onClick: () => void updateLaunchWithEac(false),
                            disabled: working
                          }
                        : {
                            tone: "ready",
                            title: "Ready to play",
                            detail: "This folder matches the selected GDG server.",
                            label: "Launch Game",
                            primaryLabel: "Launch Game",
                            icon: <Play size={18} />,
                            onClick: launchGame,
                            disabled: working
                          };
  const problemCards: ProblemCardInfo[] = [];
  if (!config.gamePath) {
    problemCards.push({
      key: "game-folder",
      tone: "gold",
      title: "Game folder needed",
      detail: detected?.found ? "Use the detected install or create a separate GDG copy." : `GDG needs to find ${selectedGame.name} on this PC.`,
      label: detected?.found ? "Choose Folder" : "Detect Game",
      icon: detected?.found ? <FolderOpen size={18} /> : <Search size={18} />,
      onClick: detected?.found ? () => setOpenStep("setup") : detectGame,
      disabled: working
    });
  }
  if (preview && gameVersionMismatch) {
    problemCards.push({
      key: "game-version",
      tone: "warn",
      title: "Steam update needed",
      detail: gameCompatibility?.reason || "Your game version does not match this server.",
      label: "Open Steam",
      icon: <RefreshCw size={18} />,
      onClick: openSteamUpdate,
      disabled: working
    });
  }
  if (syncSpaceBlocked && diskSpace) {
    problemCards.push({
      key: "space",
      tone: "danger",
      title: "Not enough disk space",
      detail: `Free up space on this drive. GDG needs about ${formatBytes(syncSpaceRequirement.bytes)} free.`,
      label: "Open Folder",
      icon: <FolderOpen size={18} />,
      onClick: openGameFolder,
      disabled: working
    });
  }
  if (preview && (installBlockedByServer || skippedServerOnlyMods > 0)) {
    problemCards.push({
      key: "server-list",
      tone: "danger",
      title: "Server mod list issue",
      detail: "This server is asking the player app to install something it should not install.",
      label: "Send Help to GDG",
      icon: <Archive size={18} />,
      onClick: createSupportBundle,
      disabled: working
    });
  }
  if (preview && localOnlyMods > 0) {
    problemCards.push({
      key: "local-only",
      tone: "warn",
      title: "Extra mods found",
      detail: `${localOnlyMods} mod${localOnlyMods === 1 ? " is" : "s are"} not part of this GDG server. Backing them up is safest.`,
      label: "Move to Backup",
      icon: <HardDrive size={18} />,
      onClick: () => void cleanLocalMods("backup"),
      disabled: working
    });
  }
  if (preview && managedExtraMods > 0) {
    problemCards.push({
      key: "managed-extra",
      tone: "warn",
      title: "Old GDG mods found",
      detail: `${managedExtraMods} GDG-managed mod${managedExtraMods === 1 ? " is" : "s are"} from a different server package.`,
      label: "Move to Backup",
      icon: <HardDrive size={18} />,
      onClick: () => void cleanManagedMods("backup", "extra"),
      disabled: working
    });
  }
  if (selectedGame.supportsEac && preview && eacMismatch && typeof serverEacEnabled === "boolean") {
    problemCards.push({
      key: "eac-server",
      tone: "warn",
      title: "EAC setting mismatch",
      detail: `This server expects EAC ${serverEacEnabled ? "on" : "off"}.`,
      label: `Set EAC ${serverEacEnabled ? "On" : "Off"}`,
      icon: serverEacEnabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />,
      onClick: () => void updateLaunchWithEac(Boolean(serverEacEnabled)),
      disabled: working
    });
  } else if (selectedGame.supportsEac && preview && hasDllMods && config.launchWithEac) {
    problemCards.push({
      key: "eac-dll",
      tone: "warn",
      title: "EAC should be off",
      detail: "DLL mods are installed in this folder. Launching with EAC off is safer.",
      label: "Set EAC Off",
      icon: <ShieldOff size={18} />,
      onClick: () => void updateLaunchWithEac(false),
      disabled: working
    });
  }
  const readyToPlay = Boolean(preview && modsToInstall === 0 && problemCards.length === 0 && !gameVersionMismatch && !installBlockedByServer);
  const readinessSummary: ReadinessSummary = !config.gamePath
    ? {
        tone: "warn",
        title: "Needs game folder",
        detail: "Use Make Me Ready to find or create the folder GDG will launch.",
        value: "1 step"
      }
    : !preview
      ? {
          tone: working ? "blue" : "gold",
          title: working ? "Checking" : "Ready to check",
          detail: "GDG will wait for you to press Make Me Ready.",
          value: working ? "..." : "Check"
        }
      : problemCards.length > 0
        ? {
            tone: problemCards.some((card) => card.tone === "danger") ? "danger" : "warn",
            title: `${problemCards.length} fix${problemCards.length === 1 ? "" : "es"} needed`,
            detail: "Use Make Me Ready or the fix cards below.",
            value: String(problemCards.length)
          }
        : modsToInstall > 0
          ? {
              tone: "gold",
              title: modChangeCopy.readinessTitle,
              detail: modChangeCopy.readinessDetail,
              value: String(modsToInstall)
            }
          : {
              tone: "ready",
              title: "Ready to play",
              detail: `${selectedServerName} matches ${selectedGameFolderLabel}.`,
              value: "Ready"
            };

  function selectPlanFilter(filter: PlanFilter) {
    setPlanFilter((current) => (current === filter ? "all" : filter));
  }

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
            <span>{selectedGame.name}</span>
          </div>
        </div>

        <section className="game-switcher" aria-label="Game selector">
          <span className="section-label">Game</span>
          <div className="game-switcher-options">
            {gameOptions.map((game) => (
              <button
                key={game.id}
                className={config.gameId === game.id ? "active" : ""}
                type="button"
                onClick={() => void changeGame(game.id)}
                disabled={working}
                aria-pressed={config.gameId === game.id}
              >
                {game.shortName}
              </button>
            ))}
          </div>
        </section>

        <section className="server-list" aria-label="Server profiles">
          <div className="server-list-heading">
            <div>
              <div className="section-label">GDG Servers</div>
              <small className="server-list-summary">
                {visibleServers.length > 0 ? `${syncAvailableCount} sync feed${syncAvailableCount === 1 ? "" : "s"} - ${gameOnlineCount} game online` : "Checking servers"}
              </small>
            </div>
            <button className="mini-icon" type="button" onClick={refreshServerDirectory} title="Refresh server status">
              <RefreshCw size={15} />
            </button>
          </div>
          {visibleServers.map((server) => {
            const health = serverHealth[server.id];
            const active = selectedServer?.id === server.id;
            const recommended = server.id === recommendedServerId;

            return (
              <button className={`server-profile ${active ? "active" : ""} ${recommended ? "recommended" : ""}`} type="button" key={server.id} onClick={() => void selectServer(server)}>
                <Server size={18} />
                <span>
                  <strong>{server.name}</strong>
                  <small>{server.host ? `${server.host}${server.gamePort ? `:${server.gamePort}` : ""}` : gameDefinitions[server.game || "7dtd"]?.name || "Mod sync"}</small>
                  <small className={getGameServerStatusClass(health)}>
                    {getGameServerStatusLabel(health)}
                  </small>
                  <small className={health?.ok ? "sync-online" : "sync-offline"}>
                    {health ? (health.ok ? `Sync available - ${health.modCount} mods - ${formatKnownBytes(health.installedBytes, health.installedSizeKnown)}` : "Sync unavailable") : "Checking sync"}
                  </small>
                  <span className="server-badges">
                    {recommended && <em className="recommended">Recommended</em>}
                    <em>{getServerKindLabel(server)}</em>
                    <em className={getGameServerBadgeClass(health)}>{getGameServerBadgeLabel(health)}</em>
                    <em>{getServerVersionLabel(health)}</em>
                    {selectedGame.supportsEac && <em>EAC {typeof health?.eacEnabled === "boolean" ? (health.eacEnabled ? "On" : "Off") : "?"}</em>}
                    <em>{health?.ok ? formatKnownBytes(health.installedBytes, health.installedSizeKnown) : "Size ?"}</em>
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        <section className="health-panel" aria-label="Loader status">
          <div className="health-panel-header">
            <span className="section-label">Status</span>
          </div>
          <div className="status-group" aria-label="Game status">
            <span className="status-group-title">Game</span>
            <StatusRow icon={<Gamepad2 size={17} />} label="Folder" value={selectedGameFolderLabel} />
            <StatusRow icon={<RefreshCw size={17} />} label="Version" value={localGameVersionLabel} />
          </div>
          <div className="status-group" aria-label="Server status">
            <span className="status-group-title">Server</span>
            <StatusRow icon={<Server size={17} />} label="Game server" value={selectedGameServerStatus} />
            <StatusRow icon={<UploadCloud size={17} />} label="Mod sync" value={selectedHealth?.ok ? "Available" : config.manifestInput ? "Unavailable" : "Missing"} />
            <StatusRow icon={<RefreshCw size={17} />} label="Version" value={serverVersionLabel} />
            {selectedGame.supportsEac && <StatusRow icon={serverEacEnabled ? <ShieldCheck size={17} /> : <ShieldOff size={17} />} label="EAC" value={serverEacLabel} />}
          </div>
          <div className="status-group" aria-label="Launch status">
            <span className="status-group-title">Launch</span>
            {selectedGame.supportsEac && <StatusRow icon={config.launchWithEac ? <ShieldCheck size={17} /> : <ShieldOff size={17} />} label="EAC" value={config.launchWithEac ? "On" : "Off"} />}
            <StatusRow icon={<ListChecks size={17} />} label="Next action" value={nextAction} />
          </div>
        </section>

        <section className={`sidebar-launch-panel ${eacWarning ? "warn" : ""}`} aria-label="Launch game">
          <div>
            <span className="section-label">Play</span>
            <strong>{config.gamePath ? "Ready to launch" : "Choose game folder"}</strong>
            <small>{selectedGame.supportsEac ? `Launch EAC ${config.launchWithEac ? "on" : "off"} - server ${serverEacLabel.toLowerCase()}` : selectedGame.name}</small>
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

        {activeTab !== "sync" && !(activeTab === "settings" && showingSupportProgress) && syncProgress && (
          <div className="content-grid">
            <ProgressPanel progress={syncProgress} panelRef={progressPanelRef} />
          </div>
        )}

        {activeTab === "sync" && (
          <div className={`content-grid ${advancedMode ? "advanced-layout" : "tester-layout"}`}>
            <section className="panel wide">
              <div className="panel-heading">
                <div>
                  <span className="section-label">Guided Setup</span>
                  <h3>{selectedServerName}</h3>
                  <p className="panel-description">Use Make Me Ready for guided setup, or Manual Setup if you want to review each step yourself.</p>
                </div>
                <div className="panel-tools">
                  <button
                    className={`mode-toggle ${advancedMode ? "active" : ""}`}
                    type="button"
                    onClick={() => setAdvancedMode((current) => !current)}
                    aria-pressed={advancedMode}
                    title={advancedMode ? "Return to guided setup" : "Open manual setup, mod list, and repair tools"}
                  >
                    <Settings size={16} />
                    {advancedMode ? "Guided Setup" : "Manual Setup"}
                  </button>
                  {advancedMode && (
                    <button className="icon-button" type="button" onClick={() => void previewSync()} disabled={working || !config.gamePath || !config.manifestInput} title="Check server mods">
                      <RefreshCw size={18} />
                    </button>
                  )}
                </div>
              </div>

              {advancedMode && <ReadinessMeter summary={readinessSummary} />}
              <GuideCard action={guidedAction} />
              {!advancedMode && config.gamePath && !guidedSetupOpen && (
                <SelectedFolderCard
                  tone={installProfile.tone}
                  installLabel={installProfile.label}
                  folderPath={config.gamePath}
                  freeSpaceLabel={diskSpace ? `${formatBytes(diskSpace.freeBytes)} free on this drive` : "Checking free space"}
                  onOpen={openGameFolder}
                  onChange={changeInstallSetup}
                  disabled={working}
                />
              )}
              {!advancedMode && guidedSetupOpen && showSetupChoices && (
                <SetupChoicePanel
                  detected={detected}
                  detectedSetupLabel={detectedSetupLabel}
                  game={selectedGame}
                  createShortcut={createShortcut}
                  onCreateShortcutChange={setCreateShortcut}
                  onUseExisting={useDetectedInstallAndContinue}
                  onCreateCopy={createGdgCopyAndContinue}
                  onBrowse={browseGameFolderAndContinue}
                  onDecline={declineGameSetup}
                  disabled={working}
                />
              )}
              {advancedMode && problemCards.length > 0 && <ProblemCards cards={problemCards} />}
              {applyResult?.backupRoot && !advancedMode && (
                <BackupResultCard
                  backupRoot={applyResult.backupRoot}
                  onOpen={() => void window.gdg.openPath(applyResult.backupRoot)}
                  onRestore={() => void restoreBackupPath(applyResult.backupRoot, 1, "sync")}
                  disabled={working}
                />
              )}
              {error && !supportBundle && (
                <SupportHelpCard onSupport={createSupportBundle} disabled={working} />
              )}
              {supportBundle && (
                <SupportResult
                  bundle={supportBundle}
                  message={supportMessage}
                  onOpen={() => void window.gdg.openPath(supportBundle.folderPath)}
                  onCopyZip={copySupportBundleZip}
                  onCopyDetails={copySupportDetails}
                />
              )}
              {advancedMode && readyToPlay && (
                <ReadyPanel
                  serverName={selectedServerName}
                  folderName={selectedGameFolderLabel}
                  eacLabel={selectedGame.supportsEac ? (config.launchWithEac ? "On" : "Off") : ""}
                  supportsEac={selectedGame.supportsEac}
                  onLaunch={launchGame}
                  disabled={working}
                />
              )}

              {advancedMode && (
                <div className="step-sections">
                <StepSection
                  number="1"
                  title="Choose Game Folder"
                  summary={config.gamePath ? `${installProfile.label} selected` : `Pick where GDG should prepare ${selectedGame.name}`}
                  state={setupStepState}
                  open={openStep === "setup"}
                  onToggle={() => setOpenStep(openStep === "setup" ? "" : "setup")}
                >
                  <div className="step-body">
                    <p className="step-copy">
                      GDG can keep vanilla untouched by making a separate copy, or it can install mods into your existing {selectedGame.name} folder.
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
                      <SetupChoicePanel
                        detected={detected}
                        detectedSetupLabel={detectedSetupLabel}
                        game={selectedGame}
                        createShortcut={createShortcut}
                        onCreateShortcutChange={setCreateShortcut}
                        onUseExisting={useDetectedInstall}
                        onCreateCopy={createGdgCopy}
                        onBrowse={browseGameFolder}
                        onDecline={declineGameSetup}
                        disabled={working}
                      />
                    )}

                    {(!config.gamePath || advancedMode) && (
                      <label>
                        <span>Game folder</span>
                        <small className="field-help">This is the {selectedGame.name} folder GDG will check, sync, and launch.</small>
                        <div className="input-row">
                          <input
                            value={config.gamePath}
                            onChange={(event) => void updateGamePath(event.target.value)}
                            placeholder={selectedGame.folderPlaceholder}
                          />
                          <button type="button" onClick={detectGame} disabled={working} title="Detect game">
                            <Search size={17} />
                          </button>
                          <button type="button" onClick={browseGameFolder} disabled={working} title="Browse game folder">
                            <FolderOpen size={17} />
                          </button>
                        </div>
                      </label>
                    )}
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
                        <strong>{selectedHealth?.ok ? "Sync available" : "Sync not confirmed"}</strong>
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
                          <button className="secondary slim" type="button" onClick={() => void previewSync()} disabled={working || !config.gamePath || !config.manifestInput}>
                            <ListChecks size={16} />
                            Retry
                          </button>
                        )}
                        {gameVersionMismatch && (
                          <div className="steam-update-help">
                            <strong>Steam controls game updates.</strong>
                            <ol>
                              <li>Open Steam and select {selectedGame.name}.</li>
                              <li>Go to Properties, then Betas.</li>
                              <li>Choose the public/current branch or the server version shown above.</li>
                              <li>Wait for Steam to finish updating, then come back and click Check Server Mods.</li>
                            </ol>
                          </div>
                        )}
                      </div>
                    )}

                    {advancedMode && (
                      <details className="advanced-settings">
                        <summary>
                          <ListChecks size={16} />
                          Setup checks
                        </summary>
                        <DoctorPanel result={doctor} failures={doctorFailures} warnings={doctorWarnings} supportsEac={selectedGame.supportsEac} onRun={runPreflightDoctor} disabled={working || !config.gamePath} />
                      </details>
                    )}

                    {advancedMode && config.manifestInput ? (
                      <details className="advanced-settings">
                        <summary>
                          <UploadCloud size={16} />
                          Custom server link
                        </summary>
                        <label>
                          <span>Server mod list link</span>
                          <small className="field-help">Most players should leave this alone. Change it only if GDG staff gave you a special link or file.</small>
                          <div className="input-row">
                            <input
                              value={config.manifestInput}
                              onChange={(event) => void updateManifestInput(event.target.value)}
                              placeholder={selectedServer?.syncUrl || sampleSyncEndpoint}
                            />
                            <button type="button" onClick={browseManifestFile} disabled={working} title="Browse manifest">
                              <FolderOpen size={17} />
                            </button>
                          </div>
                        </label>
                      </details>
                    ) : !config.manifestInput ? (
                      <label>
                        <span>Server mod list link</span>
                        <small className="field-help">Choose a GDG server on the left, or paste a special link from GDG staff.</small>
                        <div className="input-row">
                          <input
                            value={config.manifestInput}
                            onChange={(event) => void updateManifestInput(event.target.value)}
                            placeholder={selectedServer?.syncUrl || sampleSyncEndpoint}
                          />
                          <button type="button" onClick={browseManifestFile} disabled={working} title="Browse manifest">
                            <FolderOpen size={17} />
                          </button>
                        </div>
                      </label>
                    ) : (
                      <p className="step-copy">Click Check Server Mods when you are ready. Nothing is installed by this check.</p>
                    )}

                    <div className="step-actions">
                      <button className="secondary" type="button" onClick={() => void previewSync()} disabled={working || !config.gamePath || !config.manifestInput}>
                        <ListChecks size={17} />
                        Check Server Mods
                      </button>
                    </div>
                  </div>
                </StepSection>

                <StepSection
                  number="3"
                  title={modChangeCopy.stepTitle}
                  summary={
                    preview
                      ? gameVersionMismatch
                        ? "Update game before applying mod changes"
                        : modsToInstall > 0
                        ? modChangeCopy.stepSummary
                        : localOnlyMods > 0
                          ? `${localOnlyMods} local-only mod${localOnlyMods === 1 ? "" : "s"} to review`
                          : modChangeCopy.stepSummary
                      : "Check server mods first"
                  }
                  state={installStepState}
                  open={openStep === "install"}
                  onToggle={() => setOpenStep(openStep === "install" ? "" : "install")}
                >
                  <div className="step-body">
                    <p className="step-copy">
                      {modChangeCopy.stepCopy}
                    </p>
                    {localOnlyMods > 0 && (
                      <div className="local-only-warning">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>{localOnlyMods} local-only mod{localOnlyMods === 1 ? "" : "s"} detected</strong>
                          <small>These are not part of the selected server package. Move or delete them if the game crashes or behaves differently from the server.</small>
                        </span>
                      </div>
                    )}
                    {skippedServerOnlyMods > 0 && (
                      <div className="local-only-warning danger">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>{skippedServerOnlyMods} server-only manifest entr{skippedServerOnlyMods === 1 ? "y" : "ies"} blocked</strong>
                          <small>GDG refused to install those entries on this client. Republish the server manifest so only client/shared mods are listed.</small>
                        </span>
                      </div>
                    )}
                    {serverOnlyInstalledMods.length > 0 && (
                      <div className="local-only-warning danger">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>{serverOnlyInstalledMods.length} server-only mod{serverOnlyInstalledMods.length === 1 ? "" : "s"} installed locally</strong>
                          <small>{serverOnlyInstalledMods.map((mod) => mod.folderName).join(", ")}</small>
                        </span>
                      </div>
                    )}
                    {managedExtraMods > 0 && (
                      <div className="local-only-warning">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>{managedExtraMods} extra GDG-managed mod{managedExtraMods === 1 ? "" : "s"}</strong>
                          <small>These were installed by GDG before but are not part of the selected server package.</small>
                        </span>
                      </div>
                    )}
                    {gameVersionMismatch && (
                      <div className="local-only-warning danger">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>Update {selectedGame.name} before installing</strong>
                          <small>{gameCompatibility?.reason || "The selected game folder does not match the selected server version."}</small>
                        </span>
                      </div>
                    )}
                    {syncSpaceBlocked && diskSpace && (
                      <div className="local-only-warning danger">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>Not enough free space</strong>
                          <small>
                            GDG needs about {formatBytes(syncSpaceRequirement.bytes)} free on the selected game drive for downloads, extraction, and backups. This drive has {formatBytes(diskSpace.freeBytes)} free.
                          </small>
                        </span>
                      </div>
                    )}
                    {repairSpaceBlocked && diskSpace && (
                      <div className="local-only-warning danger">
                        <AlertTriangle size={18} />
                        <span>
                          <strong>Not enough free space for repair</strong>
                          <small>
                            Repair needs about {formatBytes(repairSpaceRequirement.bytes)} free on the selected game drive. This drive has {formatBytes(diskSpace.freeBytes)} free.
                          </small>
                        </span>
                      </div>
                    )}
                    <div className="step-actions">
                      {showCheckFirstAction && (
                        <button className="secondary" type="button" onClick={() => void previewSync()} disabled={working || !config.gamePath || !config.manifestInput}>
                          <ListChecks size={17} />
                          Check Server Mods
                        </button>
                      )}
                      {showUpdateGameActions && (
                        <>
                          <button className="secondary" type="button" onClick={openSteamUpdate} disabled={working}>
                            <RefreshCw size={17} />
                            Open Steam
                          </button>
                          <button className="secondary" type="button" onClick={() => void previewSync()} disabled={working || !config.gamePath || !config.manifestInput}>
                            <ListChecks size={17} />
                            Check Again
                          </button>
                        </>
                      )}
                      {showLocalCleanupActions && (
                        <>
                          <button className="secondary" type="button" onClick={() => void cleanLocalMods("backup")} disabled={working}>
                            <HardDrive size={17} />
                            Move Local-Only to Backup
                          </button>
                          {advancedMode && (
                            <button className="secondary danger" type="button" onClick={() => void cleanLocalMods("delete")} disabled={working}>
                              <Trash2 size={17} />
                              Delete Local-Only
                            </button>
                          )}
                        </>
                      )}
                      {showManagedCleanupActions && (
                        <>
                          <button className="secondary" type="button" onClick={() => void cleanManagedMods("backup", "extra")} disabled={working}>
                            <HardDrive size={17} />
                            Move Extra Managed
                          </button>
                          {advancedMode && (
                            <button className="secondary danger" type="button" onClick={() => void cleanManagedMods("delete", "extra")} disabled={working}>
                              <Trash2 size={17} />
                              Delete Extra Managed
                            </button>
                          )}
                        </>
                      )}
                      {showInstallMissingAction && (
                        <button className="primary" type="button" onClick={() => void applySync()} disabled={working}>
                          {modChangeCopy.hasUpdate && !modChangeCopy.hasInstall ? <RefreshCw size={17} /> : <Download size={17} />}
                          {modChangeCopy.actionLabel}
                        </button>
                      )}
                      {showLaunchStepAction && (
                        <button className="primary" type="button" onClick={() => setOpenStep("launch")} disabled={working}>
                          <Play size={17} />
                          Continue to Launch
                        </button>
                      )}
                    </div>
                    {showRepairActions && (
                      <details className="advanced-actions">
                        <summary>
                          <Wrench size={16} />
                          Repair options
                        </summary>
                        <div className="step-actions">
                          <button className="secondary" type="button" onClick={repairSync} disabled={working}>
                            <Wrench size={17} />
                            Reinstall Server Mods
                          </button>
                          <button className="secondary danger" type="button" onClick={() => void resetAndReinstall("delete")} disabled={working}>
                            <Trash2 size={17} />
                            Delete + Reinstall
                          </button>
                        </div>
                      </details>
                    )}
                  </div>
                </StepSection>

                <StepSection
                  number="4"
                  title={`Launch ${selectedGame.name}`}
                  summary={config.gamePath ? (selectedGame.supportsEac ? `Launch EAC ${config.launchWithEac ? "on" : "off"} - server ${serverEacLabel.toLowerCase()}` : `Launch ${selectedGame.name}`) : "Choose a game folder first"}
                  state={launchStepState}
                  open={openStep === "launch"}
                  onToggle={() => setOpenStep(openStep === "launch" ? "" : "launch")}
                >
                  <div className="step-body">
                    {config.gamePath ? (
                      <div className={`launch-card ${eacWarning ? "warn" : "ready"}`}>
                        <div className="launch-copy">
                          {selectedGame.supportsEac ? (config.launchWithEac ? <ShieldCheck size={20} /> : <ShieldOff size={20} />) : <Play size={20} />}
                          <span>
                            <strong>Launch {selectedGame.name}</strong>
                            <small>{launchHint}</small>
                            {hasDllMods && <small>DLL mods: {dllMods.map((mod) => mod.displayName).join(", ")}</small>}
                          </span>
                        </div>
                        {selectedGame.supportsEac && advancedMode && (
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
                        )}
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
              )}
            </section>

            {advancedMode && (
              <section className="panel compact">
              <div className="server-match-heading">
                <span className="section-label">Server Match</span>
                {planFilter !== "all" && (
                  <button className="filter-clear" type="button" onClick={() => setPlanFilter("all")}>
                    <XCircle size={14} />
                    Clear
                  </button>
                )}
              </div>
              <div className="metric-grid">
                {planFilterOptions.map((option) => (
                  <Metric
                    key={option.id}
                    label={option.label}
                    value={option.count}
                    tone={option.tone}
                    active={planFilter === option.id}
                    disabled={!preview}
                    onClick={() => selectPlanFilter(option.id)}
                  />
                ))}
              </div>
              <div className="storage-grid">
                <StorageStat icon={<Database size={16} />} label="Server mods" value={serverSize.known ? formatBytes(serverSize.bytes) : "Unknown"} tone="gold" />
                <StorageStat icon={<HardDrive size={16} />} label="Free space" value={diskSpace ? formatBytes(diskSpace.freeBytes) : "Unknown"} tone={freeSpaceTone} />
              </div>
              </section>
            )}

            {syncProgress && (advancedMode || working || showingSupportProgress) && <ProgressPanel progress={syncProgress} panelRef={progressPanelRef} />}

            {advancedMode && (
              <section className="panel full">
              <div className="panel-heading">
                <div>
                  <span className="section-label">Sync Plan</span>
                  <h3>{syncPlanTitle}</h3>
                  <p className="panel-description">Green rows match the server. Local-only rows are extra mods on this PC, are not removed automatically, and may cause crashes or mismatches.</p>
                </div>
                <button className="secondary slim" type="button" onClick={openModsFolder} disabled={!config.gamePath}>
                  <FolderOpen size={16} />
                  Mods
                </button>
              </div>

              <div className="plan-filter-bar" aria-label="Sync plan filters">
                {allPlanFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    className={`plan-filter ${option.tone} ${planFilter === option.id ? "active" : ""}`}
                    type="button"
                    aria-pressed={planFilter === option.id}
                    onClick={() => selectPlanFilter(option.id)}
                    disabled={!preview && option.id !== "all"}
                  >
                    <span>{option.label}</span>
                    <strong>{option.count}</strong>
                  </button>
                ))}
                {planFilter !== "all" && (
                  <button className="plan-filter clear" type="button" onClick={() => setPlanFilter("all")}>
                    <XCircle size={15} />
                    Clear
                  </button>
                )}
              </div>

              <div className="mod-table">
                {filteredPlanItems.map((item) => (
                  <PlanRow key={`${item.action}-${item.mod.id}-${item.mod.folderName || item.mod.name}`} item={item} liveStatus={livePlanStatuses[getPlanKey(item)]} />
                ))}
                {!preview && <EmptyState icon={<ShieldCheck size={22} />} title="Check pending" value="Click Check Server Mods to compare your game folder with the server." />}
                {preview && filteredPlanItems.length === 0 && (
                  <EmptyState icon={<Search size={22} />} title="No mods in this filter" value="Clear the filter or choose another server match value." />
                )}
              </div>
              </section>
            )}

            {advancedMode && applyResult && (
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
                  <button className="secondary slim" type="button" onClick={createSupportBundle} disabled={working}>
                    <Archive size={16} />
                    Support Bundle
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
                <button className="secondary slim" type="button" onClick={() => void purgeModsFolder("backup")} disabled={working || !config.gamePath}>
                  <HardDrive size={16} />
                  Backup Mods
                </button>
                <button className="secondary danger slim" type="button" onClick={() => void purgeModsFolder("delete")} disabled={working || !config.gamePath}>
                  <Trash2 size={16} />
                  Delete Mods
                </button>
                <button className="secondary slim" type="button" onClick={() => void cleanManagedMods("backup", "all")} disabled={working || !config.gamePath || managedOrServerOnlyMods === 0}>
                  <HardDrive size={16} />
                  Backup Managed
                </button>
                <button className="secondary danger slim" type="button" onClick={() => void cleanManagedMods("delete", "all")} disabled={working || !config.gamePath || managedOrServerOnlyMods === 0}>
                  <Trash2 size={16} />
                  Delete Managed
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
                    <span>{mod.folderName}{mod.managed ? " - GDG managed" : ""}{mod.serverOnly ? " - server-only" : ""}</span>
                  </div>
                  <small>{mod.hasDll ? `${mod.version || "No version"} - DLL` : mod.version || "No version"}</small>
                </article>
              ))}
              {!scan && <EmptyState icon={<HardDrive size={22} />} title="No scan yet" value="Local mods" />}
              {scan && scan.mods.length === 0 && <EmptyState icon={<HardDrive size={22} />} title="Empty Mods folder" value={scan.modsPath} />}
            </div>

            <div className="backup-manager">
              <div className="backup-heading">
                <span>
                  <strong>Backups</strong>
                  <small>{backups.length} backup{backups.length === 1 ? "" : "s"} - {formatBytes(backupTotalBytes)}</small>
                </span>
                <button className="secondary slim" type="button" onClick={() => void refreshBackups()} disabled={!config.gamePath || working}>
                  <RefreshCw size={16} />
                  Refresh
                </button>
              </div>
              <div className="backup-list">
                {backups.map((backup) => (
                  <article className="backup-row" key={backup.path}>
                    <Archive size={17} />
                    <span>
                      <strong>{backup.name}</strong>
                      <small>{formatDate(backup.createdAt)} - {backup.itemCount} item{backup.itemCount === 1 ? "" : "s"} - {formatBytes(backup.sizeBytes)}{backup.legacy ? " - legacy location" : ""}</small>
                    </span>
                    <button className="secondary slim" type="button" onClick={() => void window.gdg.openPath(backup.path)}>
                      <FolderOpen size={16} />
                      Open
                    </button>
                    <button className="secondary slim" type="button" onClick={() => void restoreBackup(backup)} disabled={working || !config.gamePath}>
                      <RotateCcw size={16} />
                      Restore
                    </button>
                    <button className="secondary danger slim" type="button" onClick={() => void deleteBackup(backup)} disabled={working || !config.gamePath}>
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </article>
                ))}
                {backups.length === 0 && <EmptyState icon={<Archive size={22} />} title="No backups found" value="Backups appear after updates, cleanup, or purge actions." />}
              </div>
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
                <button className="secondary slim" type="button" onClick={createSupportBundle} disabled={working}>
                  <Archive size={16} />
                  Support Bundle
                </button>
              </div>
            </div>

            {showingSupportProgress && syncProgress && <ProgressPanel progress={syncProgress} panelRef={progressPanelRef} />}

            {supportBundle && (
              <SupportResult
                bundle={supportBundle}
                message={supportMessage}
                onOpen={() => void window.gdg.openPath(supportBundle.folderPath)}
                onCopyZip={copySupportBundleZip}
                onCopyDetails={copySupportDetails}
              />
            )}

            <div className="settings-grid">
              <SettingItem label="Detected install" value={detected?.found ? detected.path : "Not found"} />
              <SettingItem label="Install type" value={installProfile.label} />
              <SettingItem label="Saved game folder" value={config.gamePath || "Not set"} />
              <SettingItem label="Local game version" value={localGameVersionLabel} />
              <SettingItem label="Local Steam build" value={gameVersion?.steamBuildId || "Unknown"} />
              <SettingItem label="Server game version" value={requiredGameVersion || "Not published"} />
              <SettingItem label="Server Steam build" value={requiredSteamBuildId || "Not published"} />
              {selectedGame.supportsEac && <SettingItem label="Server EAC" value={serverEacLabel} />}
              {selectedGame.supportsEac && <SettingItem label="Launch EAC" value={config.launchWithEac ? "On" : "Off"} />}
              <SettingItem label="DLL mod warning" value={hasDllMods ? `${dllMods.length} mod${dllMods.length === 1 ? "" : "s"} detected` : scanMatchesGame ? "No DLL mods detected" : "Checking"} />
              <SettingItem label="GDG-managed mods" value={`${managedInstalledMods.length} installed`} />
              <SettingItem label="Server-only local mods" value={`${serverOnlyInstalledMods.length} detected`} />
              <SettingItem label="Setup checks" value={doctor ? `${doctorFailures} fail / ${doctorWarnings} warn` : "Not run"} />
              <SettingItem label="Free disk space" value={diskSpace ? `${formatBytes(diskSpace.freeBytes)} free of ${formatBytes(diskSpace.totalBytes)}` : "Unknown"} />
              <SettingItem label="Backup storage" value={`${backups.length} backups / ${formatBytes(backupTotalBytes)}`} />
              <SettingItem label="Selected server mods" value={serverSize.known ? formatBytes(serverSize.bytes) : "Unknown"} />
              <SettingItem label="Server mod list link" value={config.manifestInput || "Not set"} />
              <SettingItem label="Server directory" value={config.serverDirectoryInput || "Built-in sample"} />
              <SettingItem label="Game adapter" value={config.gameId} />
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
      <span className="status-icon">{icon}</span>
      <span className="status-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function ReadinessMeter({ summary }: { summary: ReadinessSummary }) {
  return (
    <section className={`readiness-meter ${summary.tone}`} aria-label="Readiness">
      <span>
        <strong>{summary.title}</strong>
        <small>{summary.detail}</small>
      </span>
      <b>{summary.value}</b>
    </section>
  );
}

function SelectedFolderCard({
  tone,
  installLabel,
  folderPath,
  freeSpaceLabel,
  onOpen,
  onChange,
  disabled
}: {
  tone: string;
  installLabel: string;
  folderPath: string;
  freeSpaceLabel: string;
  onOpen: () => void | Promise<void>;
  onChange: () => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <div className={`install-summary guided-folder-summary ${tone}`}>
      <HardDrive size={18} />
      <span>
        <strong>{installLabel}</strong>
        <small>{folderPath}</small>
        <small>{freeSpaceLabel}</small>
      </span>
      <button className="secondary slim" type="button" onClick={() => void onOpen()}>
        <FolderOpen size={16} />
        Open
      </button>
      <button className="secondary slim" type="button" onClick={() => void onChange()} disabled={disabled}>
        <RotateCcw size={16} />
        Change Folder
      </button>
    </div>
  );
}

function SetupChoicePanel({
  detected,
  detectedSetupLabel,
  game,
  createShortcut,
  onCreateShortcutChange,
  onUseExisting,
  onCreateCopy,
  onBrowse,
  onDecline,
  disabled
}: {
  detected: DetectedGame | null;
  detectedSetupLabel: string;
  game: GameDefinition;
  createShortcut: boolean;
  onCreateShortcutChange: (value: boolean) => void;
  onUseExisting: () => void | Promise<void>;
  onCreateCopy: () => void | Promise<void>;
  onBrowse: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  disabled: boolean;
}) {
  const hasDetectedGame = Boolean(detected?.found);
  const browseLabel = hasDetectedGame ? "Browse different folder" : "Choose game folder";
  const browseHelp = hasDetectedGame
    ? `Choose a specific ${game.name} folder on this PC.`
    : `Browse to the folder that contains ${game.id === "repo" ? "REPO.exe" : "7DaysToDie.exe"}.`;

  return (
    <div className="setup-panel">
      <div className="setup-heading">
        <div>
          <span className="section-label">Game Setup</span>
          <strong>{hasDetectedGame ? `Choose how GDG should prepare ${game.name}.` : `Choose your ${game.name} folder.`}</strong>
          <p>
            {hasDetectedGame
              ? `A GDG copy is safest for most players. It creates a separate folder beside the detected game and starts with clean ${game.modsLabel}.`
              : "GDG could not find the game automatically. Pick the folder you want Make Me Ready to prepare."}
          </p>
          {hasDetectedGame && <small>{detectedSetupLabel}: {detected?.path}</small>}
          {detected?.isGdgCopy && <small>This already looks like a GDG copy. Browse for your Steam install if you want to overwrite vanilla.</small>}
        </div>
      </div>

      <div className="setup-options">
        {hasDetectedGame && (
          <>
            <button className="setup-option overwrite" type="button" onClick={() => void onUseExisting()} disabled={disabled}>
              <AlertTriangle size={20} />
              <span>
                <strong>{detected?.isGdgCopy ? "Use detected GDG copy" : "Use existing game"}</strong>
                <small>
                  {detected?.isGdgCopy
                    ? "Select the detected modded copy. This will not point at your vanilla Steam folder."
                    : `Use your current ${game.name} folder. GDG mods will be installed into this game.`}
                </small>
              </span>
            </button>
            <button className="setup-option copy" type="button" onClick={() => void onCreateCopy()} disabled={disabled}>
              <Copy size={20} />
              <span>
                <strong>Create GDG copy <em>Recommended</em></strong>
                <small>Make a separate folder named {game.copyName} with clean {game.modsLabel}.</small>
              </span>
            </button>
          </>
        )}
        <button className="setup-option browse" type="button" onClick={() => void onBrowse()} disabled={disabled}>
          <FolderOpen size={20} />
          <span>
            <strong>{browseLabel}</strong>
            <small>{browseHelp}</small>
          </span>
        </button>
        <button className="setup-option decline" type="button" onClick={() => void onDecline()} disabled={disabled}>
          <XCircle size={20} />
          <span>
            <strong>Choose later</strong>
            <small>Skip setup for now. You can browse for a folder or change setup later.</small>
          </span>
        </button>
      </div>

      {hasDetectedGame && (
        <label className="shortcut-toggle">
          <input type="checkbox" checked={createShortcut} onChange={(event) => onCreateShortcutChange(event.target.checked)} />
          <span>Create desktop shortcut for the GDG copy</span>
        </label>
      )}
    </div>
  );
}

function GuideCard({
  action
}: {
  action: GuideAction;
}) {
  const primaryText = action.disabled && action.workingLabel
    ? action.workingLabel
    : action.primaryLabel || (action.tone === "ready" ? action.label : "Make Me Ready");
  const preference = action.preference;

  return (
    <section className={`guided-next ${action.tone}`} aria-label="Recommended next step">
      <div className="guided-next-icon">{action.icon}</div>
      <span>
        <strong>{action.title}</strong>
        <small>{action.detail}</small>
        {action.previewText && <em className="guided-preview">{action.previewText}</em>}
      </span>
      <div className="guided-next-actions">
        <button className={`primary ${action.primaryTone === "danger" ? "danger" : ""}`} type="button" onClick={action.onClick} disabled={action.disabled}>
          {action.icon}
          {primaryText}
        </button>
        {action.secondaryAction && (
          <button
            className={`secondary slim ${action.secondaryAction.tone === "danger" ? "danger" : ""}`}
            type="button"
            onClick={action.secondaryAction.onClick}
            disabled={action.secondaryAction.disabled ?? action.disabled}
          >
            {action.secondaryAction.icon}
            {action.secondaryAction.label}
          </button>
        )}
        {action.detailsAction && (
          <button className="secondary slim" type="button" onClick={action.detailsAction.onClick} disabled={action.detailsAction.disabled ?? action.disabled}>
            {action.detailsAction.icon}
            {action.detailsAction.label}
          </button>
        )}
      </div>
      {preference && (
        <div className="cleanup-preference" role="group" aria-label="Cleanup preference">
          {cleanupPreferenceOptions.map((option) => (
            <button
              key={option.value}
              className={preference.value === option.value ? "active" : ""}
              type="button"
              onClick={() => preference.onChange(option.value)}
              aria-pressed={preference.value === option.value}
              disabled={action.disabled}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ProblemCards({ cards }: { cards: ProblemCardInfo[] }) {
  return (
    <section className="problem-cards" aria-label="Fixes needed">
      {cards.map((card) => (
        <article className={`problem-card ${card.tone}`} key={card.key}>
          <div className="problem-icon">{card.icon}</div>
          <span>
            <strong>{card.title}</strong>
            <small>{card.detail}</small>
          </span>
          <button className={card.tone === "danger" ? "secondary danger slim" : "secondary slim"} type="button" onClick={card.onClick} disabled={card.disabled}>
            {card.icon}
            {card.label}
          </button>
        </article>
      ))}
    </section>
  );
}

function SupportHelpCard({ onSupport, disabled }: { onSupport: () => void | Promise<void>; disabled: boolean }) {
  return (
    <section className="support-help-card" aria-label="Get GDG help">
      <Archive size={18} />
      <span>
        <strong>Need help?</strong>
        <small>Create a support bundle and send it to GDG staff.</small>
      </span>
      <button className="secondary slim" type="button" onClick={onSupport} disabled={disabled}>
        <Archive size={16} />
        Send Help to GDG
      </button>
    </section>
  );
}

function BackupResultCard({
  backupRoot,
  onOpen,
  onRestore,
  disabled
}: {
  backupRoot: string;
  onOpen: () => void;
  onRestore: () => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <section className="backup-result-card" aria-label="Backup ready">
      <Archive size={18} />
      <span>
        <strong>Done. Your mods were kept in a backup.</strong>
        <small>{backupRoot}</small>
      </span>
      <button className="secondary slim" type="button" onClick={onOpen}>
        <FolderOpen size={16} />
        Open Backup
      </button>
      <button className="secondary slim" type="button" onClick={onRestore} disabled={disabled}>
        <RotateCcw size={16} />
        Restore Backup
      </button>
    </section>
  );
}

function SupportResult({
  bundle,
  message,
  onOpen,
  onCopyZip,
  onCopyDetails
}: {
  bundle: { path: string; folderPath: string; fileName: string };
  message: string;
  onOpen: () => void;
  onCopyZip: (filePath: string) => Promise<void>;
  onCopyDetails: (message: string) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState("");

  async function copyZip() {
    setCopyStatus("Copying ZIP...");
    try {
      await onCopyZip(bundle.path);
      setCopyStatus("ZIP copied. Paste it into Discord.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setCopyStatus(detail || "ZIP copy failed. Use Open Folder to attach it.");
    }
  }

  async function copyDetails() {
    await onCopyDetails(message);
    setCopyStatus("Details copied.");
  }

  return (
    <div className="support-result">
      <Archive size={18} />
      <span>
        <strong>Support bundle ready</strong>
        <small>{copyStatus || `${bundle.fileName} - copy the ZIP, then paste it into Discord`}</small>
      </span>
      <button className="secondary slim" type="button" onClick={onOpen}>
        <FolderOpen size={16} />
        Open Folder
      </button>
      <button className="primary slim" type="button" onClick={() => void copyZip()}>
        <Copy size={16} />
        Copy ZIP
      </button>
      <button className="secondary slim" type="button" onClick={() => void copyDetails()} disabled={!message}>
        <Copy size={16} />
        Copy Details
      </button>
    </div>
  );
}

function ReadyPanel({
  serverName,
  folderName,
  eacLabel,
  supportsEac,
  onLaunch,
  disabled
}: {
  serverName: string;
  folderName: string;
  eacLabel: string;
  supportsEac: boolean;
  onLaunch: () => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <section className="ready-panel" aria-label="Ready to play">
      <CheckCircle2 size={22} />
      <span>
        <strong>You are ready to play</strong>
        <small>{supportsEac ? `${serverName} - ${folderName} - EAC ${eacLabel}` : `${serverName} - ${folderName}`}</small>
      </span>
      <button className="primary" type="button" onClick={onLaunch} disabled={disabled}>
        <Play size={17} />
        Launch Game
      </button>
    </section>
  );
}

function getGameVersionForBuild(buildId: string, versionMap: Record<string, string> = {}) {
  const key = String(buildId || "").trim();
  if (!key) {
    return "";
  }

  return String(versionMap[key] || "").trim();
}

function isRecommendedServer(server: DirectoryServer) {
  return server.recommended === true;
}

function readCleanupPreference(): CleanupPreference {
  if (typeof window === "undefined") {
    return "ask";
  }

  try {
    const value = window.localStorage.getItem(cleanupPreferenceKey);
    return value === "backup" || value === "delete" || value === "ask" ? value : "ask";
  } catch {
    return "ask";
  }
}

function writeCleanupPreference(preference: CleanupPreference) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(cleanupPreferenceKey, preference);
  } catch {
    // Preference persistence is helpful, but not required for syncing mods.
  }
}

function getProgressButtonLabel(progress: SyncProgress | null, verb: string) {
  if (!progress || progress.phase === "complete" || progress.phase === "failed") {
    return "";
  }

  const total = Math.max(progress.total || 0, 0);
  if (total > 1) {
    return `${verb} ${Math.min(progress.current, total)} of ${total}`;
  }

  return `${verb}...`;
}

function getGameServerStatusValue(health?: ServerHealth | null): "checking" | "online" | "offline" | "unavailable" {
  if (!health) {
    return "checking";
  }

  if (health.gameStatus === "online" || health.gameStatus === "offline") {
    return health.gameStatus;
  }

  return "unavailable";
}

function getGameServerStatusLabel(health?: ServerHealth | null) {
  const status = getGameServerStatusValue(health);

  if (status === "checking") {
    return "Checking game server";
  }

  if (status === "online") {
    return "Game server online";
  }

  if (status === "offline") {
    return "Game server offline";
  }

  return "Game status unavailable";
}

function getGameServerBadgeLabel(health?: ServerHealth | null) {
  const status = getGameServerStatusValue(health);

  if (status === "checking") {
    return "Game ?";
  }

  if (status === "online") {
    return "Game Online";
  }

  if (status === "offline") {
    return "Game Offline";
  }

  return "Game N/A";
}

function getGameServerStatusClass(health?: ServerHealth | null) {
  const status = getGameServerStatusValue(health);

  if (status === "checking" || status === "unavailable") {
    return "game-unknown";
  }

  return status === "online" ? "game-online" : "game-offline";
}

function getGameServerBadgeClass(health?: ServerHealth | null) {
  return getGameServerStatusClass(health);
}

function getServerKindLabel(server: DirectoryServer) {
  if (server.game === "repo") {
    return "R.E.P.O.";
  }

  const id = server.id.toLowerCase();
  const name = server.name.toLowerCase();
  if (id.includes("pvp") || name.includes("pvp")) {
    return "PVP";
  }
  if (id.includes("pve") || name.includes("pve")) {
    return "PVE";
  }
  if (id.includes("test") || name.includes("test")) {
    return "Test";
  }
  return "GDG";
}

function getServerVersionLabel(health?: ServerHealth) {
  if (!health?.ok) {
    return "Version ?";
  }

  return health.gameVersion || (health.steamBuildId ? `Build ${health.steamBuildId}` : "Version ?");
}

function Metric({
  label,
  value,
  tone,
  active = false,
  disabled = false,
  onClick
}: {
  label: string;
  value: number;
  tone: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`metric ${tone} ${active ? "active" : ""}`} type="button" aria-pressed={active} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
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

function DoctorPanel({
  result,
  failures,
  warnings,
  supportsEac,
  onRun,
  disabled
}: {
  result: DoctorResult | null;
  failures: number;
  warnings: number;
  supportsEac: boolean;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div className={`doctor-panel ${result ? (result.ok ? "ok" : "warn") : ""}`}>
      <div className="doctor-heading">
        <ListChecks size={18} />
        <span>
          <strong>{result ? (result.ok ? "Setup looks ready" : "Setup needs attention") : "Setup checks"}</strong>
          <small>{result ? `${failures} fail / ${warnings} warn / ${result.checks.length} checks` : supportsEac ? "Checks folder, version, space, EAC, and mod safety" : "Checks folder, version, space, and mod safety"}</small>
        </span>
        <button className="secondary slim" type="button" onClick={onRun} disabled={disabled}>
          <RefreshCw size={16} />
          Check
        </button>
      </div>
      {result && (
        <div className="doctor-checks">
          {result.checks.map((check) => (
            <div className={`doctor-check ${check.status}`} key={check.id}>
              {check.status === "pass" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>
                <strong>{check.label}</strong>
                <small>{check.detail}{check.action ? ` ${check.action}` : ""}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressPanel({ progress, panelRef }: { progress: SyncProgress; panelRef: React.RefObject<HTMLElement> }) {
  return (
    <section ref={panelRef} className={`panel full sync-progress-panel ${progress.phase}`}>
      <div className="sync-progress-heading">
        <div>
          <span className="section-label">Progress</span>
          <h3>{getProgressTitle(progress)}</h3>
        </div>
        <strong>{progress.percent}%</strong>
      </div>
      <div className="gold-progress-track" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
        <div className="gold-progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="sync-progress-details">
        <span>{progress.message}</span>
        <strong>
          {progress.total > 0
            ? `${Math.min(progress.current, progress.total)} of ${progress.total}`
            : "Ready"}
        </strong>
        {progress.bytesTotal ? (
          <small>{formatBytes(progress.bytesReceived || 0)} / {formatBytes(progress.bytesTotal)}</small>
        ) : (
          <small>{getProgressDetail(progress)}</small>
        )}
      </div>
    </section>
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
      ? action === "update"
        ? "Updating now"
        : action === "install"
          ? "Installing now"
          : "Applying now"
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
    installing: "Applying mod",
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

function isSupportBundleProgress(progress: SyncProgress) {
  const message = progress.message.toLowerCase();
  return (
    message.includes("support bundle") ||
    message.includes("diagnostic log") ||
    message.includes("recent 7 days") ||
    message.includes("local mods and game version") ||
    message.includes("selected server mod list") ||
    message.includes("writing support")
  );
}

function getProgressDetail(progress: SyncProgress) {
  if (!isSupportBundleProgress(progress)) {
    return formatSyncPhase(progress.phase);
  }

  if (progress.phase === "complete") {
    return "Ready to send";
  }

  if (progress.message.toLowerCase().includes("writing")) {
    return "Writing zip";
  }

  return "Collecting diagnostics";
}

function getProgressTitle(progress: SyncProgress) {
  if (isSupportBundleProgress(progress)) {
    return progress.phase === "complete" ? "Support bundle ready" : "Creating support bundle";
  }

  const message = progress.message.toLowerCase();
  if (message.includes("all mods") || message.includes("mods folder")) {
    if (progress.phase === "complete") {
      return message.includes("deleted") ? "Mods deleted" : "Mods moved";
    }
    return message.includes("delete") || message.includes("deleting") ? "Deleting mods" : "Moving mods";
  }

  if (message.includes("gdg-managed") || message.includes("managed mod")) {
    if (progress.phase === "complete") {
      return message.includes("deleted") ? "Managed mods deleted" : "Managed mods moved";
    }
    return message.includes("delete") || message.includes("deleting") ? "Deleting managed mods" : "Moving managed mods";
  }

  if (message.includes("restore")) {
    return progress.phase === "complete" ? "Backup restored" : "Restoring backup";
  }

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

  if (progress.message.toLowerCase().includes("repair")) {
    return progress.phase === "complete" ? "Repair complete" : "Repairing server mods";
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

  return "Applying server mods";
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

function getSyncSpaceRequirement(preview: SyncPreview | null, fallback: { bytes: number; known: boolean }, options: { repairMode?: boolean } = {}) {
  if (!preview) {
    return fallback;
  }

  let bytes = 0;
  let known = true;
  const actionable = preview.plan.filter((item) => {
    if (item.action === "install" || item.action === "update") {
      return true;
    }

    return options.repairMode && item.action === "ready" && Boolean(item.mod.source);
  });

  for (const item of actionable) {
    const archiveBytes = Number(item.mod.source?.archiveSizeBytes || 0);
    const folderBytes = Number(item.mod.folderSizeBytes || 0);
    const extractedBytes = folderBytes || archiveBytes;
    const packageBytes = archiveBytes || folderBytes;

    if (!packageBytes || !extractedBytes) {
      known = false;
    }

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

function serverMatchesGame(server: DirectoryServer, gameId: GameId) {
  return (server.game || "7dtd") === gameId;
}

function normalizePath(value: string) {
  return value.replace(/[\\/]+$/g, "").toLowerCase();
}

function getFolderName(value: string) {
  return value.replace(/[\\/]+$/g, "").split(/[\\/]/).pop() || value;
}

export default App;
