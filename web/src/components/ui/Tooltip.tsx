/**
 * The single hover-tooltip used across the app — one consistent look everywhere,
 * so no control uses the browser's native (unstyled) `title` tooltip.
 *
 * Short labels stay on one line; long ones (e.g. a full tool description) wrap
 * within a sensible max width instead of stretching off-screen. `side` places
 * it relative to the wrapped control. `wrapClassName` lets a caller keep the
 * wrapper from disturbing layout (e.g. "inline-flex", "w-full").
 */
export function Tooltip({ label, side = "bottom", wrapClassName = "", children }: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  wrapClassName?: string;
  children: React.ReactNode;
}) {
  const posCls = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  }[side];

  return (
    <span className={`group/tip relative inline-flex ${wrapClassName}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${posCls} z-50 w-max max-w-[260px] whitespace-normal break-words rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-medium leading-snug text-fg opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}
