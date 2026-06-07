import type { MacGlobalHotkeySettings, MacProductivitySettings } from "../bindings";

export const DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT = "CommandOrControl+Shift+Space";
export const MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT = "xolotl:mac-productivity-settings-changed";

export function normalizeGlobalHotkeyShortcut(shortcut: string | null | undefined): string {
  const trimmed = shortcut?.trim();
  return trimmed || DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT;
}

export function effectiveGlobalHotkeySettings(settings: MacProductivitySettings): MacGlobalHotkeySettings {
  return {
    enabled: settings.global_hotkey?.enabled ?? false,
    shortcut: normalizeGlobalHotkeyShortcut(settings.global_hotkey?.shortcut),
  };
}

export function notifyMacProductivitySettingsChanged(settings: MacProductivitySettings) {
  window.dispatchEvent(new CustomEvent(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, { detail: settings }));
}
