import type { FitTier } from "../../types";

const TIER_STYLE: Record<FitTier, { label: string; cls: string }> = {
  ideal:       { label: "Ideal",     cls: "bg-ok/15 text-ok" },
  good:        { label: "Good",      cls: "bg-accent/15 text-accent-2" },
  marginal:    { label: "Marginal",  cls: "bg-warning/15 text-warning" },
  possible:    { label: "Possible",  cls: "bg-surface-2 text-muted" },
  "too-large": { label: "Too large", cls: "bg-danger/15 text-danger" },
};

/** Hardware-fit badge (Ideal / Good / Marginal …) for a model recommendation. */
export function TierBadge({ tier }: { tier: FitTier }) {
  const t = TIER_STYLE[tier] ?? TIER_STYLE.possible;
  return (
    <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${t.cls}`}>
      {t.label}
    </span>
  );
}
