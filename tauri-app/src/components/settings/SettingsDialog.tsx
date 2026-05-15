import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { commands } from "../../bindings";

interface ProviderConfig {
  id: string;
  label: string;
  placeholder: string;
  docsUrl?: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "kimi", label: "Kimi (Moonshot)", placeholder: "sk-..." },
  { id: "kimi_coding", label: "Kimi Coding (optional, falls back to Kimi)", placeholder: "sk-..." },
  { id: "minimax", label: "MiniMax", placeholder: "eyJ..." },
];

type TestState = "idle" | "testing" | "ok" | "error";

interface ProviderState {
  key: string;
  saving: boolean;
  testState: TestState;
  testMessage: string;
  showKey: boolean;
}

function makeInitialState(): Record<string, ProviderState> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [
      p.id,
      { key: "", saving: false, testState: "idle" as TestState, testMessage: "", showKey: false },
    ])
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<Record<string, ProviderState>>(makeInitialState);

  useEffect(() => {
    if (!open) return;
    commands.getApiKeyStatus().then((s) => setStatus(s));
  }, [open]);

  function updateProvider(id: string, patch: Partial<ProviderState>) {
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(provider: string) {
    updateProvider(provider, { saving: true });
    const result = await commands.setApiKey(provider, state[provider].key.trim());
    if (result.status === "ok") {
      setStatus((prev) => ({ ...prev, [provider]: state[provider].key.trim().length > 0 }));
      updateProvider(provider, { saving: false, key: "", testState: "idle", testMessage: "" });
    } else {
      updateProvider(provider, { saving: false });
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

  function handleClear(provider: string) {
    updateProvider(provider, { key: "••••••••••••••••" });
    // Actually set to empty to clear
    void commands.setApiKey(provider, "").then(() => {
      setStatus((prev) => ({ ...prev, [provider]: false }));
      updateProvider(provider, { key: "", testState: "idle", testMessage: "" });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>API Keys</DialogTitle>
          <DialogDescription>
            Keys are stored locally in{" "}
            <code className="text-xs bg-neutral-800 px-1 rounded">~/.xolotl-code/config.json</code>
            . Environment variables take priority.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-1">
          {PROVIDERS.map((provider) => {
            const ps = state[provider.id];
            const isSet = status[provider.id] ?? false;

            return (
              <div key={provider.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[oklch(0.88_0_0)]">
                    {provider.label}
                  </span>
                  {isSet ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="h-3 w-3" /> Configured
                    </span>
                  ) : (
                    <span className="text-xs text-[oklch(0.45_0_0)]">Not set</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={ps.showKey ? "text" : "password"}
                      placeholder={isSet ? "Enter new key to replace…" : provider.placeholder}
                      value={ps.key}
                      onChange={(e) => updateProvider(provider.id, { key: e.target.value, testState: "idle", testMessage: "" })}
                      className="pr-8 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => updateProvider(provider.id, { showKey: !ps.showKey })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[oklch(0.45_0_0)] hover:text-[oklch(0.7_0_0)]"
                    >
                      {ps.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ps.key.trim() || ps.saving}
                    onClick={() => void handleSave(provider.id)}
                  >
                    {ps.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!isSet || ps.testState === "testing"}
                    onClick={() => void handleTest(provider.id)}
                  >
                    {ps.testState === "testing" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </Button>
                </div>

                {ps.testState === "ok" && (
                  <p className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="h-3 w-3 shrink-0" />
                    {ps.testMessage}
                  </p>
                )}
                {ps.testState === "error" && (
                  <p className="flex items-center gap-1 text-xs text-red-400">
                    <XCircle className="h-3 w-3 shrink-0" />
                    {ps.testMessage}
                  </p>
                )}

                {isSet && (
                  <button
                    type="button"
                    className="self-start text-xs text-[oklch(0.45_0_0)] hover:text-red-400 underline underline-offset-2"
                    onClick={() => handleClear(provider.id)}
                  >
                    Clear key
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
