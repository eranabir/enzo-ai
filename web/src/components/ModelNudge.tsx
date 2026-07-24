import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { Tooltip } from "./ui/Tooltip";
import type { ModelInfo } from "../types";

// Suggested upgrades — capable but still modest models the analyzer recommends.
const SUGGESTED = "qwen2.5:7b or llama3.1:8b";

// On-disk size below which a local model is "small" and prone to unreliable
// answers / tool misuse. ~3B models are ~2 GB; 7-8B models are ~4.5-5 GB, so
// 4 GB cleanly separates the weak tier from the dependable one.
const SMALL_MODEL_GB = 4.0;

function sizeGb(label?: string): number | null {
  const m = label?.match(/([\d.]+)\s*GB/i);
  return m ? parseFloat(m[1]) : null;
}

const STORAGE_KEY = "enzo_model_nudge_dismissed";

/**
 * Subtle, dismissible hint shown when the active chat model is a small local
 * model — nudges the user toward a more capable model for cleaner answers.
 * Dismissal is remembered per-model.
 */
export function ModelNudge({ model, models, onManageModels }: {
  model: string;
  models: ModelInfo[];
  onManageModels: () => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });

  const info = models.find((m) => m.id === model);
  const gb = info?.provider === "ollama" ? sizeGb(info.label) : null;
  const isSmall = gb != null && gb < SMALL_MODEL_GB;
  if (!isSmall || dismissed.includes(model)) return null;

  const dismiss = () => {
    const next = [...dismissed, model];
    setDismissed(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div className="mx-auto w-full max-w-[780px] px-6 pt-3">
      <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted">
        <Lightbulb className="h-3.5 w-3.5 flex-shrink-0 text-accent-2" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-fg">{model}</span> is a small model — it may give unreliable answers or misuse tools. For sharper results, try{" "}
          <button onClick={onManageModels} className="font-semibold text-accent-2 hover:underline">{SUGGESTED}</button>.
        </span>
        <Tooltip label="Dismiss" side="left">
        <button onClick={dismiss} className="flex-shrink-0 text-muted hover:text-fg" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
        </Tooltip>
      </div>
    </div>
  );
}
