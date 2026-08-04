import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("GDG-managed Minecraft bootstrap", () => {
  it("pins the signed CurseForge installer and exact Stoneblock 2 pack identity", async () => {
    const manifest = JSON.parse(await readFile(new URL("../server-directory/minecraft-bootstrap.json", import.meta.url), "utf8"));

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.launcher.name).toBe("CurseForge standalone");
    expect(manifest.launcher.url).toMatch(/^https:\/\/download\.overwolf\.com\/install\/Download\?/);
    expect(manifest.launcher.expectedPublisher).toBe("Overwolf Ltd");
    expect(manifest.launcher.maxSizeBytes).toBeGreaterThanOrEqual(100 * 1024 ** 2);
    expect(manifest.pack.projectId).toBe("310396");
    expect(manifest.pack.fileId).toBe("2818169");
    expect(manifest.pack.installUri).toBe("curseforge://install?addonId=310396&fileId=2818169");
    expect(manifest.pack.minimumInstalledAddons).toBeGreaterThanOrEqual(225);
    expect(manifest.pack.minimumModFiles).toBeGreaterThanOrEqual(225);
    expect(manifest.pack.requiredPaths).toContain("scripts");
    expect(manifest.minimumFreeBytes).toBeGreaterThanOrEqual(5 * 1024 ** 3);
  });

  it("installs through CurseForge, verifies restricted files, and finishes the instance", async () => {
    const main = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
    const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

    expect(main).toContain('ipcMain.handle("gdg:provision-minecraft"');
    expect(main).toMatch(/async function provisionMinecraftInstance\s*\(/);
    expect(main).toMatch(/async function ensureCurseForgeRuntime\s*\(/);
    expect(main).toMatch(/async function downloadSignedCurseForgeInstaller\s*\(/);
    expect(main).toMatch(/async function verifyWindowsPublisher\s*\(/);
    expect(main).toContain("Get-AuthenticodeSignature");
    expect(main).toMatch(/async function waitForMatchingCurseForgeInstance\s*\(/);
    expect(main).toMatch(/async function inspectCurseForgeInstanceCompletion\s*\(/);
    expect(main).toMatch(/async function findCurseForgeRuntime\s*\(/);
    expect(main).toMatch(/async function isCurseForgeProtocolRegistered\s*\(/);
    expect(main).toContain("metadata.isValid !== true || metadata.isEnabled !== true");
    expect(main).toContain("if (status !== 4)");
    expect(main).toContain("nextReopenAt = Date.now() + 60_000");
    expect(main).toMatch(/async function findMissingMinecraftPackFiles\s*\(/);
    expect(main).toContain("await openCurseForgeUri(manifest.pack.installUri, runtime)");
    expect(main).toContain("await ensureBundledAddons(installed.path, profile)");
    expect(main).toContain('projectId: "1293866"');
    expect(main).toMatch(/async function discoverPriorGdgMinecraftInstances\s*\(/);
    expect(main).toMatch(/async function choosePriorGdgMinecraftMigration\s*\(/);
    expect(main).toContain("Keep Old & Create Stoneblock");
    expect(main).toContain("Move Old to Recycle Bin & Create Stoneblock");
    expect(main).toContain("await shell.trashItem(instance.path)");
    expect(main).toContain("unrelated Minecraft modpacks are never touched");
    expect(preload).toContain('provisionMinecraft: (payload) => ipcRenderer.invoke("gdg:provision-minecraft"');
    expect(app).toContain("Create CurseForge profile");
    expect(app).toContain("await window.gdg.provisionMinecraft");
  });
});
