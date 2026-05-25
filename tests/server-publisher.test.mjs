import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServerFixture,
  createTempFixtureRoot,
  readManifest,
  removeTempFixtureRoot,
  runPublisher
} from "./helpers/fixtures.mjs";

const require = createRequire(import.meta.url);
const { publish } = require("../server/gdg-sync-server.cjs");

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await createTempFixtureRoot();
});

afterEach(async () => {
  await removeTempFixtureRoot(tempRoot);
  tempRoot = "";
});

describe("server publisher", () => {
  it("publishes only client-safe allowlisted mods and marks them with client audience", async () => {
    const serverRoot = await createServerFixture(tempRoot, {
      "GDG-UI": { name: "GDG UI", version: "1.0.0", fileName: "ui.xml", fileText: "<ui />\n" },
      "GDG-Core": { name: "GDG Core", version: "9.9.9", fileName: "private.xml", fileText: "<private />\n" },
      "Allocs_CommandExtensions": { name: "Allocs Command Extensions", version: "26.0.0", fileName: "allocs.xml", fileText: "<server />\n" }
    });
    const outDir = path.join(tempRoot, "publish");

    const result = await runPublisher([
      "publish",
      "--game-root",
      serverRoot,
      "--out",
      outDir,
      "--base-url",
      "https://mods.example.test",
      "--distribution",
      "allowlist",
      "--client-mods",
      "GDG-UI,Allocs_CommandExtensions"
    ]);

    expect(result.stdout).toContain("Published 1 mods");
    expect(result.stdout).toContain("Skipped 2 server-only/private mods");

    const manifest = await readManifest(outDir);
    expect(manifest.mods).toHaveLength(1);
    expect(manifest.mods[0]).toMatchObject({
      id: "gdg-ui",
      name: "GDG UI",
      audience: "client",
      required: true,
      folderName: "GDG-UI"
    });
    expect(manifest.mods[0].source.url).toBe("https://mods.example.test/packages/gdg-ui.zip");
    expect(manifest.mods[0].source.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(fsp.stat(path.join(outDir, "packages", "gdg-ui.zip"))).resolves.toBeTruthy();
  });

  it("keeps server-only Allocs out of all-except-private manifests", async () => {
    const serverRoot = await createServerFixture(tempRoot, {
      "Client-Only": { name: "Client Only", version: "1.2.3", fileName: "client.xml", fileText: "<client />\n" },
      "Allocs_WebAndMapRendering": { name: "Allocs MapRendering and WebInterface", version: "26.0.0", fileName: "allocs.xml", fileText: "<server />\n" }
    });
    const outDir = path.join(tempRoot, "publish");

    const result = await runPublisher([
      "publish",
      "--game-root",
      serverRoot,
      "--out",
      outDir,
      "--base-url",
      "https://mods.example.test",
      "--distribution",
      "all-except-private"
    ]);

    expect(result.stdout).toContain("Published 1 mods");
    expect(result.stdout).toContain("Skipped 1 server-only/private mods");

    const manifest = await readManifest(outDir);
    expect(manifest.mods.map((mod) => mod.folderName)).toEqual(["Client-Only"]);
    expect(manifest.mods[0].audience).toBe("client");
  });

  it("honors policy files for allowlists, server-only prefixes, and external packages", async () => {
    const serverRoot = await createServerFixture(tempRoot, {
      "Client-Visuals": { name: "Client Visuals", version: "2.0.0", fileName: "visuals.xml", fileText: "<visuals />\n" },
      "Secret-Economy": { name: "Secret Economy", version: "1.0.0", fileName: "economy.xml", fileText: "<economy />\n" },
      "Admin-Tools": { name: "Admin Tools", version: "1.0.0", fileName: "admin.xml", fileText: "<admin />\n" }
    });
    const outDir = path.join(tempRoot, "publish");
    const policyPath = path.join(tempRoot, "policy.json");
    await fsp.writeFile(policyPath, JSON.stringify({
      distribution: "all-except-private",
      serverOnlyPrefixes: ["Secret-", "Admin-"],
      extraClientPackages: [
        {
          id: "hosted-ui",
          name: "Hosted UI",
          version: "3.0.0",
          folderName: "Hosted-UI",
          url: "https://cdn.example.test/hosted-ui.zip",
          archiveSizeBytes: 1234,
          archiveSha256: "a".repeat(64)
        }
      ]
    }, null, 2), "utf8");

    const result = await publish({
      gameRoot: serverRoot,
      out: outDir,
      baseUrl: "https://mods.example.test",
      policy: policyPath
    });

    expect(result.modCount).toBe(2);
    expect(result.skippedCount).toBe(2);
    expect(result.externalPackageCount).toBe(1);
    expect(result.manifestPath).toBe(path.join(outDir, "manifest.json"));

    const manifest = await readManifest(outDir);
    expect(manifest.mods.map((mod) => mod.folderName).sort()).toEqual(["Client-Visuals", "Hosted-UI"]);
    expect(manifest.mods.every((mod) => mod.audience === "client")).toBe(true);
    expect(manifest.mods.find((mod) => mod.folderName === "Hosted-UI")?.source.url).toBe("https://cdn.example.test/hosted-ui.zip");
  });
});
