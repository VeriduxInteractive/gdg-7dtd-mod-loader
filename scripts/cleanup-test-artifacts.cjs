#!/usr/bin/env node

const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const TEMP_PREFIXES = [
  "gdg-mod-loader-dev",
  "gdg-mod-loader-test-"
];

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const entries = await fsp.readdir(tempRoot, { withFileTypes: true });
  const targets = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tempRoot, entry.name))
    .filter((target) => TEMP_PREFIXES.some((prefix) => path.basename(target).startsWith(prefix)));

  for (const target of targets) {
    assertInsideTemp(tempRoot, target);
    await fsp.rm(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }

  if (targets.length === 0) {
    console.log("No GDG mod loader test artifacts found.");
  }
}

function assertInsideTemp(tempRoot, target) {
  const resolvedTemp = path.resolve(tempRoot).toLowerCase();
  const resolvedTarget = path.resolve(target).toLowerCase();
  if (resolvedTarget === resolvedTemp || !resolvedTarget.startsWith(`${resolvedTemp}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside temp: ${target}`);
  }
}
