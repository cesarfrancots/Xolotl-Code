import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, XCircle, Loader2, Eye, EyeOff, Key, Sparkles, Plug, FileCode,
  RefreshCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { commands } from "../../bindings";
import type { SkillManifest, McpServerConfig, McpTestResult } from "../../bindings";
import { useUiStore } from "../../stores/uiStore";

interface ProviderConfig {
  id: string;
  label: string;
  placeholder: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic",   label: "Anthropic",                                            placeholder: "sk-ant-..." },
  { id: "bedrock",     label: "AWS Bedrock (Bearer API key)",                         placeholder: "ABSK..." },
  { id: "kimi",        label: "Kimi (Moonshot)",                                      placeholder: "sk-..." },
  { id: "kimi_coding", label: "Kimi For Coding",                                      placeholder: "sk-..." },
  { id: "minimax",     label: "MiniMax",                                              placeholder: "eyJ..." },
];

type Tab = "providers" | "skills" | "mcp";

export function SettingsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("providers");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-neutral-800">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-xs">
            Config lives in <code className="text-[10px] bg-neutral-800 px-1 rounded">~/.xolotl-code/</code>. Environment variables override config values.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-neutral-800 bg-[oklch(0.125_0_0)]">
          <TabBtn active={tab === "providers"} onClick={() => setTab("providers")} icon={<Key className="w-3.5 h-3.5" />} label="Providers" />
          <TabBtn active={tab === "skills"} onClick={() => setTab("skills")} icon={<Sparkles className="w-3.5 h-3.5" />} label="Skills" />
          <TabBtn active={tab === "mcp"} onClick={() => setTab("mcp")} icon={<Plug className="w-3.5 h-3.5" />} label="MCP Servers" />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tab === "providers" && <ProvidersPanel open={open} />}
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
          ? "bg-[oklch(0.65_0.18_250)]/15 text-[oklch(0.82_0.12_250)] shadow-[inset_0_0_0_1px_oklch(0.65_0.18_250_/_0.30)]"
          : "text-[oklch(0.50_0_0)] hover:text-[oklch(0.78_0_0)] hover:bg-[oklch(0.18_0_0)]",
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
  testState: TestState;
  testMessage: string;
  showKey: boolean;
}

function makeInitialState(): Record<string, ProviderState> {
  return Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { key: "", saving: false, testState: "idle" as TestState, testMessage: "", showKey: false }])
  );
}

function ProvidersPanel({ open }: { open: boolean }) {
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
    void commands.setApiKey(provider, "").then(() => {
      setStatus((prev) => ({ ...prev, [provider]: false }));
      updateProvider(provider, { key: "", testState: "idle", testMessage: "" });
    });
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      {PROVIDERS.map((provider) => {
        const ps = state[provider.id];
        const isSet = status[provider.id] ?? false;
        return (
          <div key={provider.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[oklch(0.88_0_0)]">{provider.label}</span>
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
              <button type="button" className="self-start text-xs text-[oklch(0.45_0_0)] hover:text-red-400 underline underline-offset-2" onClick={() => handleClear(provider.id)}>
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
        <p className="text-xs text-[oklch(0.55_0_0)] leading-relaxed">
          Skills are markdown files at <code className="text-[10px] bg-neutral-800 px-1 rounded">~/.xolotl-code/skills/&lt;name&gt;/SKILL.md</code> with a YAML frontmatter. Format matches Claude Code. Enabled skills are advertised to the model on every chat turn.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} className="text-xs h-7 gap-1 flex-none">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Reload
        </Button>
      </div>

      {skills.length === 0 ? (
        <EmptyHint
          icon={Sparkles}
          title="No skills installed"
          hint={<>Drop a folder at <code className="text-[10px] bg-neutral-800 px-1 rounded">~/.xolotl-code/skills/&lt;name&gt;/</code> containing a <code className="text-[10px] bg-neutral-800 px-1 rounded">SKILL.md</code> file.</>}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((s) => {
            const enabled = enabledSkills.includes(s.name);
            return (
              <div key={s.name} className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-neutral-800 hover:border-neutral-700 bg-[oklch(0.13_0_0)]">
                <button
                  onClick={() => toggleSkill(s.name)}
                  className={[
                    "mt-0.5 w-9 h-5 flex-none rounded-full transition-colors relative",
                    enabled ? "bg-[oklch(0.65_0.18_250)]" : "bg-neutral-700",
                  ].join(" ")}
                  title={enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[oklch(0.90_0_0)]">{s.name}</span>
                    <span className="text-[10px] text-[oklch(0.45_0_0)] font-mono">{(s.body_bytes / 1024).toFixed(1)}KB</span>
                    {(s.allowed_tools?.length ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[oklch(0.18_0_0)] text-[oklch(0.65_0_0)]">{s.allowed_tools!.length} tools</span>
                    )}
                  </div>
                  <p className="text-xs text-[oklch(0.55_0_0)] mt-0.5 leading-relaxed">
                    {s.description || <span className="italic text-[oklch(0.40_0_0)]">no description</span>}
                  </p>
                </div>
                <button onClick={() => void openPreview(s.name)} className="text-xs text-[oklch(0.55_0_0)] hover:text-[oklch(0.85_0_0)] flex items-center gap-1 flex-none mt-1" title="Preview SKILL.md">
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
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-neutral-800">
          <DialogTitle className="text-sm flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[oklch(0.65_0.18_250)]" />
            {name} / SKILL.md
          </DialogTitle>
        </DialogHeader>
        <pre className="px-4 py-3 text-xs font-mono leading-relaxed text-[oklch(0.85_0_0)] bg-[oklch(0.105_0_0)] max-h-[60vh] overflow-y-auto whitespace-pre-wrap">{content}</pre>
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
        <p className="text-xs text-[oklch(0.55_0_0)] leading-relaxed">
          MCP servers come from <code className="text-[10px] bg-neutral-800 px-1 rounded">~/.xolotl-code/mcp.json</code> (user-level) and <code className="text-[10px] bg-neutral-800 px-1 rounded">.mcp.json</code> in the current project directory.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} className="text-xs h-7 gap-1 flex-none">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Reload
        </Button>
      </div>

      <div className="rounded-md border border-yellow-700/40 bg-yellow-700/5 px-3 py-2 text-[11px] text-yellow-200/80 leading-relaxed">
        <strong className="text-yellow-300">Scaffold mode.</strong> Servers are discoverable and reachability-testable. Routing tool calls from the model through MCP is not yet wired into the chat turn — coming in a follow-up.
      </div>

      {servers.length === 0 ? (
        <EmptyHint
          icon={Plug}
          title="No MCP servers configured"
          hint={
            <>
              Create <code className="text-[10px] bg-neutral-800 px-1 rounded">~/.xolotl-code/mcp.json</code> with the same shape Claude Code uses:
              <pre className="mt-2 px-2 py-1.5 rounded bg-[oklch(0.105_0_0)] text-[10px] font-mono text-[oklch(0.75_0_0)] overflow-x-auto">{`{
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
              t?.running ? "bg-yellow-400 animate-pulse" :
              t?.ok      ? "bg-green-500" :
              t          ? "bg-red-500" :
                           "bg-neutral-600";
            return (
              <div key={s.name} className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-neutral-800 bg-[oklch(0.13_0_0)]">
                <div className={`mt-1.5 w-2 h-2 rounded-full flex-none ${dot}`} title={t?.message ?? "untested"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[oklch(0.90_0_0)]">{s.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[oklch(0.18_0_0)] text-[oklch(0.65_0_0)] uppercase tracking-wider font-mono">{s.transport}</span>
                    <span className="text-[10px] text-[oklch(0.45_0_0)]">scope: {s.scope}</span>
                    {t?.latency_ms != null && <span className="text-[10px] text-emerald-400 tabular-nums">{t.latency_ms}ms</span>}
                  </div>
                  <p className="text-xs text-[oklch(0.55_0_0)] mt-0.5 font-mono truncate">
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
    <div className="flex flex-col items-center text-center py-10 px-6 gap-3">
      <div className="w-12 h-12 rounded-full bg-[oklch(0.18_0_0)] flex items-center justify-center">
        <Icon className="w-5 h-5 text-[oklch(0.55_0_0)]" />
      </div>
      <p className="text-sm font-medium text-[oklch(0.88_0_0)]">{title}</p>
      <div className="text-xs text-[oklch(0.55_0_0)] max-w-md leading-relaxed">{hint}</div>
    </div>
  );
}

