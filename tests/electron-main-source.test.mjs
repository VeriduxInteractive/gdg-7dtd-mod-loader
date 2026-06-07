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
});
