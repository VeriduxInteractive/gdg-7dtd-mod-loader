export type LoaderConfig = {
  configVersion: number;
  gameId: "7dtd";
  gamePath: string;
  manifestInput: string;
  serverDirectoryInput: string;
  lastServerId: string;
  launchWithEac: boolean;
};

export type DetectedGame = {
  found: boolean;
  gameId: "7dtd";
  name: string;
  path: string;
  modsPath: string;
  isGdgCopy: boolean;
};

export type LocalMod = {
  folderName: string;
  folderPath: string;
  name: string;
  displayName: string;
  author: string;
  version: string;
  description: string;
  hasDll: boolean;
  dllFiles: string[];
  managed?: boolean;
  managedRecord?: ManagedModRecord | null;
  serverOnly?: boolean;
  folderSha256?: string;
};

export type ManagedModRecord = {
  folderName: string;
  modId: string;
  name: string;
  version: string;
  folderSha256?: string;
  sourceUrl?: string;
  audience?: "client" | "shared" | "server" | string;
  serverId?: string;
  serverName?: string;
  installedAt?: string;
  updatedAt?: string;
  lastAction?: string;
};

export type InstallState = {
  version: number;
  gamePath: string;
  updatedAt: string;
  installedMods: Record<string, ManagedModRecord>;
  operations: Array<Record<string, unknown>>;
};

export type ScanResult = {
  gamePath: string;
  modsPath: string;
  exists: boolean;
  mods: LocalMod[];
};

export type ManifestMod = {
  id: string;
  name: string;
  version?: string;
  audience?: "client" | "shared" | "server" | string;
  required?: boolean;
  folderName?: string;
  folderSizeBytes?: number;
  folderSha256?: string;
  source?: {
    type: "zip";
    url: string;
    archiveSizeBytes?: number;
    archiveSha256?: string;
  };
};

export type ServerManifest = {
  manifestVersion: number;
  game: "7dtd";
  server: {
    id: string;
    name: string;
    host?: string;
    port?: number;
    syncUrl?: string;
    eacEnabled?: boolean | null;
    gameVersion?: string;
    steamBuildId?: string;
    gameVersionMap?: Record<string, string>;
  };
  generatedAt?: string;
  mods: ManifestMod[];
};

export type GameVersionInfo = {
  gamePath: string;
  steamAppId: string;
  steamAppManifestPath: string;
  steamBuildId: string;
  steamUpdateState: string;
  steamInstallDir: string;
  canOpenSteamUpdate: boolean;
};

export type GameCompatibility = {
  ok: boolean;
  checked: boolean;
  reason: string;
  local: GameVersionInfo;
  requiredGameVersion?: string;
  requiredSteamBuildId?: string;
  gameVersionMap?: Record<string, string>;
};

export type SyncAction = "ready" | "install" | "update" | "blocked" | "keep";

export type SyncPlanItem = {
  action: SyncAction;
  mod: ManifestMod;
  installed: LocalMod | null;
  reason: string;
};

export type SyncPreview = {
  manifest: ServerManifest;
  local: ScanResult;
  gameCompatibility: GameCompatibility;
  plan: SyncPlanItem[];
  summary: Record<SyncAction, number>;
  installState?: InstallState;
  skippedServerOnly?: SyncPlanItem[];
  managedSummary?: {
    installed: number;
    extra: number;
    serverOnlyInstalled: number;
    operationCount: number;
  };
  downloadBytes: number;
  downloadSizeKnown: boolean;
  installedBytes: number;
  installedSizeKnown: boolean;
};

export type ApplyResult = {
  ok: boolean;
  canceled?: boolean;
  failedCount?: number;
  failures?: Array<{ modName: string; error: string }>;
  backupRoot: string;
  diagnosticLogPath?: string;
  log: string[];
  preview: SyncPreview | null;
};

export type SyncProgress = {
  phase:
    | "preparing"
    | "scanning"
    | "copying"
    | "shortcut"
    | "downloading"
    | "extracting"
    | "backing-up"
    | "installing"
    | "installed"
    | "verifying"
    | "complete"
    | "failed";
  message: string;
  modName?: string;
  modKey?: string;
  current: number;
  total: number;
  percent: number;
  bytesReceived?: number;
  bytesTotal?: number;
};

export type CloneGameResult = {
  ok: boolean;
  sourcePath: string;
  targetPath: string;
  created: boolean;
  shortcutPath: string;
  shortcutError?: string;
};

export type LaunchGameResult = {
  ok: boolean;
  gamePath: string;
  executable: string;
  requestedEac: boolean;
  eacEnabled: boolean;
};

export type DirectoryServer = {
  id: string;
  name: string;
  description?: string;
  host: string;
  gamePort?: number;
  queryPort?: number;
  syncUrl: string;
  recommended?: boolean;
};

export type ServerDirectory = {
  directoryVersion: number;
  brand: string;
  servers: DirectoryServer[];
};

export type ServerHealth = {
  serverId: string;
  ok: boolean;
  status: "online" | "offline";
  gameOk: boolean;
  gameStatus: "online" | "offline" | "unknown";
  gameQueryPort?: number;
  gameError?: string;
  modCount: number;
  blockedServerOnlyCount?: number;
  downloadBytes: number;
  downloadSizeKnown: boolean;
  installedBytes: number;
  installedSizeKnown: boolean;
  generatedAt: string;
  serverName: string;
  eacEnabled: boolean | null;
  gameVersion?: string;
  steamBuildId?: string;
  gameVersionMap?: Record<string, string>;
  error?: string;
};

export type DiskSpace = {
  path: string;
  freeBytes: number;
  totalBytes: number;
};

export type DoctorCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  action?: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
  preview: SyncPreview | null;
};

export type BackupEntry = {
  id: string;
  path: string;
  workRoot: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  itemCount: number;
  legacy?: boolean;
};

export type GdgApi = {
  getInitialState: () => Promise<{ config: LoaderConfig; detected: DetectedGame }>;
  saveConfig: (config: Partial<LoaderConfig>) => Promise<LoaderConfig>;
  detectGame: () => Promise<DetectedGame>;
  selectGameFolder: () => Promise<{ canceled: true } | { canceled: false; path: string; valid: boolean }>;
  selectManifestFile: () => Promise<{ canceled: true } | { canceled: false; path: string }>;
  loadServerDirectory: (input?: string) => Promise<ServerDirectory>;
  checkServerHealth: (server: DirectoryServer) => Promise<ServerHealth>;
  getDiskSpace: (gamePath: string) => Promise<DiskSpace>;
  getGameVersion: (gamePath: string) => Promise<GameVersionInfo>;
  cloneGameInstall: (payload: { sourcePath: string; folderName?: string; createShortcut?: boolean }) => Promise<CloneGameResult>;
  onCloneProgress: (callback: (progress: SyncProgress) => void) => () => void;
  scanMods: (gamePath: string) => Promise<ScanResult>;
  previewSync: (payload: { gamePath: string; manifestInput: string }) => Promise<SyncPreview>;
  applySync: (payload: { gamePath: string; manifestInput: string; repair?: boolean }) => Promise<ApplyResult>;
  cleanLocalMods: (payload: { gamePath: string; manifestInput: string; mode?: "backup" | "delete" }) => Promise<ApplyResult>;
  purgeModsFolder: (payload: { gamePath: string; manifestInput?: string; mode?: "backup" | "delete" }) => Promise<ApplyResult>;
  cleanManagedMods: (payload: { gamePath: string; manifestInput?: string; mode?: "backup" | "delete"; scope?: "all" | "extra" }) => Promise<ApplyResult>;
  resetAndReinstall: (payload: { gamePath: string; manifestInput: string; mode?: "backup" | "delete" }) => Promise<ApplyResult>;
  runDoctor: (payload: { gamePath: string; manifestInput?: string; launchWithEac?: boolean }) => Promise<DoctorResult>;
  listBackups: (gamePath: string) => Promise<{ backups: BackupEntry[] }>;
  restoreBackup: (payload: { gamePath: string; backupPath: string }) => Promise<ApplyResult>;
  deleteBackup: (payload: { gamePath: string; backupPath: string }) => Promise<{ ok: boolean; canceled?: boolean; deleted?: boolean; path: string; sizeBytes?: number }>;
  onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
  onSupportBundleProgress: (callback: (progress: SyncProgress) => void) => () => void;
  onGameCopyDeleted: (callback: (payload: { config: LoaderConfig; detected: DetectedGame; deletedPath: string }) => void) => () => void;
  launchGame: (payload: { gamePath: string; eacEnabled: boolean }) => Promise<LaunchGameResult>;
  openSteamUpdate: () => Promise<{ ok: boolean; target?: "steam" | "web"; error?: string }>;
  openDiagnosticLog: () => Promise<{ ok: boolean; error?: string; path: string }>;
  createSupportBundle: () => Promise<{ ok: boolean; error?: string; path: string; folderPath: string; fileName: string }>;
  copyFileToClipboard: (filePath: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  openPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
};
