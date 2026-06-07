import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import { useProjectStore } from "../stores/projectStore";
import { isTauriRuntime } from "./useProjectDrop";

export const PROJECT_OPEN_EVENT = "xolotl://open-project";

export function projectOpenPathFromPayload(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  const path = payload.trim();
  return path.length > 0 ? path : null;
}

function openProjectPath(payload: unknown) {
  const path = projectOpenPathFromPayload(payload);
  if (path) void useProjectStore.getState().addProjectPath(path);
}

export function useProjectOpenEvents() {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<string>(PROJECT_OPEN_EVENT, (event) => openProjectPath(event.payload))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.error("project open listener failed:", err);
      });

    void commands.launchProjectPaths()
      .then((paths) => {
        if (cancelled) return;
        for (const path of paths) openProjectPath(path);
      })
      .catch((err) => {
        console.error("launch project path restore failed:", err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
