import { useEffect, useRef } from "react";
import type { Message } from "../types";

export function ChatView({
  messages,
  busy,
  online,
}: {
  messages: Message[];
  busy: boolean;
  online: boolean | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <div className="max-w-[440px] px-6 text-center">
          <div className="text-5xl text-accent-2">⬡</div>
          <h1 className="my-2 text-2xl font-semibold">Welcome to Enzo</h1>
          <p className="leading-relaxed text-muted">
            Your AI runs entirely on this machine. Conversations and memory
            stay local and private.
          </p>
          {online === false && (
            <p className="mt-3 text-sm text-danger">
              The local engine (Ollama) isn't running yet. Start it, then send
              a message.
            </p>
          )}
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
            {m.role === "user" ? "You" : "Enzo"}
          </div>
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
