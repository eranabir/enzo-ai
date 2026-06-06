import { ChevronRight } from "lucide-react";

/**
 * Shared card used by both the MCP Servers modal and the Settings → Apps tab.
 * Keeps the two surfaces visually 1:1.
 */
export function ConnectorCard({
  icon,
  iconBg,
  name,
  description,
  added,
  addedLabel = "Added",
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  description: string;
  added?: boolean;
  addedLabel?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={added && !onClick}
      className={`group relative flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
        added
          ? "border-ok/20 bg-ok/5"
          : "border-border bg-surface-2 hover:border-accent/40 hover:bg-surface cursor-pointer"
      }`}
    >
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border overflow-hidden"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{name}</span>
          {added && (
            <span className="flex items-center gap-1 rounded-full bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ok">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />{addedLabel}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted leading-snug mt-0.5 truncate">{description}</p>
      </div>
      {!added && (
        <ChevronRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      )}
    </button>
  );
}

/** Section label used above each card grid. */
export function ConnectorSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted/60">{children}</p>
  );
}
