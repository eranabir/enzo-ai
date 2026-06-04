import { useEffect, useState } from "react";
import { Settings, Zap, MessageSquare, Brain, Trash2, RotateCcw, User } from "lucide-react";
import { api, getToken } from "../api";
import type { Memory, User as UserType } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/Dialog";
import { Label } from "./ui/Label";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none placeholder:text-muted focus:border-accent transition-colors";

interface Props {
  open: boolean;
  user: UserType;
  onClose: () => void;
  onUpdated: (user: UserType) => void;
}

/** Build form values from a user, falling back sensibly for null fields. */
function toForm(u: UserType) {
  return {
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    superPowers: u.superPowers ?? "",
    about: u.about ?? "",
    assistantStyle: u.assistantStyle ?? "",
  };
}

export function SettingsPanel({ open, user, onClose, onUpdated }: Props) {
  const [form, setForm] = useState(() => toForm(user));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "memory" | "apps">("profile");
  const [calStatus, setCalStatus] = useState<{ hasCredentials: boolean; connected: boolean; email?: string } | null>(null);
  const [calClientId, setCalClientId]         = useState("");
  const [calClientSecret, setCalClientSecret] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesBusy, setMemoriesBusy] = useState(false);

  // Re-sync form when the panel opens or the user object changes (e.g. after a save).
  useEffect(() => {
    if (open) {
      setForm(toForm(user));
      setSaved(false);
      setError(null);
      setTab("profile");
      setCalOpen(false);
      setCalStatus(null);
    }
  }, [open, user]);

  useEffect(() => {
    if (open && tab === "memory") {
      api.memories.list().then(setMemories).catch(() => {});
    }
    if (open && tab === "apps") {
      api.calendar.status().then(setCalStatus).catch(() => {});
    }
  }, [open, tab]);

  async function connectGoogle() {
    setCalBusy(true);
    try {
      const { url } = await api.calendar.authUrl();
      const popup = window.open(url, "google-calendar-auth", "width=500,height=650,left=400,top=100");
      const handler = (e: MessageEvent) => {
        if (e.data?.ok) {
          setCalStatus(s => s ? { ...s, connected: true, email: e.data.email } : null);
        }
        window.removeEventListener("message", handler);
        popup?.close();
      };
      window.addEventListener("message", handler);
    } catch (e) { alert((e as Error).message); }
    finally { setCalBusy(false); }
  }

  async function disconnectGoogle() {
    await api.calendar.disconnect();
    setCalStatus(s => s ? { ...s, connected: false, email: undefined } : null);
  }

  async function deleteMemory(id: string) {
    await api.memories.deleteOne(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  async function clearAllMemories() {
    if (!confirm("Clear all your memories? This cannot be undone.")) return;
    setMemoriesBusy(true);
    await api.memories.clearAll().catch(() => {});
    setMemories([]);
    setMemoriesBusy(false);
  }

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      // PATCH /auth/me
      const updated = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-enzo-ai-token": getToken() ?? "",
        },
        body: JSON.stringify({
          displayName:
            [form.firstName, form.lastName].filter(Boolean).join(" ") ||
            user.username,
          ...form,
        }),
      }).then((r) => r.json());

      if (updated?.user) {
        onUpdated(updated.user);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent-2" />
            <DialogTitle>Settings</DialogTitle>
          </div>
          <DialogDescription>
            Manage your profile and Enzo AI's memory.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border px-6 pt-1">
          {(["profile", "memory", "apps"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                tab === t ? "border-b-2 border-accent text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {t === "memory" && <Brain className="h-3.5 w-3.5" />}
              {t}
            </button>
          ))}
        </div>

        {/* Memory tab */}
        {tab === "memory" && (
          <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                {memories.length === 0
                  ? "No memories yet — they build up as you chat."
                  : `${memories.length} stored ${memories.length === 1 ? "memory" : "memories"}`}
              </p>
              {memories.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllMemories}
                  disabled={memoriesBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  <RotateCcw className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {memories.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
                >
                  <span className={`mt-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    m.type === "fact" ? "bg-blue-500/20 text-blue-400" :
                    m.type === "decision" ? "bg-amber-500/20 text-amber-400" :
                    m.type === "preference" ? "bg-purple-500/20 text-purple-400" :
                    "bg-green-500/20 text-green-400"
                  }`}>
                    {m.type.replace("_", " ")}
                  </span>
                  <p className="flex-1 text-sm text-fg leading-relaxed">{m.content}</p>
                  <button
                    type="button"
                    onClick={() => deleteMemory(m.id)}
                    className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Apps tab */}
        {tab === "apps" && (
          <div className="flex flex-col gap-3 p-6">
            {/* Google Calendar app card */}
            <div className="rounded-xl border border-border bg-surface-2 overflow-hidden">
              {/* Card header — always visible */}
              <button
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface transition-colors"
                onClick={() => { setCalOpen(o => !o); if (!calStatus) api.calendar.status().then(setCalStatus).catch(() => {}); }}
              >
                {/* Google Calendar icon */}
                <div className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden">
                  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
                    <rect width="48" height="48" rx="8" fill="#fff"/>
                    <rect x="6" y="6" width="36" height="36" rx="4" fill="#fff" stroke="#e0e0e0" strokeWidth="1"/>
                    <rect x="6" y="14" width="36" height="28" rx="0" fill="#fff"/>
                    <rect x="6" y="14" width="36" height="6" fill="#4285f4"/>
                    <rect x="6" y="6" width="36" height="8" rx="4" fill="#4285f4"/>
                    <rect x="6" y="10" width="36" height="4" fill="#4285f4"/>
                    <circle cx="14" cy="10" r="3" fill="#fff"/>
                    <circle cx="34" cy="10" r="3" fill="#fff"/>
                    <text x="24" y="34" textAnchor="middle" fontSize="14" fontWeight="700" fill="#4285f4" fontFamily="sans-serif">
                      {new Date().getDate()}
                    </text>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg">Google Calendar</p>
                  <p className="text-xs text-muted">
                    {calStatus === null ? "Loading…" : calStatus.connected ? `Connected as ${calStatus.email}` : "Not connected"}
                  </p>
                </div>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${calStatus?.connected ? "bg-ok" : "bg-muted/40"}`} />
              </button>

              {/* Expanded settings — only shown when card is open */}
              {calOpen && (calStatus === null ? (
                <div className="border-t border-border px-4 py-3 text-xs text-muted">Loading…</div>
              ) : calStatus.connected ? (
              <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
                <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#4285f4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fbbc05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335"/></svg>
                  <div>
                    <p className="font-semibold text-ok text-sm">Connected</p>
                    <p className="text-xs text-muted">{calStatus.email}</p>
                  </div>
                </div>
                <p className="text-xs text-muted">Agents can now use the <code className="bg-surface px-1 rounded text-[10px]">get_calendar_events</code> tool to read your upcoming events.</p>
                <button onClick={disconnectGoogle}
                  className="text-xs text-danger hover:underline text-left">
                  Disconnect Google Calendar
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                <p className="text-sm text-muted">Connect your Google Calendar so agents can read your schedule.</p>

                {/* Step 1: credentials */}
                <div className="rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-3">
                  <p className="text-xs font-semibold text-muted">
                    Step 1 — Create a Google OAuth app at{" "}
                    <span className="text-accent-2">console.cloud.google.com</span>
                    {" "}→ Credentials → OAuth 2.0 Client (Web) and add redirect URI:{" "}
                    <code className="bg-surface px-1 rounded text-[10px]">http://localhost:1616/api/calendar/callback</code>
                  </p>
                  <input className={inputCls} type="password"
                    placeholder={calStatus?.hasCredentials ? "Client ID ••••••••  (saved)" : "Paste Client ID"}
                    value={calClientId} onChange={e => setCalClientId(e.target.value)} />
                  <input className={inputCls} type="password"
                    placeholder={calStatus?.hasCredentials ? "Client Secret ••••••••  (saved)" : "Paste Client Secret"}
                    value={calClientSecret} onChange={e => setCalClientSecret(e.target.value)} />
                  {(calClientId.trim() || calClientSecret.trim()) && (
                    <button onClick={async () => {
                      setCalBusy(true);
                      try {
                        await api.calendar.saveCredentials({ clientId: calClientId, clientSecret: calClientSecret });
                        setCalStatus(s => s ? { ...s, hasCredentials: true } : null);
                        setCalClientId(""); setCalClientSecret("");
                      } finally { setCalBusy(false); }
                    }} disabled={calBusy || !calClientId.trim() || !calClientSecret.trim()}
                      className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-fg border border-border hover:border-accent/60 disabled:opacity-40 self-start">
                      Save credentials
                    </button>
                  )}
                </div>

                {/* Step 2: connect */}
                <button onClick={connectGoogle} disabled={calBusy || !calStatus?.hasCredentials}
                  className="flex items-center justify-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-semibold text-fg transition-colors hover:border-accent/60 disabled:opacity-40">
                  <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  {calBusy ? "Opening Google…" : calStatus?.hasCredentials ? "Sign in with Google" : "Save credentials first"}
                </button>
              </div>
            ))}
            </div>{/* end Google Calendar card */}
          </div>
        )}

        {/* Profile tab */}
        {tab === "profile" && (
        <form onSubmit={save} className="flex flex-col gap-6 px-6 pt-5 pb-6">
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {/* ── Identity ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <User className="h-3.5 w-3.5" /> Identity
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-first">First name</Label>
                <input id="s-first" className={inputCls} placeholder="Jane"
                  value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-last">Last name</Label>
                <input id="s-last" className={inputCls} placeholder="Smith"
                  value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── AI context ── */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <Zap className="h-3.5 w-3.5" /> AI context
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-powers">
                ⚡ Super powers
                <span className="ml-1 font-normal text-muted/70">— your skills & expertise</span>
              </Label>
              <input id="s-powers" className={inputCls}
                placeholder="e.g. Full-stack dev, system design, coffee brewing"
                value={form.superPowers} onChange={(e) => set("superPowers", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-about">About you</Label>
              <textarea id="s-about" className={`${inputCls} resize-none`} rows={2}
                placeholder="Background, interests, context for Enzo AI…"
                value={form.about} onChange={(e) => set("about", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-style">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  How should Enzo AI respond to you?
                </span>
              </Label>
              <textarea id="s-style" className={`${inputCls} resize-none`} rows={2}
                placeholder="e.g. Be concise, use code examples, skip the fluff."
                value={form.assistantStyle} onChange={(e) => set("assistantStyle", e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            {saved && <span className="text-xs text-ok">Saved ✓</span>}
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-fg">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
