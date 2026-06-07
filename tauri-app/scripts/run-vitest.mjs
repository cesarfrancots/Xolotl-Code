#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const storageDir = join(tmpdir(), "xolotl-vitest-node-localstorage");
const storageFile = join(storageDir, "localstorage.db");
const storageFlag = `--localstorage-file=${storageFile}`;
const currentNodeOptions = process.env.NODE_OPTIONS ?? "";
const nodeOptions = currentNodeOptions.includes("--localstorage-file=")
  ? currentNodeOptions
  : [currentNodeOptions, storageFlag].filter(Boolean).join(" ");

mkdirSync(storageDir, { recursive: true });

const vitestEntry = join(projectRoot, "node_modules", "vitest", "vitest.mjs");
const child = spawn(process.execPath, [vitestEntry, "run", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
