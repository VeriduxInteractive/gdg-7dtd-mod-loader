#!/usr/bin/env node

const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const root = path.resolve(process.argv[2] || path.join(os.tmpdir(), "gdg-mod-loader-dev"));
  const serverRoot = path.join(root, "server-7dtd");
  const clientRoot = path.join(root, "client-7dtd");

  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(path.join(serverRoot, "Mods", "GDG-UI", "Config"), { recursive: true });
  await fsp.mkdir(path.join(serverRoot, "Mods", "GDG-Core", "Config"), { recursive: true });
  await fsp.mkdir(path.join(clientRoot, "Mods"), { recursive: true });

  await fsp.writeFile(path.join(serverRoot, "7DaysToDieServer.exe"), "", "utf8");
  await fsp.writeFile(path.join(clientRoot, "7DaysToDie.exe"), "", "utf8");

  await writeModInfo(path.join(serverRoot, "Mods", "GDG-UI"), {
    name: "GDG UI",
    displayName: "GDG UI",
    version: "1.0.0",
    author: "Golden Days Gaming"
  });
  await fsp.writeFile(path.join(serverRoot, "Mods", "GDG-UI", "Config", "windows.xml"), "<configs />\n", "utf8");

  await writeModInfo(path.join(serverRoot, "Mods", "GDG-Core"), {
    name: "GDG Core",
    displayName: "GDG Core",
    version: "9.9.9",
    author: "Golden Days Gaming"
  });
  await fsp.writeFile(path.join(serverRoot, "Mods", "GDG-Core", "Config", "private.xml"), "<private />\n", "utf8");

  console.log(`Created dev fixture: ${root}`);
  console.log(`Server root: ${serverRoot}`);
  console.log(`Client root: ${clientRoot}`);
  console.log("");
  console.log("Publish client-safe mods:");
  console.log(
    `npm run server:dev -- --game-root "${serverRoot}" --out "${path.join(root, "publish")}" --base-url "http://127.0.0.1:8787" --distribution allowlist --client-mods "GDG-UI"`
  );
}

async function writeModInfo(folder, info) {
  const xml = `<xml>
  <Name value="${escapeXml(info.name)}" />
  <DisplayName value="${escapeXml(info.displayName)}" />
  <Version value="${escapeXml(info.version)}" />
  <Author value="${escapeXml(info.author)}" />
</xml>
`;

  await fsp.writeFile(path.join(folder, "ModInfo.xml"), xml, "utf8");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

