import { useEffect, useState } from "react";
import { User, Settings, Zap, MessageSquare, Brain, Trash2, RotateCcw } from "lucide-react";
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
    // Nickname falls back to displayName so the user always sees their name
    nickname: u.nickname ?? u.displayName ?? "",
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
  const [tab, setTab] = useState<"profile" | "memory">("profile");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesBusy, setMemoriesBusy] = useState(false);

  // Re-sync form when the panel opens or the user object changes (e.g. after a save).
  useEffect(() => {
    if (open) {
      setForm(toForm(user));
      setSaved(false);
      setError(null);
      setTab("profile");
    }
  }, [open, user]);

  useEffect(() => {
    if (open && tab === "memory") {
      api.memories.list().then(setMemories).catch(() => {});
    }
  }, [open, tab]);

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
          "x-enzo-token": getToken() ?? "",
        },
        body: JSON.stringify({
          displayName:
            form.nickname.trim() ||
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
            Manage your profile and Enzo's memory.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border px-6 pt-1">
          {(["profile", "memory"] as const).map((t) => (
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

        {/* Profile tab */}
        {tab === "profile" && (
        <form onSubmit={save} className="flex flex-col gap-6 px-6 pt-5 pb-6">
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {/* ── Identity ── */}
          <fieldset className="flex flex-col gap-4">
            <legend className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <User className="h-3.5 w-3.5" /> Identity
            </legend>

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
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="s-nick">
                  Nickname
                  <span className="ml-1.5 font-normal text-muted/60">— how Enzo calls you</span>
                </Label>
                <input id="s-nick" className={inputCls} placeholder="How you like to be called"
                  value={form.nickname} onChange={(e) => set("nickname", e.target.value)} />
              </div>
            </div>
          </fieldset>

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
                placeholder="Background, interests, context for Enzo…"
                value={form.about} onChange={(e) => set("about", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-style">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  How should Enzo respond to you?
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
