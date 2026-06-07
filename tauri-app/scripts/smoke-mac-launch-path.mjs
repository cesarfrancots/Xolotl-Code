import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

const tempRoot = mkdtempSync(join(tmpdir(), "xolotl-launch-smoke-"));
const tempHome = join(tempRoot, "home");
const projectsJson = join(tempHome, ".xolotl-code", "projects.json");

mkdirSync(tempHome, { recursive: true });

function makeProject(name) {
  const path = join(tempRoot, name);
  mkdirSync(path, { recursive: true });
  return path;
}

const projectWithSpaces = makeProject("Project With Spaces");
const unicodeProject = makeProject("Project Ñandú 🚀");
const packageProject = makeProject("Widget Package.xcodeproj");
writeFileSync(join(packageProject, "project.pbxproj"), "// package project smoke\n", "utf8");

const symlinkTarget = makeProject("Project Symlink Target");
const symlinkProject = join(tempRoot, "Project Symlink Alias");
symlinkSync(symlinkTarget, symlinkProject, "dir");

const sourceRoot = makeProject("Project From Nested Source File");
mkdirSync(join(sourceRoot, "src"), { recursive: true });
writeFileSync(join(sourceRoot, "package.json"), "{\"name\":\"xolotl-smoke\"}\n", "utf8");
const nestedSourceFile = join(sourceRoot, "src", "main.ts");
writeFileSync(nestedSourceFile, "console.log('launch smoke');\n", "utf8");

const projectCases = [
  { label: "space path", launchPath: projectWithSpaces, expectedPath: realpathSync(projectWithSpaces) },
  { label: "unicode path", launchPath: unicodeProject, expectedPath: realpathSync(unicodeProject) },
  { label: "symlink path", launchPath: symlinkProject, expectedPath: realpathSync(symlinkTarget) },
  { label: "package directory", launchPath: packageProject, expectedPath: realpathSync(packageProject) },
  { label: "nested source file", launchPath: nestedSourceFile, expectedPath: realpathSync(sourceRoot) },
];
const expectedProjects = projectCases.map((item) => item.expectedPath);

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
        if (
          Array.isArray(projects) &&
          expectedProjects.every((expectedPath) =>
            projects.some((project) => project?.path === expectedPath)
          )
        ) {
          return;
        }
      } catch {
        // The app may still be writing projects.json; keep polling.
      }
    }
    await sleep(250);
  }
  const seen = existsSync(projectsJson) ? readFileSync(projectsJson, "utf8") : "<missing projects.json>";
  throw new Error(
    `Timed out waiting for launch project import: ${expectedProjects.join(", ")}\nSeen projects: ${seen}`,
  );
}

let child;
let childExited = false;
try {
  child = spawn(appBin, projectCases.map((item) => item.launchPath), {
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
  for (const item of projectCases) {
    console.log(`launch path smoke ok (${item.label}): ${item.launchPath} -> ${item.expectedPath}`);
  }
} finally {
  if (child && !childExited) {
    child.kill();
    const startedAt = Date.now();
    while (!childExited && Date.now() - startedAt < 3_000) {
      await sleep(100);
    }
    if (!childExited) child.kill("SIGKILL");
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
