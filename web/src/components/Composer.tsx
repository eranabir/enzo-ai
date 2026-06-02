import { useState } from "react";

export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="mx-auto flex w-full max-w-[780px] items-end gap-2.5 px-6 pb-6 pt-3">
      <textarea
        className="max-h-[200px] flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-3 leading-normal text-fg outline-none focus:border-accent"
        placeholder={
          disabled ? "Start Ollama to begin chatting…" : "Message Enzo…"
        }
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {busy ? (
        <button
          className="h-11 flex-shrink-0 rounded-[10px] border border-border bg-surface-2 px-3.5 text-sm text-fg"
          onClick={onStop}
        >
          ◼ Stop
        </button>
      ) : (
        <button
          className="h-11 w-11 flex-shrink-0 rounded-[10px] bg-accent text-lg text-white hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={submit}
          disabled={!text.trim()}
        >
          ↑
        </button>
      )}
    </div>
  );
}
