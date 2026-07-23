import { useEffect, useRef, useState } from "react";
import { Copy, Check, Pencil, RefreshCw, FileText, Download, AlertTriangle } from "lucide-react";
import type { Message } from "../types";
import { getToken } from "../api";
import { Markdown } from "./Markdown";

const SUGGESTIONS = [
  { icon: "✍️", text: "Help me write a professional email" },
  { icon: "🧠", text: "Explain a concept simply" },
  { icon: "💡", text: "Brainstorm ideas for my project" },
  { icon: "🔍", text: "Summarize this text for me" },
];

// Inline tool-activity markers streamed into the reply, e.g. `🔧 get_datetime`.
// Stripping them tells us whether any *real* answer text has started yet — a
// reply that's still only tool badges (or empty) is still "in progress".
const TOOL_MARKER_RE = /`🔧[^`]*`/g;

/** Animated "Thinking…" indicator — the one signal that work is happening in
 *  the background. Shown continuously from send until the answer text starts,
 *  through model reasoning and tool calls, so the chat is never silently idle. */
function ThinkingIndicator() {
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-2 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-2 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-2" />
      </span>
      Thinking…
    </span>
  );
}

export function ChatView({
  messages,
  busy,
  online,
  hasActiveChat,
  onNewChat,
  onSend,
  onRegenerate,
  onEditMessage,
}: {
  messages: Message[];
  busy: boolean;
  online: boolean | null;
  hasActiveChat: boolean;
  onNewChat: () => void;
  onSend?: (text: string) => void;
  onRegenerate?: (assistantId: string) => void;
  onEditMessage?: (userId: string, content: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // No chat open → full empty state with CTA
  if (!hasActiveChat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6">
        <div className="text-center">
          <div className="mb-3 text-5xl text-accent-2" style={{ filter: "drop-shadow(0 0 16px rgba(109,94,252,0.4))" }}>⬡</div>
          <h1 className="text-xl font-semibold text-fg">What can I help you with?</h1>
          <p className="mt-1 text-sm text-muted">Your AI runs entirely on this machine.</p>
          {online === false && (
            <p className="mt-2 text-xs text-danger">
              Local engine (Ollama) isn't running — external providers still work.
            </p>
          )}
        </div>
        <button
          onClick={onNewChat}
          className="rounded-2xl bg-accent px-8 py-3 font-semibold text-white shadow-[0_0_24px_rgba(109,94,252,0.35)] transition-all hover:bg-accent-2 hover:shadow-[0_0_32px_rgba(139,125,255,0.45)]"
        >
          Start new chat
        </button>
      </div>
    );
  }

  // Chat open but no messages yet — show suggestions
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6">
        <div className="text-center">
          <div className="mb-3 text-4xl text-accent-2" style={{ filter: "drop-shadow(0 0 12px rgba(109,94,252,0.35))" }}>⬡</div>
          <h2 className="text-lg font-semibold text-fg">How can I help?</h2>
          <p className="mt-1 text-sm text-muted">Start by typing a message below or pick a suggestion.</p>
        </div>

        <div className="grid w-full max-w-lg grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              disabled={busy}
              onClick={() => onSend?.(s.text)}
              className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-left text-sm text-muted transition-all hover:border-accent/50 hover:bg-surface hover:text-fg disabled:opacity-40"
            >
              <span className="flex-shrink-0">{s.icon}</span>
              <span className="leading-snug">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          m={m}
          busy={busy}
          onRegenerate={onRegenerate}
          onEditMessage={onEditMessage}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── Single message with hover actions (copy / regenerate / edit) ────────────────

function ActionButton({ onClick, title, disabled, children }: {
  onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function MessageBubble({ m, busy, onRegenerate, onEditMessage }: {
  m: Message;
  busy: boolean;
  onRegenerate?: (assistantId: string) => void;
  onEditMessage?: (userId: string, content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);

  async function copy() {
    const text = m.content;
    let ok = false;
    // Try the async Clipboard API first…
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* API present but blocked (sandboxed iframe / permission) — fall through */ }
    // …then fall back to execCommand, which works where the API is absent or denied.
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const showActions = !editing && (m.role === "user" || !!m.content);
  // Media URLs are loaded directly by the browser, so they carry the session
  // token as a query param instead of the x-enzo-ai-token header.
  const mediaToken = encodeURIComponent(getToken() ?? "");

  return (
    <div className="group mx-auto max-w-[780px] px-6 py-3.5">
      <div className={`mb-1 text-xs font-bold ${m.role === "user" ? "text-accent-2" : "text-muted"}`}>
        {m.role === "user" ? "You" : "EnzoAI"}
      </div>

      {m.image_mime && (
        <div className="mb-2">
          <img src={`/api/chat/image/${m.id}?token=${mediaToken}`} alt="attached image"
            className="max-h-64 max-w-sm rounded-xl border border-border object-cover shadow" loading="lazy" />
        </div>
      )}

      {m.attachment_name && (
        <a
          href={`/api/chat/attachment/${m.id}?token=${mediaToken}`}
          download={m.attachment_name}
          className="group/att mb-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm shadow transition-colors hover:border-accent/60"
          title={`Download ${m.attachment_name}`}
        >
          <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-fg">{m.attachment_name}</span>
          <Download className="h-3.5 w-3.5 flex-shrink-0 text-muted group-hover/att:text-fg" />
        </a>
      )}

      {editing && m.role === "user" ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            dir="auto"
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-fg outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); if (draft.trim() && draft !== m.content) onEditMessage?.(m.id, draft.trim()); }}
              disabled={!draft.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
            >Save &amp; submit</button>
            <button
              onClick={() => { setEditing(false); setDraft(m.content); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-fg"
            >Cancel</button>
          </div>
        </div>
      ) : m.role === "user" ? (
        <div dir="auto" className="inline-block whitespace-pre-wrap break-words rounded-[10px] bg-user px-3.5 py-2.5 leading-relaxed">
          {m.content}
        </div>
      ) : (() => {
        // A reply is "in progress" while a local turn is streaming (busy) or a
        // remote (Telegram/Discord) reply is being generated (placeholder id).
        const inProgress = busy || m.id === "__remote-thinking__";
        // Real answer text has started only once there's content beyond tool badges.
        const proseStarted = !!m.content && m.content.replace(TOOL_MARKER_RE, "").trim().length > 0;
        return (
          <div dir="auto" className="break-words leading-relaxed">
            {proseStarted ? (
              <Markdown content={m.content} />
            ) : (
              <div className="flex flex-col gap-1.5">
                {/* any tool badges streamed so far, so the user sees what it's doing */}
                {m.content && <Markdown content={m.content} />}
                {/* the always-on signal until the answer text arrives */}
                {inProgress && <ThinkingIndicator />}
              </div>
            )}
          </div>
        );
      })()}

      {m.role === "assistant" && m.error && (
        <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-danger" />
          <span className="flex-1 text-sm text-danger">{m.error}</span>
          {onRegenerate && (
            <button
              onClick={() => onRegenerate(m.id)}
              disabled={busy}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          )}
        </div>
      )}

      {showActions && (
        <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <ActionButton onClick={copy} title={copied ? "Copied" : "Copy"}>
            {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
          </ActionButton>
          {m.role === "user" && onEditMessage && (
            <ActionButton onClick={() => { setDraft(m.content); setEditing(true); }} title="Edit" disabled={busy}>
              <Pencil className="h-3.5 w-3.5" />
            </ActionButton>
          )}
          {m.role === "assistant" && onRegenerate && (
            <ActionButton onClick={() => onRegenerate(m.id)} title="Regenerate" disabled={busy}>
              <RefreshCw className="h-3.5 w-3.5" />
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
