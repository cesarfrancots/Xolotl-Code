import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, XCircle, Loader2, Eye, EyeOff, Key, Plug, FileCode,
  RefreshCw, ShieldCheck, AlertCircle, Monitor, Code2, Bell, Keyboard,
  TerminalSquare,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { commands } from "../../bindings";
import type {
  ApiKeyProviderStatus,
  MacExternalAppCandidate,
  MacGlobalHotkeySettings,
  MacNotificationSettings,
  MacProductivitySettings,
  MacStatusItemSettings,
  SkillManifest,
  McpServerConfig,
  McpTestResult,
} from "../../bindings";
import { useUiStore } from "../../stores/uiStore";
import {
  getNotificationPermissionState,
  requestNotificationPermissionState,
  sendSettingsTestNotification,
  type NotificationPermissionState,
} from "../../lib/notificationActions";
import {
  DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT,
  normalizeGlobalHotkeyShortcut,
  notifyMacProductivitySettingsChanged,
} from "../../hooks/useMacGlobalHotkey";
import { useMacDialogDismissal } from "../../hooks/useMacDialogDismissal";
import { formatMacShortcut } from "../../lib/macShortcuts";

interface ProviderConfig {
  id: string;
  label: string;
  envVar: string;
  placeholder: string;
  models: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic",   label: "Anthropic",              envVar: "ANTHROPIC_API_KEY",   placeholder: "sk-ant-...", models: "Claude Sonnet, Opus, Haiku" },
  { id: "deepseek",    label: "DeepSeek",               envVar: "DEEPSEEK_API_KEY",    placeholder: "sk-...", models: "deepseek-v4-pro, deepseek-v4-flash" },
  { id: "bedrock",     label: "AWS Bedrock",            envVar: "BEDROCK_API_KEY",     placeholder: "ABSK...", models: "Bedrock Claude, Nova, Llama" },
  { id: "kimi",        label: "Kimi / Moonshot",        envVar: "KIMI_API_KEY",        placeholder: "sk-...", models: "kimi2.6" },
  { id: "kimi_coding", label: "Kimi For Coding",        envVar: "KIMI_CODING_API_KEY", placeholder: "sk-...", models: "kimi-coding" },
  { id: "minimax",     label: "MiniMax",                envVar: "MINIMAX_API_KEY",     placeholder: "sk-...", models: "MiniMax-M2.7" },
];

type Tab = "providers" | "macos" | "skills" | "mcp";

export function SettingsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("providers");
  useMacDialogDismissal(open, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xolotl-mac-dialog xolotl-mac-settings-dialog w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="xolotl-mac-dialog-header px-5 py-4">
          <DialogTitle className="text-base text-[oklch(0.92_0.015_220)]">Settings</DialogTitle>
          <DialogDescription className="text-xs text-[oklch(0.58_0.012_225)]">
            Provider keys saved from the Mac app use Keychain. Environment variables still override saved keys.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="xolotl-mac-dialog-tabbar flex items-center gap-1 px-3 py-2">
          <TabBtn active={tab === "providers"} onClick={() => setTab("providers")} icon={<Key className="w-3.5 h-3.5" />} label="Providers" />
          <TabBtn active={tab === "macos"} onClick={() => setTab("macos")} icon={<Monitor className="w-3.5 h-3.5" />} label="macOS" />
          <TabBtn active={tab === "skills"} onClick={() => setTab("skills")} icon={<FileCode className="w-3.5 h-3.5" />} label="Skills" />
          <TabBtn active={tab === "mcp"} onClick={() => setTab("mcp")} icon={<Plug className="w-3.5 h-3.5" />} label="MCP Servers" />
        </div>

        <div className="xolotl-mac-dialog-scroll max-h-[72vh] overflow-y-auto">
          {tab === "providers" && <ProvidersPanel open={open} />}
          {tab === "macos" && <MacPanel open={open} />}
          {tab === "skills" && <SkillsPanel open={open} />}
          {tab === "mcp" && <McpPanel open={open} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
        active
          ? "bg-[oklch(0.145_0.010_195)] text-[oklch(0.76_0.040_190)] shadow-[inset_0_0_0_1px_oklch(0.36_0.022_195)]"
          : "text-[oklch(0.52_0.010_225)] hover:text-[oklch(0.82_0.015_220)] hover:bg-[oklch(0.15_0.004_245)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROVIDERS
// ════════════════════════════════════════════════════════════════════════════
type TestState = "idle" | "testing" | "ok" | "error";
interface ProviderState {
  key: string;
  saving: boolean;
  migrating: boolean;
  testState: TestState;
  testMessage: string;
  showKey: boolean;
}

const EMPTY_API_KEY_STATUS: ApiKeyProviderStatus = {
  configured: false,
  source: "none",
  error: null,
};

function makeInitialState(): Record<string, ProviderState> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { key: "", saving: false, migrating: false, testState: "idle" as TestState, testMessage: "", showKey: false }])
  );
}

function providerStatusLabel(source: string): string | null {
  switch (source) {
    case "environment":
      return "Env var";
    case "macos_keychain":
      return "Keychain";
    case "config_file":
      return "Config file";
    case "macos_keychain_error":
      return "Keychain error";
    default:
      return null;
  }
}

function providerStatusTone(status: ApiKeyProviderStatus): "ok" | "error" | "empty" {
  if (status.error) return "error";
  if (status.configured) return "ok";
  return "empty";
}

function confirmKeychainMigration(provider: ProviderConfig): boolean {
  return window.confirm(
    `Move the ${provider.label} key from ~/.xolotl-code/config.json to macOS Keychain? The plaintext config entry is removed after the Keychain write succeeds.`
  );
}

function ProvidersPanel({ open }: { open: boolean }) {
  const [status, setStatus] = useState<Record<string, ApiKeyProviderStatus>>({});
  const [state, setState] = useState<Record<string, ProviderState>>(makeInitialState);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const next = await commands.getApiKeyStatus();
      setStatus(next);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  function updateProvider(id: string, patch: Partial<ProviderState>) {
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(provider: string) {
    updateProvider(provider, { saving: true });
    const result = await commands.setApiKey(provider, state[provider].key.trim());
    if (result.status === "ok") {
      await refreshStatus();
      updateProvider(provider, { saving: false, key: "", testState: "idle", testMessage: "" });
    } else {
      updateProvider(provider, { saving: false, testState: "error", testMessage: result.error });
    }
  }

  async function handleTest(provider: string) {
    updateProvider(provider, { testState: "testing", testMessage: "" });
    const result = await commands.testApiConnection(provider);
    if (result.status === "ok") {
      updateProvider(provider, { testState: "ok", testMessage: result.data });
    } else {
      updateProvider(provider, { testState: "error", testMessage: result.error });
    }
  }

  async function handleClear(provider: string) {
    updateProvider(provider, { saving: true });
    const result = await commands.setApiKey(provider, "");
    if (result.status === "ok") {
      await refreshStatus();
      updateProvider(provider, { key: "", testState: "idle", testMessage: "" });
    } else {
      updateProvider(provider, { testState: "error", testMessage: result.error });
    }
    updateProvider(provider, { saving: false });
  }

  async function handleMigrate(provider: ProviderConfig) {
    if (!confirmKeychainMigration(provider)) return;

    updateProvider(provider.id, { migrating: true, testState: "idle", testMessage: "" });
    const result = await commands.migrateApiKeyToKeychain(provider.id);
    if (result.status === "ok") {
      setStatus((prev) => ({ ...prev, [provider.id]: result.data }));
      await refreshStatus();
      updateProvider(provider.id, {
        migrating: false,
        testState: "ok",
        testMessage: "Moved to macOS Keychain.",
      });
    } else {
      updateProvider(provider.id, {
        migrating: false,
        testState: "error",
        testMessage: result.error,
      });
    }
  }

  const configuredCount = PROVIDERS.filter((provider) => status[provider.id]?.configured).length;
  const hasAnyProvider = configuredCount > 0;
  const primaryReady = Boolean(
    status.kimi_coding?.configured
      || status.deepseek?.configured
      || status.anthropic?.configured
      || status.bedrock?.configured
  );

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
        <div className={[
          "rounded-md border px-3 py-3",
          hasAnyProvider
            ? "border-[oklch(0.30_0.045_155)] bg-[oklch(0.145_0.018_155)]/55"
            : "border-[oklch(0.34_0.040_70)] bg-[oklch(0.145_0.014_70)]/50",
        ].join(" ")}>
          <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
            {hasAnyProvider ? (
              <ShieldCheck className="h-4 w-4 text-[oklch(0.70_0.080_155)]" />
            ) : (
              <AlertCircle className="h-4 w-4 text-[oklch(0.72_0.080_70)]" />
            )}
            Provider readiness
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[oklch(0.58_0.012_225)]">
            {hasAnyProvider
              ? `${configuredCount} of ${PROVIDERS.length} providers configured. ${primaryReady ? "Chat and goal eval can use configured models." : "Add Kimi Coding, DeepSeek, Anthropic, or Bedrock for the main coding models."}`
              : "Add at least one provider key before running chat, agents, or model evals."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refreshStatus()} disabled={loadingStatus} className="self-start gap-1 text-xs">
          {loadingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {PROVIDERS.map((provider) => {
        const ps = state[provider.id];
        const providerStatus = status[provider.id] ?? EMPTY_API_KEY_STATUS;
        const isSet = providerStatus.configured;
        const sourceLabel = providerStatusLabel(providerStatus.source);
        const needsMigration = providerStatus.source === "config_file";
        const statusTone = providerStatusTone(providerStatus);
        return (
          <div key={provider.id} className="flex flex-col gap-2 rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[oklch(0.88_0.015_220)]">{provider.label}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[oklch(0.50_0.010_225)]">
                  <code className="rounded bg-[oklch(0.15_0.004_245)] px-1 py-0.5">{provider.envVar}</code>
                  <span>{provider.models}</span>
                </div>
              </div>
              {statusTone === "ok" ? (
                <span className="flex flex-none items-center gap-1 rounded border border-[oklch(0.32_0.045_155)] bg-[oklch(0.15_0.018_155)] px-2 py-0.5 text-xs text-[oklch(0.72_0.085_155)]">
                  <CheckCircle className="h-3 w-3" /> {sourceLabel ?? "Configured"}
                </span>
              ) : statusTone === "error" ? (
                <span className="flex flex-none items-center gap-1 rounded border border-[oklch(0.34_0.055_25)] bg-[oklch(0.15_0.018_25)] px-2 py-0.5 text-xs text-[oklch(0.72_0.095_25)]">
                  <XCircle className="h-3 w-3" /> Keychain error
                </span>
              ) : (
                <span className="flex-none rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] px-2 py-0.5 text-xs text-[oklch(0.50_0.010_225)]">Not set</span>
              )}
            </div>
            {providerStatus.error && (
              <div className="rounded-md border border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)]/55 px-2.5 py-2 text-xs leading-relaxed text-[oklch(0.73_0.085_25)]">
                <div className="flex items-start gap-1.5">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{providerStatus.error}</span>
                </div>
              </div>
            )}
            {needsMigration && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[oklch(0.34_0.035_70)] bg-[oklch(0.145_0.014_70)]/45 px-2.5 py-2 text-xs text-[oklch(0.70_0.055_70)]">
                <span>Legacy config key can be moved to Keychain.</span>
                <Button size="sm" variant="outline" disabled={ps.migrating || ps.saving} onClick={() => void handleMigrate(provider)} className="h-7 gap-1 text-xs">
                  {ps.migrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Move to Keychain
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={ps.showKey ? "text" : "password"}
                  placeholder={isSet ? "Enter new key to replace..." : provider.placeholder}
                  value={ps.key}
                  onChange={(e) => updateProvider(provider.id, { key: e.target.value, testState: "idle", testMessage: "" })}
                  className="pr-8 text-sm font-mono border-[oklch(0.24_0.010_235)] bg-[oklch(0.105_0.004_245)]"
                />
                <button
                  type="button"
                  aria-label={ps.showKey ? "Hide API key" : "Show API key"}
                  title={ps.showKey ? "Hide API key" : "Show API key"}
                  onClick={() => updateProvider(provider.id, { showKey: !ps.showKey })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[oklch(0.46_0.010_225)] hover:text-[oklch(0.72_0.015_220)]"
                >
                  {ps.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button size="sm" variant="outline" disabled={!ps.key.trim() || ps.saving} onClick={() => void handleSave(provider.id)}>
                {ps.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" disabled={!isSet || ps.testState === "testing"} onClick={() => void handleTest(provider.id)}>
                {ps.testState === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
              </Button>
            </div>
            {ps.testState === "ok" && (
              <p className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle className="h-3 w-3 shrink-0" /> {ps.testMessage}
              </p>
            )}
            {ps.testState === "error" && (
              <p className="flex items-center gap-1 text-xs text-red-400">
                <XCircle className="h-3 w-3 shrink-0" /> {ps.testMessage}
              </p>
            )}
            {isSet && (
              <button type="button" className="self-start text-xs text-[oklch(0.48_0.010_225)] hover:text-red-400 underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50" disabled={ps.saving} onClick={() => void handleClear(provider.id)}>
                Clear key
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// macOS
// ════════════════════════════════════════════════════════════════════════════
const EMPTY_MAC_SETTINGS: MacProductivitySettings = {
  external_editor: null,
  external_terminal: null,
  detected_editors: [],
  detected_terminals: [],
  global_hotkey: {
    enabled: false,
    shortcut: DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT,
  },
  status_item: {
    enabled: false,
  },
  notifications: {
    agent_finished: false,
    eval_finished: false,
    permission_required: false,
  },
};

const EDITOR_PRESETS = ["Visual Studio Code", "Cursor", "Zed", "Sublime Text"];
const TERMINAL_PRESETS = ["Terminal", "iTerm", "Warp"];
const HOTKEY_PRESETS = [
  DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT,
  "CommandOrControl+Option+X",
  "CommandOrControl+Shift+X",
];

interface MacAppChoice {
  label: string;
  value: string;
  path?: string;
  installed: boolean;
}

function macAppChoices(detected: MacExternalAppCandidate[], presets: string[]): MacAppChoice[] {
  const seen = new Set<string>();
  const installed = detected.map((candidate) => {
    seen.add(candidate.value);
    return {
      label: candidate.label,
      value: candidate.value,
      path: candidate.path,
      installed: true,
    };
  });
  return [
    ...installed,
    ...presets
      .filter((preset) => !seen.has(preset))
      .map((preset) => ({
        label: preset,
        value: preset,
        installed: false,
      })),
  ];
}

function macRecoveryHint(error: string): string | null {
  const lower = error.toLowerCase();
  if (lower.includes("notification") || lower.includes("system settings")) {
    return "Open macOS System Settings > Notifications and allow Xolotl Code, then return here and retry.";
  }
  if (lower.includes("hotkey") || lower.includes("shortcut") || lower.includes("accelerator") || lower.includes("registered")) {
    return "Pick a different shortcut, save again, or disable the global hotkey if another Mac app owns it.";
  }
  if (lower.includes("terminal") || lower.includes("iterm") || lower.includes("warp")) {
    return "Use Terminal, iTerm, Warp, an installed app bundle path, or a full executable path, then save the terminal preference again.";
  }
  if (lower.includes("editor") || lower.includes("application") || lower.includes("executable")) {
    return "Use an installed app name or a full executable path, then save the editor preference again.";
  }
  return null;
}

function macNotificationStatusTone(permission: NotificationPermissionState): "ok" | "warning" | "muted" | "error" {
  if (permission === "granted") return "ok";
  if (permission === "denied") return "error";
  if (permission === "default" || permission === "unknown") return "warning";
  return "muted";
}

function MacPanel({ open }: { open: boolean }) {
  const [settings, setSettings] = useState<MacProductivitySettings>(EMPTY_MAC_SETTINGS);
  const [editor, setEditor] = useState("");
  const [terminal, setTerminal] = useState("");
  const [hotkeyShortcut, setHotkeyShortcut] = useState(DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>("unknown");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function applyMacSettings(next: MacProductivitySettings) {
    setSettings(next);
    setEditor(next.external_editor ?? "");
    setTerminal(next.external_terminal ?? "");
    setHotkeyShortcut(normalizeGlobalHotkeyShortcut(next.global_hotkey.shortcut));
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await commands.getMacProductivitySettings();
      applyMacSettings(next);
      setNotificationPermission(await getNotificationPermissionState());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function saveEditor(value = editor) {
    setSaving(true);
    setMessage("");
    setError("");
    const result = await commands.setExternalEditor(value.trim());
    if (result.status === "ok") {
      applyMacSettings(result.data);
      notifyMacProductivitySettingsChanged(result.data);
      setMessage(result.data.external_editor ? "External editor saved." : "External editor cleared.");
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  async function saveTerminal(value = terminal) {
    setSaving(true);
    setMessage("");
    setError("");
    const result = await commands.setExternalTerminal(value.trim());
    if (result.status === "ok") {
      applyMacSettings(result.data);
      notifyMacProductivitySettingsChanged(result.data);
      setMessage(result.data.external_terminal ? "External terminal saved." : "External terminal cleared.");
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  async function saveGlobalHotkey(patch: Partial<MacGlobalHotkeySettings> = {}) {
    setSaving(true);
    setMessage("");
    setError("");
    const nextHotkey = {
      enabled: patch.enabled ?? settings.global_hotkey.enabled,
      shortcut: normalizeGlobalHotkeyShortcut(patch.shortcut ?? hotkeyShortcut),
    };
    const result = await commands.setMacGlobalHotkeySettings(nextHotkey);
    if (result.status === "ok") {
      applyMacSettings(result.data);
      notifyMacProductivitySettingsChanged(result.data);
      setMessage(result.data.global_hotkey.enabled ? "Global hotkey saved." : "Global hotkey disabled.");
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  async function saveStatusItem(patch: Partial<MacStatusItemSettings> = {}) {
    setSaving(true);
    setMessage("");
    setError("");
    const nextStatusItem = {
      enabled: patch.enabled ?? settings.status_item.enabled,
    };
    const result = await commands.setMacStatusItemSettings(nextStatusItem);
    if (result.status === "ok") {
      applyMacSettings(result.data);
      notifyMacProductivitySettingsChanged(result.data);
      setMessage(result.data.status_item.enabled ? "Menu bar status item enabled." : "Menu bar status item disabled.");
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  async function ensureNotificationPermission(): Promise<boolean> {
    let permission = await getNotificationPermissionState();
    if (permission === "default" || permission === "unknown") {
      permission = await requestNotificationPermissionState();
    }
    setNotificationPermission(permission);
    if (permission === "granted") return true;
    setError(
      permission === "denied"
        ? "Notifications are blocked in macOS System Settings."
        : "Notification permission is not available."
    );
    return false;
  }

  async function saveNotifications(nextNotifications: MacNotificationSettings) {
    setSaving(true);
    setMessage("");
    setError("");
    const enabling = Object.entries(nextNotifications).some(([key, value]) => (
      value && !settings.notifications[key as keyof MacNotificationSettings]
    ));
    if (enabling && !(await ensureNotificationPermission())) {
      setSaving(false);
      return;
    }
    const result = await commands.setMacNotificationSettings(nextNotifications);
    if (result.status === "ok") {
      applyMacSettings(result.data);
      notifyMacProductivitySettingsChanged(result.data);
      setMessage("Notification settings saved.");
    } else {
      setError(result.error);
    }
    setSaving(false);
  }

  async function toggleNotification(key: keyof MacNotificationSettings, checked: boolean) {
    await saveNotifications({
      ...settings.notifications,
      [key]: checked,
    });
  }

  async function handleRequestNotificationPermission() {
    setMessage("");
    setError("");
    const permission = await requestNotificationPermissionState();
    setNotificationPermission(permission);
    setMessage(permission === "granted" ? "Notification permission granted." : "");
    if (permission === "denied") setError("Notifications are blocked in macOS System Settings.");
  }

  function handleSendTestNotification() {
    try {
      sendSettingsTestNotification();
      setMessage("Test notification sent.");
      setError("");
    } catch (err) {
      setError(String(err));
      setMessage("");
    }
  }

  const editorChoices = macAppChoices(settings.detected_editors, EDITOR_PRESETS);
  const terminalChoices = macAppChoices(settings.detected_terminals, TERMINAL_PRESETS);

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
        <MacStatusTile
          icon={Code2}
          label="Editor"
          value={settings.external_editor ?? "Not configured"}
          tone={settings.external_editor ? "ok" : "muted"}
        />
        <MacStatusTile
          icon={TerminalSquare}
          label="Terminal"
          value={settings.external_terminal ?? "Not configured"}
          tone={settings.external_terminal ? "ok" : "muted"}
        />
        <MacStatusTile
          icon={Keyboard}
          label="Global Hotkey"
          value={settings.global_hotkey.enabled ? formatMacShortcut(settings.global_hotkey.shortcut) : "Disabled"}
          tone={settings.global_hotkey.enabled ? "ok" : "muted"}
        />
        <MacStatusTile
          icon={Monitor}
          label="Menu Bar"
          value={settings.status_item.enabled ? "Shown" : "Hidden"}
          tone={settings.status_item.enabled ? "ok" : "muted"}
        />
        <MacStatusTile
          icon={Bell}
          label="Notifications"
          value={notificationPermissionLabel(notificationPermission)}
          tone={macNotificationStatusTone(notificationPermission)}
        />
      </div>

      <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
          <Code2 className="h-4 w-4 text-[oklch(0.68_0.050_190)]" />
          Preferred external editor
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[oklch(0.58_0.012_225)]">
          Project rows and the command palette use this app name or executable path.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={editor}
            onChange={(e) => {
              setEditor(e.target.value);
              setMessage("");
              setError("");
            }}
            placeholder="Visual Studio Code, Cursor, Zed, or /usr/local/bin/code"
            className="text-sm border-[oklch(0.24_0.010_235)] bg-[oklch(0.105_0.004_245)]"
          />
          <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => void saveEditor()} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving || loading || !settings.external_editor} onClick={() => void saveEditor("")}>
            Clear
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {editorChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-label={choice.installed ? `Use installed editor ${choice.label}` : `Use editor preset ${choice.label}`}
              title={choice.path}
              onClick={() => {
                setEditor(choice.value);
                setMessage("");
                setError("");
              }}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                choice.installed
                  ? "border-[oklch(0.34_0.038_185)] bg-[oklch(0.15_0.010_205)] text-[oklch(0.78_0.040_190)] hover:border-[oklch(0.44_0.052_185)] hover:text-[oklch(0.90_0.045_190)]"
                  : "border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] text-[oklch(0.62_0.016_220)] hover:border-[oklch(0.35_0.025_195)] hover:text-[oklch(0.82_0.025_210)]"
              }`}
            >
              <span>{choice.label}</span>
              {choice.installed && (
                <span className="rounded bg-[oklch(0.20_0.020_190)] px-1 text-[9px] uppercase text-[oklch(0.72_0.038_185)]">
                  Installed
                </span>
              )}
            </button>
          ))}
        </div>
        {settings.external_editor && (
          <p className="mt-2 text-xs text-[oklch(0.62_0.018_205)]">
            Current: <code className="rounded bg-[oklch(0.15_0.004_245)] px-1 py-0.5 text-[10px]">{settings.external_editor}</code>
          </p>
        )}
      </div>

      <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
          <TerminalSquare className="h-4 w-4 text-[oklch(0.68_0.050_190)]" />
          Preferred external terminal
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[oklch(0.58_0.012_225)]">
          Terminal cwd actions can hand off the active folder to a native Mac terminal app.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={terminal}
            onChange={(e) => {
              setTerminal(e.target.value);
              setMessage("");
              setError("");
            }}
            placeholder="Terminal, iTerm, Warp, or /Applications/Warp.app"
            className="text-sm border-[oklch(0.24_0.010_235)] bg-[oklch(0.105_0.004_245)]"
          />
          <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => void saveTerminal()} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Terminal"}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving || loading || !settings.external_terminal} onClick={() => void saveTerminal("")}>
            Clear
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {terminalChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-label={choice.installed ? `Use installed terminal ${choice.label}` : `Use terminal preset ${choice.label}`}
              title={choice.path}
              onClick={() => {
                setTerminal(choice.value);
                setMessage("");
                setError("");
              }}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                choice.installed
                  ? "border-[oklch(0.34_0.038_185)] bg-[oklch(0.15_0.010_205)] text-[oklch(0.78_0.040_190)] hover:border-[oklch(0.44_0.052_185)] hover:text-[oklch(0.90_0.045_190)]"
                  : "border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] text-[oklch(0.62_0.016_220)] hover:border-[oklch(0.35_0.025_195)] hover:text-[oklch(0.82_0.025_210)]"
              }`}
            >
              <span>{choice.label}</span>
              {choice.installed && (
                <span className="rounded bg-[oklch(0.20_0.020_190)] px-1 text-[9px] uppercase text-[oklch(0.72_0.038_185)]">
                  Installed
                </span>
              )}
            </button>
          ))}
        </div>
        {settings.external_terminal && (
          <p className="mt-2 text-xs text-[oklch(0.62_0.018_205)]">
            Current: <code className="rounded bg-[oklch(0.15_0.004_245)] px-1 py-0.5 text-[10px]">{settings.external_terminal}</code>
          </p>
        )}
      </div>

      <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
          <Monitor className="h-4 w-4 text-[oklch(0.68_0.050_190)]" />
          Menu bar helper
        </div>
        <div className="mt-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-3 py-2 text-xs text-[oklch(0.76_0.018_220)]">
            <input
              type="checkbox"
              checked={settings.status_item.enabled}
              disabled={saving || loading}
              onChange={(event) => void saveStatusItem({ enabled: event.target.checked })}
              className="h-4 w-4 accent-[oklch(0.68_0.050_190)]"
            />
            <span>Show menu bar status item</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-[oklch(0.58_0.012_225)]">
          Shows active project, agent, and eval status with quick access to Xolotl commands.
        </p>
      </div>

      <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
          <Keyboard className="h-4 w-4 text-[oklch(0.68_0.050_190)]" />
          Global hotkey
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded border border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-3 py-2 text-xs text-[oklch(0.76_0.018_220)]">
            <input
              type="checkbox"
              checked={settings.global_hotkey.enabled}
              disabled={saving || loading}
              onChange={(event) => void saveGlobalHotkey({ enabled: event.target.checked })}
              className="h-4 w-4 accent-[oklch(0.68_0.050_190)]"
            />
            <span>Enable global hotkey</span>
          </label>
          <Input
            aria-label="Global hotkey shortcut"
            value={hotkeyShortcut}
            onChange={(e) => {
              setHotkeyShortcut(e.target.value);
              setMessage("");
              setError("");
            }}
            placeholder={DEFAULT_MAC_GLOBAL_HOTKEY_SHORTCUT}
            className="min-w-0 text-sm font-mono border-[oklch(0.24_0.010_235)] bg-[oklch(0.105_0.004_245)] lg:flex-1"
          />
          <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => void saveGlobalHotkey()} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Hotkey"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {HOTKEY_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setHotkeyShortcut(preset);
                setMessage("");
                setError("");
              }}
              className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] px-2 py-1 text-[11px] text-[oklch(0.62_0.016_220)] transition-colors hover:border-[oklch(0.35_0.025_195)] hover:text-[oklch(0.82_0.025_210)]"
            >
              {formatMacShortcut(preset)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[oklch(0.58_0.012_225)]">
          Current: <code className="rounded bg-[oklch(0.15_0.004_245)] px-1 py-0.5 text-[10px]">{settings.global_hotkey.enabled ? formatMacShortcut(settings.global_hotkey.shortcut) : "Disabled"}</code>
        </p>
      </div>

      <div className="rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)] px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[oklch(0.90_0.025_220)]">
          <Bell className="h-4 w-4 text-[oklch(0.68_0.050_190)]" />
          Notifications
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[oklch(0.58_0.012_225)]">
          <span className="rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] px-2 py-1">
            Permission: {notificationPermissionLabel(notificationPermission)}
          </span>
          <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => void handleRequestNotificationPermission()}>
            Request Permission
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving || loading || notificationPermission !== "granted"}
            onClick={handleSendTestNotification}
          >
            Send Test
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <NotificationToggle
            label="Agent finished"
            checked={settings.notifications.agent_finished}
            disabled={saving || loading}
            onChange={(checked) => void toggleNotification("agent_finished", checked)}
          />
          <NotificationToggle
            label="Eval finished"
            checked={settings.notifications.eval_finished}
            disabled={saving || loading}
            onChange={(checked) => void toggleNotification("eval_finished", checked)}
          />
          <NotificationToggle
            label="Permission required"
            checked={settings.notifications.permission_required}
            disabled={saving || loading}
            onChange={(checked) => void toggleNotification("permission_required", checked)}
          />
        </div>
      </div>

      {message && (
        <p className="flex items-center gap-1 rounded-md border border-[oklch(0.32_0.045_155)] bg-[oklch(0.145_0.018_155)]/45 px-2.5 py-2 text-xs text-emerald-400">
          <CheckCircle className="h-3 w-3 shrink-0" /> {message}
        </p>
      )}
      {error && (
        <MacRecoveryPanel message={error} hint={macRecoveryHint(error)} />
      )}
    </div>
  );
}

function MacStatusTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "ok" | "warning" | "muted" | "error";
}) {
  const toneClasses = {
    ok: "border-[oklch(0.30_0.045_155)] bg-[oklch(0.145_0.018_155)]/45 text-[oklch(0.74_0.080_155)]",
    warning: "border-[oklch(0.34_0.040_70)] bg-[oklch(0.145_0.014_70)]/50 text-[oklch(0.76_0.080_70)]",
    muted: "border-[oklch(0.22_0.008_240)] bg-[oklch(0.118_0.004_245)] text-[oklch(0.58_0.012_225)]",
    error: "border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)]/55 text-[oklch(0.76_0.090_25)]",
  }[tone];

  return (
    <div className={`min-w-0 rounded-md border px-3 py-2 ${toneClasses}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 flex-none" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[oklch(0.52_0.010_225)]">{label}</div>
          <div className="mt-0.5 truncate text-xs font-medium" title={value}>{value}</div>
        </div>
      </div>
    </div>
  );
}

function MacRecoveryPanel({ message, hint }: { message: string; hint: string | null }) {
  return (
    <div className="rounded-md border border-[oklch(0.34_0.055_25)] bg-[oklch(0.145_0.018_25)]/55 px-2.5 py-2 text-xs text-[oklch(0.76_0.090_25)]">
      <div className="flex items-start gap-1.5">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <div>{message}</div>
          {hint && <div className="mt-1 text-[oklch(0.70_0.065_45)]">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function notificationPermissionLabel(permission: NotificationPermissionState): string {
  switch (permission) {
    case "granted": return "Granted";
    case "denied": return "Blocked";
    case "default": return "Not requested";
    case "unsupported": return "Unavailable";
    default: return "Unknown";
  }
}

function NotificationToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-[oklch(0.22_0.008_240)] bg-[oklch(0.105_0.004_245)] px-3 py-2 text-xs text-[oklch(0.76_0.018_220)]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[oklch(0.68_0.050_190)]"
      />
      <span>{label}</span>
    </label>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SKILLS
// ════════════════════════════════════════════════════════════════════════════
function SkillsPanel({ open }: { open: boolean }) {
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const enabledSkills = useUiStore((s) => s.enabledSkills);
  const toggleSkill = useUiStore((s) => s.toggleSkill);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await commands.listSkills();
      setSkills(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function openPreview(name: string) {
    const r = await commands.readSkill(name);
    if (r.status === "ok") setPreview({ name, content: r.data });
  }

  return (
    <div className="flex flex-col p-5 gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[oklch(0.56_0.012_225)] leading-relaxed">
          Skills are loaded from <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">~/.xolotl-code/skills/&lt;name&gt;/SKILL.md</code>. Enabled skills are advertised on chat turns.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} className="text-xs h-7 gap-1 flex-none">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Reload
        </Button>
      </div>

      {skills.length === 0 ? (
        <EmptyHint
          icon={FileCode}
          title="No skills installed"
          hint={<>Drop a folder at <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">~/.xolotl-code/skills/&lt;name&gt;/</code> containing a <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">SKILL.md</code> file.</>}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((s) => {
            const enabled = enabledSkills.includes(s.name);
            return (
              <div key={s.name} className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-[oklch(0.22_0.008_240)] hover:border-[oklch(0.30_0.016_215)] bg-[oklch(0.125_0.004_245)]">
                <button
                  onClick={() => toggleSkill(s.name)}
                  className={[
                    "mt-0.5 w-9 h-5 flex-none rounded-full transition-colors relative",
                    enabled ? "bg-[oklch(0.42_0.030_190)]" : "bg-[oklch(0.22_0.008_240)]",
                  ].join(" ")}
                  title={enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[oklch(0.90_0.015_220)]">{s.name}</span>
                    <span className="text-[10px] text-[oklch(0.48_0.010_225)] font-mono">{(s.body_bytes / 1024).toFixed(1)}KB</span>
                    {(s.allowed_tools?.length ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] text-[oklch(0.60_0.012_225)]">{s.allowed_tools!.length} tools</span>
                    )}
                  </div>
                  <p className="text-xs text-[oklch(0.56_0.012_225)] mt-0.5 leading-relaxed">
                    {s.description || <span className="italic text-[oklch(0.42_0.008_225)]">no description</span>}
                  </p>
                </div>
                <button onClick={() => void openPreview(s.name)} className="text-xs text-[oklch(0.54_0.010_225)] hover:text-[oklch(0.82_0.015_220)] flex items-center gap-1 flex-none mt-1" title="Preview SKILL.md">
                  <FileCode className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {preview && <SkillPreview name={preview.name} content={preview.content} onClose={() => setPreview(null)} />}
    </div>
  );
}

function SkillPreview({ name, content, onClose }: { name: string; content: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-5xl gap-0 p-0 overflow-hidden rounded-md border-[oklch(0.22_0.008_240)] bg-[oklch(0.108_0.004_245)]">
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-[oklch(0.22_0.008_240)] bg-[oklch(0.118_0.004_245)]">
          <DialogTitle className="text-sm flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[oklch(0.62_0.035_190)]" />
            {name} / SKILL.md
          </DialogTitle>
        </DialogHeader>
        <pre className="px-4 py-3 text-xs font-mono leading-relaxed text-[oklch(0.84_0.012_220)] bg-[oklch(0.102_0.003_245)] max-h-[60vh] overflow-y-auto whitespace-pre-wrap">{content}</pre>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MCP
// ════════════════════════════════════════════════════════════════════════════
function McpPanel({ open }: { open: boolean }) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [tests, setTests] = useState<Record<string, McpTestResult & { running?: boolean }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await commands.listMcpServers();
      setServers(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  async function runTest(name: string) {
    setTests((prev) => ({ ...prev, [name]: { ok: false, message: "Testing…", latency_ms: null, running: true } }));
    const r = await commands.testMcpServer(name);
    setTests((prev) => ({ ...prev, [name]: { ...r, running: false } }));
  }

  return (
    <div className="flex flex-col p-5 gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[oklch(0.56_0.012_225)] leading-relaxed">
          MCP servers come from <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">~/.xolotl-code/mcp.json</code> and project-level <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">.mcp.json</code>.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} className="text-xs h-7 gap-1 flex-none">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Reload
        </Button>
      </div>

      <div className="rounded-md border border-[oklch(0.34_0.040_70)] bg-[oklch(0.145_0.014_70)]/50 px-3 py-2 text-[11px] text-[oklch(0.72_0.080_70)] leading-relaxed">
        <strong className="text-[oklch(0.78_0.090_70)]">Scaffold mode.</strong> Servers are discoverable and reachability-testable. Model tool routing is not wired into chat yet.
      </div>

      {servers.length === 0 ? (
        <EmptyHint
          icon={Plug}
          title="No MCP servers configured"
          hint={
            <>
              Create <code className="text-[10px] bg-[oklch(0.15_0.004_245)] px-1 rounded">~/.xolotl-code/mcp.json</code> with the same shape Claude Code uses:
              <pre className="mt-2 px-2 py-1.5 rounded bg-[oklch(0.102_0.003_245)] text-[10px] font-mono text-[oklch(0.74_0.012_220)] overflow-x-auto">{`{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/some/path"]
    }
  }
}`}</pre>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {servers.map((s) => {
            const t = tests[s.name];
            const dot =
              t?.running ? "bg-[oklch(0.72_0.080_70)] animate-pulse" :
              t?.ok      ? "bg-green-500" :
              t          ? "bg-red-500" :
                           "bg-[oklch(0.34_0.010_235)]";
            return (
              <div key={s.name} className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.125_0.004_245)]">
                <div className={`mt-1.5 w-2 h-2 rounded-full flex-none ${dot}`} title={t?.message ?? "untested"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[oklch(0.90_0.015_220)]">{s.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.15_0.004_245)] text-[oklch(0.60_0.012_225)] uppercase tracking-wider font-mono">{s.transport}</span>
                    <span className="text-[10px] text-[oklch(0.48_0.010_225)]">scope: {s.scope}</span>
                    {t?.latency_ms != null && <span className="text-[10px] text-emerald-400 tabular-nums">{t.latency_ms}ms</span>}
                  </div>
                  <p className="text-xs text-[oklch(0.56_0.012_225)] mt-0.5 font-mono truncate">
                    {s.transport === "http"
                      ? s.url
                      : `${s.command ?? "?"} ${(s.args ?? []).join(" ")}`}
                  </p>
                  {t?.message && !t.running && (
                    <p className={`text-[10px] mt-1 ${t.ok ? "text-emerald-400" : "text-red-400"}`}>{t.message}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => void runTest(s.name)} disabled={t?.running} className="text-xs h-7 flex-none">
                  {t?.running ? <Loader2 className="w-3 h-3 animate-spin" /> : "Test"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyHint({
  icon: Icon, title, hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6 gap-3 rounded-md border border-[oklch(0.22_0.008_240)] bg-[oklch(0.115_0.004_245)]">
      <div className="w-10 h-10 rounded border border-[oklch(0.24_0.010_235)] bg-[oklch(0.14_0.006_235)] flex items-center justify-center">
        <Icon className="w-4 h-4 text-[oklch(0.54_0.025_195)]" />
      </div>
      <p className="text-sm font-medium text-[oklch(0.88_0.015_220)]">{title}</p>
      <div className="text-xs text-[oklch(0.56_0.012_225)] max-w-md leading-relaxed">{hint}</div>
    </div>
  );
}
