import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultAppBundle = join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Xolotl Code.app",
);
const sourceAppBundle = resolve(process.argv[2] ?? defaultAppBundle);
const timeoutMs = Number(process.env.XOLOTL_SMOKE_TIMEOUT_MS ?? 15_000);

if (process.platform !== "darwin") {
  throw new Error("macOS open-project smoke must run on macOS.");
}

if (!existsSync(sourceAppBundle)) {
  throw new Error(`Packaged app bundle not found: ${sourceAppBundle}. Run npm run build:mac first.`);
}

const sourceAppBin = join(sourceAppBundle, "Contents", "MacOS", "xolotl");
if (!existsSync(sourceAppBin)) {
  throw new Error(`Packaged app binary not found: ${sourceAppBin}. Run npm run build:mac first.`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "xolotl-open-smoke-"));
const tempHome = join(tempRoot, "home");
const tempAppBundle = join(tempRoot, "Xolotl Code Open Smoke.app");
const tempAppBin = join(tempAppBundle, "Contents", "MacOS", "xolotl");
const tempStderr = join(tempRoot, "xolotl-open-smoke.stderr.log");
const projectsJson = join(tempHome, ".xolotl-code", "projects.json");
const keepTemp = process.env.XOLOTL_SMOKE_KEEP_TEMP === "1";

mkdirSync(tempHome, { recursive: true });
cpSync(sourceAppBundle, tempAppBundle, { recursive: true });

const processNeedles = [
  tempAppBundle,
  tempAppBin,
  realpathSync(tempAppBundle),
  realpathSync(tempAppBin),
];

const projectFromPath = mkdtempSync(join(tempRoot, "Project From Open Path "));
const projectFromUrl = mkdtempSync(join(tempRoot, "Project From File URL "));
const canonicalPathProject = realpathSync(projectFromPath);
const canonicalUrlProject = realpathSync(projectFromUrl);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function openApp(args) {
  execFileSync("open", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function appPids() {
  const raw = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return raw
    .split("\n")
    .flatMap((line) => {
      if (!processNeedles.some((needle) => line.includes(needle))) return [];
      const match = line.trim().match(/^(\d+)/);
      return match ? [Number(match[1])] : [];
    });
}

async function waitForAppProcess() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pids = appPids();
    if (pids.length > 0) return pids;
    await sleep(250);
  }
  const stderr = existsSync(tempStderr) ? readFileSync(tempStderr, "utf8").trim() : "";
  throw new Error(`Timed out waiting for temp app process.${stderr ? `\nApp stderr:\n${stderr}` : ""}`);
}

async function waitForProjects(expectedPaths) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(projectsJson)) {
      const raw = readFileSync(projectsJson, "utf8");
      try {
        const projects = JSON.parse(raw);
        if (
          Array.isArray(projects) &&
          expectedPaths.every((expectedPath) =>
            projects.some((project) => project?.path === expectedPath)
          )
        ) {
          return projects;
        }
      } catch {
        // The app may still be writing projects.json; keep polling.
      }
    }
    await sleep(250);
  }
  const seen = existsSync(projectsJson) ? readFileSync(projectsJson, "utf8") : "<missing projects.json>";
  throw new Error(
    `Timed out waiting for Launch Services project import: ${expectedPaths.join(", ")}\nSeen projects: ${seen}`,
  );
}

async function terminateApp() {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const pids = appPids();
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {
        // Process already exited.
      }
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3_000) {
      if (appPids().length === 0) return;
      await sleep(100);
    }
  }
}

try {
  openApp([
    "-n",
    "-F",
    "-g",
    "--env",
    `HOME=${tempHome}`,
    "--env",
    "RUST_BACKTRACE=1",
    "--stderr",
    tempStderr,
    "-a",
    tempAppBundle,
  ]);
  await waitForAppProcess();

  // Give the WebView time to mount its project-open listener. Late arrivals are
  // also stored in native pending state, but this keeps the smoke closer to a
  // normal already-running Finder/Open With workflow.
  await sleep(1_000);

  openApp(["-g", "-a", tempAppBundle, canonicalPathProject]);
  await waitForProjects([canonicalPathProject]);

  openApp(["-g", "-a", tempAppBundle, "-u", pathToFileURL(canonicalUrlProject).href]);
  await waitForProjects([canonicalPathProject, canonicalUrlProject]);

  console.log(`open project smoke ok: ${canonicalPathProject}`);
  console.log(`open file-url smoke ok: ${canonicalUrlProject}`);
} finally {
  await terminateApp();
  if (!keepTemp) {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`kept smoke temp directory: ${tempRoot}`);
  }
}
