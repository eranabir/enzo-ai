import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Square, Paperclip, X, FileText } from "lucide-react"; // image + document upload

export interface AttachedImage {
  base64: string;   // without data-URI prefix
  mime: string;     // e.g. "image/jpeg"
  preview: string;  // data-URI for <img> preview
}

export interface AttachedDocument {
  base64: string;   // raw file bytes (no data-URI prefix)
  mime: string;     // e.g. "application/pdf"
  name: string;     // original filename
  size: number;     // bytes
}

// Documents the chat can read (extracted to text server-side). Images are added
// only when the model is vision-capable (handled via canAttachImage).
const DOCUMENT_ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.log,.xml,.yaml,.yml,.html,.htm," +
  ".css,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cc,.cs,.php,.sh," +
  ".sql,.toml,.ini,.pdf,.doc,.docx,.xls,.xlsx";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface ComposerHandle {
  /** Attach a file exactly as if it had been picked from the file dialog — used by the page-level drag-and-drop zone. */
  attachFile: (file: File) => void;
}

interface ComposerProps {
  busy: boolean;
  disabled: boolean;
  canAttachImage?: boolean;
  onSend: (text: string, image?: AttachedImage, doc?: AttachedDocument) => void;
  onStop: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ busy, disabled, canAttachImage, onSend, onStop }, ref) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [doc, setDoc] = useState<AttachedDocument | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = text.trim();
    if ((!t && !image && !doc) || busy) return;
    onSend(t || " ", image ?? undefined, doc ?? undefined);
    setText("");
    setImage(null);
    setDoc(null);
  };

  const canSend = (!!text.trim() || !!image || !!doc) && !busy;

  const accept = (canAttachImage ? "image/*," : "") + DOCUMENT_ACCEPT;

  const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — base64 stays under the server's 30 MB body limit

  const processFile = (file: File) => {
    if (disabled) return;
    if (file.size > MAX_BYTES) {
      setErr(`"${file.name}" is ${formatSize(file.size)} — files must be under 20 MB.`);
      return;
    }
    setErr(null);
    const isImage = file.type.startsWith("image/");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(",");
      const mime = header.match(/data:([^;]+)/)?.[1] ?? file.type;
      if (isImage && canAttachImage) {
        setImage({ base64, mime: mime || "image/jpeg", preview: dataUrl });
        setDoc(null);
      } else {
        // Documents (and any non-image) go through server-side text extraction.
        setDoc({ base64, mime: mime || file.type || "application/octet-stream", name: file.name, size: file.size });
        setImage(null);
      }
    };
    reader.readAsDataURL(file);
  };

  useImperativeHandle(ref, () => ({ attachFile: processFile }));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset early so the same file can be re-selected
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...(e.clipboardData?.items ?? [])]
      .find((item) => item.kind === "file")
      ?.getAsFile();
    if (file) {
      e.preventDefault();
      processFile(file);
    }
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

      {/* Document attachment chip */}
      {doc && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm shadow">
          <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-fg" title={doc.name}>{doc.name}</span>
          <span className="flex-shrink-0 text-xs text-muted">{formatSize(doc.size)}</span>
          <button
            onClick={() => setDoc(null)}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-muted hover:text-fg"
            title="Remove document"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Attachment error (e.g. too large / unsupported) */}
      {err && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1">{err}</span>
          <button onClick={() => setErr(null)} className="flex-shrink-0 hover:text-fg" title="Dismiss">
            <X className="h-3 w-3" />
          </button>
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
          accept={accept}
          className="hidden"
          onChange={handleFile}
        />

        <textarea
          dir="auto"
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
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        {/* Action buttons: attach + send/stop */}
        <div className="flex flex-shrink-0 items-end gap-1 p-2">
          {!busy && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              title={canAttachImage ? "Attach a document or image" : "Attach a document (PDF, Word, Excel, text)"}
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
});
