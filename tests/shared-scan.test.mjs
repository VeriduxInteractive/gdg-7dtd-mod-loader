import fsp from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGameRoot,
  createModFolder,
  createTempFixtureRoot,
  removeTempFixtureRoot
} from "./helpers/fixtures.mjs";

const require = createRequire(import.meta.url);
const {
  hashDirectory,
  scanSevenDaysMods,
  validateManifest
} = require("../shared/gdg-sync-core.cjs");

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await createTempFixtureRoot();
});

afterEach(async () => {
  await removeTempFixtureRoot(tempRoot);
  tempRoot = "";
});

describe("shared 7DTD scanning", () => {
  it("scans only valid mod folders and can exclude private folders", async () => {
    const gameRoot = await createGameRoot(tempRoot, "client-7dtd", "7DaysToDie.exe");
    const modsRoot = path.join(gameRoot, "Mods");

    await createModFolder(modsRoot, "GDG-UI", {
      name: "GDG UI",
      displayName: "Golden Days UI",
      version: "1.0.0",
      fileName: "windows.xml",
      fileText: "<configs />\n"
    });
    await createModFolder(modsRoot, "GDG-Private", {
      name: "GDG Private",
      version: "9.9.9",
      fileName: "private.xml",
      fileText: "<private />\n"
    });
    await fsp.mkdir(path.join(modsRoot, "Not-A-Mod"), { recursive: true });
    await fsp.writeFile(path.join(modsRoot, "loose.txt"), "ignore me", "utf8");

    const scan = await scanSevenDaysMods(gameRoot, {
      hash: true,
      excludeFolders: ["GDG-Private"]
    });

    expect(scan.exists).toBe(true);
    expect(scan.mods).toHaveLength(1);
    expect(scan.mods[0]).toMatchObject({
      folderName: "GDG-UI",
      name: "GDG UI",
      displayName: "Golden Days UI",
      version: "1.0.0"
    });
    expect(scan.mods[0].folderSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic directory hashes when file timestamps differ", async () => {
    const first = path.join(tempRoot, "first");
    const second = path.join(tempRoot, "second");
    await fsp.mkdir(path.join(first, "Config"), { recursive: true });
    await fsp.mkdir(path.join(second, "Config"), { recursive: true });
    await fsp.writeFile(path.join(first, "Config", "a.xml"), "<a />\n", "utf8");
    await fsp.writeFile(path.join(second, "Config", "a.xml"), "<a />\n", "utf8");
    await fsp.utimes(path.join(second, "Config", "a.xml"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));

    await expect(hashDirectory(first)).resolves.toBe(await hashDirectory(second));
  });

  it("rejects malformed manifests before sync planning", () => {
    expect(() => validateManifest({ game: "7dtd", mods: [] })).not.toThrow();
    expect(() => validateManifest({ game: "wrong", mods: [] })).toThrow(/Manifest game/);
    expect(() => validateManifest({ game: "7dtd", mods: [{ id: "missing-name" }] })).toThrow(/id and name/);
  });
});
