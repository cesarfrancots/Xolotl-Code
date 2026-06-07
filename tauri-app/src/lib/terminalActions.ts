import { useTerminalStore } from "../stores/terminalStore";
import { useUiStore } from "../stores/uiStore";
import { projectDisplayName } from "../stores/projectStore";

export function openTerminalAtPath(path: string, title?: string) {
  const cleanTitle = title?.trim();
  useUiStore.getState().setTerminalPanelOpen(true);
  return useTerminalStore.getState().addTab(cleanTitle || projectDisplayName(path), path);
}
