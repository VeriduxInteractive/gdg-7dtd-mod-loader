#!/usr/bin/env node

const AdmZip = require("adm-zip");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  hashDirectory,
  hashFile,
  slugify,
  validateManifest
} = require("../shared/gdg-sync-core.cjs");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = path.resolve(args.source || args.plugins || args._[0] || "");
  const gameRoot = path.resolve(args.gameRoot || args["game-root"] || path.join(source, "..", ".."));
  const outDir = path.resolve(args.out || "server-publish/repo");
  const packagesDir = path.join(outDir, "packages");
  const baseUrl = normalizeBaseUrl(args.baseUrl || args["base-url"] || "https://mods.goldendaysgaming.com/repo");
  const serverId = String(args.serverId || args["server-id"] || "golden-days-repo").trim();
  const serverName = String(args.serverName || args["server-name"] || "Golden Days R.E.P.O.").trim();
  const include = new Set(parseList(args.include).map((item) => item.toLowerCase()));
  const exclude = new Set(parseList(args.exclude).map((item) => item.toLowerCase()));

  if (!source || source === path.parse(source).root) {
    throw new Error("Missing --source path to the R.E.P.O. BepInEx/plugins folder.");
  }

  const sourceStats = await fsp.stat(source).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Source folder not found: ${source}`);
  }

  await fsp.rm(packagesDir, { recursive: true, force: true });
  await fsp.mkdir(packagesDir, { recursive: true });

  const entries = (await fsp.readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => include.size === 0 || include.has(entry.name.toLowerCase()))
    .filter((entry) => !exclude.has(entry.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    throw new Error(`No plugin folders found in ${source}`);
  }

  const mods = [];
  const usedArchiveNames = new Set();
  for (const entry of entries) {
    const folderPath = path.join(source, entry.name);
    const archiveName = reserveArchiveName(entry.name, usedArchiveNames);
    const archivePath = path.join(packagesDir, archiveName);
    await zipDirectory(folderPath, archivePath, entry.name);

    const archiveStats = await fsp.stat(archivePath);
    mods.push({
      id: slugify(entry.name),
      name: prettifyName(entry.name),
      version: inferVersion(entry.name),
      audience: "client",
      required: true,
      folderName: entry.name,
      folderSizeBytes: await getDirectorySize(folderPath),
      folderSha256: await hashDirectory(folderPath),
      source: {
        type: "zip",
        url: `${baseUrl}/packages/${encodeURIComponent(archiveName)}`,
        archiveSizeBytes: archiveStats.size,
        archiveSha256: await hashFile(archivePath)
      }
    });
  }

  const manifest = {
    manifestVersion: 1,
    game: "repo",
    server: {
      id: serverId,
      name: serverName,
      syncUrl: `${baseUrl}/manifest.json`
    },
    generatedAt: new Date().toISOString(),
    bootstrap: await publishBootstrapPackage(gameRoot, packagesDir, baseUrl),
    mods
  };

  validateManifest(manifest);
  await fsp.writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fsp.writeFile(
    path.join(outDir, "gdg-sync.json"),
    `${JSON.stringify({ game: "repo", server: manifest.server, manifestUrl: manifest.server.syncUrl }, null, 2)}\n`,
    "utf8"
  );

  console.log(`Published ${mods.length} R.E.P.O. package${mods.length === 1 ? "" : "s"}.`);
  console.log(`Source: ${source}`);
  console.log(`Manifest: ${path.join(outDir, "manifest.json")}`);
  console.log(`Packages: ${packagesDir}`);
  console.log(`Upload the contents of ${outDir} to ${baseUrl}`);
}

async function publishBootstrapPackage(gameRoot, packagesDir, baseUrl) {
  const zipRoot = "repo-bepinex-bootstrap";
  const archiveName = "repo-bepinex-bootstrap.zip";
  const archivePath = path.join(packagesDir, archiveName);
  const paths = [
    "winhttp.dll",
    "doorstop_config.ini",
    ".doorstop_version",
    "BepInEx/core",
    "BepInEx/config/BepInEx.cfg"
  ];
  const requiredPaths = [
    "winhttp.dll",
    "doorstop_config.ini",
    "BepInEx/core/BepInEx.dll"
  ];

  for (const requiredPath of requiredPaths) {
    const fullPath = path.join(gameRoot, requiredPath);
    const stats = await fsp.stat(fullPath).catch(() => null);
    if (!stats) {
      throw new Error(`Missing required R.E.P.O. BepInEx bootstrap path: ${fullPath}`);
    }
  }

  const zip = new AdmZip();
  for (const relativePath of paths) {
    const sourcePath = path.join(gameRoot, relativePath);
    const stats = await fsp.stat(sourcePath).catch(() => null);
    if (!stats) {
      continue;
    }

    const zipPath = `${zipRoot}/${relativePath}`.replace(/\\/g, "/");
    if (stats.isDirectory()) {
      await addDirectoryToZip(zip, sourcePath, zipPath);
    } else if (stats.isFile()) {
      zip.addLocalFile(sourcePath, path.dirname(zipPath));
    }
  }

  await new Promise((resolve, reject) => {
    zip.writeZip(archivePath, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const archiveStats = await fsp.stat(archivePath);
  return {
    id: "repo-bepinex-bootstrap",
    name: "R.E.P.O. BepInEx Bootstrap",
    version: "5.4.21",
    required: true,
    paths,
    requiredPaths,
    source: {
      type: "zip",
      url: `${baseUrl}/packages/${encodeURIComponent(archiveName)}`,
      archiveSizeBytes: archiveStats.size,
      archiveSha256: await hashFile(archivePath)
    }
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }

    const [rawKey, rawValue] = item.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    if (rawValue !== undefined) {
      args[key] = rawValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseList(value) {
  if (!value || value === true) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function reserveArchiveName(folderName, usedArchiveNames) {
  const baseName = slugify(folderName || "repo-plugin") || "repo-plugin";
  let archiveName = `${baseName}.zip`;
  let suffix = 2;

  while (usedArchiveNames.has(archiveName.toLowerCase())) {
    archiveName = `${baseName}-${suffix}.zip`;
    suffix += 1;
  }

  usedArchiveNames.add(archiveName.toLowerCase());
  return archiveName;
}

function prettifyName(folderName) {
  return String(folderName || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+\d+(?:\.\d+){1,3}$/g, "")
    .trim() || folderName;
}

function inferVersion(folderName) {
  return /(?:^|[-_\s])v?(\d+(?:\.\d+){1,3})(?:[-_\s]|$)/i.exec(String(folderName || ""))?.[1] || "0.0.0";
}

async function zipDirectory(sourceDir, archivePath, zipRoot) {
  const zip = new AdmZip();
  await addDirectoryToZip(zip, sourceDir, zipRoot);
  await new Promise((resolve, reject) => {
    zip.writeZip(archivePath, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
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
