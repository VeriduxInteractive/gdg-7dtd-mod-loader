import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Electron main source", () => {
  it("defines the byte formatter used by preflight and sync errors", async () => {
    const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");

    expect(source).toMatch(/function\s+formatBytes\s*\(/);
    expect(source).toMatch(/Free disk space"[^]*formatBytes\(diskSpace\.freeBytes\)/);
    expect(source).toMatch(/Estimated need \$\{formatBytes\(neededSpace\.bytes\)\}/);
  });

  it("does not fall back to the EAC executable when EAC off is requested", async () => {
    const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");

    expect(source).toMatch(/const candidates = eacEnabled \? \[\.\.\.eacCandidates, \.\.\.directCandidates\] : directCandidates;/);
    expect(source).toMatch(/No non-EAC \$\{profile\.name\} executable was found/);
  });

  it("excludes R.E.P.O. staging artifacts when creating a GDG copy", async () => {
    const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");

    expect(source).toContain("excludedCopyPatterns");
    expect(source).toContain("repo-publish-*.tgz");
    expect(source).toContain("publish-repo-*.sh");
    expect(source).toContain("temp_*");
  });

  it("defines an exact CurseForge-first Stoneblock 2 profile with Prism compatibility", async () => {
    const source = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");

    expect(source).toMatch(/minecraft:\s*\{[^]*platform:\s*"prism"/);
    expect(source).toMatch(/minecraft:\s*\{[^]*managesModsExternally:\s*true/);
    expect(source).toContain('prismPackVersionId: "2818169"');
    expect(source).toContain("prismPackMinimumInstalledAddons: 225");
    expect(source).toContain("prismPackMinimumModFiles: 225");
    expect(source).toContain('prismPackRequiredPaths: ["manifest.json", "config", "mods", "scripts"]');
    expect(source).toContain("curseForgeGameId: 432");
    expect(source).toContain("priority: isCurseForgeMinecraft ? 70 : 80");
    expect(source).toContain('`curseforge://launch-game?instanceId=${encodeURIComponent(instanceId)}&gameId=${gameTypeId}`');
    expect(source).toContain('launchArgs.push("--server", serverAddress)');
    expect(source).toContain('trimmed.startsWith("bundled://")');
    expect(source).toContain('targetName: "GDG-Quick-Join.jar"');
    expect(source).toMatch(/async function ensureBundledAddons\s*\(/);
    expect(source).toContain("normalized.startsWith(addon.ownedPrefix)");
    expect(source).toContain('path.basename(normalizeLocalPath(source)).toLowerCase() === "gdg.servers.local.json"');
  });
});
