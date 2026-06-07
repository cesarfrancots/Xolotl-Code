#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const viteEntry = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const dep0205Flag = "--disable-warning=DEP0205";
const currentNodeOptions = process.env.NODE_OPTIONS ?? "";
const nodeOptions = currentNodeOptions.includes(dep0205Flag)
  ? currentNodeOptions
  : [currentNodeOptions, dep0205Flag].filter(Boolean).join(" ");

const child = spawn(process.execPath, [viteEntry, ...process.argv.slice(2)], {
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
