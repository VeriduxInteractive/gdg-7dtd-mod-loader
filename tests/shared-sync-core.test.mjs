import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildSyncPlan,
  getClientBlockedReason,
  getManifestClientMods,
  getModAudience,
  isClientBlockedServerOnlyMod,
  isClientInstallableManifestMod,
  summarizePlan,
  validateManifest
} = require("../shared/gdg-sync-core.cjs");

describe("shared sync policy", () => {
  it("accepts Minecraft manifests for launcher-managed packs", () => {
    expect(() => validateManifest({ game: "minecraft", mods: [] })).not.toThrow();
  });

  it("normalizes manifest audience metadata", () => {
    expect(getModAudience({ id: "gdg-ui" })).toBe("client");
    expect(getModAudience({ id: "shared-mod", audience: "shared" })).toBe("shared");
    expect(getModAudience({ id: "server-mod", audience: "server-only" })).toBe("server");
    expect(getModAudience({ id: "private-mod", side: "private" })).toBe("server");
    expect(getModAudience({ id: "legacy-server", client: false })).toBe("server");
    expect(getModAudience({ id: "legacy-server-side", clientSide: false })).toBe("server");
  });

  it("blocks known server-only and explicit server audience entries from client install plans", () => {
    const manifest = {
      mods: [
        {
          id: "gdg-ui",
          name: "GDG UI",
          folderName: "GDG-UI",
          audience: "client",
          source: { type: "zip", url: "https://example.test/gdg-ui.zip" }
        },
        {
          id: "shared-icons",
          name: "Shared Icons",
          folderName: "Shared-Icons",
          audience: "shared",
          source: { type: "zip", url: "https://example.test/shared-icons.zip" }
        },
        {
          id: "allocs-commandextensions",
          name: "Allocs Command Extensions",
          folderName: "Allocs_CommandExtensions",
          audience: "client",
          source: { type: "zip", url: "https://example.test/allocs.zip" }
        },
        {
          id: "gdg-private-logic",
          name: "GDG Private Logic",
          folderName: "GDG-Private-Logic",
          audience: "server",
          source: { type: "zip", url: "https://example.test/private.zip" }
        }
      ]
    };

    const plan = buildSyncPlan(manifest, []);

    expect(summarizePlan(plan)).toEqual({
      ready: 0,
      install: 2,
      update: 0,
      blocked: 2,
      keep: 0
    });
    expect(plan.find((item) => item.mod.folderName === "Allocs_CommandExtensions")?.reason).toContain("Known server-only");
    expect(plan.find((item) => item.mod.folderName === "GDG-Private-Logic")?.reason).toContain("Server-only mod");
  });

  it("filters client-installable manifest mods for size and health summaries", () => {
    const manifest = {
      mods: [
        { id: "client", name: "Client", folderName: "Client", audience: "client" },
        { id: "shared", name: "Shared", folderName: "Shared", audience: "shared" },
        { id: "server", name: "Server", folderName: "Server", audience: "server" },
        { id: "allocs", name: "Allocs Server Fixes", folderName: "Allocs_CommonFunc", audience: "client" }
      ]
    };

    expect(getManifestClientMods(manifest).map((mod) => mod.folderName)).toEqual(["Client", "Shared"]);
    expect(isClientInstallableManifestMod(manifest.mods[0])).toBe(true);
    expect(isClientInstallableManifestMod(manifest.mods[2])).toBe(false);
    expect(isClientBlockedServerOnlyMod(manifest.mods[3])).toBe(true);
    expect(getClientBlockedReason(manifest.mods[3])).toContain("Known server-only");
  });
});
