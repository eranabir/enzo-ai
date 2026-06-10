import { useEffect, useState } from "react";
import { api, streamPullModel } from "../api";
import type { SystemAnalysis, User } from "../types";

interface Props {
  user: User;
  onDone: () => void;
}

type Mode = "local" | "cloud" | "both";
type StepKey = "welcome" | "encrypt" | "models" | "done";

/** Approx download size per model (Q4) — shown in the recommendation list. */
const MODEL_SIZES: Record<string, string> = {
  "qwen2.5:32b": "~20 GB",
  "qwen2.5:14b": "~9 GB",
  "qwen2.5:7b": "~4.7 GB",
  "qwen2.5:0.5b": "~0.4 GB",
  "llama3.1:8b": "~4.9 GB",
  "llama3.2:3b": "~2 GB",
  "llama3.2:1b": "~1.3 GB",
};

export function SetupWizard({ user, onDone }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  // Encryption setup is offered to the admin (first user) during onboarding.
  const [includeEncStep, setIncludeEncStep] = useState(false);
  const [encPass, setEncPass] = useState("");
  const [encPass2, setEncPass2] = useState("");
  const [encBusy, setEncBusy] = useState(false);
  const [encErr, setEncErr] = useState<string | null>(null);
  const [encRecoveryKey, setEncRecoveryKey] = useState<string | null>(null);
  const [encDone, setEncDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const steps: StepKey[] = ["welcome", ...(includeEncStep ? (["encrypt"] as StepKey[]) : []), "models", "done"];
  const current = steps[stepIdx];
  // The "Choose your AI" step was removed — we always set up both local models
  // and (optional) cloud keys on the model-configuration step. Asserted to the
  // wider Mode union so the existing mode checks below still type-check.
  const mode = "both" as Mode;
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [keyInputs, setKeyInputs] = useState({ openai: "", anthropic: "", google: "" });
  const [keySaved, setKeySaved] = useState<string[]>([]);
  const [showKeys, setShowKeys] = useState(false);

  // Model selection (local / both): either take the default model, or analyze
  // the machine first and pick from recommendations.
  const [modelChoice, setModelChoice] = useState<"default" | "analyze" | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [analysis, setAnalysis] = useState<SystemAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState("");
  const [pullProgress, setPullProgress] = useState<{ completed: number; total: number } | null>(null);

  // Offer the encryption step to the admin if encryption isn't already set up.
  useEffect(() => {
    if (!user.isAdmin) return;
    api.vault.status()
      .then((s) => { if (!s.configured) setIncludeEncStep(true); })
      .catch(() => {});
  }, [user.isAdmin]);

  useEffect(() => {
    if (current === "models" && (mode === "local" || mode === "both")) {
      setChecking(true);
      api.status()
        .then((s) => {
          setOllamaOk(s.ollama);
          if (s.ollama) {
            api.models()
              .then(({ models: m, default: d }) => { setModels(m.map(x => x.id)); setDefaultModel(d); })
              .catch(() => {});
          }
        })
        .catch(() => setOllamaOk(false))
        .finally(() => setChecking(false));
    }
  }, [current, mode]);

  async function setupEncryption() {
    if (encPass.length < 6) { setEncErr("Passphrase must be at least 6 characters."); return; }
    if (encPass !== encPass2) { setEncErr("Passphrases don't match."); return; }
    setEncBusy(true); setEncErr(null);
    try {
      const res = await api.vault.setup(encPass);
      setEncRecoveryKey(res.recoveryKey);
      setEncDone(true);
      setEncPass(""); setEncPass2("");
    } catch (e) { setEncErr((e as Error).message); }
    finally { setEncBusy(false); }
  }

  /** Run hardware analysis (lazily, only when the user picks "Analyze system"). */
  function runAnalyze() {
    if (analysis || analyzing) return;
    setAnalyzing(true);
    api.system()
      .then((a) => {
        setAnalysis(a);
        setSelectedModel((cur) => cur || a.recommendation.modelId);
      })
      .catch(() => {})
      .finally(() => setAnalyzing(false));
  }

  function downloadModel() {
    const model = selectedModel.trim();
    if (!model || pulling) return;
    setPulling(true);
    setPullStatus("Starting…");
    setPullProgress(null);
    streamPullModel(
      model,
      (s, progress) => { setPullStatus(s); setPullProgress(progress ?? null); },
      () => {
        setPulling(false);
        setPullStatus("");
        setPullProgress(null);
        setModels((m) => (m.includes(model) ? m : [...m, model]));
      },
      (e) => { setPulling(false); setPullProgress(null); setPullStatus(`⚠ ${e}`); },
      "/api/models/pull",
    );
  }

  async function saveKey(provider: string) {
    const key = (keyInputs as Record<string,string>)[provider]?.trim();
    if (!key) return;
    try {
      await api.keys.save(provider, key);
      setKeySaved((s) => [...s, provider]);
    } catch { /* ignore */ }
  }

  function finish() {
    localStorage.setItem("enzo_wizard_done", "1");
    onDone();
  }

  const fmtGb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
  const pullPct =
    pullProgress && pullProgress.total > 0
      ? Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))
      : null;

  // Progress UI shown under the Download button while a pull is in flight.
  // Determinate bar when byte totals are known, otherwise an indeterminate pulse.
  const pullProgressUI = pulling ? (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
        <div
          className={`h-full rounded-full bg-accent transition-all duration-300 ${pullPct == null ? "animate-pulse w-full" : ""}`}
          style={pullPct == null ? undefined : { width: `${pullPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span className="truncate">{pullStatus || "Starting…"}</span>
        {pullPct != null && (
          <span className="flex-shrink-0 tabular-nums">
            {pullProgress ? `${fmtGb(pullProgress.completed)} / ${fmtGb(pullProgress.total)} · ` : ""}{pullPct}%
          </span>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 backdrop-blur-sm">
      <div className="flex min-h-full flex-col items-center px-4 py-10">
        {/* Progress dots */}
        <div className="mb-8 flex gap-2">
          {steps.map((s, i) => (
            <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === stepIdx ? "w-8 bg-accent" : i < stepIdx ? "w-3 bg-accent/50" : "w-3 bg-border"}`} />
          ))}
        </div>

        <div className="flex w-full max-w-lg flex-1 flex-col justify-center">

        {/* Step — Welcome */}
        {current === "welcome" && (
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-4xl">
              ⬡
            </div>
            <h1 className="mb-2 text-3xl font-bold">Welcome, {user.username}</h1>
            <p className="mb-2 text-muted">You're setting up <span className="text-accent-2 font-semibold">enzo ai</span> — your private AI assistant.</p>
            <p className="mb-8 text-sm text-muted">Everything runs on your machine. Your chats, memories, and data never leave.</p>
            <div className="grid grid-cols-3 gap-3 mb-8 text-left">
              {[
                { icon: "🔒", title: "Private", desc: "Zero telemetry. Nothing sent to us." },
                { icon: "🧠", title: "Memory", desc: "Learns about you over time." },
                { icon: "⚡", title: "Fast", desc: "Local models, no latency." },
              ].map(f => (
                <div key={f.title} className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="text-xl mb-1">{f.icon}</div>
                  <div className="text-xs font-semibold text-fg">{f.title}</div>
                  <div className="text-[11px] text-muted mt-0.5">{f.desc}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setStepIdx(i => i + 1)} className="w-full rounded-xl bg-accent py-3 font-semibold text-white hover:bg-accent-2 transition-colors">
              Get started →
            </button>
          </div>
        )}

        {/* Step — Secure your chats (admin only) */}
        {current === "encrypt" && (
          <div>
            <div className="mb-6 text-center">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-3xl">🔒</div>
              <h2 className="text-2xl font-bold">Secure your chats</h2>
              <p className="mt-2 text-sm text-muted">
                Encrypt your messages, titles and memories at rest with a passphrase. A copied database
                or backup is useless without it.
              </p>
            </div>

            {!encDone ? (
              <div className="rounded-xl border border-border bg-surface-2 p-5">
                <div className="flex flex-col gap-3">
                  <input className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-fg outline-none focus:border-accent placeholder:text-muted"
                    type="password" placeholder="Choose a passphrase" value={encPass} onChange={e => setEncPass(e.target.value)} />
                  <input className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-fg outline-none focus:border-accent placeholder:text-muted"
                    type="password" placeholder="Confirm passphrase" value={encPass2} onChange={e => setEncPass2(e.target.value)} />
                  {encErr && <p className="text-xs text-danger">{encErr}</p>}
                  <button onClick={setupEncryption} disabled={encBusy || !encPass || !encPass2}
                    className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                    {encBusy ? "Encrypting…" : "Encrypt my chats"}
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-muted leading-relaxed">
                  Remember this passphrase — you'll enter it (or a recovery key) to unlock your chats.
                  On a headless server set <code className="bg-bg px-1 rounded">ENZO_PASSPHRASE</code> to auto-unlock.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-5">
                <p className="text-sm font-semibold text-fg">Save your recovery key</p>
                <p className="mt-1 text-xs text-muted">This is the <b>only</b> way back in if you forget your passphrase. It won't be shown again.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 select-all break-all rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm">{encRecoveryKey}</code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(encRecoveryKey ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
                    className={`flex-shrink-0 rounded-lg border px-3 py-2.5 text-xs transition-colors ${copied ? "border-ok/40 bg-ok/10 text-ok" : "border-border text-muted hover:text-fg"}`}
                  >{copied ? "Copied ✓" : "Copy"}</button>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button onClick={() => setStepIdx(i => i - 1)} className="flex-1 rounded-xl border border-border py-2.5 text-sm text-muted hover:text-fg">← Back</button>
              {!encDone ? (
                <button onClick={() => setStepIdx(i => i + 1)} className="flex-1 rounded-xl border border-border py-2.5 text-sm text-muted hover:text-fg">Skip for now</button>
              ) : (
                <button onClick={() => setStepIdx(i => i + 1)} className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2">I've saved it →</button>
              )}
            </div>
          </div>
        )}

        {/* Step — Model Configuration */}
        {current === "models" && (
          <div>
            <h2 className="mb-6 text-xl font-bold text-center">Model Configuration</h2>

            {/* Local engine status */}
            {(mode === "local" || mode === "both") && (
              <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm font-semibold leading-none">Local engine (Ollama)</span>
                  {checking ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted animate-pulse leading-none"><span className="inline-block h-1.5 w-1.5 rounded-full bg-muted" />Checking…</span>
                  ) : ollamaOk === true ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ok font-semibold leading-none"><span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />Running</span>
                  ) : ollamaOk === false ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-danger font-semibold leading-none"><span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />Offline</span>
                  ) : null}
                </div>
                {ollamaOk === true && models.length > 0 && (
                  <div className="mt-2 text-center text-xs text-muted">Models ready: {models.slice(0,3).join(", ")}</div>
                )}
                {ollamaOk === false && (
                  <p className="mt-2 text-center text-xs text-muted">Ollama isn't detected. <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-accent-2 underline">Install Ollama</a> to use local models. You can continue without it and use cloud models instead.</p>
                )}
              </div>
            )}

            {/* Model selection — pick the default model, or analyze the system first */}
            {(mode === "local" || mode === "both") && ollamaOk && (
              <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">

                {/* Step A — two ways to choose a model */}
                {modelChoice === null && (
                  <>
                    <span className="mb-3 block text-sm font-semibold">How should we pick your first model?</span>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => { setModelChoice("default"); setSelectedModel(defaultModel); }}
                        className="flex items-center gap-3 rounded-lg border border-border bg-bg p-4 text-left transition-all hover:border-accent/40"
                      >
                        <span className="text-xl">🚀</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-fg">Use the default model</div>
                          <div className="mt-0.5 text-[11px] text-muted">A well-rounded model that runs on most machines — the fastest way to get started.</div>
                          {defaultModel && <div className="mt-1 font-mono text-[10px] text-muted/70">{defaultModel}</div>}
                        </div>
                      </button>
                      <button
                        onClick={() => { setModelChoice("analyze"); runAnalyze(); }}
                        className="flex items-center gap-3 rounded-lg border border-border bg-bg p-4 text-left transition-all hover:border-accent/40"
                      >
                        <span className="text-xl">🔍</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-fg">Analyze my system</div>
                          <div className="mt-0.5 text-[11px] text-muted">Detect your CPU, RAM and GPU, then recommend the best-fitting model.</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}

                {/* Step B (default) — confirm + download the default model */}
                {modelChoice === "default" && (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold">Default model</span>
                      <button onClick={() => setModelChoice(null)} disabled={pulling} className="text-xs text-muted hover:text-fg disabled:opacity-40">← Change</button>
                    </div>
                    <div className="mb-3 rounded-lg border border-accent bg-accent/10 p-3">
                      <div className="text-sm font-semibold text-fg">{defaultModel || "…"}</div>
                      <div className="mt-0.5 text-[11px] text-muted">Balanced quality and speed — a safe default for most machines.</div>
                    </div>
                    {models.includes(selectedModel) ? (
                      <p className="text-xs font-semibold text-ok">✓ {selectedModel} is ready to use</p>
                    ) : (
                      <>
                        <button
                          onClick={downloadModel}
                          disabled={pulling || !selectedModel}
                          className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
                        >
                          {pulling ? "Downloading…" : `Download ${selectedModel}`}
                        </button>
                        {pullProgressUI}
                        {!pulling && <p className="mt-2 text-[11px] text-muted">This downloads the model so it's ready to use — required to continue.</p>}
                      </>
                    )}
                  </>
                )}

                {/* Step B (analyze) — show the analysis, then recommended models */}
                {modelChoice === "analyze" && (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold">Recommended for your system</span>
                      <button onClick={() => setModelChoice(null)} disabled={pulling} className="text-xs text-muted hover:text-fg disabled:opacity-40">← Change</button>
                    </div>

                    {analyzing && (
                      <div className="flex items-center gap-2 py-6 text-sm text-muted">
                        <span className="animate-pulse">🔍 Analyzing your system…</span>
                      </div>
                    )}

                    {analysis && (
                      <>
                        {/* Detected hardware */}
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {[
                            { label: "CPU", value: `${analysis.info.cpuCount}c` },
                            { label: "RAM", value: `${analysis.info.ramGb}GB` },
                            { label: "GPU", value: analysis.info.gpuName?.split(" ").slice(-2).join(" ") ?? "—" },
                            { label: analysis.info.unifiedMemory ? "Accel" : "VRAM", value: analysis.info.unifiedMemory ? (analysis.info.accelerator ?? "Metal") : (analysis.info.vramGb != null ? `${analysis.info.vramGb}GB` : "—") },
                          ].map((c) => (
                            <div key={c.label} className="rounded-lg border border-border bg-bg p-2 text-center">
                              <div className="text-[9px] uppercase tracking-wide text-muted">{c.label}</div>
                              <div className="truncate text-xs font-semibold text-fg">{c.value}</div>
                            </div>
                          ))}
                        </div>

                        {/* Recommended + alternative models */}
                        <div className="flex flex-col gap-2 mb-3">
                          {[
                            { modelId: analysis.recommendation.modelId, label: analysis.recommendation.label, note: analysis.recommendation.reason, recommended: true },
                            ...analysis.recommendation.alternatives.map((a) => ({ ...a, recommended: false })),
                          ].map((opt) => {
                            const installed = models.includes(opt.modelId);
                            const selected = selectedModel === opt.modelId;
                            return (
                              <button
                                key={opt.modelId}
                                onClick={() => setSelectedModel(opt.modelId)}
                                disabled={pulling}
                                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all disabled:opacity-60 ${selected ? "border-accent bg-accent/10" : "border-border bg-bg hover:border-accent/40"}`}
                              >
                                <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${selected ? "border-accent bg-accent" : "border-border"}`}>
                                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-fg">{opt.label}</span>
                                    {MODEL_SIZES[opt.modelId] && (
                                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{MODEL_SIZES[opt.modelId]}</span>
                                    )}
                                    {opt.recommended && <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent-2">Recommended</span>}
                                    {installed && <span className="text-[10px] font-semibold text-ok">Installed ✓</span>}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-muted">{opt.note}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Download the selected model */}
                        {models.includes(selectedModel) ? (
                          <p className="text-xs font-semibold text-ok">✓ {selectedModel} is ready to use</p>
                        ) : (
                          <>
                            <button
                              onClick={downloadModel}
                              disabled={pulling || !selectedModel}
                              className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
                            >
                              {pulling ? "Downloading…" : `Download ${selectedModel}`}
                            </button>
                            {pullProgressUI}
                            {!pulling && <p className="mt-2 text-[11px] text-muted">This downloads the model so it's ready to use — required to continue.</p>}
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Cloud keys — collapsed by default (all optional) */}
            {(mode === "cloud" || mode === "both") && (
              <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">
                <button
                  type="button"
                  onClick={() => setShowKeys(v => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-semibold">
                    API Keys <span className="font-normal text-muted">(all optional — add now or later in Settings){keySaved.length > 0 ? ` · ${keySaved.length} saved` : ""}</span>
                  </span>
                  <span className={`text-xs text-muted transition-transform ${showKeys ? "rotate-180" : ""}`}>▼</span>
                </button>
                {showKeys && (
                <div className="mt-3">
                {([
                  { id: "openai", label: "OpenAI", placeholder: "sk-...", color: "text-green-400" },
                  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", color: "text-amber-400" },
                  { id: "google", label: "Google Gemini", placeholder: "AIza...", color: "text-blue-400" },
                ] as const).map(p => (
                  <div key={p.id} className="mb-3">
                    <label className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${p.color}`}>{p.label}</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted disabled:opacity-50"
                        placeholder={keySaved.includes(p.id) ? "Saved ✓" : p.placeholder}
                        value={keyInputs[p.id]}
                        onChange={e => setKeyInputs(k => ({...k, [p.id]: e.target.value}))}
                        disabled={keySaved.includes(p.id)}
                      />
                      <button
                        onClick={() => saveKey(p.id)}
                        disabled={!keyInputs[p.id].trim() || keySaved.includes(p.id)}
                        className="flex-shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
                      >
                        {keySaved.includes(p.id) ? "✓ Saved" : "Save"}
                      </button>
                    </div>
                  </div>
                ))}
                </div>
                )}
              </div>
            )}

            {/* A working local model is required before finishing (unless the
                local engine is unavailable, in which case cloud keys cover it). */}
            {(() => {
              const needsModel = (mode === "local" || mode === "both") && ollamaOk === true && models.length === 0;
              return (
                <div>
                  <div className="flex gap-3">
                    <button onClick={() => setStepIdx(i => i - 1)} className="flex-1 rounded-xl border border-border py-2.5 text-sm text-muted hover:text-fg">← Back</button>
                    <button
                      onClick={() => setStepIdx(i => i + 1)}
                      disabled={needsModel}
                      className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Continue →
                    </button>
                  </div>
                  {needsModel && (
                    <p className="mt-2 text-center text-[11px] text-muted">Download a model above to continue.</p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Step — All set */}
        {current === "done" && (
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-ok/30 bg-ok/10 text-4xl animate-pulse">
              ✓
            </div>
            <h2 className="mb-2 text-2xl font-bold">All set!</h2>
            <p className="text-muted mb-8">Enzo AI is ready. Start chatting and it will learn about you over time.</p>
            <div className="rounded-xl border border-border bg-surface-2 p-4 mb-6 text-left text-sm space-y-2">
              <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Profile created</div>
              {(mode === "local" || mode === "both") && ollamaOk && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Local engine connected</div>}
              {(mode === "local" || mode === "both") && models.length > 0 && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Local model ready</div>}
              {keySaved.length > 0 && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> {keySaved.length} cloud provider{keySaved.length > 1 ? "s" : ""} configured</div>}
              {encDone && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Chats encrypted with your passphrase</div>}
              <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Memory system active</div>
            </div>
            <button onClick={finish} className="w-full rounded-xl bg-accent py-3 font-semibold text-white hover:bg-accent-2 transition-colors">
              Start chatting →
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
