import { useEffect, useState } from "react";
import { api } from "../api";
import type { User } from "../types";

interface Props {
  user: User;
  onDone: () => void;
}

type Mode = "local" | "cloud" | "both" | null;
type Step = 1 | 2 | 3 | 4;

export function SetupWizard({ user, onDone }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>(null);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [keyInputs, setKeyInputs] = useState({ openai: "", anthropic: "", google: "" });
  const [keySaved, setKeySaved] = useState<string[]>([]);

  useEffect(() => {
    if (step === 3 && (mode === "local" || mode === "both")) {
      setChecking(true);
      api.status()
        .then((s) => {
          setOllamaOk(s.ollama);
          if (s.ollama) {
            api.models().then(({ models: m }) => setModels(m.map(x => x.id))).catch(() => {});
          }
        })
        .catch(() => setOllamaOk(false))
        .finally(() => setChecking(false));
    }
  }, [step, mode]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 backdrop-blur-sm p-4">
      {/* Progress dots */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-2">
        {[1,2,3,4].map(s => (
          <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? "w-8 bg-accent" : s < step ? "w-3 bg-accent/50" : "w-3 bg-border"}`} />
        ))}
      </div>

      <div className="w-full max-w-lg">

        {/* Step 1 — Welcome */}
        {step === 1 && (
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-4xl">
              ⬡
            </div>
            <h1 className="mb-2 text-3xl font-bold">Welcome, {user.username}</h1>
            <p className="mb-2 text-muted">You're setting up <span className="text-accent-2 font-semibold">enzo ai</span> — your private AI assistant.</p>
            <p className="mb-8 text-sm text-muted">Everything runs on your machine. Your conversations, memories, and data never leave.</p>
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
            <button onClick={() => setStep(2)} className="w-full rounded-xl bg-accent py-3 font-semibold text-white hover:bg-accent-2 transition-colors">
              Get started →
            </button>
          </div>
        )}

        {/* Step 2 — Choose mode */}
        {step === 2 && (
          <div>
            <h2 className="mb-1 text-xl font-bold text-center">Choose your AI</h2>
            <p className="text-center text-sm text-muted mb-6">How do you want to power your conversations?</p>
            <div className="flex flex-col gap-3 mb-6">
              {[
                { id: "local" as Mode, icon: "🖥", title: "Local AI", sub: "Runs on your machine — free, private, offline-ready", tags: ["Free", "No internet", "100% private"] },
                { id: "cloud" as Mode, icon: "☁", title: "Cloud AI", sub: "ChatGPT, Claude, Gemini — your own API keys", tags: ["GPT-4o", "Claude", "Gemini"] },
                { id: "both" as Mode, icon: "⚡", title: "Both", sub: "Start with local, switch to cloud when you need more power", tags: ["Best of both"] },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setMode(opt.id)}
                  className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-all ${mode === opt.id ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-accent/40"}`}
                >
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <div className="font-semibold text-fg">{opt.title}</div>
                    <div className="text-xs text-muted mt-0.5">{opt.sub}</div>
                    <div className="flex gap-1.5 mt-2">
                      {opt.tags.map(t => <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted">{t}</span>)}
                    </div>
                  </div>
                  {mode === opt.id && <span className="text-accent-2 font-bold text-lg">✓</span>}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 rounded-xl border border-border py-2.5 text-sm text-muted hover:text-fg">← Back</button>
              <button onClick={() => setStep(3)} disabled={!mode} className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">Continue →</button>
            </div>
          </div>
        )}

        {/* Step 3 — Model Configuration */}
        {step === 3 && (
          <div>
            <h2 className="mb-1 text-xl font-bold text-center">Model Configuration</h2>

            {/* Local engine status */}
            {(mode === "local" || mode === "both") && (
              <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">Local engine (Ollama)</span>
                  {checking ? (
                    <span className="text-xs text-muted animate-pulse">Checking…</span>
                  ) : ollamaOk === true ? (
                    <span className="text-xs text-ok font-semibold">● Running</span>
                  ) : ollamaOk === false ? (
                    <span className="text-xs text-danger font-semibold">● Offline</span>
                  ) : null}
                </div>
                {ollamaOk === true && models.length > 0 && (
                  <div className="text-xs text-muted">Models ready: {models.slice(0,3).join(", ")}</div>
                )}
                {ollamaOk === false && (
                  <p className="text-xs text-muted">Ollama isn't detected. <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-accent-2 underline">Install Ollama</a> to use local models. You can continue without it and use cloud models instead.</p>
                )}
              </div>
            )}

            {/* Cloud keys */}
            {(mode === "cloud" || mode === "both") && (
              <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">
                <p className="text-sm font-semibold mb-3">API Keys <span className="font-normal text-muted">(all optional — add now or later in Settings)</span></p>
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

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 rounded-xl border border-border py-2.5 text-sm text-muted hover:text-fg">← Back</button>
              <button onClick={() => setStep(4)} className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2">Continue →</button>
            </div>
          </div>
        )}

        {/* Step 4 — All set */}
        {step === 4 && (
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-ok/30 bg-ok/10 text-4xl animate-pulse">
              ✓
            </div>
            <h2 className="mb-2 text-2xl font-bold">All set!</h2>
            <p className="text-muted mb-8">Enzo AI is ready. Start chatting and it will learn about you over time.</p>
            <div className="rounded-xl border border-border bg-surface-2 p-4 mb-6 text-left text-sm space-y-2">
              <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Profile created</div>
              {(mode === "local" || mode === "both") && ollamaOk && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Local engine connected</div>}
              {keySaved.length > 0 && <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> {keySaved.length} cloud provider{keySaved.length > 1 ? "s" : ""} configured</div>}
              <div className="flex items-center gap-2 text-muted"><span className="text-ok">✓</span> Memory system active</div>
            </div>
            <button onClick={finish} className="w-full rounded-xl bg-accent py-3 font-semibold text-white hover:bg-accent-2 transition-colors">
              Start chatting →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
