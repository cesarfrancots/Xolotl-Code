import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const appName = "Xolotl Code";
const appBundle = `${appName}.app`;
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version ?? "0.0.0";
const arch = process.env.MAC_DMG_ARCH ?? (process.arch === "arm64" ? "aarch64" : process.arch);
const releaseBundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle");
const appBundleRoot = arch === "universal"
  ? join(projectRoot, "src-tauri", "target", "universal-apple-darwin", "release", "bundle")
  : releaseBundleRoot;
const appPathOverride = process.env.MAC_APP_BUNDLE_PATH ?? process.env.MAC_DMG_APP_PATH;
const appPath = resolve(appPathOverride ?? join(appBundleRoot, "macos", appBundle));
const requireSigning = process.env.MAC_RELEASE_REQUIRE_SIGNING === "1";
const skipAdhocSign = process.env.MAC_RELEASE_SKIP_ADHOC_SIGN === "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function command(command, args) {
  const result = run(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function codesignDetails(path) {
  const result = run("/usr/bin/codesign", ["-dv", "--verbose=4", path]);
  return `${result.stdout}\n${result.stderr}`;
}

if (process.platform !== "darwin") {
  throw new Error("macOS ad-hoc signing must run on macOS.");
}

if (!existsSync(appPath)) {
  throw new Error(`App bundle not found: ${appPath}. Run npm run build:mac first.`);
}

if (skipAdhocSign) {
  console.log(`Skipped ad-hoc signing for ${appBundle} ${version}: MAC_RELEASE_SKIP_ADHOC_SIGN=1`);
  process.exit(0);
}

const beforeDetails = codesignDetails(appPath);
const hasDeveloperId = beforeDetails.includes("Authority=Developer ID Application");

if (hasDeveloperId) {
  console.log(`Skipped ad-hoc signing for ${appBundle} ${version}: Developer ID signature is already present.`);
  process.exit(0);
}

if (requireSigning) {
  throw new Error("Developer ID signing is required; refusing to replace it with an ad-hoc signature.");
}

command("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
console.log(`Ad-hoc signed ${appBundle} ${version}: ${appPath}`);
