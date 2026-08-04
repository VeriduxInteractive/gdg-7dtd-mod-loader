const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const projectRoot = path.join(repoRoot, "minecraft-client");
const wrapperJar = path.join(projectRoot, "gradle", "wrapper", "gradle-wrapper.jar");
const outputDir = path.join(projectRoot, "build", "libs");
const stageDir = path.join(repoRoot, "server-directory", "addons");
const stagedJar = path.join(stageDir, "GDG-Quick-Join.jar");
const gradleUserHome = process.env.GDG_GRADLE_USER_HOME
  || path.join(process.env.LOCALAPPDATA || repoRoot, "GoldenDaysGaming", "BuildTools", "gradle-minecraft-1.12.2");

const javaCandidates = [
  process.env.GDG_JAVA8_HOME ? path.join(process.env.GDG_JAVA8_HOME, "bin", "java.exe") : "",
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "GoldenDaysGaming", "BuildTools", "temurin8-jdk8u502-b07", "jdk8u502-b07", "bin", "java.exe") : "",
  process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java.exe") : "",
  "java"
].filter(Boolean);

function isJava8Jdk(candidate) {
  if (candidate !== "java" && !fs.existsSync(candidate)) {
    return false;
  }
  const version = spawnSync(candidate, ["-version"], { encoding: "utf8", windowsHide: true });
  const versionText = `${version.stdout || ""}\n${version.stderr || ""}`;
  if (version.status !== 0 || !/version\s+"1\.8\./.test(versionText)) {
    return false;
  }
  const javac = candidate === "java" ? "javac" : path.join(path.dirname(candidate), "javac.exe");
  const compiler = spawnSync(javac, ["-version"], { encoding: "utf8", windowsHide: true });
  return compiler.status === 0 && /javac\s+1\.8\./.test(`${compiler.stdout || ""}\n${compiler.stderr || ""}`);
}

const javaExecutable = javaCandidates.find(isJava8Jdk);
if (!javaExecutable) {
  throw new Error("A Java 8 JDK is required to build the Forge 1.12.2 Quick Join addon. Set GDG_JAVA8_HOME to a Temurin 8 JDK.");
}

if (!fs.existsSync(wrapperJar)) {
  throw new Error(`Gradle wrapper is missing: ${wrapperJar}`);
}
fs.mkdirSync(gradleUserHome, { recursive: true });

const javaHome = javaExecutable === "java" ? "" : path.dirname(path.dirname(javaExecutable));
const gradleArgs = [
  "-Dorg.gradle.appname=gradlew",
  ...(javaHome ? [`-Dorg.gradle.java.home=${javaHome}`] : []),
  "-classpath",
  wrapperJar,
  "org.gradle.wrapper.GradleWrapperMain",
  "clean",
  "setupDecompWorkspace",
  "build",
  "-x",
  "getAssets"
];
const result = spawnSync(javaExecutable, gradleArgs, {
  cwd: projectRoot,
  env: { ...process.env, GRADLE_USER_HOME: gradleUserHome },
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
