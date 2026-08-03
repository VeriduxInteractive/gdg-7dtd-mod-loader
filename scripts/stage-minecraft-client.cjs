const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const projectRoot = path.join(repoRoot, "minecraft-client");
const wrapperJar = path.join(projectRoot, "gradle", "wrapper", "gradle-wrapper.jar");
const outputDir = path.join(projectRoot, "build", "libs");
const stageDir = path.join(repoRoot, "server-directory", "addons");
const stagedJar = path.join(stageDir, "GDG-Quick-Join.jar");

const javaCandidates = [
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java.exe") : "",
  process.env.APPDATA ? path.join(process.env.APPDATA, "PrismLauncher", "java", "java-runtime-gamma", "bin", "java.exe") : "",
  "java"
].filter(Boolean);

const javaExecutable = javaCandidates.find((candidate) => candidate === "java" || fs.existsSync(candidate));
if (!javaExecutable) {
  throw new Error("Java 17 was not found. Install Java 17 or let Prism Launcher provision java-runtime-gamma.");
}

if (!fs.existsSync(wrapperJar)) {
  throw new Error(`Gradle wrapper is missing: ${wrapperJar}`);
}

const javaHome = javaExecutable === "java" ? "" : path.dirname(path.dirname(javaExecutable));
const gradleArgs = [
  "-Dorg.gradle.appname=gradlew",
  ...(javaHome ? [`-Dorg.gradle.java.home=${javaHome}`] : []),
  "-classpath",
  wrapperJar,
  "org.gradle.wrapper.GradleWrapperMain",
  "build"
];
const result = spawnSync(javaExecutable, gradleArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}

const builtJars = fs.readdirSync(outputDir)
  .filter((name) => /^GDG-Quick-Join-.*\.jar$/i.test(name))
  .map((name) => path.join(outputDir, name));
if (builtJars.length !== 1) {
  throw new Error(`Expected one GDG Quick Join JAR in ${outputDir}, found ${builtJars.length}.`);
}

fs.mkdirSync(stageDir, { recursive: true });
fs.copyFileSync(builtJars[0], stagedJar);
console.log(`Staged ${path.basename(builtJars[0])} -> ${stagedJar}`);
