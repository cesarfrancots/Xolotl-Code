import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const appName = "Xolotl Code";
const appBundle = `${appName}.app`;
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(readFileSync(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const version = packageJson.version ?? tauriConfig.version ?? "0.0.0";
const archLabel = process.env.MAC_DMG_ARCH ?? (process.arch === "arm64" ? "aarch64" : process.arch);
const releaseBundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle");
const appBundleRoot = archLabel === "universal"
  ? join(projectRoot, "src-tauri", "target", "universal-apple-darwin", "release", "bundle")
  : releaseBundleRoot;
const defaultAppPath = join(appBundleRoot, "macos", appBundle);
const defaultDmgPath = join(releaseBundleRoot, "dmg", `${appName}_${version}_${archLabel}.dmg`);

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const appPathOverride = process.env.MAC_APP_BUNDLE_PATH ?? process.env.MAC_DMG_APP_PATH;
const appPath = resolve(positional[0] ?? appPathOverride ?? defaultAppPath);
const dmgPath = resolve(positional[1] ?? defaultDmgPath);
const expectUniversal = args.has("--expect-universal") || process.env.MAC_RELEASE_EXPECT_UNIVERSAL === "1";
const requireSigning = args.has("--require-signing") || process.env.MAC_RELEASE_REQUIRE_SIGNING === "1";
const requireNotarization = args.has("--require-notarization") || process.env.MAC_RELEASE_REQUIRE_NOTARIZATION === "1";
const expectedDocumentContentTypes = [
  "public.folder",
  "public.source-code",
  "public.plain-text",
  "public.json",
];
const expectedUrlScheme = "xolotl-code";

const failures = [];
const warnings = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function commandOutput(command, args) {
  const result = run(command, args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function plistValue(plistPath, key) {
  return commandOutput("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
}

function optionalPlistValue(plistPath, key) {
  try {
    return plistValue(plistPath, key);
  } catch {
    return "";
  }
}

function attachDmg(path) {
  const result = run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-plist", path]);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`hdiutil attach failed: ${result.stderr.trim()}`);
  }
  const match = result.stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  if (!match) throw new Error("hdiutil attach did not report a mount point.");
  return match[1];
}

function detachDmg(mountPoint) {
  const result = run("/usr/bin/hdiutil", ["detach", mountPoint, "-quiet"]);
  if (result.status !== 0) {
    warnings.push(`Could not detach DMG mount ${mountPoint}: ${result.stderr.trim()}`);
  }
}

function printReport() {
  for (const note of notes) console.log(`ok: ${note}`);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`error: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("mac release preflight ok");
}

if (process.platform !== "darwin") {
  throw new Error("macOS release preflight must run on macOS.");
}

check(existsSync(appPath), `App bundle not found: ${appPath}. Run npm run build:mac first.`);
check(existsSync(dmgPath), `DMG not found: ${dmgPath}. Run npm run build:mac:dmg first.`);

if (existsSync(appPath)) {
  const infoPlist = join(appPath, "Contents", "Info.plist");
  const executable = join(appPath, "Contents", "MacOS", "xolotl");
  const icon = join(appPath, "Contents", "Resources", "icon.icns");
  check(existsSync(infoPlist), `Info.plist missing: ${infoPlist}`);
  check(existsSync(executable), `App executable missing: ${executable}`);
  check(existsSync(icon), `App icon missing: ${icon}`);

  if (existsSync(infoPlist)) {
    check(plistValue(infoPlist, "CFBundleName") === appName, "CFBundleName does not match Xolotl Code.");
    check(plistValue(infoPlist, "CFBundleDisplayName") === appName, "CFBundleDisplayName does not match Xolotl Code.");
    check(plistValue(infoPlist, "CFBundleIdentifier") === tauriConfig.identifier, "CFBundleIdentifier does not match tauri.conf.json.");
    check(plistValue(infoPlist, "CFBundleShortVersionString") === version, "CFBundleShortVersionString does not match package.json.");
    check(plistValue(infoPlist, "CFBundleExecutable") === "xolotl", "CFBundleExecutable does not match expected binary name.");
    check(plistValue(infoPlist, "LSApplicationCategoryType") === "public.app-category.developer-tools", "App category is not Developer Tools.");
    notes.push("Info.plist identity and category are consistent");

    const documentTypes = optionalPlistValue(infoPlist, "CFBundleDocumentTypes");
    check(Boolean(documentTypes), "CFBundleDocumentTypes is missing; Finder/Open With document registration is not packaged.");
    for (const contentType of expectedDocumentContentTypes) {
      check(documentTypes.includes(contentType), `CFBundleDocumentTypes does not include ${contentType}.`);
    }
    if (documentTypes) {
      notes.push("Finder/Open With document types are registered");
    }

    const urlTypes = optionalPlistValue(infoPlist, "CFBundleURLTypes");
    check(Boolean(urlTypes), "CFBundleURLTypes is missing; xolotl-code URL scheme is not packaged.");
    check(urlTypes.includes(expectedUrlScheme), `CFBundleURLTypes does not include ${expectedUrlScheme}.`);
    if (urlTypes) {
      notes.push("xolotl-code URL scheme is registered");
    }
  }

  if (existsSync(executable)) {
    const archs = commandOutput("/usr/bin/lipo", ["-archs", executable]).split(/\s+/).filter(Boolean);
    if (expectUniversal) {
      check(archs.includes("arm64") && archs.includes("x86_64"), `Expected universal binary, saw: ${archs.join(", ")}`);
    } else {
      const expectedArch = process.arch === "arm64" ? "arm64" : "x86_64";
      check(archs.includes(expectedArch), `Expected ${expectedArch} binary support, saw: ${archs.join(", ")}`);
    }
    notes.push(`Executable architectures: ${archs.join(", ")}`);
  }

  const verify = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const details = run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]);
  const signingOutput = `${details.stdout}\n${details.stderr}`;
  const hasDeveloperId = signingOutput.includes("Authority=Developer ID Application");
  const hasTeamIdentifier = /TeamIdentifier=[A-Z0-9]+/.test(signingOutput);
  const isAdHoc = signingOutput.includes("Signature=adhoc");
  if (requireSigning) {
    check(verify.status === 0, `codesign verification failed: ${verify.stderr.trim()}`);
    check(hasDeveloperId && hasTeamIdentifier, "App is not signed with a Developer ID Application identity.");
  } else {
    warn(verify.status === 0, `codesign verification did not pass: ${verify.stderr.trim()}`);
    warn(hasDeveloperId && hasTeamIdentifier, isAdHoc ? "App is ad-hoc signed; Developer ID signing is not required for this preflight." : "Developer ID signature is not present.");
  }

  if (requireNotarization) {
    const assess = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
    check(assess.status === 0, `spctl assessment failed: ${assess.stderr.trim() || assess.stdout.trim()}`);
    check(process.env.APPLE_ID && process.env.APPLE_TEAM_ID && (process.env.APPLE_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD), "Notarization gate requires APPLE_ID, APPLE_TEAM_ID, and APPLE_PASSWORD or APPLE_APP_SPECIFIC_PASSWORD.");
  }
}

let mountPoint = null;
if (existsSync(dmgPath)) {
  try {
    mountPoint = attachDmg(dmgPath);
    const mountedApp = join(mountPoint, appBundle);
    const applications = join(mountPoint, "Applications");
    check(existsSync(mountedApp), `DMG does not contain ${appBundle}.`);
    check(existsSync(applications), "DMG does not contain Applications link.");
    if (existsSync(applications)) {
      check(lstatSync(applications).isSymbolicLink(), "DMG Applications entry is not a symlink.");
    }
    notes.push("DMG contains app bundle and Applications symlink");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (mountPoint) detachDmg(mountPoint);
  }
}

printReport();
