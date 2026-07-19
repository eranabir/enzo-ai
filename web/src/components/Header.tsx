import { Brain, Cpu, Wrench, Eye, Lock } from "lucide-react";
import type { Chat, ModelInfo } from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";
import { Tooltip } from "./ui/Tooltip";

export function Header({
  models,
  model,
  online,
  activeChat,
  onModelChange,
  onToggleMemory,
}: {
  models: ModelInfo[];
  model: string;
  online: boolean | null;
  activeChat: Chat | null;
  onModelChange: (m: string) => void;
  onToggleMemory: (enabled: boolean) => void;
}) {
  const statusColor =
    online ? "text-ok" : online === false ? "text-danger" : "text-muted";

  const memoryOn = activeChat
    ? activeChat.memory_enabled !== 0
    : true; // default for new chats

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg px-5 py-2.5">
      <div className="min-w-0 max-w-[280px]">
        {activeChat
          ? <p dir="auto" className="truncate text-sm font-semibold text-fg">{activeChat.title}</p>
          : <p className="text-sm font-semibold text-muted"></p>
        }
      </div>

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

        {/* Memory toggle — only shown when a chat is active */}
        {activeChat && (
          <button
            onClick={() => onToggleMemory(!memoryOn)}
            title={memoryOn ? "Memory on — click to disable for this chat" : "Memory off — click to enable"}
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

        {/* Model picker — locked when this chat belongs to an agent, since the
            agent's own model always governs it (changing it here would do nothing). */}
        {activeChat?.agent_id ? (
          <Tooltip label="Using agent model">
            <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted">
              <Lock className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="max-w-[160px] truncate">{model || "Agent default"}</span>
            </div>
          </Tooltip>
        ) : (
        <Select value={model} onValueChange={onModelChange} disabled={models.length === 0}>
          <SelectTrigger className="max-w-[220px]">
            <Cpu className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
              <SelectValue placeholder="No models installed" />
            </span>
          </SelectTrigger>
          <SelectContent className="w-64">
            {models.map((m) => {
              const isExternal = ["openai","anthropic","google"].includes(m.provider);
              const providerBadge: Record<string, string> = {
                openai:    "text-green-400",
                anthropic: "text-amber-400",
                google:    "text-blue-400",
              };
              const providerLabel: Record<string, string> = {
                openai: "OpenAI", anthropic: "Claude", google: "Gemini",
              };
              const displayName = isExternal ? (m.label ?? m.id.split(":")[1]) : m.id;
              const sizeHint    = isExternal ? null : m.label;

              return (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  label={<span className="font-medium">{displayName}</span>}
                >
                  {/* Suffix shown only in the dropdown, not in the trigger */}
                  {sizeHint && (
                    <span className="text-xs text-muted">{sizeHint}</span>
                  )}
                  {m.supportsTools && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2" title="Supports tools / function calling">
                      <Wrench className="h-2.5 w-2.5" /> Tools
                    </span>
                  )}
                  {m.supportsVision && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted" title="Can read images">
                      <Eye className="h-2.5 w-2.5" /> Vision
                    </span>
                  )}
                  {providerLabel[m.provider] && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${providerBadge[m.provider]}`}>
                      {providerLabel[m.provider]}
                    </span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        )}
      </div>
    </header>
  );
}
