import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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

export async function revealPathInFinder(path: string) {
  const res = await commands.revealInFinder(path);
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
