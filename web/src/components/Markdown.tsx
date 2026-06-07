import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/** A fenced code block with a copy button. `children` is the highlighted <code>. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function copy() {
    const text = ref.current?.innerText ?? "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="group relative my-3">
      <button
        onClick={copy}
        className={`absolute right-2 top-2 rounded-md border px-2 py-1 text-[11px] font-medium opacity-0 transition-all group-hover:opacity-100 ${
          copied ? "border-ok/40 bg-ok/10 text-ok" : "border-border bg-surface-2 text-muted hover:text-fg"
        }`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <pre ref={ref} className="overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-3.5 text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

/** Render assistant markdown: GFM + syntax-highlighted code, links open safely. */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const text = String(children ?? "");
            const isBlock = /language-/.test(className ?? "") || text.includes("\n");
            if (isBlock) return <code className={className} {...props}>{children}</code>;
            return (
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.85em] text-accent-2" {...props}>
                {children}
              </code>
            );
          },
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent-2 underline underline-offset-2 hover:text-accent">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
