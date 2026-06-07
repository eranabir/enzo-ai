import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

/** Consistent back/up navigation button used in modal headers and sub-views. */
export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <ChevronLeft className="h-4 w-4" /> {label}
    </button>
  );
}

/**
 * Shared header chrome for all overlay modals (Agents, MCP, Admin, …) so the
 * back button and close button look and behave identically everywhere.
 *
 * Layout: [back?] [title + subtitle]  ……  [actions?] [close]
 *  - onBack   : optional intra-modal navigation (e.g. detail → list)
 *  - onClose  : closes the whole modal
 *  - actions  : optional extra controls rendered left of the close button
 */
export function ModalHeader({
  title,
  subtitle,
  onClose,
  onBack,
  backLabel = "Back",
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && <BackButton onClick={onBack} label={backLabel} />}
        <div className="min-w-0">
          <h2 className="truncate font-bold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg border border-border p-1.5 text-muted transition-colors hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
