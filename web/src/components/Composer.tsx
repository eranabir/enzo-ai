import { useRef, useState } from "react";
import { ArrowUp, Square, Paperclip, X } from "lucide-react"; // image upload support

export interface AttachedImage {
  base64: string;   // without data-URI prefix
  mime: string;     // e.g. "image/jpeg"
  preview: string;  // data-URI for <img> preview
}

export function Composer({
  busy,
  disabled,
  canAttachImage,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  canAttachImage?: boolean;
  onSend: (text: string, image?: AttachedImage) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [image, setImage] = useState<AttachedImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = text.trim();
    if ((!t && !image) || busy) return;
    onSend(t || " ", image ?? undefined);
    setText("");
    setImage(null);
  };

  const canSend = (!!text.trim() || !!image) && !busy;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(",");
      const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
      setImage({ base64, mime, preview: dataUrl });
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="mx-auto w-full max-w-[780px] px-6 pb-6 pt-3">
      {/* Image preview strip */}
      {image && (
        <div className="mb-2 flex items-start gap-2">
          <div className="relative inline-block">
            <img
              src={image.preview}
              alt="attachment"
              className="max-h-32 max-w-48 rounded-xl border border-border object-cover shadow"
            />
            <button
              onClick={() => setImage(null)}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 border border-border text-muted hover:text-fg shadow"
              title="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Unified input container */}
      <div
        className={`relative flex items-end rounded-2xl border bg-surface-2 transition-all duration-200 ${
          focused
            ? "border-accent/60 shadow-[0_0_0_1px_rgba(109,94,252,0.25),0_0_20px_rgba(109,94,252,0.12)]"
            : "border-border"
        }`}
      >
        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />

        <textarea
          className="max-h-[200px] min-h-[52px] flex-1 resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-fg outline-none placeholder:text-muted/60"
          placeholder={disabled ? "Start Ollama to begin chatting…" : "Message Enzo AI…"}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        {/* Action buttons: attach + send/stop */}
        <div className="flex flex-shrink-0 items-end gap-1 p-2">
          {canAttachImage && !busy && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              title="Attach image"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          )}
          {busy ? (
            <button
              onClick={onStop}
              title="Stop generating"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-danger hover:text-danger"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              title="Send (Enter)"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                canSend
                  ? "bg-accent text-white shadow-[0_0_12px_rgba(109,94,252,0.4)] hover:bg-accent-2 hover:shadow-[0_0_16px_rgba(139,125,255,0.5)]"
                  : "bg-surface text-muted/40 cursor-not-allowed"
              }`}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-muted/40">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
