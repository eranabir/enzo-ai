import { Brain, Cpu } from "lucide-react";
import type { Conversation, ModelInfo } from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";

export function Header({
  models,
  model,
  online,
  activeConversation,
  onModelChange,
  onToggleMemory,
}: {
  models: ModelInfo[];
  model: string;
  online: boolean | null;
  activeConversation: Conversation | null;
  onModelChange: (m: string) => void;
  onToggleMemory: (enabled: boolean) => void;
}) {
  const statusColor =
    online ? "text-ok" : online === false ? "text-danger" : "text-muted";

  const memoryOn = activeConversation
    ? activeConversation.memory_enabled !== 0
    : true; // default for new conversations

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg px-5 py-2.5">
      <div className="font-semibold tracking-tight">Enzo</div>

      <div className="flex items-center gap-3">
        {/* Engine status */}
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold ${statusColor}`}
          title={
            online ? "Local engine connected"
            : online === false ? "Ollama not running"
            : "Checking…"
          }
        >
          <span className="text-[10px]">●</span>
          {online ? "Local" : online === false ? "Offline" : "…"}
        </div>

        {/* Memory toggle — only shown when a conversation is active */}
        {activeConversation && (
          <button
            onClick={() => onToggleMemory(!memoryOn)}
            title={memoryOn ? "Memory on — click to disable for this conversation" : "Memory off — click to enable"}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-fg"
          >
            <Brain className={`h-3.5 w-3.5 transition-colors ${memoryOn ? "text-accent-2" : "text-muted"}`} />
            <span className={memoryOn ? "text-fg" : "text-muted"}>Memory</span>
            {/* Toggle switch */}
            <div className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors duration-200 ${memoryOn ? "bg-accent" : "bg-border"}`}>
              <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${memoryOn ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </div>
          </button>
        )}

        {/* Model picker */}
        <Select value={model} onValueChange={onModelChange} disabled={models.length === 0}>
          <SelectTrigger className="w-52">
            <Cpu className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
            <SelectValue placeholder="No models installed" />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="font-medium">{m.id}</span>
                {m.label && (
                  <span className="ml-2 text-xs text-muted">{m.label}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
