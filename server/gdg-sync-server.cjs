#!/usr/bin/env node

const AdmZip = require("adm-zip");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  createManifest,
  exists,
  hashDirectory,
  hashFile,
  parseModInfo,
  scanSevenDaysMods,
  slugify,
  validateManifest
} = require("../shared/gdg-sync-core.cjs");

const DEFAULT_EXCLUDES = ["GDGSyncClient", "GDGSyncServer"];
const DEFAULT_GAME_VERSION_MAP = {
  "22422060": "2.6",
  "21600838": "2.5",
  "20371853": "2.4",
  "19878666": "2.3",
  "19002040": "2.0",
  "17989995": "1.4",
  "12966449": "Alpha 21.2",
  "10740005": "Alpha 20.7",
  "7108523": "Alpha 19.6",
  "4714807": "Alpha 18.4",
  "3851784": "Alpha 17.4",
  "2222519": "Alpha 16.4",
  "1642896": "Alpha 15.2",
  "1192732": "Alpha 14.7",
  "963560": "Alpha 13.8",
  "745244": "Alpha 12.5",
  "659274": "Alpha 11.6",
  "480999": "Alpha 10.4",
  "386759": "Alpha 9.3",
  "333572": "Alpha 8.8"
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";

  if (command === "help" || args.help) {
    printHelp();
    return;
  }

  if (command === "publish") {
    const result = await publish(args);
    printPublishResult(result);
    return;
  }

  if (command === "serve") {
    const manifestPath = await resolveManifestForServe(args);
    await serve({ ...args, manifestPath });
    return;
  }

  if (command === "publish-and-serve") {
    const result = await publish(args);
    printPublishResult(result);
    void startAutoRepublish(args);
    await serve({ ...args, manifestPath: result.manifestPath });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function publish(args) {
  const gameRoot = resolveRequiredPath(args.gameRoot || args["game-root"], "Missing --game-root");
  const modsPath = path.resolve(args.modsPath || args["mods-path"] || path.join(gameRoot, "Mods"));
  const outDir = path.resolve(args.out || "server-publish");
  const packagesDir = path.join(outDir, "packages");
  const baseUrl = normalizeBaseUrl(args.baseUrl || args["base-url"] || "http://127.0.0.1:8787");
  const excludes = parseList(args.exclude || args.excludes || DEFAULT_EXCLUDES.join(","));
  const policy = await loadDistributionPolicy(args);

  if (!(await exists(modsPath))) {
    throw new Error(`Mods folder not found: ${modsPath}`);
  }

  await fsp.rm(packagesDir, { recursive: true, force: true });
  await fsp.mkdir(packagesDir, { recursive: true });

  const scan = await scanSevenDaysMods(gameRoot, {
    modsPath,
    hash: true,
    excludeFolders: excludes
  });

  const mods = [];
  const usedArchiveNames = new Set();
  const publishableMods = filterPublishableMods(scan.mods, policy);
  const externalClientMods = await loadExternalClientMods(policy.extraClientMods);
  const externalClientPackages = await resolveExternalClientPackages(policy.extraClientPackages);
  const serverConfig = await readSevenDaysServerConfig(gameRoot);
  const gameVersionMap = await loadGameVersionMap(args);
  const steamBuildId = String(args.steamBuildId || args["steam-build-id"] || "").trim();
  const gameVersion = String(args.gameVersion || args["game-version"] || gameVersionMap[steamBuildId] || "").trim();

  for (const localMod of publishableMods) {
    mods.push(await packageLocalMod(localMod, { packagesDir, baseUrl, usedArchiveNames }));
  }

  for (const localMod of externalClientMods) {
    mods.push(await packageLocalMod(localMod, { packagesDir, baseUrl, usedArchiveNames }));
  }

  for (const externalPackage of externalClientPackages) {
    mods.push(createExternalClientPackageManifest(externalPackage));
  }

  const manifest = createManifest({
    server: {
      id: args.serverId || args["server-id"] || "golden-days-gaming",
      name: args.serverName || args["server-name"] || "Golden Days Gaming",
      host: args.publicHost || args["public-host"] || "",
      port: Number(args.gamePort || args["game-port"] || 26900),
      syncUrl: `${baseUrl}/gdg-sync/manifest.json`,
      eacEnabled: resolveOptionalBoolean(args.eac !== undefined ? args.eac : args["eac-enabled"], serverConfig.eacEnabled),
      gameVersion,
      steamBuildId,
      gameVersionMap
    },
    mods
  });

  validateManifest(manifest);

  const manifestPath = path.join(outDir, "manifest.json");
  const discoveryPath = path.join(outDir, "gdg-sync.json");
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fsp.writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        game: "7dtd",
        server: manifest.server,
        manifestUrl: manifest.server.syncUrl
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    outDir,
    manifestPath,
    discoveryPath,
    packagesDir,
    modCount: mods.length,
    totalPackageBytes: mods.reduce((total, mod) => total + Number(mod.source?.archiveSizeBytes || 0), 0),
    skippedCount: scan.mods.length - publishableMods.length,
    externalClientCount: externalClientMods.length,
    externalPackageCount: externalClientPackages.length,
    eacEnabled: manifest.server.eacEnabled,
    gameVersion: manifest.server.gameVersion,
    steamBuildId: manifest.server.steamBuildId,
    knownGameVersionCount: Object.keys(manifest.server.gameVersionMap || {}).length,
    policy,
    baseUrl
  };
}

async function startAutoRepublish(args) {
  if (!isAutoRepublishEnabled(args)) {
    return;
  }

  const intervalSeconds = Math.max(15, Number(args.watchInterval || args["watch-interval"] || 120));
  let lastSignature = await getPublishInputSignature(args).catch((error) => {
    console.warn(`Auto-republish could not read initial signature: ${error.message}`);
    return "";
  });
  let publishing = false;

  console.log(`Auto-republish enabled; checking for server mod changes every ${intervalSeconds}s.`);

  setInterval(async () => {
    if (publishing) {
      return;
    }

    publishing = true;
    try {
      const nextSignature = await getPublishInputSignature(args);
      if (nextSignature && nextSignature !== lastSignature) {
        console.log(`[${new Date().toISOString()}] Server files changed; rebuilding GDG sync manifest.`);
        const result = await publish(args);
        printPublishResult(result);
        lastSignature = await getPublishInputSignature(args);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Auto-republish failed: ${error.message}`);
    } finally {
      publishing = false;
    }
  }, intervalSeconds * 1000);
}

function isAutoRepublishEnabled(args) {
  return Boolean(
    args.watch ||
    args["watch"] ||
    args.autoRepublish ||
    args["auto-republish"]
  );
}

async function getPublishInputSignature(args) {
  const gameRoot = resolveRequiredPath(args.gameRoot || args["game-root"], "Missing --game-root");
  const modsPath = path.resolve(args.modsPath || args["mods-path"] || path.join(gameRoot, "Mods"));
  const policyPath = args.policy || args["policy"];
  const configCandidates = [
    path.join(gameRoot, "serverconfig.xml"),
    path.join(gameRoot, "serverconfigfull.xml")
  ];
  const records = [];

  await collectFileSignatureRecords(modsPath, modsPath, records);

  for (const configPath of configCandidates) {
    if (await exists(configPath)) {
      await addFileSignatureRecord(path.dirname(configPath), configPath, records);
    }
  }

  if (policyPath) {
    const resolvedPolicyPath = path.resolve(policyPath);
    if (await exists(resolvedPolicyPath)) {
      await addFileSignatureRecord(path.dirname(resolvedPolicyPath), resolvedPolicyPath, records);
    }
  }

  records.sort();
  return hashText(records.join("\n"));
}

async function collectFileSignatureRecords(root, current, records) {
  if (!(await exists(current))) {
    return;
  }

  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFileSignatureRecords(root, fullPath, records);
    } else if (entry.isFile()) {
      await addFileSignatureRecord(root, fullPath, records);
    }
  }
}

async function addFileSignatureRecord(root, filePath, records) {
  const stats = await fsp.stat(filePath);
  records.push(`${path.relative(root, filePath).replace(/\\/g, "/")}|${stats.size}|${Math.trunc(stats.mtimeMs)}`);
}

function hashText(value) {
  return require("node:crypto").createHash("sha256").update(value).digest("hex");
}

async function packageLocalMod(localMod, context) {
  const archiveName = reserveArchiveName(localMod.folderName, context.usedArchiveNames);
  const archivePath = path.join(context.packagesDir, archiveName);

  await zipDirectory(localMod.folderPath, archivePath, localMod.folderName);
  const archiveStats = await fsp.stat(archivePath);
  const archiveSha256 = await hashFile(archivePath);
  const folderSizeBytes = await getDirectorySize(localMod.folderPath);

  return {
    id: slugify(localMod.name || localMod.folderName),
    name: localMod.displayName || localMod.name || localMod.folderName,
    version: localMod.version || "0.0.0",
    required: true,
    folderName: localMod.folderName,
    folderSizeBytes,
    folderSha256: localMod.folderSha256,
    source: {
      type: "zip",
      url: `${context.baseUrl}/packages/${encodeURIComponent(archiveName)}`,
      archiveSizeBytes: archiveStats.size,
      archiveSha256
    }
  };
}

function reserveArchiveName(folderName, usedArchiveNames) {
  const baseName = slugify(folderName || "mod") || "mod";
  let archiveName = `${baseName}.zip`;
  let suffix = 2;

  while (usedArchiveNames.has(archiveName.toLowerCase())) {
    archiveName = `${baseName}-${suffix}.zip`;
    suffix += 1;
  }

  usedArchiveNames.add(archiveName.toLowerCase());
  return archiveName;
}

function createExternalClientPackageManifest(packageConfig) {
  const url = String(packageConfig.url || "").trim();
  const folderName = String(packageConfig.folderName || packageConfig.id || packageConfig.name || "").trim();

  if (!url) {
    throw new Error("External client package is missing url.");
  }

  if (!folderName) {
    throw new Error(`External client package is missing folderName: ${url}`);
  }

  return {
    id: slugify(packageConfig.id || folderName),
    name: packageConfig.name || folderName,
    version: packageConfig.version || "0.0.0",
    required: packageConfig.required !== false,
    folderName,
    folderSizeBytes: Number(packageConfig.folderSizeBytes || packageConfig.archiveSizeBytes || 0),
    ...(packageConfig.folderSha256 ? { folderSha256: normalizeSha256(packageConfig.folderSha256) } : {}),
    source: {
      type: "zip",
      url,
      archiveSizeBytes: Number(packageConfig.archiveSizeBytes || 0),
      ...(packageConfig.archiveSha256 || packageConfig.sha256 || packageConfig.digest
        ? { archiveSha256: normalizeSha256(packageConfig.archiveSha256 || packageConfig.sha256 || packageConfig.digest) }
        : {})
    }
  };
}

async function resolveExternalClientPackages(packages) {
  const resolved = [];

  for (const packageConfig of packages || []) {
    if (packageConfig.githubRepo) {
      resolved.push(await resolveGitHubReleasePackage(packageConfig));
    } else {
      resolved.push(packageConfig);
    }
  }

  return resolved;
}

async function loadGameVersionMap(args) {
  const input = args.gameVersionMap || args["game-version-map"];
  if (!input) {
    return { ...DEFAULT_GAME_VERSION_MAP };
  }

  if (String(input).trim().toLowerCase() === "none") {
    return {};
  }

  const trimmed = String(input).trim();
  const parsed = trimmed.startsWith("{")
    ? JSON.parse(trimmed)
    : JSON.parse(await fsp.readFile(path.resolve(trimmed), "utf8"));

  return normalizeGameVersionMap(parsed);
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

async function resolveGitHubReleasePackage(packageConfig) {
  const repo = String(packageConfig.githubRepo || "").trim();
  const release = String(packageConfig.release || "latest").trim();
  const assetName = String(packageConfig.assetName || "").trim();

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repo for external client package: ${repo}`);
  }

  if (!assetName) {
    throw new Error(`GitHub external client package is missing assetName for ${repo}.`);
  }

  const releaseUrl =
    release === "latest"
      ? `https://api.github.com/repos/${repo}/releases/latest`
      : `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(release)}`;
  const releaseData = await fetchJson(releaseUrl, { "User-Agent": "GDG-Sync-Server" });
  const asset = (releaseData.assets || []).find((item) => item.name === assetName);
  if (!asset) {
    throw new Error(`Release asset ${assetName} was not found in ${repo}@${releaseData.tag_name || release}.`);
  }

  const version = packageConfig.version || normalizeReleaseVersion(releaseData.tag_name || releaseData.name || release);
  const archiveSha256 = packageConfig.archiveSha256 || packageConfig.sha256 || packageConfig.digest || asset.digest || "";

  return {
    ...packageConfig,
    version,
    url: asset.browser_download_url,
    archiveSizeBytes: Number(packageConfig.archiveSizeBytes || asset.size || 0),
    ...(archiveSha256 ? { archiveSha256 } : {})
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.json();
}

function normalizeReleaseVersion(value) {
  return String(value || "0.0.0").trim().replace(/^v/i, "") || "0.0.0";
}

async function serve(args) {
  const port = Number(args.port || 8787);
  const host = args.host || "0.0.0.0";
  const manifestPath = path.resolve(args.manifestPath || args["manifest-path"]);
  const outDir = path.dirname(manifestPath);
  const packagesDir = path.join(outDir, "packages");

  if (!(await exists(manifestPath))) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }

      if (pathname === "/" || pathname === "/gdg-sync" || pathname === "/gdg-sync/manifest.json" || pathname === "/manifest.json") {
        await sendFile(response, manifestPath, "application/json", request.method === "HEAD");
        return;
      }

      if (pathname === "/gdg-sync.json") {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
        sendJson(response, 200, {
          game: "7dtd",
          server: manifest.server,
          manifestUrl: manifest.server.syncUrl || "/gdg-sync/manifest.json"
        });
        return;
      }

      if (pathname.startsWith("/packages/")) {
        const fileName = path.basename(pathname);
        const packagePath = path.join(packagesDir, fileName);
        await sendFile(response, packagePath, "application/zip", request.method === "HEAD");
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));

  console.log(`GDG sync server listening on http://${host}:${port}`);
  console.log(`Manifest: ${pathToFileURL(manifestPath).href}`);
}

async function resolveManifestForServe(args) {
  const manifestPath = args.manifestPath || args["manifest-path"];
  if (manifestPath) {
    return manifestPath;
  }

  const outDir = path.resolve(args.out || "server-publish");
  return path.join(outDir, "manifest.json");
}

async function zipDirectory(sourceDir, archivePath, rootFolderName) {
  const zip = new AdmZip();
  await addDirectoryToZip(zip, sourceDir, rootFolderName || path.basename(sourceDir));
  zip.writeZip(archivePath);
}

async function addDirectoryToZip(zip, sourceDir, zipRoot) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const zipPath = `${zipRoot}/${entry.name}`.replace(/\\/g, "/");

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, sourcePath, zipPath);
    } else if (entry.isFile()) {
      zip.addLocalFile(sourcePath, path.dirname(zipPath));
    }
  }
}

async function getDirectorySize(sourceDir) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(sourcePath);
    } else if (entry.isFile()) {
      total += (await fsp.stat(sourcePath)).size;
    }
  }

  return total;
}

async function readSevenDaysServerConfig(gameRoot) {
  const candidates = [
    path.join(gameRoot, "serverconfig.xml"),
    path.join(gameRoot, "serverconfigfull.xml")
  ];

  for (const configPath of candidates) {
    if (!(await exists(configPath))) {
      continue;
    }

    const xml = await fsp.readFile(configPath, "utf8");
    return {
      configPath,
      eacEnabled: getXmlPropertyBoolean(xml, "EACEnabled")
    };
  }

  return {
    configPath: "",
    eacEnabled: null
  };
}

async function loadExternalClientMods(paths) {
  const mods = [];

  for (const sourcePath of paths || []) {
    const folderPath = path.resolve(sourcePath);
    const modInfoPath = path.join(folderPath, "ModInfo.xml");
    if (!(await exists(modInfoPath))) {
      throw new Error(`External client mod must point at a mod folder with ModInfo.xml: ${folderPath}`);
    }

    const xml = await fsp.readFile(modInfoPath, "utf8");
    const info = parseModInfo(xml);
    mods.push({
      folderName: path.basename(folderPath),
      folderPath,
      name: info.name || path.basename(folderPath),
      displayName: info.displayName || info.name || path.basename(folderPath),
      author: info.author || "",
      version: info.version || "",
      description: info.description || "",
      folderSha256: await hashDirectory(folderPath)
    });
  }

  mods.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return mods;
}

function getXmlPropertyBoolean(xml, propertyName) {
  const propertyPattern = new RegExp(`<property\\s+[^>]*name=["']${escapeRegExp(propertyName)}["'][^>]*>`, "i");
  const property = propertyPattern.exec(xml);
  if (!property) {
    return null;
  }

  const value = /value=["']([^"']+)["']/i.exec(property[0])?.[1];
  return resolveOptionalBoolean(value, null);
}

async function sendFile(response, filePath, contentType, headOnly) {
  if (!(await exists(filePath))) {
    sendJson(response, 404, { error: "File not found" });
    return;
  }

  const stat = await fsp.stat(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "no-cache"
  });

  if (!headOnly) {
    response.end(await fsp.readFile(filePath));
  } else {
    response.end();
  }
}

function sendJson(response, status, body) {
  const json = `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-cache"
  });
  response.end(json);
}

function resolveRequiredPath(value, errorMessage) {
  if (!value) {
    throw new Error(errorMessage);
  }

  return path.resolve(value);
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePathList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseObjectList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }

  if (!value || typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function resolveOptionalBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadDistributionPolicy(args) {
  const policyPath = args.policy || args["policy"];
  const filePolicy = policyPath ? JSON.parse(await fsp.readFile(path.resolve(policyPath), "utf8")) : {};
  const clientMods = [
    ...parseList(filePolicy.clientMods || ""),
    ...parseList(args.clientMods || args["client-mods"] || "")
  ];
  const serverOnlyMods = [
    ...parseList(filePolicy.serverOnlyMods || ""),
    ...parseList(args.privateMods || args["private-mods"] || ""),
    ...parseList(args.serverOnlyMods || args["server-only-mods"] || "")
  ];
  const serverOnlyPrefixes = [
    ...parseList(filePolicy.serverOnlyPrefixes || filePolicy.privatePrefixes || ""),
    ...parseList(args.privatePrefixes || args["private-prefixes"] || ""),
    ...parseList(args.serverOnlyPrefixes || args["server-only-prefixes"] || "")
  ];
  const extraClientMods = [
    ...parsePathList(filePolicy.extraClientMods || filePolicy.extraClientModPaths || ""),
    ...parsePathList(args.extraClientMods || args["extra-client-mods"] || ""),
    ...parsePathList(args.extraClientModPaths || args["extra-client-mod-paths"] || "")
  ];
  const extraClientPackages = [
    ...parseObjectList(filePolicy.extraClientPackages || []),
    ...parseObjectList(args.extraClientPackages || args["extra-client-packages"] || [])
  ];
  const mode =
    args.distribution ||
    args["distribution"] ||
    filePolicy.distribution ||
    (clientMods.length > 0 ? "allowlist" : "all-except-private");

  if (!["allowlist", "all-except-private"].includes(mode)) {
    throw new Error('Distribution must be "allowlist" or "all-except-private".');
  }

  return {
    distribution: mode,
    clientMods: dedupe(clientMods),
    serverOnlyMods: dedupe(serverOnlyMods),
    serverOnlyPrefixes: dedupe(serverOnlyPrefixes),
    extraClientMods: dedupe(extraClientMods),
    extraClientPackages: dedupeObjects(extraClientPackages, (item) => item.url || item.folderName || item.name)
  };
}

function filterPublishableMods(mods, policy) {
  const allowlist = new Set(policy.clientMods.map(normalizeModKey));
  const blocklist = new Set(policy.serverOnlyMods.map(normalizeModKey));
  const blockPrefixes = policy.serverOnlyPrefixes.map(normalizeModKey).filter(Boolean);

  return mods.filter((mod) => {
    if (modMatches(mod, blocklist) || modMatchesPrefix(mod, blockPrefixes)) {
      return false;
    }

    if (policy.distribution === "allowlist") {
      return modMatches(mod, allowlist);
    }

    return true;
  });
}

function modMatches(mod, keys) {
  const candidates = [mod.folderName, mod.name, mod.displayName, slugify(mod.folderName), slugify(mod.name)];
  return candidates.some((candidate) => keys.has(normalizeModKey(candidate)));
}

function modMatchesPrefix(mod, prefixes) {
  const candidates = [mod.folderName, mod.name, mod.displayName, slugify(mod.folderName), slugify(mod.name)]
    .map(normalizeModKey)
    .filter(Boolean);
  return candidates.some((candidate) => prefixes.some((prefix) => candidate.startsWith(prefix)));
}

function normalizeModKey(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeObjects(values, getKey) {
  const byKey = new Map();
  for (const value of values || []) {
    const key = String(getKey(value) || "").trim().toLowerCase();
    if (key && !byKey.has(key)) {
      byKey.set(key, value);
    }
  }
  return [...byKey.values()];
}

function normalizeSha256(value) {
  return String(value || "").trim().replace(/^sha256:/i, "").toLowerCase();
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      args[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      args[rawKey] = true;
      continue;
    }

    args[key] = next;
    args[rawKey] = next;
    index += 1;
  }

  return args;
}

function printPublishResult(result) {
  console.log(`Published ${result.modCount} mods`);
  console.log(`Package size: ${formatBytes(result.totalPackageBytes)}`);
  console.log(`Server EAC: ${typeof result.eacEnabled === "boolean" ? (result.eacEnabled ? "on" : "off") : "unknown"}`);
  console.log(`Required game version: ${result.gameVersion || "not set"}`);
  console.log(`Required Steam build: ${result.steamBuildId || "not set"}`);
  console.log(`Known game versions: ${result.knownGameVersionCount}`);
  console.log(`Skipped ${result.skippedCount} server-only/private mods`);
  console.log(`Extra client-only mods: ${result.externalClientCount}`);
  console.log(`Extra client-only packages: ${result.externalPackageCount}`);
  console.log(`Distribution: ${result.policy.distribution}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Discovery: ${result.discoveryPath}`);
  console.log(`Packages: ${result.packagesDir}`);
  console.log(`Base URL: ${result.baseUrl}`);
}

function formatBytes(bytes) {
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

function printHelp() {
  console.log(`GDG Sync Server

Commands:
  publish            Scan Mods, package zips, and write manifest files
  serve              Serve an existing published manifest and packages
  publish-and-serve  Publish, then start the local sync endpoint

Common options:
  --game-root <path>       7 Days to Die server root
  --mods-path <path>       Optional explicit Mods folder
  --out <path>             Publish output folder, default server-publish
  --base-url <url>         Public URL clients use, default http://127.0.0.1:8787
  --server-id <id>         Stable server id
  --server-name <name>     Friendly server name
  --public-host <host>     Game server host shown to clients
  --game-port <port>       7DTD game port, default 26900
  --game-version <version> Human-readable required game version shown to players, e.g. 2.6 Stable
  --steam-build-id <id>    Required Steam client build id from appmanifest_251570.acf
  --game-version-map <json|path|none> Build id to friendly version map, defaults to known SteamDB 7DTD branches
  --port <port>            HTTP sync endpoint port, default 8787
  --host <host>            HTTP bind host, default 0.0.0.0
  --exclude <csv>          Mod folders not published, default GDGSyncClient,GDGSyncServer
  --policy <path>          JSON distribution policy
  --distribution <mode>    allowlist or all-except-private
  --client-mods <csv>      Client-safe folders to publish in allowlist mode
  --private-mods <csv>     Server-only folders never published
  --private-prefixes <csv> Server-only folder/name prefixes never published
  --extra-client-mods <paths> Semicolon- or comma-separated client-only mod folders to publish
  --extra-client-packages <json> JSON array of already-hosted client zip package metadata
  --watch                 Rebuild published manifest/packages when server files change
  --watch-interval <sec>  Auto-republish check interval, default 120

Examples:
  npm run server:publish -- --game-root "D:\\7dtd-server" --base-url "https://mods.goldendaysgaming.com"
  npm run server:publish -- --game-root "D:\\7dtd-server" --distribution allowlist --client-mods "GDG-UI,GDG-Icons"
  npm run server:serve -- --out "server-publish" --port 8787
`);
}

module.exports = {
  loadDistributionPolicy,
  parseArgs,
  publish,
  serve
};
