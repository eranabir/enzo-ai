import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The single hover-tooltip used across the app — one consistent look everywhere,
 * so no control uses the browser's native (unstyled) `title` tooltip.
 *
 * It renders into a document-body portal with fixed positioning computed from
 * the trigger's rect, so it is never clipped by a scrolling/`overflow` ancestor
 * (e.g. a modal). Short labels stay on one line; long ones wrap within a sensible
 * max width. `side` places it relative to the wrapped control. `wrapClassName`
 * lets a caller keep the wrapper from disturbing layout (e.g. "w-full").
 */
export function Tooltip({ label, side = "bottom", wrapClassName = "", children }: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  wrapClassName?: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; transform: string } | null>(null);

  const GAP = 8; // matches the old mt-2/mb-2 spacing

  const compute = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const map = {
      top:    { top: r.top - GAP,    left: cx,        transform: "translate(-50%, -100%)" },
      bottom: { top: r.bottom + GAP, left: cx,        transform: "translate(-50%, 0)" },
      left:   { top: cy,             left: r.left - GAP,  transform: "translate(-100%, -50%)" },
      right:  { top: cy,             left: r.right + GAP, transform: "translate(0, -50%)" },
    }[side];
    setPos(map);
  };

  const show = () => { compute(); setOpen(true); };
  const hide = () => { setOpen(false); setVisible(false); };

  // Fade in on the frame after mount so opacity transitions from 0.
  useLayoutEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`inline-flex ${wrapClassName}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && pos && createPortal(
        <span
          role="tooltip"
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: pos.transform }}
          className={`pointer-events-none z-[1000] w-max max-w-[260px] whitespace-normal break-words rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-medium leading-snug text-fg shadow-lg transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
