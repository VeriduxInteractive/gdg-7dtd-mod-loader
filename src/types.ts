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
  folderSha256?: string;
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
  };
  generatedAt?: string;
  mods: ManifestMod[];
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
  plan: SyncPlanItem[];
  summary: Record<SyncAction, number>;
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
  log: string[];
  preview: SyncPreview;
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
  modCount: number;
  downloadBytes: number;
  downloadSizeKnown: boolean;
  installedBytes: number;
  installedSizeKnown: boolean;
  generatedAt: string;
  serverName: string;
  eacEnabled: boolean | null;
  error?: string;
};

export type DiskSpace = {
  path: string;
  freeBytes: number;
  totalBytes: number;
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
  cloneGameInstall: (payload: { sourcePath: string; folderName?: string; createShortcut?: boolean }) => Promise<CloneGameResult>;
  onCloneProgress: (callback: (progress: SyncProgress) => void) => () => void;
  scanMods: (gamePath: string) => Promise<ScanResult>;
  previewSync: (payload: { gamePath: string; manifestInput: string }) => Promise<SyncPreview>;
  applySync: (payload: { gamePath: string; manifestInput: string }) => Promise<ApplyResult>;
  cleanLocalMods: (payload: { gamePath: string; manifestInput: string; mode?: "backup" | "delete" }) => Promise<ApplyResult>;
  onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
  onGameCopyDeleted: (callback: (payload: { config: LoaderConfig; detected: DetectedGame; deletedPath: string }) => void) => () => void;
  launchGame: (payload: { gamePath: string; eacEnabled: boolean }) => Promise<LaunchGameResult>;
  openPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
};
