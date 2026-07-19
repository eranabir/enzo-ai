/** Hover label for a control whose purpose or state isn't obvious from its icon/text alone. */
export function Tooltip({ label, side = "bottom", children }: {
  label: string;
  side?: "bottom" | "right";
  children: React.ReactNode;
}) {
  const posCls = side === "bottom"
    ? "left-1/2 top-full mt-2 -translate-x-1/2"
    : "left-full top-1/2 ml-2 -translate-y-1/2";

  return (
    <div className="group/tip relative flex">
      {children}
      <span
        className={`pointer-events-none absolute ${posCls} z-50 whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-fg opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100`}
      >
        {label}
      </span>
    </div>
  );
}
