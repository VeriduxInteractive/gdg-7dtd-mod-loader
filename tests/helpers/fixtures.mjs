import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createTempFixtureRoot() {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "gdg-mod-loader-test-"));
}

export async function removeTempFixtureRoot(root) {
  if (!root) {
    return;
  }

  assertSafeTempRoot(root);
  await fsp.rm(root, { recursive: true, force: true });
}

export async function createGameRoot(root, name = "game-7dtd", executable = "7DaysToDieServer.exe") {
  const gameRoot = path.join(root, name);
  await fsp.mkdir(path.join(gameRoot, "Mods"), { recursive: true });
  await fsp.writeFile(path.join(gameRoot, executable), "", "utf8");
  return gameRoot;
}

export async function createServerFixture(root, mods) {
  const serverRoot = await createGameRoot(root, "server-7dtd", "7DaysToDieServer.exe");

  for (const [folderName, info] of Object.entries(mods)) {
    await createModFolder(path.join(serverRoot, "Mods"), folderName, info);
  }

  return serverRoot;
}

export async function createModFolder(modsRoot, folderName, info) {
  const modRoot = path.join(modsRoot, folderName);
  await fsp.mkdir(path.join(modRoot, "Config"), { recursive: true });
  await writeModInfo(modRoot, info);
  if (info.fileName) {
    await fsp.writeFile(path.join(modRoot, "Config", info.fileName), info.fileText || "<configs />\n", "utf8");
  }
  return modRoot;
}

export async function writeModInfo(folder, info) {
  const xml = `<xml>
  <Name value="${escapeXml(info.name || path.basename(folder))}" />
  <DisplayName value="${escapeXml(info.displayName || info.name || path.basename(folder))}" />
  <Version value="${escapeXml(info.version || "1.0.0")}" />
  <Author value="${escapeXml(info.author || "Golden Days Gaming")}" />
</xml>
`;
  await fsp.writeFile(path.join(folder, "ModInfo.xml"), xml, "utf8");
}

export async function runPublisher(args) {
  return await execFileAsync(process.execPath, [path.join(process.cwd(), "server", "gdg-sync-server.cjs"), ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 30_000
  });
}

export async function readManifest(outDir) {
  return JSON.parse(await fsp.readFile(path.join(outDir, "manifest.json"), "utf8"));
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assertSafeTempRoot(root) {
  const tempRoot = path.resolve(os.tmpdir()).toLowerCase();
  const resolvedRoot = path.resolve(root).toLowerCase();
  if (resolvedRoot === tempRoot || !resolvedRoot.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside temp: ${root}`);
  }
}
