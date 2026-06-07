import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { commands, type MacGlobalHotkeySettings, type MacProductivitySettings } from "../bindings";

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

export async function focusXolotlFromGlobalHotkey() {
  const currentWindow = getCurrentWindow();
  await currentWindow.show();
  await currentWindow.unminimize();
  await currentWindow.setFocus();
}

export function useMacGlobalHotkey() {
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let registeredShortcut: string | null = null;

    const applySettings = async (settings: MacProductivitySettings) => {
      const run = ++generation;
      const hotkey = effectiveGlobalHotkeySettings(settings);

      if (registeredShortcut && (!hotkey.enabled || registeredShortcut !== hotkey.shortcut)) {
        const previous = registeredShortcut;
        registeredShortcut = null;
        await unregister(previous).catch((err) => {
          console.warn("global hotkey unregister failed:", err);
        });
      }

      if (disposed || run !== generation || !hotkey.enabled || registeredShortcut === hotkey.shortcut) {
        return;
      }

      try {
        await register(hotkey.shortcut, (event: ShortcutEvent) => {
          if (event.state !== "Pressed") return;
          void focusXolotlFromGlobalHotkey().catch((err) => {
            console.error("global hotkey focus failed:", err);
          });
        });
        if (disposed || run !== generation) {
          await unregister(hotkey.shortcut).catch(() => undefined);
        } else {
          registeredShortcut = hotkey.shortcut;
        }
      } catch (err) {
        console.error("global hotkey registration failed:", err);
      }
    };

    const loadSettings = () => {
      void commands.getMacProductivitySettings().then(applySettings).catch((err) => {
        console.warn("global hotkey settings load failed:", err);
      });
    };

    const onSettingsChanged = (event: Event) => {
      const settings = (event as CustomEvent<MacProductivitySettings | null>).detail;
      if (settings) void applySettings(settings);
      else loadSettings();
    };

    loadSettings();
    window.addEventListener(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, onSettingsChanged);

    return () => {
      disposed = true;
      generation += 1;
      window.removeEventListener(MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT, onSettingsChanged);
      if (registeredShortcut) {
        void unregister(registeredShortcut).catch((err) => {
          console.warn("global hotkey cleanup failed:", err);
        });
        registeredShortcut = null;
      }
    };
  }, []);
}
