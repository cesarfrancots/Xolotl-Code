import { useEffect } from "react";

function isMacCloseShortcut(event: KeyboardEvent): boolean {
  return (
    event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === "w"
  );
}

export function useMacDialogDismissal(
  open: boolean,
  onOpenChange: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isMacCloseShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, onOpenChange]);
}
