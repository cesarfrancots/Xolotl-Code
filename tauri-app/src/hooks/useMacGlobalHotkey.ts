import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { commands, type MacProductivitySettings } from "../bindings";
import { errorDetail, notifyMacAppStatus } from "../lib/macAppStatus";
import {
  effectiveGlobalHotkeySettings,
  MAC_PRODUCTIVITY_SETTINGS_CHANGED_EVENT,
} from "../lib/macProductivitySettings";

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
            notifyMacAppStatus({
              tone: "error",
              message: "Global hotkey could not focus Xolotl Code.",
              hint: `Use the Dock or Cmd+Tab to bring the app forward, then check macOS permissions if this repeats. ${errorDetail(err)}`,
            });
          });
        });
        if (disposed || run !== generation) {
          await unregister(hotkey.shortcut).catch(() => undefined);
        } else {
          registeredShortcut = hotkey.shortcut;
        }
      } catch (err) {
        console.error("global hotkey registration failed:", err);
        notifyMacAppStatus({
          tone: "error",
          message: "Global hotkey registration failed.",
          hint: `Pick a different shortcut in Settings, or disable the global hotkey if another Mac app owns it. ${errorDetail(err)}`,
        });
      }
    };

    const loadSettings = () => {
      void commands.getMacProductivitySettings().then(applySettings).catch((err) => {
        console.warn("global hotkey settings load failed:", err);
        notifyMacAppStatus({
          tone: "error",
          message: "Mac productivity settings could not load.",
          hint: `Open Settings and save the Mac productivity options again. ${errorDetail(err)}`,
        });
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
