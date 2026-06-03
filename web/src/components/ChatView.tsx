import { useEffect, useRef } from "react";
import type { Message } from "../types";

export function ChatView({
  messages,
  busy,
  online,
  hasActiveConversation,
  onNewChat,
}: {
  messages: Message[];
  busy: boolean;
  online: boolean | null;
  hasActiveConversation: boolean;
  onNewChat: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // No conversation open → full empty state with CTA
  if (!hasActiveConversation) {
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

  // Conversation open but no messages yet (shouldn't normally happen)
  if (messages.length === 0) {
    return <div className="flex-1" />;
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
            {m.role === "user" ? "You" : "Enzo AI"}
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
          <div
            className={`leading-relaxed whitespace-pre-wrap break-words ${
              m.role === "user"
                ? "inline-block rounded-[10px] bg-user px-3.5 py-2.5"
                : ""
            }`}
          >
            {m.content || (busy ? <span className="animate-blink text-accent-2">▋</span> : "")}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
