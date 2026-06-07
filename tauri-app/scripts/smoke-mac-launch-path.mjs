import { existsSync, mkdtempSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultAppBin = join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Xolotl Code.app",
  "Contents",
  "MacOS",
  "xolotl",
);
const appBin = resolve(process.argv[2] ?? defaultAppBin);
const timeoutMs = Number(process.env.XOLOTL_SMOKE_TIMEOUT_MS ?? 12_000);

if (process.platform !== "darwin") {
  throw new Error("macOS launch-path smoke must run on macOS.");
}

if (!existsSync(appBin)) {
  throw new Error(`Packaged app binary not found: ${appBin}. Run npm run build:mac first.`);
}

const tempHome = mkdtempSync(join(tmpdir(), "xolotl-smoke-home-"));
const projectDir = mkdtempSync(join(tmpdir(), "xolotl-smoke-project-"));
const canonicalProject = realpathSync(projectDir);
const projectsJson = join(tempHome, ".xolotl-code", "projects.json");

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForProjectImport() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(projectsJson)) {
      const raw = readFileSync(projectsJson, "utf8");
      try {
        const projects = JSON.parse(raw);
        if (Array.isArray(projects) && projects.some((project) => project?.path === canonicalProject)) {
          return;
        }
      } catch {
        // The app may still be writing projects.json; keep polling.
      }
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for launch project import: ${canonicalProject}`);
}

let child;
let childExited = false;
try {
  child = spawn(appBin, [canonicalProject], {
    env: { ...process.env, HOME: tempHome },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    childExited = true;
    if (code && code !== 0) {
      console.error(`Xolotl exited early with code ${code}${signal ? ` signal ${signal}` : ""}`);
      if (stderr.trim()) console.error(stderr.trim());
    }
  });

  await waitForProjectImport();
  console.log(`launch path smoke ok: ${canonicalProject}`);
} finally {
  if (child && !childExited) {
    child.kill();
    const startedAt = Date.now();
    while (!childExited && Date.now() - startedAt < 3_000) {
      await sleep(100);
    }
    if (!childExited) child.kill("SIGKILL");
  }
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}
