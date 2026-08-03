import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

describe("GDG Minecraft Quick Join addon", () => {
  it("builds a client-only Forge addon with the required metadata", async () => {
    const jarPath = fileURLToPath(new URL("../server-directory/addons/GDG-Quick-Join.jar", import.meta.url));
    const zip = new AdmZip(jarPath);
    const modsToml = zip.readAsText("META-INF/mods.toml");

    expect(modsToml).toContain('modId="gdgquickjoin"');
    expect(modsToml).toContain('version="0.1.0"');
    expect(modsToml).toContain('side="CLIENT"');
    expect(zip.getEntry("com/goldendaysgaming/minecraft/GdgQuickJoin.class")).toBeTruthy();
  });

  it("uses Minecraft status pings and direct connection from the title screen", async () => {
    const source = await readFile(
      new URL("../minecraft-client/src/main/java/com/goldendaysgaming/minecraft/GdgQuickJoin.java", import.meta.url),
      "utf8"
    );

    expect(source).toContain("ScreenEvent.Init.Post");
    expect(source).toContain("ServerStatusPinger");
    expect(source).toContain("ConnectScreen.startConnecting");
    expect(source).toContain('"goldendays.mcsh.io:25565"');
    expect(source).toContain('resolve("gdg-quick-join.json")');
  });
});
