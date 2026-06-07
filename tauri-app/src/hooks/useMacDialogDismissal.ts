import { useEffect } from "react";

interface MacDialogDismissalEntry {
  onOpenChange: (open: boolean) => void;
}

const openDialogStack: MacDialogDismissalEntry[] = [];

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

    const entry: MacDialogDismissalEntry = { onOpenChange };
    openDialogStack.push(entry);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isMacCloseShortcut(event)) return;
      if (openDialogStack[openDialogStack.length - 1] !== entry) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      const index = openDialogStack.indexOf(entry);
      if (index >= 0) openDialogStack.splice(index, 1);
    };
  }, [open, onOpenChange]);
}
