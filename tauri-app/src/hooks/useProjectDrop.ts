import { useEffect } from "react";
import type { DragDropEvent } from "@tauri-apps/api/window";
import { useProjectStore } from "../stores/projectStore";

type TauriGlobal = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export function firstDroppedProjectPath(paths: string[]): string | null {
  const path = paths.find((candidate) => candidate.trim().length > 0);
  return path ? path.trim() : null;
}

export function isTauriRuntime() {
  return Boolean((window as TauriGlobal).__TAURI_INTERNALS__);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function useProjectDrop() {
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload as DragDropEvent;
        if (payload.type !== "drop") return;
        const path = firstDroppedProjectPath(payload.paths);
        if (path) void useProjectStore.getState().addProjectPath(path);
      }))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.error("project drop listener failed:", err);
        useProjectStore.getState().setProjectError(`Project drag and drop unavailable. ${errorDetail(err)}`);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
