import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { api, streamPullModel } from "../api";
import type { ModelInfo, User } from "../types";

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

// ── Main panel ───────────────────────────────────────────────────────────────

type Tab = "users" | "models" | "tools" | "danger";

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
          {(["users", "models", "tools", "danger"] as Tab[]).map((t) => (
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
          {tab === "tools"   && <ToolsTab />}
          {tab === "danger"  && <DangerTab />}
        </div>
      </div>
    </div>
  );
}
