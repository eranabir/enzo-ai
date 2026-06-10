/**
 * Shadcn-style Select built on Radix UI Select primitive.
 * Styled to match the Enzo dark theme (Tailwind v4 tokens).
 */
import * as React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

// ── Root / Trigger ────────────────────────────────────────────────────────────

const Select = RadixSelect.Root;
const SelectValue = RadixSelect.Value;
const SelectGroup = RadixSelect.Group;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof RadixSelect.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border",
      "bg-surface-2 px-3 py-2 text-sm text-fg shadow-sm outline-none",
      "placeholder:text-muted",
      "focus:border-accent focus:ring-1 focus:ring-accent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-colors",
      className,
    )}
    {...props}
  >
    {children}
    <RadixSelect.Icon asChild>
      <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
    </RadixSelect.Icon>
  </RadixSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

// ── Content / Portal ──────────────────────────────────────────────────────────

const SelectContent = React.forwardRef<
  React.ElementRef<typeof RadixSelect.Content>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      position={position}
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        "relative z-50 min-w-[8rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border",
        "bg-surface shadow-2xl",
        // Radix animation classes
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" && "min-w-[var(--radix-select-trigger-width)]",
        className,
      )}
      {...props}
    >
      <RadixSelect.Viewport className="p-1 max-h-60 overflow-y-auto">{children}</RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));
SelectContent.displayName = "SelectContent";

// ── Label ─────────────────────────────────────────────────────────────────────

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof RadixSelect.Label>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Label>
>(({ className, ...props }, ref) => (
  <RadixSelect.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted", className)}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

// ── Item ──────────────────────────────────────────────────────────────────────

const SelectItem = React.forwardRef<
  React.ElementRef<typeof RadixSelect.Item>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Item> & {
    /** Text shown in the trigger when this item is selected.
     *  When omitted, `children` is used for both trigger and dropdown. */
    label?: React.ReactNode;
  }
>(({ className, children, label, ...props }, ref) => (
  <RadixSelect.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm text-fg outline-none whitespace-nowrap",
      "focus:bg-surface-2 focus:text-fg",
      "data-[state=checked]:text-accent-2",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      "transition-colors",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <RadixSelect.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-accent-2" />
      </RadixSelect.ItemIndicator>
    </span>
    {/* ItemText is copied into the trigger — when label is given, only label shows there.
        min-w-0 + truncate lets a long model name shrink so the size suffix stays visible. */}
    <RadixSelect.ItemText className="min-w-0 flex-1 truncate">{label ?? children}</RadixSelect.ItemText>
    {/* Badge / size suffix — only in dropdown, pushed to the right */}
    {label && children && (
      <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 pl-2">{children}</span>
    )}
  </RadixSelect.Item>
));
SelectItem.displayName = "SelectItem";

// ── Separator ─────────────────────────────────────────────────────────────────

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof RadixSelect.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Separator>
>(({ className, ...props }, ref) => (
  <RadixSelect.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
