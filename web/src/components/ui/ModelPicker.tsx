/**
 * Reusable model selector dropdown.
 *
 * Rule: everywhere a model needs to be chosen, use this component.
 * - Always shows available models fetched from the API
 * - First option is always "System default (model-name)" pre-selected
 * - Models grouped by provider
 * - value="" means "use system default"
 */
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { api } from "../../api";
import type { ModelInfo } from "../../types";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from "./Select";

interface Props {
  value: string;           // "" = system default
  onChange: (v: string) => void;
  /** Pre-fetched models (skip internal fetch if provided) */
  models?: ModelInfo[];
  /** Pre-fetched default model ID (skip internal fetch if provided) */
  defaultModelId?: string;
  className?: string;
  disabled?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama:    "Local (Ollama)",
  openai:    "OpenAI",
  anthropic: "Anthropic",
  google:    "Google Gemini",
};

const PROVIDER_BADGE_COLORS: Record<string, string> = {
  openai:    "text-green-400",
  anthropic: "text-amber-400",
  google:    "text-blue-400",
};

export function ModelPicker({ value, onChange, models: propModels, defaultModelId: propDefault, className, disabled }: Props) {
  const [models, setModels]           = useState<ModelInfo[]>(propModels ?? []);
  const [defaultModel, setDefault]    = useState<string>(propDefault ?? "");

  // Fetch if not provided via props
  useEffect(() => {
    if (propModels && propDefault !== undefined) return;
    api.models().then(({ models: m, default: def }) => {
      // Embedding-only models can't run an agent — hide them.
      if (!propModels)  setModels(m.filter((x) => x.supportsChat !== false));
      if (!propDefault) setDefault(def);
    }).catch(() => {});
  }, [propModels, propDefault]);

  const defaultLabel = defaultModel
    ? `System default (${displayName(models, defaultModel)})`
    : "System default";

  const providers = ["ollama", "openai", "anthropic", "google"] as const;

  return (
    <Select
      value={value || "__default__"}
      onValueChange={(v) => onChange(v === "__default__" ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue placeholder={defaultLabel} />
      </SelectTrigger>
      <SelectContent>
        {/* System default — always first */}
        <SelectItem value="__default__" label={<span className="text-muted">{defaultLabel}</span>}>
          <span className="text-muted">{defaultLabel}</span>
        </SelectItem>

        {models.length > 0 && <SelectSeparator />}

        {providers.map((pid) => {
          // Only chat-capable models — embedding models can't run an agent.
          const pm = models.filter((m) => m.provider === pid && m.supportsChat !== false);
          if (!pm.length) return null;
          return (
            <SelectGroup key={pid}>
              <SelectLabel>{PROVIDER_LABELS[pid] ?? pid}</SelectLabel>
              {pm.map((m) => {
                const name = pid !== "ollama" ? (m.label ?? m.id.split(":")[1]) : m.id;
                const badge = PROVIDER_BADGE_COLORS[pid];
                return (
                  <SelectItem key={m.id} value={m.id} label={<span className="font-medium">{name}</span>}>
                    <span className="font-medium">{name}</span>
                    {m.label && pid === "ollama" && (
                      <span className="ml-1.5 text-xs text-muted">{m.label}</span>
                    )}
                    {m.supportsTools && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2" title="Supports tools / function calling">
                        <Wrench className="h-2.5 w-2.5" /> Tools
                      </span>
                    )}
                    {badge && (
                      <span className={`text-[10px] font-bold uppercase ${badge}`}>
                        {PROVIDER_LABELS[pid]?.split(" ")[0]}
                      </span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function displayName(models: ModelInfo[], id: string): string {
  const m = models.find((x) => x.id === id);
  if (!m) return id;
  if (m.provider !== "ollama") return m.label ?? m.id.split(":")[1] ?? id;
  return m.id;
}
