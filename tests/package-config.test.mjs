import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("electron-builder package config", () => {
  it("includes the shared sync core required by the packaged Electron main process", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const files = packageJson.build?.files || [];

    expect(files).toContain("electron/**/*");
    expect(files).toContain("shared/**/*");
  });
});
