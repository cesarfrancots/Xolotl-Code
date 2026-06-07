import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { commands } from "../bindings";

function stripTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

export function relativePathFromRoot(path: string, root: string): string {
  const cleanPath = stripTrailingSlash(path);
  const cleanRoot = stripTrailingSlash(root);
  if (!cleanRoot || cleanPath === cleanRoot) return ".";
  if (cleanRoot === "/" && cleanPath.startsWith("/")) return cleanPath.slice(1);
  const prefix = `${cleanRoot}/`;
  return cleanPath.startsWith(prefix) ? cleanPath.slice(prefix.length) : cleanPath;
}

export async function copyTextToClipboard(text: string) {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}

export function xolotlCodeOpenUrl(path: string): string {
  const url = new URL("xolotl-code://open");
  url.searchParams.set("path", path);
  return url.href;
}

export async function copyXolotlCodeOpenUrl(path: string) {
  await copyTextToClipboard(xolotlCodeOpenUrl(path));
}

function projectLabelFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function projectContextHandoffText(path: string, name?: string | null): string {
  const label = name?.trim() || projectLabelFromPath(path);
  return [
    "Xolotl Code project context",
    `Project: ${label}`,
    `Path: ${path}`,
    `Open: ${xolotlCodeOpenUrl(path)}`,
    "",
    "Use this as the active project context for Xolotl Code automation, Shortcuts, Raycast, Alfred, or shell handoff.",
  ].join("\n");
}

export async function copyProjectContextHandoff(path: string, name?: string | null) {
  await copyTextToClipboard(projectContextHandoffText(path, name));
}

export async function readTextFromClipboard() {
  try {
    return await readText();
  } catch {
    return await navigator.clipboard?.readText?.() ?? "";
  }
}

export async function revealPathInFinder(path: string) {
  const res = await commands.revealInFinder(path);
  if (res.status === "error") {
    throw new Error(res.error);
  }
}

export async function quickLookPath(path: string) {
  const res = await commands.quickLookPath(path);
  if (res.status === "error") {
    throw new Error(res.error);
  }
}

export async function openPathInExternalEditor(path: string) {
  const res = await commands.openPathInExternalEditor(path);
  if (res.status === "error") {
    throw new Error(res.error);
  }
}
