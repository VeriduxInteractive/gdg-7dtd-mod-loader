import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

describe("GDG Minecraft Quick Join addon", () => {
  it("builds a client-only Forge 1.12.2 addon with the required metadata", async () => {
    const jarPath = fileURLToPath(new URL("../server-directory/addons/GDG-Quick-Join.jar", import.meta.url));
    const zip = new AdmZip(jarPath);
    const metadata = zip.readAsText("mcmod.info");
    const packMetadata = JSON.parse(zip.readAsText("pack.mcmeta"));

    expect(metadata).toContain('"modid": "gdgquickjoin"');
    expect(metadata).toContain('"version": "0.2.1"');
    expect(metadata).toContain('"mcversion": "1.12.2"');
    expect(packMetadata.pack.pack_format).toBe(3);
    expect(zip.getEntry("META-INF/mods.toml")).toBeNull();
    expect(zip.getEntry("com/goldendaysgaming/minecraft/GdgQuickJoin.class")).toBeTruthy();
  });

  it("uses asynchronous protocol status pings and direct connection from the title screen", async () => {
    const source = await readFile(
      new URL("../minecraft-client/src/main/java/com/goldendaysgaming/minecraft/GdgQuickJoin.java", import.meta.url),
      "utf8"
    );

    expect(source).toContain("GuiScreenEvent.InitGuiEvent.Post");
    expect(source).toContain("ProtocolStatusPinger");
    expect(source).toContain("MINECRAFT_1_12_2_PROTOCOL = 340");
    expect(source).toContain("thread.setDaemon(true)");
    expect(source).toContain("new GuiConnecting(parent, minecraft, row.data)");
    expect(source).not.toContain("FMLClientHandler.instance().connectToServer");
    expect(source).toContain('acceptedMinecraftVersions = "[1.12.2]"');
    expect(source).toContain('acceptableRemoteVersions = "*"');
    expect(source).toContain("clientSideOnly = true");
    expect(source).toContain('"lumien.custommainmenu.gui.GuiCustom"');
    expect(source).toContain('"goldendays.mcsh.io:25565"');
    expect(source).toContain('resolve("gdg-quick-join.json")');
    expect(source).toContain('attachTo(current, buttonList, "client tick fallback")');
    expect(source).toContain("activePanel.ensureButtons(buttonList)");
    expect(source).toContain('ObfuscationReflectionHelper.findField');
    expect(source).toContain("CUSTOM_MENU_RIGHT_RAIL_WIDTH = 42");
  });
});
