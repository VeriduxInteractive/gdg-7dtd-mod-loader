import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("GDG-managed Minecraft bootstrap", () => {
  it("pins the signed CurseForge installer and exact Superior pack identity", async () => {
    const manifest = JSON.parse(await readFile(new URL("../server-directory/minecraft-bootstrap.json", import.meta.url), "utf8"));

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.launcher.name).toBe("CurseForge standalone");
    expect(manifest.launcher.url).toMatch(/^https:\/\/download\.overwolf\.com\/install\/Download\?/);
    expect(manifest.launcher.expectedPublisher).toBe("Overwolf Ltd");
    expect(manifest.launcher.maxSizeBytes).toBeGreaterThanOrEqual(100 * 1024 ** 2);
    expect(manifest.pack.projectId).toBe("1293866");
    expect(manifest.pack.fileId).toBe("8348938");
    expect(manifest.pack.installUri).toBe("curseforge://install?addonId=1293866&fileId=8348938");
    expect(manifest.pack.requiredFileNames).toHaveLength(14);
    expect(manifest.pack.requiredFileNames).toContain("superior-miapi-0.1.0.jar");
    expect(manifest.pack.requiredFileNames).toContain("Frozy's Quest Book.zip");
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
    expect(main).toMatch(/async function findMissingMinecraftPackFiles\s*\(/);
    expect(main).toContain("spawn(launcherPath, [manifest.pack.installUri]");
    expect(main).toContain("await ensureBundledAddons(installed.path, profile)");
    expect(preload).toContain('provisionMinecraft: (payload) => ipcRenderer.invoke("gdg:provision-minecraft"');
    expect(app).toContain("Create CurseForge profile");
    expect(app).toContain("await window.gdg.provisionMinecraft");
  });
});
