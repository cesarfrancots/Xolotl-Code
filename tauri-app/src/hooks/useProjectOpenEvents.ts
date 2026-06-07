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

async function openProjectPath(payload: unknown) {
  const path = projectOpenPathFromPayload(payload);
  if (path) await useProjectStore.getState().addProjectPath(path);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
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
        useProjectStore.getState().setProjectError(`Project open listener unavailable. ${errorDetail(err)}`);
      });

    void commands.launchProjectPaths()
      .then(async (paths) => {
        if (cancelled) return;
        if (paths.length > 0) {
          for (const path of paths) {
            if (cancelled) return;
            await openProjectPath(path);
          }
          return;
        }
        try {
          await useProjectStore.getState().restoreActiveProject();
        } catch (err) {
          if (cancelled) return;
          console.error("last active project restore failed:", err);
          useProjectStore.getState().setProjectError(`Could not restore last active project. ${errorDetail(err)}`);
        }
      })
      .catch((err) => {
        console.error("launch project path restore failed:", err);
        useProjectStore.getState().setProjectError(`Could not restore launch project paths. ${errorDetail(err)}`);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
