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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function xolotlCodeOpenShellCommand(path: string): string {
  return `open ${shellQuote(xolotlCodeOpenUrl(path))}`;
}

export async function copyXolotlCodeOpenUrl(path: string) {
  await copyTextToClipboard(xolotlCodeOpenUrl(path));
}

export async function copyXolotlCodeOpenShellCommand(path: string) {
  await copyTextToClipboard(xolotlCodeOpenShellCommand(path));
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

export interface PathContextHandoffOptions {
  label?: string | null;
  kind?: string | null;
  relativePath?: string | null;
}

export interface AutomationHandoffPayload {
  schema: "xolotl-code.mac-handoff.v1";
  app: "Xolotl Code";
  kind: string;
  label: string;
  path: string;
  relativePath?: string;
  xolotlCodeUrl: string;
  shellOpenCommand: string;
}

export function pathAutomationHandoffPayload(
  path: string,
  options: PathContextHandoffOptions = {},
): AutomationHandoffPayload {
  const label = options.label?.trim() || projectLabelFromPath(path);
  const kind = options.kind?.trim() || "Path";
  const relativePath = options.relativePath?.trim();
  const payload: AutomationHandoffPayload = {
    schema: "xolotl-code.mac-handoff.v1",
    app: "Xolotl Code",
    kind,
    label,
    path,
    xolotlCodeUrl: xolotlCodeOpenUrl(path),
    shellOpenCommand: xolotlCodeOpenShellCommand(path),
  };
  if (relativePath) payload.relativePath = relativePath;
  return payload;
}

export function projectAutomationHandoffPayload(path: string, name?: string | null): AutomationHandoffPayload {
  return pathAutomationHandoffPayload(path, {
    kind: "Project",
    label: name?.trim() || projectLabelFromPath(path),
  });
}

export function pathAutomationHandoffJson(path: string, options: PathContextHandoffOptions = {}): string {
  return JSON.stringify(pathAutomationHandoffPayload(path, options), null, 2);
}

export function projectAutomationHandoffJson(path: string, name?: string | null): string {
  return JSON.stringify(projectAutomationHandoffPayload(path, name), null, 2);
}

export async function copyPathAutomationHandoff(path: string, options: PathContextHandoffOptions = {}) {
  await copyTextToClipboard(pathAutomationHandoffJson(path, options));
}

export async function copyProjectAutomationHandoff(path: string, name?: string | null) {
  await copyTextToClipboard(projectAutomationHandoffJson(path, name));
}

export function pathContextHandoffText(path: string, options: PathContextHandoffOptions = {}): string {
  const label = options.label?.trim() || projectLabelFromPath(path);
  const kind = options.kind?.trim() || "Path";
  const relativePath = options.relativePath?.trim();
  return [
    "Xolotl Code path context",
    `${kind}: ${label}`,
    `Path: ${path}`,
    relativePath ? `Relative Path: ${relativePath}` : null,
    `Open: ${xolotlCodeOpenUrl(path)}`,
    "",
    `Use this as the ${kind.toLowerCase()} context for Xolotl Code automation, Shortcuts, Raycast, Alfred, or shell handoff.`,
  ].filter((line): line is string => line !== null).join("\n");
}

export async function copyPathContextHandoff(path: string, options: PathContextHandoffOptions = {}) {
  await copyTextToClipboard(pathContextHandoffText(path, options));
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

export async function openPathInExternalTerminal(path: string) {
  const res = await commands.openPathInExternalTerminal(path);
  if (res.status === "error") {
    throw new Error(res.error);
  }
}
