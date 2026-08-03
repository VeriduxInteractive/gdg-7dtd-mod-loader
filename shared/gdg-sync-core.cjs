const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const GAME_ID = "7dtd";
const SUPPORTED_GAME_IDS = new Set(["7dtd", "repo", "minecraft"]);
const MANIFEST_VERSION = 1;
const CLIENT_BLOCKED_SERVER_ONLY_MOD_NAMES = new Set([
  "allocs_commandextensions",
  "allocs-commandextensions",
  "allocs-command-extensions",
  "allocs command extensions",
  "allocs_webandmaprendering",
  "allocs-webandmaprendering",
  "allocs-web-and-map-rendering",
  "allocs maprendering and webinterface",
  "allocs_commonfunc",
  "allocs-commonfunc",
  "allocs-common-func",
  "allocs server fixes"
]);
const CLIENT_BLOCKED_SERVER_ONLY_MOD_PREFIXES = ["allocs_", "allocs-", "allocs "];
const CLIENT_INSTALLABLE_AUDIENCES = new Set(["client", "shared"]);

async function scanSevenDaysMods(gameRoot, options = {}) {
  const modsPath = options.modsPath || path.join(gameRoot, "Mods");

  if (!(await exists(modsPath))) {
    return {
      gamePath: gameRoot,
      modsPath,
      exists: false,
      mods: []
    };
  }

  const entries = await fsp.readdir(modsPath, { withFileTypes: true });
  const mods = [];
  const excludes = new Set((options.excludeFolders || []).map((name) => name.toLowerCase()));

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || excludes.has(entry.name.toLowerCase())) {
      continue;
    }

    const folderPath = path.join(modsPath, entry.name);
    const modInfoPath = path.join(folderPath, "ModInfo.xml");
    if (!(await exists(modInfoPath))) {
      continue;
    }

    const xml = await fsp.readFile(modInfoPath, "utf8");
    const info = parseModInfo(xml);
    const mod = {
      folderName: entry.name,
      folderPath,
      name: info.name || entry.name,
      displayName: info.displayName || info.name || entry.name,
      author: info.author || "",
      version: info.version || "",
      description: info.description || ""
    };

    if (options.hash) {
      mod.folderSha256 = await hashDirectory(folderPath);
    }

    mods.push(mod);
  }

  mods.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    gamePath: gameRoot,
    modsPath,
    exists: true,
    mods
  };
}

function createManifest({ server, mods }) {
  return {
    manifestVersion: MANIFEST_VERSION,
    game: GAME_ID,
    server,
    generatedAt: new Date().toISOString(),
    mods
  };
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

function isClientBlockedServerOnlyMod(mod) {
  const candidates = getModKeyCandidates(mod);
  return candidates.some((candidate) => {
    const normalized = normalizeModKey(candidate);
    return CLIENT_BLOCKED_SERVER_ONLY_MOD_NAMES.has(normalized) ||
      CLIENT_BLOCKED_SERVER_ONLY_MOD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

function isClientInstallableManifestMod(mod) {
  return CLIENT_INSTALLABLE_AUDIENCES.has(getModAudience(mod)) && !isClientBlockedServerOnlyMod(mod);
}

function getClientBlockedReason(mod) {
  const audience = getModAudience(mod);
  if (!CLIENT_INSTALLABLE_AUDIENCES.has(audience)) {
    return "Server-only mod was published in the client manifest; GDG will not install it";
  }

  if (isClientBlockedServerOnlyMod(mod)) {
    return "Known server-only mod was published by mistake; GDG will not install it on clients";
  }

  return "";
}

function getModAudience(mod) {
  if (mod?.serverOnly === true || mod?.client === false || mod?.clientSide === false) {
    return "server";
  }

  const audience =
    normalizeAudience(mod?.audience) ||
    normalizeAudience(mod?.side) ||
    normalizeAudience(mod?.distribution) ||
    normalizeAudience(mod?.target);

  if (audience) {
    return audience;
  }

  return "client";
}

function normalizeAudience(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["client", "clients", "client-only", "client-side"].includes(normalized)) {
    return "client";
  }

  if (["shared", "both", "common", "client-server", "server-client"].includes(normalized)) {
    return "shared";
  }

  if (["server", "server-only", "server-side", "dedicated-server", "private"].includes(normalized)) {
    return "server";
  }

  return "";
}

function getManifestClientMods(manifest) {
  return (manifest?.mods || []).filter(isClientInstallableManifestMod);
}

function getModKeyCandidates(mod) {
  return [
    mod?.id,
    mod?.folderName,
    mod?.name,
    mod?.displayName,
    slugify(mod?.id),
    slugify(mod?.folderName),
    slugify(mod?.name),
    slugify(mod?.displayName)
  ].filter(Boolean);
}

function normalizeModKey(value) {
  return String(value || "").trim().toLowerCase();
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

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a JSON object.");
  }

  if (!SUPPORTED_GAME_IDS.has(manifest.game)) {
    throw new Error(`Manifest game must be one of: ${[...SUPPORTED_GAME_IDS].join(", ")}.`);
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

function slugify(value) {
  return String(value || "mod")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  GAME_ID,
  SUPPORTED_GAME_IDS,
  MANIFEST_VERSION,
  buildSyncPlan,
  createManifest,
  exists,
  hashDirectory,
  hashFile,
  getClientBlockedReason,
  getManifestClientMods,
  getModAudience,
  isClientBlockedServerOnlyMod,
  isClientInstallableManifestMod,
  parseModInfo,
  scanSevenDaysMods,
  slugify,
  summarizePlan,
  validateManifest
};
