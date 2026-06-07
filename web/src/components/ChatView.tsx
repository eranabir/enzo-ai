import { useEffect, useRef } from "react";
import type { Message } from "../types";
import { Markdown } from "./Markdown";

const SUGGESTIONS = [
  { icon: "✍️", text: "Help me write a professional email" },
  { icon: "🧠", text: "Explain a concept simply" },
  { icon: "💡", text: "Brainstorm ideas for my project" },
  { icon: "🔍", text: "Summarize this text for me" },
];

export function ChatView({
  messages,
  busy,
  online,
  hasActiveChat,
  onNewChat,
  onSend,
}: {
  messages: Message[];
  busy: boolean;
  online: boolean | null;
  hasActiveChat: boolean;
  onNewChat: () => void;
  onSend?: (text: string) => void;
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
        <div key={m.id} className="mx-auto max-w-[780px] px-6 py-3.5">
          <div
            className={`mb-1 text-xs font-bold ${
              m.role === "user" ? "text-accent-2" : "text-muted"
            }`}
          >
            {m.role === "user" ? "You" : "EnzoAI"}
          </div>
          {/* Image attachment — shown above the text bubble */}
          {m.image_mime && (
            <div className="mb-2">
              <img
                src={`/api/chat/image/${m.id}`}
                alt="attached image"
                className="max-h-64 max-w-sm rounded-xl border border-border object-cover shadow"
                loading="lazy"
              />
            </div>
          )}
          {m.role === "user" ? (
            <div className="inline-block whitespace-pre-wrap break-words rounded-[10px] bg-user px-3.5 py-2.5 leading-relaxed">
              {m.content}
            </div>
          ) : (
            <div className="break-words leading-relaxed">
              {m.content
                ? <Markdown content={m.content} />
                : (busy ? <span className="animate-blink text-accent-2">▋</span> : "")}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
