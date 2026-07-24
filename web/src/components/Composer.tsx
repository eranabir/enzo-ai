import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Square, Paperclip, X, FileText, FolderGit2, Folder, CornerLeftUp, GitBranch } from "lucide-react"; // image + document upload
import { Tooltip } from "./ui/Tooltip";

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

type FolderCheck = {
  exists: boolean; isDirectory: boolean; isGit: boolean; branch: string | null;
  diffStat: { insertions: number; deletions: number } | null;
};
type FolderListing = { path: string; parent: string | null; folders: string[] };

/** Join a directory and a child name using whichever separator the directory
 *  string already uses (Windows paths use "\", everything else "/"). The
 *  server re-resolves the result, so this only needs to be roughly right. */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** Attach/detach a local project folder (for list_directory/read_file/git tools) as a
 *  row inside the input box — same placement as the agent label above it. Lets the
 *  user click their way down through subfolders instead of typing a path. */
function FolderRow({
  chatId, folderPath, onSetFolderPath, onCheckFolder, onBrowseFolder,
}: {
  chatId: string | null;
  folderPath: string | null | undefined;
  onSetFolderPath: (path: string | null) => void;
  onCheckFolder: (path: string) => Promise<FolderCheck>;
  onBrowseFolder: (path?: string) => Promise<FolderListing>;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [gitInfo, setGitInfo] = useState<FolderCheck | null>(null);

  // Reset local editing state when switching chats.
  useEffect(() => {
    setBrowsing(false);
  }, [chatId]);

  // Branch/git indicator for the collapsed display row.
  useEffect(() => {
    if (!folderPath) { setGitInfo(null); return; }
    onCheckFolder(folderPath).then(setGitInfo).catch(() => setGitInfo(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath]);

  async function loadDir(path?: string) {
    setLoading(true);
    try {
      const res = await onBrowseFolder(path);
      setListing(res);
      setPathInput(res.path);
    } finally {
      setLoading(false);
    }
  }

  function openBrowser() {
    setBrowsing(true);
    loadDir(folderPath ?? undefined);
  }

  function selectCurrent() {
    if (listing) onSetFolderPath(listing.path);
    setBrowsing(false);
  }

  function remove() {
    onSetFolderPath(null);
    setBrowsing(false);
  }

  if (!browsing) {
    const folderName = folderPath ? folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath : null;
    const diff = gitInfo?.isGit ? gitInfo.diffStat : null;
    const hasDiff = diff && (diff.insertions > 0 || diff.deletions > 0);
    return (
      <button
        type="button"
        onClick={openBrowser}
        title={folderPath ?? "Attach a project folder"}
        className="mb-2 flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-left text-xs transition-colors hover:border-accent/40"
      >
        <FolderGit2 className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
        {folderName ? (
          <>
            <span className="font-semibold text-fg">{folderName}</span>
            {gitInfo?.isGit && gitInfo.branch && (
              <span className="flex items-center gap-1 text-muted">
                <GitBranch className="h-3 w-3" />
                {gitInfo.branch}
              </span>
            )}
            {hasDiff && (
              <span className="ml-auto flex items-center gap-2 font-mono text-[11px] font-semibold">
                {diff!.insertions > 0 && <span className="text-ok">+{diff!.insertions}</span>}
                {diff!.deletions > 0 && <span className="text-danger">-{diff!.deletions}</span>}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted">Choose a project folder…</span>
        )}
      </button>
    );
  }

  return (
    <div className="mb-2 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
      {/* Current path — editable for pasting an exact path, but the list below is the primary way to navigate */}
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); loadDir(pathInput); }
            if (e.key === "Escape") setBrowsing(false);
          }}
        />
        <Tooltip label="Up one level" side="top">
        <button
          type="button"
          disabled={!listing?.parent}
          aria-label="Up one level"
          onClick={() => listing?.parent && loadDir(listing.parent)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-fg disabled:opacity-30"
        >
          <CornerLeftUp className="h-3.5 w-3.5" />
        </button>
        </Tooltip>
      </div>

      {/* Subfolders — click to descend without typing */}
      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border">
        {loading ? (
          <div className="px-3 py-4 text-center text-xs text-muted">Loading…</div>
        ) : !listing || listing.folders.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">No subfolders</div>
        ) : (
          listing.folders.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => loadDir(joinPath(listing.path, name))}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface hover:text-fg"
            >
              <Folder className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{name}</span>
            </button>
          ))
        )}
      </div>

      <div className="mt-2 flex gap-2">
        {folderPath && (
          <button type="button" onClick={remove} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-danger">
            Remove
          </button>
        )}
        <button type="button" onClick={() => setBrowsing(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-fg">
          Cancel
        </button>
        <button type="button" onClick={selectCurrent} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2">
          Select This Folder
        </button>
      </div>
    </div>
  );
}

interface ComposerProps {
  busy: boolean;
  disabled: boolean;
  canAttachImage?: boolean;
  agentLabel?: { emoji: string; name: string } | null;
  chatId: string | null;
  folderPath?: string | null;
  onSetFolderPath: (path: string | null) => void;
  onCheckFolder: (path: string) => Promise<FolderCheck>;
  onBrowseFolder: (path?: string) => Promise<FolderListing>;
  onSend: (text: string, image?: AttachedImage, doc?: AttachedDocument) => void;
  onStop: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ busy, disabled, canAttachImage, agentLabel, chatId, folderPath, onSetFolderPath, onCheckFolder, onBrowseFolder, onSend, onStop }, ref) {
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
            <Tooltip label="Remove image" side="top">
            <button
              onClick={() => setImage(null)}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 border border-border text-muted hover:text-fg shadow"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Document attachment chip */}
      {doc && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm shadow">
          <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-fg" title={doc.name}>{doc.name}</span>
          <span className="flex-shrink-0 text-xs text-muted">{formatSize(doc.size)}</span>
          <Tooltip label="Remove document" side="top">
          <button
            onClick={() => setDoc(null)}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-muted hover:text-fg"
            aria-label="Remove document"
          >
            <X className="h-3 w-3" />
          </button>
          </Tooltip>
        </div>
      )}

      {/* Attachment error (e.g. too large / unsupported) */}
      {err && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1">{err}</span>
          <Tooltip label="Dismiss" side="top">
          <button onClick={() => setErr(null)} className="flex-shrink-0 hover:text-fg" aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
          </Tooltip>
        </div>
      )}

      {/* Project folder — its own bar above the input, like a repo/branch status bar */}
      {chatId && (
        <FolderRow chatId={chatId} folderPath={folderPath} onSetFolderPath={onSetFolderPath} onCheckFolder={onCheckFolder} onBrowseFolder={onBrowseFolder} />
      )}

      {/* Unified input container — a column: optional agent-label row on top, then the input row */}
      <div
        className={`rounded-2xl border bg-surface-2 transition-all duration-200 ${
          focused
            ? "border-accent/60 shadow-[0_0_0_1px_rgba(109,94,252,0.25),0_0_20px_rgba(109,94,252,0.12)]"
            : "border-border"
        }`}
      >
        {agentLabel && (
          <div className="flex items-center gap-1.5 border-b border-border px-4 pb-2 pt-2.5 text-[11px] font-medium text-muted">
            <span>{agentLabel.emoji}</span>
            <span>Using agent: {agentLabel.name}</span>
          </div>
        )}
        <div className="flex items-end">
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
              <Tooltip label={canAttachImage ? "Attach a document or image" : "Attach a document (PDF, Word, Excel, text)"} side="top">
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                aria-label="Attach"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              </Tooltip>
            )}
            {busy ? (
              <Tooltip label="Stop generating" side="top">
              <button
                onClick={onStop}
                aria-label="Stop generating"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-danger hover:text-danger"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
              </Tooltip>
            ) : (
              <Tooltip label="Send (Enter)" side="top">
              <button
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  canSend
                    ? "bg-accent text-white shadow-[0_0_12px_rgba(109,94,252,0.4)] hover:bg-accent-2 hover:shadow-[0_0_16px_rgba(139,125,255,0.5)]"
                    : "bg-surface text-muted/40 cursor-not-allowed"
                }`}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-muted/40">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
});
