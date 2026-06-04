import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import { SlackIcon } from "./ui/SlackIcon";
import { api, streamPullModel } from "../api";
import type { ModelInfo, User } from "../types";
import { ModelPicker } from "./ui/ModelPicker";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">{title}</h3>
      {children}
    </div>
  );
}

// ── Users tab ───────────────────────────────────────────────────────────────

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.admin.listUsers().then(setUsers).catch(() => {});
  }, []);

  async function doDelete(u: User) {
    if (!confirm(`Delete ${u.displayName} and all their chats? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.admin.deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      setMsg({ id: u.id, text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function doReset(u: User) {
    if (newPw.length < 4) { setMsg({ id: u.id, text: "Min 4 characters", ok: false }); return; }
    setBusy(true);
    try {
      await api.admin.resetPassword(u.id, newPw);
      setMsg({ id: u.id, text: "Password updated", ok: true });
      setResetting(null);
      setNewPw("");
    } catch (e) {
      setMsg({ id: u.id, text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Local users">
      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-2">
                  {u.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {u.displayName}
                    {u.isAdmin && (
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-2">
                        Admin
                      </span>
                    )}
                    {u.id === currentUserId && (
                      <span className="text-[10px] text-muted">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted">@{u.username}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg"
                  onClick={() => { setResetting(resetting === u.id ? null : u.id); setNewPw(""); setMsg(null); }}
                >
                  Reset pw
                </button>
                {u.id !== currentUserId && (
                  <button
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
                    onClick={() => doDelete(u)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            {resetting === u.id && (
              <div className="mt-2.5 flex gap-2">
                <input
                  className={inputCls}
                  type="password"
                  placeholder="New password (min 4 chars)"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doReset(u)}
                  autoFocus
                />
                <button
                  className="flex-shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
                  onClick={() => doReset(u)}
                  disabled={busy}
                >
                  Save
                </button>
              </div>
            )}
            {msg?.id === u.id && (
              <p className={`mt-1.5 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Models tab ───────────────────────────────────────────────────────────────

interface SystemAnalysis {
  info: { os: string; arch: string; cpuCount: number; cpuModel: string; ramGb: number; vramGb: number | null; gpuName: string | null; detectionMethod: string };
  recommendation: { modelId: string; label: string; reason: string; vramRequired: number | null; alternatives: { modelId: string; label: string; note: string }[]; alreadyInstalled: boolean };
}

const PROVIDER_META: Record<string, { label: string; color: string; placeholder: string }> = {
  openai:    { label: "OpenAI",    color: "text-green-400", placeholder: "sk-..." },
  anthropic: { label: "Anthropic", color: "text-amber-400", placeholder: "sk-ant-..." },
  google:    { label: "Google Gemini", color: "text-blue-400", placeholder: "AIza..." },
};

function ModelsTab() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [ollamaOnline, setOllamaOnline] = useState(true);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<SystemAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keySaving, setKeySaving] = useState<Record<string, boolean>>({});
  const [pullName, setPullName] = useState("");
  const [pullStatus, setPullStatus] = useState("");
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api.admin
      .listModels()
      .then((res: any) => {
        setModels(res.models ?? []);
        setDefaultModel(res.defaultModel ?? "");
        setOllamaOnline(res.ollamaOnline ?? true);
        setConfiguredProviders(res.configuredProviders ?? []);
      })
      .catch(() => {});
  }
  useEffect(load, []);

  async function saveProviderKey(provider: string) {
    const key = (keyInputs[provider] ?? "").trim();
    if (!key) return;
    setKeySaving((s) => ({ ...s, [provider]: true }));
    try {
      await api.keys.save(provider, key);
      setConfiguredProviders((p) => [...new Set([...p, provider])]);
      setKeyInputs((k) => ({ ...k, [provider]: "" }));
      load(); // refresh model list
    } catch { /* ignore */ }
    setKeySaving((s) => ({ ...s, [provider]: false }));
  }

  async function removeProviderKey(provider: string) {
    await api.keys.remove(provider).catch(() => {});
    setConfiguredProviders((p) => p.filter((x) => x !== provider));
    load();
  }

  async function analyzeSystem() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await fetch("/api/system", { headers: { "x-enzo-ai-token": localStorage.getItem("enzo_token") ?? "" } });
      setAnalysis(await result.json());
    } catch { /* ignore */ }
    setAnalyzing(false);
  }

  async function doSetDefault(model: string) {
    setBusy(true);
    try {
      await api.admin.setDefaultModel(model);
      setDefaultModel(model);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(name: string) {
    if (!confirm(`Remove model "${name}" from Ollama?`)) return;
    setBusy(true);
    try {
      await api.admin.deleteModel(name);
      setModels((prev) => prev.filter((m) => m.id !== name));
      if (defaultModel === name) setDefaultModel("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doPull() {
    const model = pullName.trim();
    if (!model) return;
    setPulling(true);
    setPullStatus("Starting…");
    setErr(null);
    await streamPullModel(
      model,
      (s) => setPullStatus(s),
      () => { setPulling(false); setPullStatus(""); setPullName(""); load(); },
      (e) => { setPulling(false); setPullStatus(""); setErr(e); },
    );
  }

  const localModels = models.filter(m => m.provider === "ollama");

  return (
    <div className="flex flex-col gap-6">

      {/* ── LOCAL AI ────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">🖥 Local AI</span>
          <span className={`text-[10px] font-semibold ${ollamaOnline ? "text-ok" : "text-danger"}`}>
            ● {ollamaOnline ? "Ollama running" : "Ollama offline"}
          </span>
        </div>
        {err && <p className="mb-2 text-xs text-danger">{err}</p>}

        {/* Installed models */}
        <div className="flex flex-col gap-1.5 mb-3">
          {localModels.length === 0 ? (
            <p className="text-xs text-muted py-2">No local models installed. Pull one below.</p>
          ) : localModels.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium">{m.id}</span>
              {m.label && <span className="text-xs text-muted">{m.label}</span>}
              {m.id === defaultModel && (
                <span className="rounded-full bg-ok/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ok">Default</span>
              )}
              {m.id !== defaultModel && (
                <button onClick={() => doSetDefault(m.id)} disabled={busy}
                  className="text-xs text-muted hover:text-ok">Set default</button>
              )}
              <button onClick={() => doDelete(m.id)} disabled={busy}
                className="text-xs text-muted hover:text-danger">Remove</button>
            </div>
          ))}
        </div>

        {/* Pull */}
        <div className="flex gap-2 mb-1">
          <input className={inputCls} placeholder="Pull model — e.g. llama3.1:8b"
            value={pullName} onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !pulling && doPull()} disabled={pulling} />
          <button onClick={doPull} disabled={pulling || !pullName.trim()}
            className="flex-shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
            {pulling ? "…" : "Pull"}
          </button>
        </div>
        {pullStatus && <p className="text-xs text-muted truncate mb-2">{pullStatus}</p>}
        <p className="text-[11px] text-muted mb-3">Browse at <span className="text-accent-2">ollama.com/library</span></p>

        {/* System analysis — compact */}
        {!analysis ? (
          <button onClick={analyzeSystem} disabled={analyzing}
            className="flex items-center gap-1.5 text-xs text-accent-2 hover:underline disabled:opacity-40">
            <Cpu className="h-3.5 w-3.5" />
            {analyzing ? "Analyzing…" : "Analyze hardware for best model"}
          </button>
        ) : (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div className="grid grid-cols-4 gap-1.5 mb-3">
              {[
                { label: "CPU", value: `${analysis.info.cpuCount}c` },
                { label: "RAM", value: `${analysis.info.ramGb}GB` },
                { label: "GPU", value: analysis.info.gpuName?.split(" ").slice(-2).join(" ") ?? "—" },
                { label: "VRAM", value: analysis.info.vramGb != null ? `${analysis.info.vramGb}GB` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/50 px-2 py-1.5 text-center">
                  <div className="text-[9px] text-muted">{label}</div>
                  <div className="text-xs font-semibold text-fg">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-accent-2 font-semibold">Recommended: </span>
                <span className="text-sm font-bold text-fg">{analysis.recommendation.label}</span>
                <p className="text-[11px] text-muted mt-0.5">{analysis.recommendation.reason}</p>
              </div>
              {!analysis.recommendation.alreadyInstalled && (
                <button onClick={() => setPullName(analysis.recommendation.modelId)}
                  className="flex-shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-2">
                  Pull
                </button>
              )}
            </div>
            <button onClick={() => setAnalysis(null)} className="mt-2 text-[11px] text-muted hover:text-fg">Re-analyze</button>
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      {/* ── EXTERNAL AI ─────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">☁ External AI</span>
          <span className="text-[10px] text-muted">— keys stored encrypted on this machine</span>
        </div>

        <div className="flex flex-col gap-3">
          {Object.entries(PROVIDER_META).map(([id, meta]) => {
            const isConfigured = configuredProviders.includes(id);
            const providerModels = models.filter(m => m.provider === id);
            return (
              <div key={id} className="rounded-xl border border-border bg-surface-2 overflow-hidden">
                {/* Provider header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${meta.color}`}>{meta.label}</span>
                    <span className={`text-[10px] font-semibold ${isConfigured ? "text-ok" : "text-muted"}`}>
                      {isConfigured ? "● Connected" : "● Not connected"}
                    </span>
                  </div>
                  {isConfigured && (
                    <button onClick={() => removeProviderKey(id)}
                      className="text-[11px] text-muted hover:text-danger">
                      Remove key
                    </button>
                  )}
                </div>

                {/* Model list — same style as local models */}
                {isConfigured && providerModels.length > 0 && (
                  <div className="px-3 py-2 flex flex-col gap-1">
                    {providerModels.map(m => (
                      <div key={m.id} className="flex items-center gap-2 py-0.5">
                        <span className="flex-1 truncate text-sm">{m.label ?? m.id}</span>
                        {m.id === defaultModel && (
                          <span className="rounded-full bg-ok/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ok">Default</span>
                        )}
                        {m.id !== defaultModel && (
                          <button onClick={() => doSetDefault(m.id)} disabled={busy}
                            className="text-xs text-muted hover:text-ok">
                            Set default
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* API key input */}
                <div className="flex gap-2 px-3 py-2">
                  <input type="password"
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg outline-none placeholder:text-muted focus:border-accent"
                    placeholder={isConfigured ? "Paste new key to update…" : meta.placeholder}
                    value={keyInputs[id] ?? ""}
                    onChange={(e) => setKeyInputs((k) => ({ ...k, [id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && saveProviderKey(id)} />
                  <button onClick={() => saveProviderKey(id)}
                    disabled={keySaving[id] || !(keyInputs[id] ?? "").trim()}
                    className="flex-shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                    {keySaving[id] ? "…" : isConfigured ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ── Danger tab ────────────────────────────────────────────────────────────────

function DangerTab() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doReset() {
    if (confirm !== "reset") return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/reset", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-enzo-ai-token": localStorage.getItem("enzo_token") ?? "" },
        body: JSON.stringify({ confirm: "reset" }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Wipe local state and reload — the app will show fresh registration
      localStorage.clear();
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
        <h3 className="mb-1 text-sm font-bold text-danger">⚠ Reset all data</h3>
        <p className="mb-4 text-xs text-muted leading-relaxed">
          This permanently deletes <strong className="text-fg">all users, conversations, memories, API keys, and settings</strong>.
          The app will return to a clean first-install state. This cannot be undone.
        </p>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted">
            Type <span className="font-mono text-danger">reset</span> to confirm
          </label>
          <input
            className="rounded-lg border border-danger/40 bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-danger placeholder:text-muted"
            placeholder="reset"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doReset()}
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <button
            onClick={doReset}
            disabled={confirm !== "reset" || busy}
            className="rounded-lg border border-danger bg-danger/10 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Resetting…" : "Reset everything"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tools tab ────────────────────────────────────────────────────────────────

function ToolsTab() {
  const [tools, setTools] = useState<import("../types").ToolDefinition[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.admin.listTools().then(setTools).catch(() => {});
  }, []);

  async function toggle(name: string, enabled: boolean) {
    setBusy(name);
    try {
      const updated = await api.admin.setToolEnabled(name, enabled);
      setTools(updated);
    } catch { /* ignore */ } finally {
      setBusy(null);
    }
  }

  const TOOL_DESC: Record<string, string> = {
    get_datetime: "Returns the current date and time",
    calculator: "Evaluates math expressions",
    web_search: "Searches the web via DuckDuckGo",
    read_url: "Fetches and reads a web page",
    read_file: "Reads a file from the local machine",
    list_directory: "Lists files in a local directory",
    git: "Runs read-only git commands in a repo",
  };

  return (
    <Section title="Available tools">
      <p className="mb-4 text-xs text-muted">
        Disabled tools cannot be used by any agent, even if selected during agent creation.
      </p>
      <div className="flex flex-col gap-2">
        {tools.map((t) => (
          <div key={t.name} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className={`text-sm font-semibold ${t.enabled ? "text-fg" : "text-muted line-through"}`}>
                {t.name.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-muted">{TOOL_DESC[t.name] ?? t.description}</span>
            </div>
            <button
              disabled={busy === t.name}
              onClick={() => toggle(t.name, !t.enabled)}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                t.enabled ? "bg-accent" : "bg-surface"
              } border border-border disabled:opacity-50`}
              title={t.enabled ? "Click to disable" : "Click to enable"}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                t.enabled ? "left-[22px]" : "left-0.5"
              }`} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Integrations tab ─────────────────────────────────────────────────────────

type IntegrationId = "telegram" | "discord" | "slack";

interface IntegrationDef {
  id: IntegrationId | "discord" | "slack";
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  available: boolean;
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "telegram", name: "Telegram", icon: <SiTelegram className="h-6 w-6" />, color: "text-[#2AABEE]", description: "Chat with your AI via Telegram from anywhere.",   available: true  },
  { id: "discord",  name: "Discord",  icon: <SiDiscord  className="h-6 w-6" />, color: "text-[#5865F2]", description: "Bring Enzo AI into your Discord server.",        available: true  },
  { id: "slack",    name: "Slack",    icon: <SlackIcon className="h-6 w-6" />, color: "text-[#E01E5A]", description: "Use Enzo AI directly in your Slack workspace.",  available: true  },
];

// ── Telegram config screen ────────────────────────────────────────────────────

function SlackConfig({ onBack }: { onBack: () => void }) {
  const [botToken, setBotToken]   = useState("");
  const [appToken, setAppToken]   = useState("");
  const [allowedIds, setAllowed]  = useState("");
  const [model, setModel]         = useState("");
  const [running, setRunning]     = useState(false);
  const [hasTokens, setHasTokens] = useState(false);
  const [botName, setBotName]     = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    api.admin.getSlack().then((d) => {
      setRunning(d.enabled);
      setAllowed(d.allowedIds);
      setModel(d.model);
      setHasTokens(!!(d.botToken && d.appToken));
    }).catch(() => {});
  }, []);

  async function save() {
    if (!botToken.trim() && !appToken.trim() && !hasTokens) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, string | boolean> = { allowedIds, model };
      if (botToken.trim()) body.botToken = botToken;
      if (appToken.trim()) body.appToken = appToken;
      if (running && !botToken.trim() && !appToken.trim()) body.reconnect = true;
      const res = await api.admin.saveSlack(body as any);
      setRunning(res.running);
      setHasTokens(true);
      if (res.botName) setBotName(res.botName);
      setBotToken(""); setAppToken("");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try { await api.admin.stopSlack(); setRunning(false); setBotName(null); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors">
        ← Back to integrations
      </button>
      <div className="mb-5 flex items-center gap-3">
        <SlackIcon className="h-8 w-8 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-fg">Slack</h3>
          <p className="text-xs text-muted">Bring Enzo AI into your Slack workspace.</p>
        </div>
        {running && <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ok"><span className="text-[10px]">●</span> Connected</div>}
      </div>

      {running && (
        <div className="mb-4 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot @{botName ?? "enzo-ai"} is live</p>
          <p className="mt-0.5 text-xs text-muted">Message the bot directly or mention it in channels.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token <span className="font-normal">(xoxb-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">api.slack.com/apps → your app → OAuth & Permissions → Bot User OAuth Token</p>
          <input className={inputCls} type="password"
            placeholder={hasTokens ? "••••••••  (configured)" : "xoxb-..."}
            value={botToken} onChange={e => setBotToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">App-Level Token <span className="font-normal">(xapp-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">api.slack.com/apps → your app → Basic Information → App-Level Tokens → Create token with <code className="bg-surface px-1 rounded text-[10px]">connections:write</code> scope</p>
          <input className={inputCls} type="password"
            placeholder={hasTokens ? "••••••••  (configured)" : "xapp-..."}
            value={appToken} onChange={e => setAppToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed Channel / User IDs <span className="font-normal">(optional)</span></label>
          <input className={inputCls} placeholder="C1234567890, U1234567890" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || (!botToken.trim() && !appToken.trim() && !hasTokens)}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? "Connecting…" : running ? "Save & Reconnect" : "Save & Connect"}
          </button>
          {running && (
            <button onClick={stop} disabled={busy}
              className="rounded-xl border border-danger/40 bg-danger/10 px-4 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50">
              Disconnect
            </button>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted space-y-1.5">
          <p className="font-semibold text-fg">Setup checklist</p>
          <p>1. Enable <span className="text-fg">Socket Mode</span> in your app settings</p>
          <p>2. Subscribe to bot events: <code className="bg-surface px-1 rounded text-[10px]">message.channels</code>, <code className="bg-surface px-1 rounded text-[10px]">message.im</code></p>
          <p>3. Add bot scopes: <code className="bg-surface px-1 rounded text-[10px]">chat:write</code>, <code className="bg-surface px-1 rounded text-[10px]">channels:history</code>, <code className="bg-surface px-1 rounded text-[10px]">im:history</code></p>
          <p>4. Install app to workspace</p>
          <p>5. Invite bot to channels: <code className="bg-surface px-1 rounded text-[10px]">/invite @yourbot</code></p>
        </div>
      </div>
    </div>
  );
}

function DiscordConfig({ onBack }: { onBack: () => void }) {
  const [token, setToken]       = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [model, setModel]       = useState("");
  const [running, setRunning]   = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botTag, setBotTag]     = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    api.admin.getDiscord().then((d) => {
      setRunning(d.enabled);
      setAllowed(d.allowedIds);
      setModel(d.model);
      setHasToken(!!d.token);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string; model: string; reconnect?: boolean } = { allowedIds, model };
      if (token.trim()) body.token = token;
      // If already running and no new token, send reconnect flag to restart with stored token
      if (running && !token.trim()) body.reconnect = true;
      const res = await api.admin.saveDiscord(body);
      setRunning(res.running);
      setHasToken(true);
      if (res.tag) setBotTag(res.tag);
      setToken("");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.admin.stopDiscord();
      setRunning(false); setBotTag(null);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors">
        ← Back to integrations
      </button>

      <div className="mb-5 flex items-center gap-3">
        <SiDiscord className="h-8 w-8 flex-shrink-0 text-[#5865F2]" />
        <div>
          <h3 className="font-semibold text-fg">Discord</h3>
          <p className="text-xs text-muted">Bring Enzo AI into your Discord server or DMs.</p>
        </div>
        {running && (
          <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ok">
            <span className="text-[10px]">●</span> Connected
          </div>
        )}
      </div>

      {running && (
        <div className="mb-4 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot {botTag ? botTag : ""} is live</p>
          <p className="mt-0.5 text-xs text-muted">
            @mention the bot in any channel, or DM it directly.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">
            Get from <span className="text-accent-2">discord.com/developers/applications</span> → your app → Bot → Reset Token
          </p>
          <input
            className={inputCls} type="password"
            placeholder={hasToken ? "••••••••  (configured — paste to replace)" : "Paste your bot token"}
            value={token}
            onChange={e => setToken(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Allowed User IDs <span className="font-normal">(optional)</span>
          </label>
          <p className="mb-1.5 text-[11px] text-muted">
            Your Discord user ID. Right-click your name → Copy User ID (needs Developer Mode on in Discord settings).
          </p>
          <input
            className={inputCls}
            placeholder="123456789012345678"
            value={allowedIds}
            onChange={e => setAllowed(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={busy || (!token.trim() && !hasToken)}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? "Connecting…" : running ? "Save & Reconnect" : "Save & Connect"}
          </button>
          {running && (
            <button onClick={stop} disabled={busy}
              className="rounded-xl border border-danger/40 bg-danger/10 px-4 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50">
              Disconnect
            </button>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted space-y-1.5">
          <p className="font-semibold text-fg">Setup checklist</p>
          <p>1. Enable <span className="text-fg">Message Content Intent</span> in your bot settings</p>
          <p>2. Invite bot with permissions: Read Messages, Send Messages</p>
          <p>3. In servers: @mention the bot to talk to it</p>
          <p>4. In DMs: just message it directly</p>
        </div>
      </div>
    </div>
  );
}

function TelegramConfig({ onBack }: { onBack: () => void }) {
  const [token, setToken]       = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [model, setModel]       = useState("");
  const [running, setRunning]   = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botName, setBotName]   = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    api.admin.getTelegram().then((d) => {
      setRunning(d.enabled);
      setAllowed(d.allowedIds);
      setModel(d.model);
      setHasToken(!!d.token);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string; model: string } = { allowedIds, model };
      if (token.trim()) body.token = token;
      const res = await api.admin.saveTelegram(body);
      setRunning(res.running);
      setHasToken(true);
      if (res.username) setBotName(res.username);
      setToken("");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try {
      await api.admin.stopTelegram();
      setRunning(false); setBotName(null);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-fg transition-colors">
        ← Back to integrations
      </button>

      <div className="mb-5 flex items-center gap-3">
        <SiTelegram className="h-8 w-8 flex-shrink-0 text-[#2AABEE]" />
        <div>
          <h3 className="font-semibold text-fg">Telegram</h3>
          <p className="text-xs text-muted">Chat with your AI via Telegram from anywhere in the world.</p>
        </div>
        {running && (
          <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-ok">
            <span className="text-[10px]">●</span> Connected
          </div>
        )}
      </div>

      {/* Success banner */}
      {running && (
        <div className="mb-4 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">
            ✓ Bot {botName ? `@${botName}` : ""} is live
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Open Telegram and send it a message — it will reply using your local AI.
          </p>
        </div>
      )}

      {/* Always-visible config form */}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">
            Get one from <span className="text-accent-2">@BotFather</span> on Telegram → /newbot
          </p>
          <input
            className={inputCls}
            type="password"
            placeholder={hasToken ? "••••••••  (configured — paste to replace)" : "Paste your bot token"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Allowed User IDs <span className="font-normal">(optional)</span>
          </label>
          <p className="mb-1.5 text-[11px] text-muted">
            Leave blank = anyone can use it. Your ID via <span className="text-accent-2">@userinfobot</span>
          </p>
          <input
            className={inputCls}
            placeholder="123456789, 987654321"
            value={allowedIds}
            onChange={(e) => setAllowed(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={busy || (!token.trim() && !hasToken)}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Connecting…" : running ? "Save & Reconnect" : "Save & Connect"}
          </button>
          {running && (
            <button onClick={stop} disabled={busy}
              className="rounded-xl border border-danger/40 bg-danger/10 px-4 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50">
              Disconnect
            </button>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

// ── Integrations overview ─────────────────────────────────────────────────────

function IntegrationsTab() {
  const [selected, setSelected]       = useState<IntegrationId | null>(null);
  const [telegramRunning, setTgRunning] = useState(false);
  const [discordRunning,  setDcRunning] = useState(false);
  const [slackRunning,    setSlRunning] = useState(false);

  useEffect(() => {
    api.admin.getTelegram().then((d) => setTgRunning(d.enabled)).catch(() => {});
    api.admin.getDiscord().then((d)  => setDcRunning(d.enabled)).catch(() => {});
    api.admin.getSlack().then((d)    => setSlRunning(d.enabled)).catch(() => {});
  }, []);

  function refresh() {
    api.admin.getTelegram().then((d) => setTgRunning(d.enabled)).catch(() => {});
    api.admin.getDiscord().then((d)  => setDcRunning(d.enabled)).catch(() => {});
    api.admin.getSlack().then((d)    => setSlRunning(d.enabled)).catch(() => {});
  }

  if (selected === "telegram") return <TelegramConfig onBack={() => { setSelected(null); refresh(); }} />;
  if (selected === "discord")  return <DiscordConfig  onBack={() => { setSelected(null); refresh(); }} />;
  if (selected === "slack")    return <SlackConfig    onBack={() => { setSelected(null); refresh(); }} />;

  const connectedMap: Record<string, boolean> = { telegram: telegramRunning, discord: discordRunning, slack: slackRunning };

  return (
    <div>
      <p className="mb-5 text-xs text-muted">
        Connect Enzo AI to external services. Messages are forwarded to your local AI and replies sent back.
      </p>

      <div className="flex flex-col gap-3">
        {INTEGRATIONS.map((integration) => {
          const connected = connectedMap[integration.id] ?? false;
          return (
          <button
            key={integration.id}
            disabled={!integration.available}
            onClick={() => integration.available && setSelected(integration.id as IntegrationId)}
            className={`flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors ${
              integration.available
                ? connected
                  ? "border-ok/40 bg-ok/5 hover:border-ok/60 cursor-pointer"
                  : "border-border bg-surface-2 hover:border-accent/60 hover:bg-surface cursor-pointer"
                : "border-border/50 bg-surface-2/50 cursor-not-allowed opacity-50"
            }`}
          >
            <span className={`flex-shrink-0 ${integration.color}`}>{integration.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">{integration.name}</span>
                {connected && (
                  <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-semibold text-ok border border-ok/30">
                    Connected
                  </span>
                )}
                {!integration.available && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted border border-border">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">{integration.description}</p>
            </div>
            {integration.available && (
              <span className={`flex-shrink-0 text-sm ${connected ? "text-ok" : "text-muted"}`}>
                {connected ? "●" : "→"}</span>
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Admin Settings tab (Google OAuth etc.) ───────────────────────────────────

function AdminSettingsTab() {
  const [clientId, setClientId]         = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured]     = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [msg, setMsg]                   = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.calendar.adminConfig().then((d) => setConfigured(d.configured)).catch(() => {});
  }, []);

  async function save() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.calendar.setAdminConfig({ clientId, clientSecret });
      setConfigured(res.configured);
      setClientId(""); setClientSecret("");
      setMsg({ text: "Saved — users can now connect their Google Calendar from their Settings", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally { setBusy(false); }
  }

  return (
    <Section title="Google Calendar OAuth">
      <p className="mb-4 text-xs text-muted">
        Enter your Google OAuth app credentials so users can connect their own Google Calendar.
        Create them at{" "}
        <span className="text-accent-2">console.cloud.google.com</span>
        {" "}→ APIs & Services → Credentials → OAuth 2.0 Client (Web application).
      </p>
      <p className="mb-4 text-xs text-muted">
        Authorized redirect URI to add:{" "}
        <code className="bg-surface px-1.5 py-0.5 rounded text-[11px]">http://localhost:1616/api/calendar/callback</code>
      </p>

      <div className="flex flex-col gap-3">
        <div className={`flex items-center gap-2 text-xs font-semibold mb-1 ${configured ? "text-ok" : "text-muted"}`}>
          <span className="text-[10px]">●</span>
          {configured ? "OAuth credentials configured — users can connect their Google Calendar" : "Not configured"}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Client ID</label>
          <input className={inputCls} type="password"
            placeholder={configured ? "••••••••  (saved — paste to replace)" : "Paste Client ID"}
            value={clientId} onChange={e => setClientId(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Client Secret</label>
          <input className={inputCls} type="password"
            placeholder={configured ? "••••••••  (saved — paste to replace)" : "Paste Client Secret"}
            value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </div>

        <button onClick={save} disabled={busy || (!clientId.trim() || !clientSecret.trim())}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40 self-start">
          {busy ? "Saving…" : "Save Credentials"}
        </button>

        {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      </div>
    </Section>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

type Tab = "users" | "models" | "tools" | "integrations" | "settings" | "danger";

export function AdminPanel({
  currentUser,
  onClose,
}: {
  currentUser: User;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-bold">Admin panel</h2>
            <p className="text-xs text-muted">Manage users, models and system settings</p>
          </div>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-fg"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-4 pt-1">
          {(["users", "models", "tools", "integrations", "settings", "danger"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-md px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                t === "danger" ? (tab === "danger" ? "border-b-2 border-danger text-danger" : "text-danger/60 hover:text-danger") :
                tab === t
                  ? "border-b-2 border-accent text-fg"
                  : "text-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "users"   && <UsersTab currentUserId={currentUser.id} />}
          {tab === "models"  && <ModelsTab />}
          {tab === "tools"        && <ToolsTab />}
          {tab === "integrations" && <IntegrationsTab />}
          {tab === "settings"    && <AdminSettingsTab />}
          {tab === "danger"  && <DangerTab />}
        </div>
      </div>
    </div>
  );
}
