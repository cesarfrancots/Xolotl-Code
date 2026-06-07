import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const appName = "Xolotl Code";
const appBundle = `${appName}.app`;
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version ?? "0.0.0";
const arch = process.env.MAC_DMG_ARCH ?? (process.arch === "arm64" ? "aarch64" : process.arch);
const bundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle");
const appPath = join(bundleRoot, "macos", appBundle);
const dmgDir = join(bundleRoot, "dmg");
const outputPath = resolve(
  process.argv[2] ?? join(dmgDir, `${appName}_${version}_${arch}.dmg`)
);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

if (process.platform !== "darwin") {
  throw new Error("macOS DMG packaging must run on macOS.");
}

const staging = mkdtempSync(join(tmpdir(), "xolotl-dmg-"));
try {
  mkdirSync(dmgDir, { recursive: true });
  run("/usr/bin/ditto", [appPath, join(staging, appBundle)]);
  symlinkSync("/Applications", join(staging, "Applications"));
  rmSync(outputPath, { force: true });
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    appName,
    "-srcfolder",
    staging,
    "-ov",
    "-format",
    "UDZO",
    outputPath,
  ]);
  console.log(`Created ${outputPath}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
