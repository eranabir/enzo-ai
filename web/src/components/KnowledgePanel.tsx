import { useEffect, useRef, useState } from "react";
import { BookOpen, Trash2, FileText, Globe, Upload, MessageSquare } from "lucide-react";
import { api } from "../api";
import type { KnowledgeBase, KnowledgeDocument } from "../types";
import { ModalHeader } from "./ui/ModalHeader";

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

interface Props {
  onClose: () => void;
  onStartChat: (knowledgeBaseId: string) => void;
}

export function KnowledgePanel({ onClose, onStartChat }: Props) {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [embed, setEmbed] = useState<{ model: string; available: boolean } | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const [active, setActive] = useState<KnowledgeBase | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  useEffect(() => {
    api.knowledge.listBases().then(setBases).catch(() => {});
    api.knowledge.status().then(setEmbed).catch(() => {});
  }, []);

  async function createBase() {
    if (!form.name.trim()) return;
    const kb = await api.knowledge.createBase({ name: form.name.trim(), description: form.description.trim() || undefined });
    setBases((prev) => [kb, ...prev]);
    setForm({ name: "", description: "" });
    setCreating(false);
  }

  async function deleteBase(id: string) {
    if (!confirm("Delete this knowledge base and all its documents?")) return;
    await api.knowledge.deleteBase(id).catch(() => {});
    setBases((prev) => prev.filter((b) => b.id !== id));
  }

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (view === "detail" && active) {
    return (
      <KnowledgeDetail
        kb={active}
        onClose={onClose}
        onBack={() => { setView("list"); setActive(null); api.knowledge.listBases().then(setBases).catch(() => {}); }}
        onStartChat={() => onStartChat(active.id)}
      />
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title="Knowledge"
          subtitle="Give your agents private documents to answer from"
          onClose={onClose}
          actions={
            bases.length > 0 ? (
              <button onClick={() => setCreating(true)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-2">
                + New base
              </button>
            ) : undefined
          }
        />

        <div className="flex-1 overflow-y-auto p-5">
          {embed && !embed.available && (
            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              The embedding model <span className="font-mono">{embed.model}</span> will be downloaded automatically the first time you add a document (~270 MB, one time).
            </div>
          )}

          {creating && (
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4">
              <input autoFocus className={inputCls} placeholder="Name — e.g. Product docs"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && createBase()} />
              <input className={inputCls} placeholder="Description (optional)"
                value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setCreating(false); setForm({ name: "", description: "" }); }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-fg">Cancel</button>
                <button onClick={createBase} disabled={!form.name.trim()}
                  className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">Create</button>
              </div>
            </div>
          )}

          {bases.length === 0 && !creating ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <BookOpen className="h-10 w-10 text-muted/40" />
              <div>
                <p className="font-semibold text-fg">No knowledge bases yet</p>
                <p className="text-sm text-muted">Create one, add documents, then attach it to an agent or chat.</p>
              </div>
              <button onClick={() => setCreating(true)}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-2">
                Create your first knowledge base
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {bases.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <BookOpen className="h-5 w-5 flex-shrink-0 text-accent-2" />
                  <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => { setActive(b); setView("detail"); }}>
                    <span className="truncate font-semibold text-fg">{b.name}</span>
                    <span className="truncate text-xs text-muted">
                      {b.document_count} document{b.document_count === 1 ? "" : "s"}{b.description ? ` · ${b.description}` : ""}
                    </span>
                  </button>
                  <button onClick={() => onStartChat(b.id)} title="Chat with this knowledge base"
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2">
                    <MessageSquare className="h-3.5 w-3.5" /> Chat
                  </button>
                  <button onClick={() => deleteBase(b.id)} title="Delete"
                    className="rounded-lg border border-border p-1.5 text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeDetail({ kb, onClose, onBack, onStartChat }: {
  kb: KnowledgeBase; onClose: () => void; onBack: () => void; onStartChat: () => void;
}) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [tab, setTab] = useState<"text" | "url" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.knowledge.listDocuments(kb.id).then(setDocs).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [kb.id]);

  async function add(body: { title?: string; sourceType: "text" | "url"; content?: string; url?: string }) {
    setBusy(true); setErr(null);
    try {
      await api.knowledge.addDocument(kb.id, body);
      setTitle(""); setText(""); setUrl("");
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    await add({ title: file.name, sourceType: "text", content });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function deleteDoc(id: string) {
    await api.knowledge.deleteDocument(id).catch(() => {});
    refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title={kb.name}
          onBack={onBack}
          backLabel="All bases"
          onClose={onClose}
          actions={
            <button onClick={onStartChat}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-2">
              <MessageSquare className="h-4 w-4" /> Chat
            </button>
          }
        />

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Add content */}
          <div className="rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-3">
            <div className="flex gap-1">
              {([["text", "Paste text", FileText], ["url", "From URL", Globe], ["file", "Upload file", Upload]] as const).map(([k, label, Icon]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === k ? "bg-accent/10 text-accent-2" : "text-muted hover:text-fg"}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            {tab === "text" && (
              <>
                <input className={inputCls} placeholder="Title — e.g. Onboarding guide" value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea className={`${inputCls} resize-none font-mono text-xs`} rows={6} placeholder="Paste the document text here…" value={text} onChange={(e) => setText(e.target.value)} />
                <button onClick={() => add({ title, sourceType: "text", content: text })} disabled={busy || !text.trim()}
                  className="self-end rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  {busy ? "Indexing…" : "Add document"}
                </button>
              </>
            )}
            {tab === "url" && (
              <>
                <input className={inputCls} placeholder="https://example.com/article" value={url} onChange={(e) => setUrl(e.target.value)} />
                <button onClick={() => add({ sourceType: "url", url, title: url })} disabled={busy || !url.trim()}
                  className="self-end rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  {busy ? "Fetching & indexing…" : "Fetch & add"}
                </button>
              </>
            )}
            {tab === "file" && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">Text-based files: .txt, .md, .csv, .json, code. (PDF support coming soon.)</p>
                <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.json,.log,.ts,.tsx,.js,.py,.html,.css,.yml,.yaml,text/*" onChange={onFile} disabled={busy}
                  className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-accent-2" />
                {busy && <p className="text-xs text-muted">Indexing…</p>}
              </div>
            )}
            {err && <p className="text-xs text-danger">{err}</p>}
          </div>

          {/* Documents */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted/60">
              Documents {docs.length > 0 && `(${docs.length})`}
            </p>
            {docs.length === 0 ? (
              <p className="text-sm text-muted">No documents yet — add some above.</p>
            ) : docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2.5">
                {d.source_type === "url" ? <Globe className="h-4 w-4 flex-shrink-0 text-muted" /> : <FileText className="h-4 w-4 flex-shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{d.title}</p>
                  <p className="text-xs text-muted">{d.chunk_count} chunk{d.chunk_count === 1 ? "" : "s"}</p>
                </div>
                <button onClick={() => deleteDoc(d.id)} title="Remove" className="rounded-lg border border-border p-1.5 text-muted hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
