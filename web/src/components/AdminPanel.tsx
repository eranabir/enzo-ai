import { useEffect, useState } from "react";
import { Cpu, Users as UsersIcon, Boxes, Wrench, AlertTriangle, Plug, ChevronDown, Lock } from "lucide-react";
import { api, streamPullModel } from "../api";
import type { ModelInfo, User, SystemAnalysis } from "../types";
import { ModalHeader } from "./ui/ModalHeader";
import { TierBadge } from "./ui/TierBadge";
import { useConfirm } from "./ui/ConfirmProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/Select";
import { Tooltip } from "./ui/Tooltip";

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

function fmtGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Inline model-download progress bar (determinate when byte totals are known). */
function PullBar({ status, progress }: { status: string; progress: { completed: number; total: number } | null }) {
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : null;
  return (
    <div className="mt-2 w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full bg-accent transition-all duration-300 ${pct == null ? "w-full animate-pulse" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
      <p className="mt-1 truncate text-[10px] text-muted">
        {progress ? `${fmtGb(progress.completed)} / ${fmtGb(progress.total)} · ` : ""}
        {pct != null ? `${pct}%` : status}
      </p>
    </div>
  );
}

// ── Users tab ───────────────────────────────────────────────────────────────

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.admin.listUsers().then(setUsers).catch(() => {});
  }, []);

  async function doDelete(u: User) {
    if (!(await confirm({
      title: "Delete user?",
      description: `${u.displayName} and all their chats will be permanently deleted. This cannot be undone.`,
      confirmText: "Delete user",
      danger: true,
    }))) return;
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

const PROVIDER_META: Record<string, { label: string; color: string; placeholder: string }> = {
  openai:    { label: "OpenAI",    color: "text-green-400", placeholder: "sk-..." },
  anthropic: { label: "Anthropic", color: "text-amber-400", placeholder: "sk-ant-..." },
  google:    { label: "Google Gemini", color: "text-blue-400", placeholder: "AIza..." },
};

function ModelsTab() {
  const confirm = useConfirm();
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
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ completed: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [numCtx, setNumCtx] = useState<number | null>(null);

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
    api.admin.getSettings().then((s) => setNumCtx(s.numCtx)).catch(() => {});
  }
  useEffect(load, []);

  function changeNumCtx(n: number) {
    const prev = numCtx;
    setNumCtx(n);
    api.admin.updateSettings({ numCtx: n })
      .then((s) => setNumCtx(s.numCtx))
      .catch(() => setNumCtx(prev));
  }

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
    if (!(await confirm({
      title: "Remove model?",
      description: `"${name}" will be deleted from this machine. You can pull it again later.`,
      confirmText: "Remove",
      danger: true,
    }))) return;
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

  async function doPull(modelArg?: string) {
    const model = (modelArg ?? pullName).trim();
    if (!model || pulling) return;
    setPullName(model);            // reflect what's downloading in the input
    setPulling(true);
    setPullingModel(model);
    setPullProgress(null);
    setPullStatus(`Downloading ${model}…`);
    setErr(null);
    const reset = () => { setPulling(false); setPullingModel(null); setPullProgress(null); setPullStatus(""); };
    await streamPullModel(
      model,
      (s, progress) => { setPullStatus(s); setPullProgress(progress ?? null); },
      () => { reset(); setPullName(""); load(); },   // load() moves it into the installed list
      (e) => { reset(); setErr(e); },
    );
  }

  const localModels = models.filter(m => m.provider === "ollama");
  // Chat models vs. embedding/utility models (e.g. nomic-embed-text). The latter
  // can't hold a conversation, so they're listed separately and never offered as
  // a default chat model.
  const chatModels = localModels.filter(m => m.supportsChat !== false);
  const utilityModels = localModels.filter(m => m.supportsChat === false);
  // Is the active download for a model shown in the analyze box? If so its
  // progress bar renders inside that item rather than under the manual pull input.
  const inAnalysis = (id: string) =>
    !!analysis && (analysis.recommendation.modelId === id || analysis.recommendation.alternatives.some((a) => a.modelId === id));
  const pullingFromAnalyze = !!pullingModel && inAnalysis(pullingModel);

  return (
    <div className="flex flex-col gap-6">

      {/* ── LOCAL MODELS ────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">🖥 Local models</span>
          <span className={`text-[10px] font-semibold ${ollamaOnline ? "text-ok" : "text-danger"}`}>
            ● {ollamaOnline ? "Ollama running" : "Ollama offline"}
          </span>
        </div>
        {err && <p className="mb-2 text-xs text-danger">{err}</p>}

        {/* Installed chat models */}
        <div className="flex flex-col gap-1.5 mb-3">
          {chatModels.length === 0 ? (
            <p className="text-xs text-muted py-2">No local chat models installed. Pull one below.</p>
          ) : chatModels.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium">{m.id}</span>
              {m.label && <span className="text-xs text-muted">{m.label}</span>}
              {m.supportsTools && (
                <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent-2" title="Supports tools / function calling">Tools</span>
              )}
              {m.supportsVision && (
                <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted" title="Can read images">Vision</span>
              )}
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

        {/* Context length (num_ctx) — how much conversation the local model keeps in view */}
        {numCtx !== null && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Context length</span>
              <span className="text-[11px] text-muted">Tokens the local model keeps in view. Higher = more memory of the conversation, but needs more VRAM and can slow replies.</span>
            </div>
            <Tooltip label="Context window (num_ctx) for local models" side="bottom">
              <Select value={String(numCtx)} onValueChange={(v) => changeNumCtx(Number(v))}>
                <SelectTrigger className="w-28 flex-shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2048, 4096, 8192, 16384, 32768, 65536].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n / 1024}K ({n})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Tooltip>
          </div>
        )}

        {/* Embedding / utility models — not chat-capable, kept separate */}
        {utilityModels.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Embedding models
            </p>
            <div className="flex flex-col gap-1.5">
              {utilityModels.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/50 px-3 py-2">
                  <span className="flex-1 truncate text-sm font-medium text-muted">{m.id}</span>
                  {m.label && <span className="text-xs text-muted">{m.label}</span>}
                  <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted" title="Turns documents into vectors for Knowledge Base search">Embedding</span>
                  <button onClick={() => doDelete(m.id)} disabled={busy}
                    className="text-xs text-muted hover:text-danger">Remove</button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Used by Knowledge Bases to search your documents — not for chatting. Safe to remove if you don't use Knowledge Bases.
            </p>
          </div>
        )}

        {/* Pull (manual) */}
        <div className="flex gap-2 mb-1">
          <input className={inputCls} placeholder="Pull model — e.g. llama3.1:8b"
            value={pullName} onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !pulling && doPull()} disabled={pulling} />
          <button onClick={() => doPull()} disabled={pulling || !pullName.trim()}
            className="flex-shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
            {pulling && !pullingFromAnalyze ? "…" : "Pull"}
          </button>
        </div>
        {pulling && !pullingFromAnalyze && <PullBar status={pullStatus} progress={pullProgress} />}
        <p className="mt-2 text-[11px] text-muted">Browse at <span className="text-accent-2">ollama.com/library</span></p>
      </div>

      <div className="border-t border-border" />

      {/* ── ANALYZE ─────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">🔍 Analyze</span>
          <span className="text-[10px] text-muted">— best models for your hardware</span>
        </div>
        {!analysis ? (
          <button onClick={analyzeSystem} disabled={analyzing}
            className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent-2 hover:bg-accent/10 disabled:opacity-40">
            <Cpu className="h-3.5 w-3.5" />
            {analyzing ? "Analyzing…" : "Analyze my hardware"}
          </button>
        ) : (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div className="grid grid-cols-4 gap-1.5 mb-3">
              {[
                { label: "CPU", value: `${analysis.info.cpuCount}c` },
                { label: "RAM", value: `${analysis.info.ramGb}GB` },
                { label: "GPU", value: analysis.info.gpuName?.split(" ").slice(-2).join(" ") ?? "—" },
                { label: "Usable", value: `~${analysis.info.usableGb}GB` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border/50 px-2 py-1.5 text-center">
                  <div className="text-[9px] text-muted">{label}</div>
                  <div className="text-xs font-semibold text-fg">{value}</div>
                </div>
              ))}
            </div>
            {(() => {
              const rec = analysis.recommendation;
              const recInstalled = models.some((m) => m.id === rec.modelId);
              const isPulling = pullingModel === rec.modelId;
              return (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-fg">{rec.label}</span>
                      {rec.size && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{rec.size}</span>}
                      <span className="ml-1.5 rounded-md bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent-2">★ Recommended</span>
                      <span className="ml-1.5 inline-flex align-middle"><TierBadge tier={rec.tier} /></span>
                      <p className="text-[11px] text-muted mt-0.5">{rec.reason}</p>
                    </div>
                    {recInstalled ? (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-ok">Installed ✓</span>
                    ) : !isPulling ? (
                      <button onClick={() => doPull(rec.modelId)} disabled={pulling}
                        className="flex-shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                        Pull
                      </button>
                    ) : null}
                  </div>
                  {isPulling && <PullBar status={pullStatus} progress={pullProgress} />}
                </div>
              );
            })()}

            {/* Alternatives for other hardware tiers */}
            {analysis.recommendation.alternatives.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Other options</div>
                <div className="flex flex-col gap-2">
                  {analysis.recommendation.alternatives.map((alt) => {
                    const installed = models.some((m) => m.id === alt.modelId);
                    const isPulling = pullingModel === alt.modelId;
                    return (
                      <div key={alt.modelId}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-fg">{alt.label}</span>
                            {alt.size && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{alt.size}</span>}
                            <span className="ml-1.5 inline-flex align-middle"><TierBadge tier={alt.tier} /></span>
                            <p className="truncate text-[10px] text-muted">{alt.note}</p>
                          </div>
                          {installed ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold text-ok">Installed ✓</span>
                          ) : !isPulling ? (
                            <button onClick={() => doPull(alt.modelId)} disabled={pulling}
                              className="flex-shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-fg hover:border-accent/40 disabled:opacity-40">
                              Pull
                            </button>
                          ) : null}
                        </div>
                        {isPulling && <PullBar status={pullStatus} progress={pullProgress} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button onClick={() => setAnalysis(null)} className="mt-3 text-[11px] text-muted hover:text-fg">Re-analyze</button>
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      {/* ── EXTERNAL MODELS ─────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">☁ External models</span>
          <span className="text-[10px] text-muted">— API keys stored encrypted on this machine</span>
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
          This permanently deletes <strong className="text-fg">all users, chats, memories, API keys, and settings</strong>.
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [chatTools, setChatTools] = useState<boolean | null>(null);

  useEffect(() => {
    api.admin.listTools().then(setTools).catch(() => {});
    api.admin.getSettings().then((s) => setChatTools(s.chatToolsEnabled)).catch(() => {});
  }, []);

  async function toggleChatTools() {
    const next = !chatTools;
    setChatTools(next);
    api.admin.updateSettings({ chatToolsEnabled: next })
      .then((s) => setChatTools(s.chatToolsEnabled))
      .catch(() => setChatTools(!next));
  }

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
    git: "Runs read-only git commands in a repo",
  };

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Friendly names for the connection a group of account tools belongs to.
  const CONN_NAMES: Record<string, string> = { google: "Google Calendar", gmail: "Gmail" };
  const connName = (id: string) => CONN_NAMES[id] ?? cap(id);

  const renderTool = (t: import("../types").ToolDefinition, hideConnBadge = false) => (
    <div key={t.name} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${t.enabled ? "text-fg" : "text-muted line-through"}`}>
            {t.name.replace(/_/g, " ")}
          </span>
          {t.requiresConnection && !hideConnBadge && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2">Requires {cap(t.requiresConnection)}</span>
          )}
        </div>
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
  );

  const systemTools = tools.filter((t) => !t.requiresConnection);
  const accountTools = tools.filter((t) => t.requiresConnection);

  // Group account tools by the connection they require, preserving first-seen order.
  const groupOrder: string[] = [];
  const groups: Record<string, import("../types").ToolDefinition[]> = {};
  for (const t of accountTools) {
    const k = t.requiresConnection!;
    if (!groups[k]) { groups[k] = []; groupOrder.push(k); }
    groups[k].push(t);
  }
  const isOpen = (k: string) => openGroups[k] ?? false;
  const toggleGroup = (k: string) => setOpenGroups((g) => ({ ...g, [k]: !isOpen(k) }));

  return (
    <div className="flex flex-col gap-6">
      <Section title="Regular chats">
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5 pr-3">
            <span className="text-sm font-semibold text-fg">Allow tools in regular chats</span>
            <span className="text-xs text-muted">
              Off by default — keeps plain chats fast (replies stream instantly). Agents always use their own tools regardless. Turn on to let tool-less chats call tools, at the cost of slower first responses.
            </span>
          </div>
          <button
            disabled={chatTools === null}
            onClick={toggleChatTools}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full border border-border transition-colors disabled:opacity-50 ${chatTools ? "bg-accent" : "bg-surface"}`}
            title={chatTools ? "Click to disable" : "Click to enable"}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${chatTools ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
      </Section>

      <Section title="System tools">
        <p className="mb-4 text-xs text-muted">
          Built-in tools that always work. Disabled tools can't be used by any agent.
        </p>
        <div className="flex flex-col gap-2">{systemTools.map((t) => renderTool(t))}</div>
      </Section>

      {accountTools.length > 0 && (
        <Section title="Account tools">
          <p className="mb-4 text-xs text-muted">
            These require a connected account to run. You enable/disable them here; each user connects their own account in their Settings.
          </p>
          <div className="flex flex-col gap-2">
            {groupOrder.map((k) => {
              const list = groups[k];
              const enabledCount = list.filter((t) => t.enabled).length;
              const open = isOpen(k);
              return (
                <div key={k} className="rounded-xl border border-border bg-surface-2 overflow-hidden">
                  <button
                    onClick={() => toggleGroup(k)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface"
                  >
                    <div className="flex items-center gap-2">
                      <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                      <span className="text-sm font-semibold">{connName(k)}</span>
                    </div>
                    <span className="text-[11px] text-muted">{enabledCount}/{list.length} enabled</span>
                  </button>
                  {open && (
                    <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                      {list.map((t) => renderTool(t, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}


// ── Connections tab ──────────────────────────────────────────────────────────

function ConnectionsTab() {
  const [conns, setConns] = useState<{ id: string; name: string; enabled: boolean }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.admin.listConnections().then(setConns).catch(() => {}); }, []);

  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    try { setConns(await api.admin.setConnectionEnabled(id, enabled)); }
    catch { /* ignore */ } finally { setBusy(null); }
  }

  return (
    <Section title="Connections">
      <p className="mb-4 text-xs text-muted">
        Enable or disable connection types for everyone. Disabling one immediately stops all running
        bots of that type and hides it from users' Settings.
      </p>
      <div className="flex flex-col gap-2">
        {conns.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span className={`text-sm font-semibold ${c.enabled ? "text-fg" : "text-muted line-through"}`}>{c.name}</span>
            <button
              disabled={busy === c.id}
              onClick={() => toggle(c.id, !c.enabled)}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${c.enabled ? "bg-accent" : "bg-surface"} border border-border disabled:opacity-50`}
              title={c.enabled ? "Click to disable" : "Click to enable"}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${c.enabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Encryption tab ─────────────────────────────────────────────────────────────

function EncryptionTab() {
  const [status, setStatus] = useState<{ configured: boolean; unlocked: boolean } | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.vault.status().then(setStatus).catch(() => {}); }, []);

  async function setup() {
    if (pass.length < 6) { setError("Passphrase must be at least 6 characters."); return; }
    if (pass !== pass2) { setError("Passphrases don't match."); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.vault.setup(pass);
      setRecoveryKey(res.recoveryKey);
      setStatus({ configured: res.configured, unlocked: res.unlocked });
      setPass(""); setPass2("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function change() {
    if (pass.length < 6) { setError("Passphrase must be at least 6 characters."); return; }
    if (pass !== pass2) { setError("Passphrases don't match."); return; }
    setBusy(true); setError(null);
    try {
      await api.vault.changePassphrase(pass);
      setPass(""); setPass2(""); setChanging(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

  // One-time recovery key display after setup.
  if (recoveryKey) {
    return (
      <Section title="Save your recovery key">
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-fg">
          This is the <b>only</b> way back into your chats if you forget your passphrase. Store it
          somewhere safe — it will not be shown again.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-sm">{recoveryKey}</code>
          <button
            onClick={() => { navigator.clipboard?.writeText(recoveryKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
            className={`flex-shrink-0 rounded-lg border px-3 py-2.5 text-xs transition-colors ${copied ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted hover:text-fg"}`}
          >{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <button
          onClick={() => setRecoveryKey(null)}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-2"
        >I've saved it</button>
      </Section>
    );
  }

  if (status === null) return <p className="text-xs text-muted">Loading…</p>;

  // Configured — show status + management.
  if (status.configured) {
    return (
      <Section title="Encryption">
        <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <Lock className="h-4 w-4 text-ok" />
          <div>
            <p className="text-sm font-semibold text-ok">Chats are encrypted</p>
            <p className="text-[11px] text-muted">
              {status.unlocked ? "Vault is unlocked for this session." : "Vault is locked."}
            </p>
          </div>
        </div>

        <p className="mt-4 mb-3 text-[11px] text-muted leading-relaxed">
          Messages, titles and memories are encrypted at rest with your passphrase. On a headless
          server set <code className="bg-surface-2 px-1 rounded">ENZO_PASSPHRASE</code> to auto-unlock
          on boot.
        </p>

        {!changing ? (
          <div className="flex gap-2">
            <button onClick={() => { setChanging(true); setError(null); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg hover:border-accent/60">
              Change passphrase
            </button>
            {status.unlocked && (
              <button
                onClick={async () => { await api.vault.lock().catch(() => {}); setStatus((s) => s ? { ...s, unlocked: false } : s); }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-fg hover:border-accent/60">
                Lock now
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
            <p className="text-xs font-semibold text-muted">New passphrase</p>
            <input className={inputCls} type="password" placeholder="New passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
            <input className={inputCls} type="password" placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <button onClick={change} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                {busy ? "Saving…" : "Save passphrase"}
              </button>
              <button onClick={() => { setChanging(false); setPass(""); setPass2(""); setError(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-fg">Cancel</button>
            </div>
          </div>
        )}
      </Section>
    );
  }

  // Not configured — set up encryption.
  return (
    <Section title="Encryption">
      <p className="mb-4 text-xs text-muted leading-relaxed">
        Protect chats, titles and memories with a passphrase. They'll be encrypted at rest — a copied
        database or backup is useless without it. You'll get a one-time recovery key.
      </p>
      <div className="flex flex-col gap-2 max-w-sm">
        <input className={inputCls} type="password" placeholder="Choose a passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
        <input className={inputCls} type="password" placeholder="Confirm passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button onClick={setup} disabled={busy || !pass || !pass2}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
          {busy ? "Setting up…" : "Turn on encryption"}
        </button>
      </div>
    </Section>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

type Tab = "users" | "models" | "tools" | "connections" | "encryption" | "danger";

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  users:        <UsersIcon className="h-3.5 w-3.5" />,
  models:       <Boxes className="h-3.5 w-3.5" />,
  tools:        <Wrench className="h-3.5 w-3.5" />,
  connections:  <Plug className="h-3.5 w-3.5" />,
  encryption:   <Lock className="h-3.5 w-3.5" />,
  danger:       <AlertTriangle className="h-3.5 w-3.5" />,
};

export function AdminPanel({
  currentUser,
  onClose,
  initialTab = "users",
}: {
  currentUser: User;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <ModalHeader
          title="Admin panel"
          subtitle="Manage users, models and system settings"
          onClose={onClose}
        />

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-5 pt-1">
          {(["users", "models", "tools", "connections", "encryption", "danger"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-semibold capitalize transition-colors first:-ml-3 ${
                t === "danger" ? (tab === "danger" ? "border-b-2 border-danger text-danger" : "text-danger/60 hover:text-danger") :
                tab === t
                  ? "border-b-2 border-accent text-fg"
                  : "text-muted hover:text-fg"
              }`}
            >
              {TAB_ICONS[t]}
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "users"   && <UsersTab currentUserId={currentUser.id} />}
          {tab === "models"  && <ModelsTab />}
          {tab === "tools"        && <ToolsTab />}
          {tab === "connections"  && <ConnectionsTab />}
          {tab === "encryption"   && <EncryptionTab />}
          {tab === "danger"  && <DangerTab />}
        </div>
      </div>
    </div>
  );
}
