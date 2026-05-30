import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useUiStore } from "../../stores/uiStore";
import { TerminalPanel } from "./TerminalPanel";

/**
 * The bottom terminal dock. Rendered at the foot of the center column. When the
 * panel is toggled closed it stays mounted-but-hidden (its parent decides when
 * to unmount) so running shells survive a close/reopen. A grab handle along the
 * top edge drag-resizes the dock height.
 */
export function TerminalDock() {
  const open = useUiStore((s) => s.terminalPanelOpen);
  const height = useUiStore((s) => s.terminalPanelHeight);
  const draggingRef = useRef(false);
  // Who held focus before the dock opened — restored when it closes so keyboard
  // focus doesn't get orphaned to <body> inside the now-hidden subtree.
  const focusBeforeOpenRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);

  // Pointer Events + capture so the drag always ends even if the cursor is
  // released outside the window (plain window mouseup is not guaranteed there).
  const onHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      // Dock is anchored to the bottom: height grows as the cursor moves up.
      useUiStore.getState().setTerminalPanelHeight(window.innerHeight - ev.clientY);
    };
    const end = () => {
      draggingRef.current = false;
      document.body.style.userSelect = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }, []);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      focusBeforeOpenRef.current = document.activeElement as HTMLElement | null;
    } else if (!open && wasOpen) {
      focusBeforeOpenRef.current?.focus?.();
      focusBeforeOpenRef.current = null;
    }
  }, [open]);

  return (
    <div
      className={[
        "flex-none flex flex-col border-t border-[oklch(0.22_0.008_240)] bg-[oklch(0.085_0.004_250)]",
        open ? "" : "hidden",
      ].join(" ")}
      style={open ? { height } : undefined}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onPointerDown={onHandlePointerDown}
        className="flex-none h-1.5 cursor-row-resize bg-transparent hover:bg-[oklch(0.45_0.04_200)]/40 transition-colors"
      />
      <div className="flex-1 min-h-0">
        <TerminalPanel />
      </div>
    </div>
  );
}
