import { useEffect, useState } from "react";
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

function ModelsTab() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [ollamaOnline, setOllamaOnline] = useState(true);
  const [pullName, setPullName] = useState("");
  const [pullStatus, setPullStatus] = useState("");
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api.admin
      .listModels()
      .then(({ models, defaultModel, ollamaOnline }) => {
        setModels(models);
        setDefaultModel(defaultModel);
        setOllamaOnline(ollamaOnline);
      })
      .catch(() => {});
  }
  useEffect(load, []);

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

  return (
    <div className="flex flex-col gap-5">
      <Section title="Installed models">
        {!ollamaOnline && (
          <p className="mb-3 text-xs text-danger">Ollama is offline — start it to manage models.</p>
        )}
        {err && <p className="mb-3 text-xs text-danger">{err}</p>}
        <div className="flex flex-col gap-2">
          {models.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{m.id}</span>
                  {m.id === defaultModel && (
                    <span className="flex-shrink-0 rounded-full bg-ok/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ok">
                      Default
                    </span>
                  )}
                </div>
                {m.label && <div className="text-xs text-muted">{m.label}</div>}
              </div>
              <div className="flex flex-shrink-0 gap-1.5">
                {m.id !== defaultModel && (
                  <button
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-ok hover:text-ok"
                    onClick={() => doSetDefault(m.id)}
                    disabled={busy}
                  >
                    Set default
                  </button>
                )}
                <button
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger"
                  onClick={() => doDelete(m.id)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {models.length === 0 && (
            <p className="text-sm text-muted">No models installed yet.</p>
          )}
        </div>
      </Section>

      <Section title="Pull a new model">
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="e.g. qwen2.5:14b or llama3.1:8b"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !pulling && doPull()}
            disabled={pulling}
          />
          <button
            className="flex-shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
            onClick={doPull}
            disabled={pulling || !pullName.trim()}
          >
            {pulling ? "Pulling…" : "Pull"}
          </button>
        </div>
        {pullStatus && (
          <p className="mt-2 truncate text-xs text-muted">{pullStatus}</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Browse available models at{" "}
          <span className="text-accent-2">ollama.com/library</span>
        </p>
      </Section>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

type Tab = "users" | "models";

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
          {(["users", "models"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-md px-4 py-2 text-sm font-semibold capitalize transition-colors ${
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
          {tab === "users" && <UsersTab currentUserId={currentUser.id} />}
          {tab === "models" && <ModelsTab />}
        </div>
      </div>
    </div>
  );
}
