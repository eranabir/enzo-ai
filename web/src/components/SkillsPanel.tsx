import { useEffect, useState } from "react";
import { Pencil, Trash2, Sparkles } from "lucide-react";
import { useConfirm } from "./ui/ConfirmProvider";
import { ModalHeader } from "./ui/ModalHeader";
import { api } from "../api";
import type { Skill } from "../types";

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

/**
 * Manage the user's library of skills — reusable, on-demand instruction bundles
 * that can be attached to agents. An agent sees each skill's name + description
 * and loads the full instructions only when a task matches (progressive
 * disclosure), so common guidance lives in one place instead of being pasted
 * into every agent.
 */
export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form, setForm] = useState({ name: "", description: "", instructions: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.skills.list().then(setSkills).catch(() => {}); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", instructions: "" });
    setErr(null);
    setView("form");
  }

  function openEdit(s: Skill) {
    setEditing(s);
    setForm({ name: s.name, description: s.description, instructions: s.instructions });
    setErr(null);
    setView("form");
  }

  async function save() {
    if (!form.name.trim() || !form.instructions.trim()) {
      setErr("Name and instructions are required");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        instructions: form.instructions.trim(),
      };
      if (editing) {
        const updated = await api.skills.update(editing.id, body);
        setSkills(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const created = await api.skills.create(body);
        setSkills(prev => [created, ...prev]);
      }
      setView("list");
    } catch (e) {
      setErr((e as Error).message || "Failed to save skill");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete skill?", description: "This skill will be removed and detached from any agents using it.", confirmText: "Delete", danger: true }))) return;
    await api.skills.delete(id).catch(() => {});
    setSkills(prev => prev.filter(s => s.id !== id));
  }

  // ── Form view ──────────────────────────────────────────────────────────────
  if (view === "form") return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title={editing ? "Edit skill" : "New skill"}
          onBack={() => setView("list")}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Name</label>
            <input className={inputCls} placeholder="e.g. Summarize a medical PDF"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Description</label>
            <input className={inputCls} placeholder="One line — this is what the agent sees to decide when to use the skill"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <p className="text-[11px] text-muted">The agent reads only this line up front, and loads the full instructions below on demand.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Instructions</label>
            <textarea className={`${inputCls} min-h-[280px] resize-y leading-relaxed`} rows={14}
              placeholder="The full step-by-step know-how the agent should follow when this skill applies…"
              value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} />
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
        <div className="border-t border-border px-5 py-4 flex gap-3">
          <button onClick={() => setView("list")} className="rounded-xl border border-border px-4 py-2 text-sm text-muted hover:text-fg">Cancel</button>
          <button onClick={save} disabled={busy || !form.name.trim() || !form.instructions.trim()}
            className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
            {busy ? "Saving…" : editing ? "Save changes" : "Create skill"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title="Skills"
          subtitle="Reusable, on-demand instructions you can attach to agents"
          onClose={onClose}
          actions={
            skills.length > 0 ? (
              <button onClick={openCreate}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-2">
                + New skill
              </button>
            ) : undefined
          }
        />
        <div className="flex-1 overflow-y-auto p-5">
          {skills.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Sparkles className="h-10 w-10 opacity-30" />
              <div>
                <p className="font-semibold text-fg">No skills yet</p>
                <p className="text-sm text-muted max-w-sm">A skill is a reusable set of instructions. Attach it to an agent and it loads only when a task matches — so you write the guidance once and share it across agents.</p>
              </div>
              <button onClick={openCreate}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-2">
                Create your first skill
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <Sparkles className="h-4 w-4 flex-shrink-0 text-accent-2" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-fg">{s.name}</span>
                    <p className="text-xs text-muted truncate mt-0.5">{s.description || s.instructions.slice(0, 80)}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => openEdit(s)} className="rounded-lg border border-border p-1.5 text-muted hover:text-fg">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(s.id)} className="rounded-lg border border-border p-1.5 text-muted hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
